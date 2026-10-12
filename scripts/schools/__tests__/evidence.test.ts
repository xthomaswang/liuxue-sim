import { describe, expect, it } from "vitest";
import {
  processEvidence, resolveRankings, schoolNameVariants, sharedRankWarnings, sourceDomainProblem, validateEntryShape,
} from "../lib/evidence.ts";
import type { DirectoryLookup } from "../lib/evidence.ts";
import { evidenceEntry, evidenceFile, fakeSite, rankPage, verifierFor } from "./helpers.ts";

const directory: Record<string, { instnm: string; webaddr: string }> = {
  "100001": { instnm: "Test University", webaddr: "www.test.edu/" },
  "100002": { instnm: "Test University-Branch Campus", webaddr: "https://branch.test.edu/" },
  "100003": { instnm: "Other College", webaddr: "www.othercollege.org" },
};
const lookup: DirectoryLookup = (unitid) => directory[unitid];

const URL = "https://news.test.edu/rank";
const GOOD_PAGE = rankPage("Test University is ranked No. 42 among National Universities in the 2027 edition.");

function run(entries: ReturnType<typeof evidenceEntry>[], pages: Parameters<typeof fakeSite>[0], options = {}) {
  const site = fakeSite(pages);
  const verifier = verifierFor(site, options);
  const processed = processEvidence([evidenceFile("t", entries)], lookup, verifier);
  return { site, verifier, processed };
}

describe("证据的机械复核", () => {
  it("2xx + 引文命中 + 页面提到 2027 + 能认出学校 + 引文含名次 → VERIFIED", () => {
    const { processed } = run([evidenceEntry()], { [URL]: GOOD_PAGE });
    expect(processed[0].status).toBe("VERIFIED");
    expect(processed[0].record?.checks).toMatchObject({
      http2xx: true, mentions2027: true, quoteMatch: true, schoolIdentified: "OFFICIAL_DOMAIN", rankNumberInQuote: true,
    });
  });

  it("引文匹配忽略大小写、弯引号、长短横线与多余空白", () => {
    const page = rankPage("Test&nbsp;University is ranked <b>No.&nbsp;42</b> among   National Universities &mdash; a “record” high");
    const entry = evidenceEntry({ quote: 'test university is ranked no. 42 among national universities - a "record" high' });
    expect(run([entry], { [URL]: page }).processed[0].status).toBe("VERIFIED");
  });

  it("引文不在页面上 → UNVERIFIED / QUOTE_NOT_FOUND", () => {
    const { processed } = run([evidenceEntry({ quote: "Test University is ranked No. 41 among National Universities" })], { [URL]: GOOD_PAGE });
    expect(processed[0]).toMatchObject({ status: "UNVERIFIED", problems: ["QUOTE_NOT_FOUND"] });
  });

  it("categoryQuote 给了就必须同样命中", () => {
    const entry = evidenceEntry({ categoryQuote: "Regional Universities North" });
    expect(run([entry], { [URL]: GOOD_PAGE }).processed[0].problems).toEqual(["CATEGORY_QUOTE_NOT_FOUND"]);
  });

  it("页面没有出现 2027 → 不算当年证据", () => {
    const page = "<p>Test University is ranked No. 42 among National Universities</p>";
    expect(run([evidenceEntry()], { [URL]: page }).processed[0].problems).toEqual(["PAGE_DOES_NOT_MENTION_2027"]);
  });

  it("引文里没有名次数字（或只是别的数字的一部分）→ 不通过", () => {
    const page = rankPage("Test University is ranked No. 142 among National Universities");
    const entry = evidenceEntry({ quote: "Test University is ranked No. 142 among National Universities" });
    expect(run([entry], { [URL]: page }).processed[0].problems).toEqual(["QUOTE_MISSING_RANK_NUMBER"]);
  });

  it("区间名次要求上下限都出现在引文里", () => {
    const page = rankPage("Test University placed in the 392-434 band of National Universities");
    const ok = evidenceEntry({ rankMin: 392, rankMax: 434, quote: "placed in the 392-434 band of National Universities" });
    const missing = evidenceEntry({ rankMin: 392, rankMax: 440, quote: "placed in the 392-434 band of National Universities" });
    expect(run([ok], { [URL]: page }).processed[0].status).toBe("VERIFIED");
    expect(run([missing], { [URL]: page }).processed[0].problems).toEqual(["QUOTE_MISSING_RANK_NUMBER"]);
  });

  it("系统页或新闻稿不在学校自己的域名下时，正文必须出现校名（括注写法拆开后任一即可）", () => {
    const systemUrl = "https://www.statesystem.edu/rankings";
    const page = rankPage("Campus Public National TU Main 12 42");
    const named = evidenceEntry({ sourceUrl: systemUrl, schoolNameInSource: "TU Main (Test University)", quote: "TU Main 12 42" });
    const result = run([named], { [systemUrl]: page }).processed[0];
    expect(result.status).toBe("VERIFIED");
    expect(result.record?.checks.schoolIdentified).toBe("NAME_ON_PAGE");

    const unnamed = evidenceEntry({ sourceUrl: systemUrl, ipedsName: "Test University", schoolNameInSource: "Test U", quote: "12 42" });
    expect(run([unnamed], { [systemUrl]: page }).processed[0].problems).toEqual(["SCHOOL_NOT_IDENTIFIED_ON_PAGE"]);
    expect(schoolNameVariants(named)).toEqual(["TU Main (Test University)", "TU Main", "Test University"]);
  });

  it("HTTP 非 2xx、抓取失败都是 UNVERIFIED，且标为可重试", () => {
    const blocked = run([evidenceEntry()], { [URL]: { status: 406, html: "" } }).processed[0];
    expect(blocked).toMatchObject({ status: "UNVERIFIED", problems: ["HTTP_406"] });
    expect(blocked.record?.transient).toBe(true);
    const down = run([evidenceEntry()], {}).processed[0];
    expect(down).toMatchObject({ status: "UNVERIFIED", problems: ["FETCH_FAILED"] });
  });
});

describe("证据的格式、来源与连接", () => {
  it("格式不合法的条目被拒收，不会去抓取", () => {
    const bad = { ...evidenceEntry(), category: "PUBLIC", rankMin: 0 } as unknown as ReturnType<typeof evidenceEntry>;
    const { processed, site } = run([bad], { [URL]: GOOD_PAGE });
    expect(processed[0].status).toBe("REJECTED");
    expect(processed[0].problems).toEqual(["SCHEMA_INVALID:category", "SCHEMA_INVALID:rankMin"]);
    expect(site.calls).toEqual([]);
    expect(validateEntryShape(evidenceEntry())).toEqual([]);
    expect(validateEntryShape({ ...evidenceEntry(), unitid: "12345" })).toEqual(["SCHEMA_INVALID:unitid-format"]);
  });

  it("旧版次（不是 2027）被拒收，不会冒充当年排名", () => {
    expect(run([evidenceEntry({ edition: 2026 })], { [URL]: GOOD_PAGE }).processed[0]).toMatchObject({
      status: "REJECTED", problems: ["EDITION_NOT_2027"],
    });
  });

  it("UNITID 不在目录里、或 ipedsName 与目录校名不完全一致 → 拒收（不做模糊匹配，不跨校区继承）", () => {
    const unknown = run([evidenceEntry({ unitid: "999999" })], { [URL]: GOOD_PAGE }).processed[0];
    expect(unknown).toMatchObject({ status: "REJECTED", problems: ["UNITID_NOT_IN_DIRECTORY"] });
    const branch = run([evidenceEntry({ unitid: "100002" })], { [URL]: GOOD_PAGE }).processed[0];
    expect(branch).toMatchObject({ status: "REJECTED", problems: ["IPEDS_NAME_MISMATCH"] });
  });

  it("来源域名：机构官方必须是 .edu 或与该校 IPEDS 官网同域；发布方只认 PR Newswire 新闻稿", () => {
    const school = directory["100003"];
    const base = evidenceEntry({ unitid: "100003", ipedsName: "Other College" });
    expect(sourceDomainProblem({ ...base, sourceUrl: "https://news.othercollege.org/x" }, school.webaddr)).toBeNull();
    expect(sourceDomainProblem({ ...base, sourceUrl: "https://www.somewhere.edu/x" }, school.webaddr)).toBeNull();
    expect(sourceDomainProblem({ ...base, sourceUrl: "https://www.localnews.com/x" }, school.webaddr)).toBe("SOURCE_DOMAIN_NOT_OFFICIAL");
    expect(sourceDomainProblem({ ...base, sourceType: "RANK_PUBLISHER", sourceUrl: "https://www.prnewswire.com/x" }, school.webaddr)).toBeNull();
    expect(sourceDomainProblem({ ...base, sourceType: "RANK_PUBLISHER", sourceUrl: "https://www.usnews.com/x" }, school.webaddr)).toBe("SOURCE_DOMAIN_NOT_PUBLISHER");
    const rejected = run([{ ...base, sourceUrl: "https://www.localnews.com/x" }], {}).processed[0];
    expect(rejected).toMatchObject({ status: "REJECTED", problems: ["SOURCE_DOMAIN_NOT_OFFICIAL"] });
  });
});

describe("合并与冲突", () => {
  const second = "https://www.test.edu/about/rankings";
  const pages = {
    [URL]: GOOD_PAGE,
    [second]: rankPage("Test University tied for No. 42 among National Universities"),
  };

  it("同一学校多条一致的证据合并为一个名次，任一条标了并列即为并列", () => {
    const entries = [
      evidenceEntry(),
      evidenceEntry({ sourceUrl: second, tied: true, quote: "Test University tied for No. 42 among National Universities" }),
    ];
    const resolution = resolveRankings(run(entries, pages).processed).get("100001")!;
    expect(resolution).toMatchObject({ status: "VERIFIED", category: "NU", rankMin: 42, rankMax: 42, tied: true });
    expect(resolution.evidence).toHaveLength(2);
  });

  it("类别或名次不一致 → CONFLICT，不挑一个", () => {
    const entries = [
      evidenceEntry(),
      evidenceEntry({ sourceUrl: second, category: "LAC", quote: "Test University tied for No. 42 among National Universities" }),
    ];
    const resolution = resolveRankings(run(entries, pages).processed).get("100001")!;
    expect(resolution.status).toBe("CONFLICT");
    expect(resolution.rankMin).toBeNull();
    expect(resolution.conflictDetail).toBe("LAC:42-42 vs NU:42-42");
  });

  it("未通过复核的条目不参与合并，也不会造成冲突", () => {
    const entries = [evidenceEntry(), evidenceEntry({ sourceUrl: second, rankMin: 40, rankMax: 40, quote: "not on the page 40" })];
    const resolutions = resolveRankings(run(entries, pages).processed);
    expect(resolutions.get("100001")).toMatchObject({ status: "VERIFIED", rankMin: 42 });
  });

  it("两所学校同类别同名次而有人没标并列 → 只给提示", () => {
    const other = "https://news.othercollege.org/rank";
    const entries = [
      evidenceEntry(),
      evidenceEntry({ unitid: "100003", ipedsName: "Other College", schoolNameInSource: "Other College", sourceUrl: other, quote: "Other College is No. 42 among National Universities" }),
    ];
    const processed = run(entries, { [URL]: GOOD_PAGE, [other]: rankPage("Other College is No. 42 among National Universities") }).processed;
    expect(sharedRankWarnings(resolveRankings(processed))).toEqual(["SHARED_RANK_WITHOUT_TIE_FLAG NU 42: 100001, 100003"]);
  });

  it("结果顺序与证据文件、条目的输入顺序无关", () => {
    const a = evidenceEntry();
    const b = evidenceEntry({ unitid: "100003", ipedsName: "Other College", schoolNameInSource: "Other College", sourceUrl: "https://news.othercollege.org/rank", quote: "Other College is No. 7" });
    const site = fakeSite({ [URL]: GOOD_PAGE });
    const forward = processEvidence([evidenceFile("a", [a]), evidenceFile("b", [b])], lookup, verifierFor(site));
    const backward = processEvidence([evidenceFile("b", [b]), evidenceFile("a", [a])], lookup, verifierFor(site));
    expect(backward.map((item) => item.entry.unitid)).toEqual(forward.map((item) => item.entry.unitid));
  });
});

describe("复核缓存", () => {
  it("同一次构建内同一 URL 只抓一次", () => {
    const entries = [evidenceEntry(), evidenceEntry({ quote: "ranked No. 42 among National Universities" })];
    const { site, processed } = run(entries, { [URL]: GOOD_PAGE });
    expect(processed.map((item) => item.status)).toEqual(["VERIFIED", "VERIFIED"]);
    expect(site.calls).toEqual([URL]);
  });

  it("缓存里已有结论的不重抓；--offline 只用缓存，缓存没有的记为 UNVERIFIED", () => {
    const first = run([evidenceEntry()], { [URL]: GOOD_PAGE });
    const cache = first.verifier.exportCache();
    expect(Object.keys(cache.records)).toHaveLength(1);

    const again = run([evidenceEntry()], {}, { cache });
    expect(again.processed[0].status).toBe("VERIFIED");
    expect(again.site.calls).toEqual([]);

    const offline = run([evidenceEntry(), evidenceEntry({ quote: "ranked No. 42 among" })], {}, { cache, offline: true });
    expect(offline.processed.map((item) => item.status).sort()).toEqual(["UNVERIFIED", "VERIFIED"]);
    expect(offline.processed.find((item) => item.status === "UNVERIFIED")?.problems).toEqual(["NOT_IN_CACHE_OFFLINE"]);
    expect(offline.site.calls).toEqual([]);
    expect(Object.keys(offline.verifier.exportCache().records)).toHaveLength(1);
  });

  it("上次因网络失败的条目联网时会重试；--refresh-evidence 则全部重抓", () => {
    const failed = run([evidenceEntry()], {});
    const cache = failed.verifier.exportCache();
    expect(Object.values(cache.records)[0].transient).toBe(true);

    const retried = run([evidenceEntry()], { [URL]: GOOD_PAGE }, { cache });
    expect(retried.processed[0].status).toBe("VERIFIED");
    expect(retried.site.calls).toEqual([URL]);

    const good = retried.verifier.exportCache();
    const refreshed = run([evidenceEntry()], { [URL]: rankPage("the page changed") }, { cache: good, refresh: true });
    expect(refreshed.processed[0].problems).toEqual(["QUOTE_NOT_FOUND"]);
  });
});
