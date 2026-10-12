import { describe, expect, it } from "vitest";
import { runPipeline, RUNTIME_CATALOG_PATH } from "../lib/pipeline.ts";
import type { PipelineInputs } from "../lib/pipeline.ts";
import type { CatalogManifest, CuratedSchoolEntry, RawEvidenceEntry, RuntimeCatalog, SchoolRecord } from "../lib/types.ts";
import {
  curatedEntry, curatedFile, evidenceEntry, evidenceFile, fakeSite, hdRow, icRow, NO_ALIASES, NO_OVERRIDES,
  rankPage, schools, snapshotOf, verifierFor,
} from "./helpers.ts";

/** 合成世界：每档 3 所精选学校（NU 的 S–D，SPECIAL 的 U），外加若干用于各情形的学校。 */
function world() {
  const tiers = ["S", "A", "B", "C", "D"] as const;
  const base = schools(15, 200001, "Ranked University");
  const special = schools(3, 300001, "Art School");
  const curated: CuratedSchoolEntry[] = [
    ...base.hd.map((row, index) => curatedEntry({ unitid: row.UNITID, ipedsName: row.INSTNM, group: "NU", approxTier: tiers[Math.floor(index / 3)] })),
    ...special.hd.map((row) => curatedEntry({ unitid: row.UNITID, ipedsName: row.INSTNM, group: "SPECIAL", approxTier: "U" })),
  ];
  return { hd: [...base.hd, ...special.hd], ic: [...base.ic, ...special.ic], curated };
}

function inputsFor(
  w: ReturnType<typeof world>,
  evidence: RawEvidenceEntry[] = [],
  pages: Parameters<typeof fakeSite>[0] = {},
  extra: Partial<PipelineInputs> = {},
): PipelineInputs {
  return {
    snapshot: snapshotOf(w.hd, w.ic),
    curated: curatedFile(w.curated),
    aliases: NO_ALIASES,
    overrides: NO_OVERRIDES,
    evidenceFiles: evidence.length > 0 ? [evidenceFile("t", evidence)] : [],
    verifier: verifierFor(fakeSite(pages)),
    previousManifest: null,
    now: "2026-10-12T03:00:00Z",
    ...extra,
  };
}

const catalogOf = (outputs: ReturnType<typeof runPipeline>) => outputs.catalog;
const byId = (records: SchoolRecord[], unitid: string) => records.find((record) => record.unitid === unitid);
const runtimeOf = (outputs: ReturnType<typeof runPipeline>) => JSON.parse(outputs.files[RUNTIME_CATALOG_PATH]) as RuntimeCatalog;
const coverageOf = (outputs: ReturnType<typeof runPipeline>) => JSON.parse(outputs.files["data/schools/coverage-report.json"]);
const manifestOf = (outputs: ReturnType<typeof runPipeline>) => JSON.parse(outputs.files["data/schools/manifest.json"]) as CatalogManifest;

describe("精选目录组装", () => {
  it("没有证据时全部用大致档位：不带名次，依据标 APPROXIMATE / UNRANKED_SPECIAL", () => {
    const outputs = runPipeline(inputsFor(world()));
    const runtime = runtimeOf(outputs);
    expect(runtime.mode).toBe("CURATED");
    expect(runtime.releaseStatus).toBe("VALIDATED");
    expect(runtime.counts).toEqual({
      eligible: 18, rankedVerified: 0, verified: 0, approximate: 15, special: 3,
      byTier: { S: 3, A: 3, B: 3, C: 3, D: 3, U: 3 },
    });
    expect(runtime.schools.every((school) => school.rank === null)).toBe(true);
    expect(runtime.schools.filter((school) => school.tier === "U").every((school) => school.group === "SPECIAL" && school.tierBasis === "UNRANKED_SPECIAL")).toBe(true);
    expect(runtime.schools.filter((school) => school.tier !== "U").every((school) => school.tierBasis === "APPROXIMATE")).toBe(true);
    const record = catalogOf(outputs)[0];
    expect(record.ranking).toMatchObject({ status: "MISSING", category: null, rankMin: null, rankMax: null, evidence: [] });
    expect(record.tier).toMatchObject({ value: "S", basis: "APPROXIMATE", mappingVersion: "usnews-2027-game-v2" });
  });

  it("已核实证据优先于大致档位，并带上名次与来源", () => {
    const w = world();
    const target = w.hd[0]; // 精选里记为 S
    const url = "https://news.rankeduniversity1.edu/rank";
    const outputs = runPipeline(inputsFor(w, [
      evidenceEntry({ unitid: target.UNITID, ipedsName: target.INSTNM, schoolNameInSource: target.INSTNM, sourceUrl: url, rankMin: 27, rankMax: 27, tied: true, quote: `${target.INSTNM} tied for No. 27 among National Universities` }),
    ], { [url]: rankPage(`${target.INSTNM} tied for No. 27 among National Universities`) }));
    const record = byId(catalogOf(outputs), target.UNITID)!;
    expect(record.tier).toMatchObject({ value: "A", basis: "VERIFIED_2027", reason: "NU_RANK_27_IN_BAND_21-50" });
    expect(record.ranking).toMatchObject({ status: "VERIFIED", category: "NU", rankMin: 27, rankMax: 27, tied: true });
    expect(record.ranking.evidence[0]).toMatchObject({ sourceUrl: url, verification: "VERIFIED", sourceYear: 2027 });
    expect(record.curation).toMatchObject({ listed: true, approxTier: "S" });
    const school = runtimeOf(outputs).schools.find((item) => item.unitid === target.UNITID)!;
    expect(school).toMatchObject({ tier: "A", tierBasis: "VERIFIED_2027", rank: { category: "NU", rankMin: 27, rankMax: 27, tied: true } });
  });

  it("证据与大致档位相差两档以上 → 仍以证据为准，但列进报告", () => {
    const w = world();
    const target = w.hd[0]; // S
    const url = "https://news.rankeduniversity1.edu/rank";
    const quote = `${target.INSTNM} is No. 88 among National Universities`;
    const outputs = runPipeline(inputsFor(w, [
      evidenceEntry({ unitid: target.UNITID, ipedsName: target.INSTNM, schoolNameInSource: target.INSTNM, sourceUrl: url, rankMin: 88, rankMax: 88, quote }),
    ], { [url]: rankPage(quote) }));
    expect(byId(catalogOf(outputs), target.UNITID)!.tier.value).toBe("B");
    expect(coverageOf(outputs).tierDiscrepancies).toEqual([
      expect.objectContaining({ unitid: target.UNITID, approxTier: "S", verifiedTier: "B", rankMin: 88 }),
    ]);
  });

  it("有已核实证据但不在精选名单里的学校也收进目录；地区类归 REGIONAL", () => {
    const w = world();
    w.hd.push(hdRow({ UNITID: "400001", INSTNM: "Regional College", WEBADDR: "www.regional.edu" }));
    w.ic.push(icRow({ UNITID: "400001" }));
    const url = "https://www.prnewswire.com/news-releases/x.html";
    const quote = "Regional Universities: North 1. Regional College";
    const outputs = runPipeline(inputsFor(w, [
      evidenceEntry({ unitid: "400001", ipedsName: "Regional College", schoolNameInSource: "Regional College", category: "RU_NORTH", rankMin: 1, rankMax: 1, sourceType: "RANK_PUBLISHER", sourceUrl: url, quote }),
    ], { [url]: rankPage(quote) }));
    const record = byId(catalogOf(outputs), "400001")!;
    expect(record.group).toBe("REGIONAL");
    expect(record.tier).toMatchObject({ value: "B", basis: "VERIFIED_2027" });
    expect(record.curation).toEqual({ listed: false, approxTier: null, note: null });
    expect(coverageOf(outputs).counts).toMatchObject({ curatedJoined: 18, evidenceOnlyAdded: 1, inCatalog: 19 });
  });

  it("没通过复核的证据不生效：精选学校保持大致档位，名单外的学校不进目录", () => {
    const w = world();
    w.hd.push(hdRow({ UNITID: "400001", INSTNM: "Regional College", WEBADDR: "www.regional.edu" }));
    w.ic.push(icRow({ UNITID: "400001" }));
    const target = w.hd[0];
    const outputs = runPipeline(inputsFor(w, [
      evidenceEntry({ unitid: target.UNITID, ipedsName: target.INSTNM, sourceUrl: "https://news.rankeduniversity1.edu/rank", rankMin: 150, rankMax: 150, quote: "No. 150" }),
      evidenceEntry({ unitid: "400001", ipedsName: "Regional College", sourceUrl: "https://www.regional.edu/rank", category: "RC_WEST", rankMin: 3, rankMax: 3, quote: "No. 3" }),
    ], {}));
    expect(byId(catalogOf(outputs), target.UNITID)!.tier).toMatchObject({ value: "S", basis: "APPROXIMATE" });
    expect(byId(catalogOf(outputs), "400001")).toBeUndefined();
    expect(coverageOf(outputs).evidence.notVerified).toHaveLength(2);
  });

  it("互相矛盾的已核实证据：精选学校回退到大致档位并记 CONFLICT；名单外的学校不收", () => {
    const w = world();
    w.hd.push(hdRow({ UNITID: "400001", INSTNM: "Outside College", WEBADDR: "www.outside.edu" }));
    w.ic.push(icRow({ UNITID: "400001" }));
    const target = w.hd[3]; // A
    const a = "https://news.rankeduniversity4.edu/a";
    const b = "https://news.rankeduniversity4.edu/b";
    const c = "https://www.outside.edu/a";
    const d = "https://www.outside.edu/b";
    const make = (unitid: string, name: string, url: string, rank: number) =>
      evidenceEntry({ unitid, ipedsName: name, schoolNameInSource: name, sourceUrl: url, rankMin: rank, rankMax: rank, quote: `${name} is No. ${rank}` });
    const outputs = runPipeline(inputsFor(w, [
      make(target.UNITID, target.INSTNM, a, 30), make(target.UNITID, target.INSTNM, b, 60),
      make("400001", "Outside College", c, 30), make("400001", "Outside College", d, 60),
    ], {
      [a]: rankPage(`${target.INSTNM} is No. 30`), [b]: rankPage(`${target.INSTNM} is No. 60`),
      [c]: rankPage("Outside College is No. 30"), [d]: rankPage("Outside College is No. 60"),
    }));
    const record = byId(catalogOf(outputs), target.UNITID)!;
    expect(record.tier).toMatchObject({ value: "A", basis: "APPROXIMATE", reason: "CURATED_APPROXIMATE_TIER_AFTER_RANK_CONFLICT" });
    expect(record.ranking).toMatchObject({ status: "CONFLICT", rankMin: null });
    expect(byId(catalogOf(outputs), "400001")).toBeUndefined();
    const coverage = coverageOf(outputs);
    expect(coverage.rankConflicts).toHaveLength(2);
    expect(coverage.removedSchools).toEqual([expect.objectContaining({ unitid: "400001", status: "RANK_CONFLICT", source: "EVIDENCE_ONLY" })]);
  });

  it("不合格的精选学校被剔除并写明原因（军校、纯线上、已关闭、缺 IC 行）", () => {
    const w = world();
    const extra = [
      { hd: hdRow({ UNITID: "500001", INSTNM: "Service Academy", OBEREG: "0" }), ic: icRow({ UNITID: "500001" }) },
      { hd: hdRow({ UNITID: "500002", INSTNM: "Online University" }), ic: icRow({ UNITID: "500002", DISTNCED: "1" }) },
      { hd: hdRow({ UNITID: "500003", INSTNM: "Closed College", ACT: "D", CYACTIVE: "3", CLOSEDAT: "06302024" }), ic: icRow({ UNITID: "500003" }) },
      { hd: hdRow({ UNITID: "500004", INSTNM: "Unreported College" }), ic: null },
    ];
    for (const item of extra) {
      w.hd.push(item.hd);
      if (item.ic) w.ic.push(item.ic);
      w.curated.push(curatedEntry({ unitid: item.hd.UNITID, ipedsName: item.hd.INSTNM, group: "NU", approxTier: "B" }));
    }
    const outputs = runPipeline(inputsFor(w));
    expect(catalogOf(outputs)).toHaveLength(18);
    const removed = coverageOf(outputs).removedSchools as Array<{ unitid: string; status: string; reasonCodes: string[] }>;
    expect(removed.map((item) => [item.unitid, item.status, item.reasonCodes[0]])).toEqual([
      ["500001", "EXCLUDED", "SPECIAL_ELIGIBILITY_UNSUPPORTED"],
      ["500002", "EXCLUDED", "ONLINE_ONLY_STORY_MISMATCH"],
      ["500003", "EXCLUDED", "CLOSED_OR_NO_NEW_INTAKE"],
      ["500004", "REVIEW_REQUIRED", "MISSING_IC_ROW"],
    ]);
    expect(outputs.summary.counts).toMatchObject({ candidates: 22, eligible: 18, excluded: 3, reviewRequired: 1 });
  });

  it("精选名单连接不上（UNITID 不存在或校名不一致）→ 不收、列入报告，目录降为 DRAFT", () => {
    const w = world();
    w.curated.push(curatedEntry({ unitid: "999999", ipedsName: "Ghost University" }));
    w.curated.push(curatedEntry({ unitid: w.hd[0].UNITID === "200001" ? "200002" : "200001", ipedsName: "Wrong Name University" }));
    const outputs = runPipeline(inputsFor(w));
    const coverage = coverageOf(outputs);
    expect(coverage.joinFailures.map((item: { problem: string }) => item.problem.split("（")[0])).toEqual(["UNITID_NOT_IN_HD2024"]);
    expect(coverage.curatedListProblems).toEqual(["200002 Wrong Name University: DUPLICATE_UNITID"]);
    expect(outputs.summary.releaseStatus).toBe("DRAFT");
    expect(outputs.summary.failedChecks).toEqual(["CURATED_JOIN_EXACT"]);
    expect(catalogOf(outputs)).toHaveLength(18);
  });

  it("精选名单里的校名与 HD 不完全一致 → 连接失败，不会换成别的校区", () => {
    const w = world();
    w.curated[0] = { ...w.curated[0], ipedsName: "Ranked University 1-Other Campus" };
    const outputs = runPipeline(inputsFor(w));
    expect(coverageOf(outputs).joinFailures).toEqual([expect.objectContaining({ unitid: "200001", problem: expect.stringContaining("IPEDS_NAME_MISMATCH") })]);
    expect(byId(catalogOf(outputs), "200001")).toBeUndefined();
  });

  it("地区类学校没有已核实证据就不收；SPECIAL 不能带 S–D 档", () => {
    const w = world();
    w.hd.push(hdRow({ UNITID: "400001", INSTNM: "Regional College" }), hdRow({ UNITID: "400002", INSTNM: "Design School" }));
    w.ic.push(icRow({ UNITID: "400001" }), icRow({ UNITID: "400002" }));
    w.curated.push(curatedEntry({ unitid: "400001", ipedsName: "Regional College", group: "REGIONAL", approxTier: "C" }));
    w.curated.push(curatedEntry({ unitid: "400002", ipedsName: "Design School", group: "SPECIAL", approxTier: "B" }));
    const outputs = runPipeline(inputsFor(w));
    const coverage = coverageOf(outputs);
    expect(coverage.removedSchools).toEqual([expect.objectContaining({ unitid: "400001", status: "REGIONAL_WITHOUT_VERIFIED_EVIDENCE" })]);
    expect(coverage.curatedListProblems).toEqual(["400002 Design School: SPECIAL_MUST_BE_U"]);
  });

  it("任何一池不足 3 所 → DRAFT，不跨档补位、不复制", () => {
    const w = world();
    w.curated = w.curated.filter((entry) => !(entry.group === "SPECIAL" && entry.unitid !== "300001"));
    const outputs = runPipeline(inputsFor(w));
    expect(outputs.summary.releaseStatus).toBe("DRAFT");
    expect(outputs.summary.failedChecks).toEqual(["POOLS_AT_LEAST_3"]);
    const runtime = runtimeOf(outputs);
    expect(runtime.releaseStatus).toBe("DRAFT");
    expect(runtime.counts.byTier.U).toBe(1);
    expect(runtime.schools.filter((school) => school.tier === "U")).toHaveLength(1);
    expect(new Set(runtime.schools.map((school) => school.unitid)).size).toBe(runtime.schools.length);
  });

  it("中文名来自映射文件；对不上的映射让检查失败", () => {
    const w = world();
    const ok = runPipeline(inputsFor(w, [], {}, {
      aliases: { ...NO_ALIASES, entries: [{ unitid: "200001", ipedsName: "Ranked University 1", nameZh: "排名大学一" }, { unitid: "200002", ipedsName: "Ranked University 2", nameZh: null }] },
    }));
    expect(byId(catalogOf(ok), "200001")!.nameZh).toBe("排名大学一");
    expect(byId(catalogOf(ok), "200002")!.nameZh).toBeNull();
    expect(byId(catalogOf(ok), "200003")!.nameZh).toBeNull();
    const bad = runPipeline(inputsFor(w, [], {}, {
      aliases: { ...NO_ALIASES, entries: [{ unitid: "200001", ipedsName: "Some Other University", nameZh: "张冠李戴" }] },
    }));
    expect(byId(catalogOf(bad), "200001")!.nameZh).toBeNull();
    expect(bad.summary.failedChecks).toEqual(["ALIASES_JOIN_EXACT"]);
  });

  it("带官方依据且复核通过的人工覆盖会生效；复核不过的不生效并进报告", () => {
    const w = world();
    const url = "https://www.rankeduniversity1.edu/about";
    const override = {
      unitid: "200001", ipedsName: "Ranked University 1", fact: "specialEligibilitySupported" as const,
      originalValue: true, correctedValue: false, reasonCode: "SPECIAL_ELIGIBILITY_UNSUPPORTED",
      reason: "本科生须加入学员团。", officialUrl: url, quote: "all undergraduates are cadets", verifiedAt: "2026-10-11",
    };
    const overrides = { ...NO_OVERRIDES, overrides: [override] };
    const applied = runPipeline(inputsFor(w, [], { [url]: "<p>At this college all undergraduates are cadets.</p>" }, { overrides }));
    expect(byId(catalogOf(applied), "200001")).toBeUndefined();
    expect(coverageOf(applied).overrides).toEqual([expect.objectContaining({ unitid: "200001", applied: true, verification: "VERIFIED" })]);

    const notApplied = runPipeline(inputsFor(w, [], { [url]: "<p>Nothing relevant here.</p>" }, { overrides }));
    expect(byId(catalogOf(notApplied), "200001")).toBeDefined();
    expect(coverageOf(notApplied).overrides).toEqual([expect.objectContaining({ applied: false, problem: "QUOTE_NOT_FOUND" })]);
  });
});

describe("范围上限：已核实名次超出范围的学校不进目录", () => {
  /** 往合成世界里加一所名单外的学校和它的一条已核实证据。 */
  function withRanked(
    w: ReturnType<typeof world>,
    unitid: string,
    category: RawEvidenceEntry["category"],
    rankMin: number,
    rankMax = rankMin,
  ) {
    const name = `Outside School ${unitid}`;
    const url = `https://www.outside${unitid}.edu/rank`;
    w.hd.push(hdRow({ UNITID: unitid, INSTNM: name, WEBADDR: `www.outside${unitid}.edu` }));
    w.ic.push(icRow({ UNITID: unitid }));
    const label = rankMin === rankMax ? `No. ${rankMin}` : `${rankMin}-${rankMax}`;
    const quote = `${name} is ranked ${label}`;
    return {
      entry: evidenceEntry({ unitid, ipedsName: name, schoolNameInSource: name, category, rankMin, rankMax, sourceUrl: url, quote }),
      page: { [url]: rankPage(quote) },
    };
  }

  function build(cases: Array<[string, RawEvidenceEntry["category"], number, number?]>) {
    const w = world();
    const made = cases.map(([unitid, category, rankMin, rankMax]) => withRanked(w, unitid, category, rankMin, rankMax));
    const pages = Object.assign({}, ...made.map((item) => item.page));
    return runPipeline(inputsFor(w, made.map((item) => item.entry), pages));
  }

  it("综合大学 200 进、201 不进；文理学院 50 进、51 不进", () => {
    const outputs = build([["600200", "NU", 200], ["600201", "NU", 201], ["600050", "LAC", 50], ["600051", "LAC", 51]]);
    const catalog = catalogOf(outputs);
    expect(byId(catalog, "600200")!.tier).toMatchObject({ value: "D", basis: "VERIFIED_2027" });
    expect(byId(catalog, "600050")!.tier).toMatchObject({ value: "B", basis: "VERIFIED_2027" });
    expect(byId(catalog, "600201")).toBeUndefined();
    expect(byId(catalog, "600051")).toBeUndefined();
    const coverage = coverageOf(outputs);
    expect(coverage.outOfScopeRank).toEqual([
      { unitid: "600051", name: "Outside School 600051", listedInCurated: false, category: "LAC", rankMin: 51, rankMax: 51, tied: false, limit: 50, evidenceUrls: ["https://www.outside600051.edu/rank"] },
      { unitid: "600201", name: "Outside School 600201", listedInCurated: false, category: "NU", rankMin: 201, rankMax: 201, tied: false, limit: 200, evidenceUrls: ["https://www.outside600201.edu/rank"] },
    ]);
    expect(coverage.scopeRule).toMatchObject({ version: "curated-scope-v2", limits: { NU: 200, LAC: 50 } });
    expect(manifestOf(outputs).scopeRuleVersion).toBe("curated-scope-v2");
    expect(outputs.summary.failedChecks).toEqual([]);
  });

  it("被这条规则排除的不算被拒证据，也不算资格剔除；数量对得上", () => {
    const outputs = build([["600201", "NU", 201], ["600051", "LAC", 51]]);
    const coverage = coverageOf(outputs);
    expect(coverage.evidence.notVerified).toEqual([]);
    expect(coverage.removedSchools).toEqual([]);
    expect(coverage.counts).toMatchObject({ candidates: 20, inCatalog: 18, removed: 0, outOfScopeRank: 2 });
    expect(outputs.summary.counts).toMatchObject({ candidates: 20, eligible: 18, outOfScopeRank: 2 });
    const entries = JSON.parse(outputs.files["data/schools/rank-evidence.json"]).entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => [entry.unitid, entry.verification, entry.inCatalog, entry.outOfScopeRank])).toEqual([
      ["600051", "VERIFIED", false, true],
      ["600201", "VERIFIED", false, true],
    ]);
  });

  it("在精选名单里也一样：已核实名次超出范围就剔除，不回退到大致档位", () => {
    const w = world();
    const target = w.hd[14]; // 名单里记为 D
    const url = "https://news.rankeduniversity15.edu/rank";
    const quote = `${target.INSTNM} is ranked No. 236 among National Universities`;
    const outputs = runPipeline(inputsFor(w, [
      evidenceEntry({ unitid: target.UNITID, ipedsName: target.INSTNM, schoolNameInSource: target.INSTNM, sourceUrl: url, rankMin: 236, rankMax: 236, quote }),
    ], { [url]: rankPage(quote) }));
    expect(byId(catalogOf(outputs), target.UNITID)).toBeUndefined();
    expect(coverageOf(outputs).outOfScopeRank).toEqual([expect.objectContaining({ unitid: target.UNITID, listedInCurated: true, rankMin: 236 })]);
    // D 池因此只剩 2 所：如实降为 DRAFT，不补位。
    expect(outputs.summary.failedChecks).toEqual(["POOLS_AT_LEAST_3"]);
  });

  it("区间名次按下限判断；地区类不设上限；没有证据的大致档位学校不受影响", () => {
    const outputs = build([["600195", "NU", 195, 205], ["600210", "NU", 210, 240], ["600080", "RU_SOUTH", 80], ["600045", "RC_WEST", 45]]);
    const catalog = catalogOf(outputs);
    expect(byId(catalog, "600195")!.tier.value).toBe("D");
    expect(byId(catalog, "600210")).toBeUndefined();
    expect(byId(catalog, "600080")!).toMatchObject({ group: "REGIONAL", tier: { value: "D" } });
    expect(byId(catalog, "600045")!).toMatchObject({ group: "REGIONAL", tier: { value: "D" } });
    expect(catalog.filter((record) => record.tier.basis === "APPROXIMATE")).toHaveLength(15);
    expect(coverageOf(outputs).outOfScopeRank.map((item: { unitid: string }) => item.unitid)).toEqual(["600210"]);
  });

  it("资格不合格的学校仍归在资格剔除里，不重复出现在范围清单", () => {
    // 一所纯线上、名次又在 200 名以后的学校：先被资格规则剔除。
    const w = world();
    const name = "Online Outside School";
    const url = "https://www.onlineoutside.edu/rank";
    const quote = `${name} is ranked No. 301`;
    w.hd.push(hdRow({ UNITID: "600301", INSTNM: name, WEBADDR: "www.onlineoutside.edu" }));
    w.ic.push(icRow({ UNITID: "600301", DISTNCED: "1" }));
    const entry = evidenceEntry({ unitid: "600301", ipedsName: name, schoolNameInSource: name, rankMin: 301, rankMax: 301, sourceUrl: url, quote });
    const coverage = coverageOf(runPipeline(inputsFor(w, [entry], { [url]: rankPage(quote) })));
    expect(coverage.outOfScopeRank).toEqual([]);
    expect(coverage.removedSchools).toEqual([expect.objectContaining({ unitid: "600301", status: "EXCLUDED" })]);
  });
});

describe("产物的稳定性与一致性", () => {
  function shuffled<T>(items: T[], seed: number): T[] {
    const out = [...items];
    let state = seed;
    for (let i = out.length - 1; i > 0; i--) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const j = state % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  it("打乱 IPEDS 行、精选名单与证据的输入顺序，全部产物字节相同", () => {
    const w = world();
    const url = "https://news.rankeduniversity2.edu/rank";
    const other = "https://news.rankeduniversity9.edu/rank";
    const evidence = [
      evidenceEntry({ unitid: "200002", ipedsName: "Ranked University 2", schoolNameInSource: "Ranked University 2", sourceUrl: url, rankMin: 5, rankMax: 5, quote: "Ranked University 2 is No. 5" }),
      evidenceEntry({ unitid: "200009", ipedsName: "Ranked University 9", schoolNameInSource: "Ranked University 9", sourceUrl: other, rankMin: 77, rankMax: 77, quote: "Ranked University 9 is No. 77" }),
    ];
    const pages = { [url]: rankPage("Ranked University 2 is No. 5"), [other]: rankPage("Ranked University 9 is No. 77") };
    const baseline = runPipeline(inputsFor(w, evidence, pages));
    for (const seed of [1, 7, 42]) {
      const mixed = { hd: shuffled(w.hd, seed), ic: shuffled(w.ic, seed + 1), curated: shuffled(w.curated, seed + 2) };
      const outputs = runPipeline(inputsFor(mixed, shuffled(evidence, seed + 3), pages));
      expect(outputs.files).toEqual(baseline.files);
    }
    expect(baseline.summary.failedChecks).toEqual([]);
  });

  it("目录内容没变时沿用上一次的 generatedAt；内容变了才更新", () => {
    const w = world();
    const first = runPipeline(inputsFor(w, [], {}, { now: "2026-10-12T03:00:00Z" }));
    const again = runPipeline(inputsFor(w, [], {}, { now: "2026-10-13T09:00:00Z", previousManifest: manifestOf(first) }));
    expect(again.files).toEqual(first.files);
    expect(manifestOf(again).generatedAt).toBe("2026-10-12T03:00:00Z");

    w.curated[0] = { ...w.curated[0], approxTier: "A" };
    const changed = runPipeline(inputsFor(w, [], {}, { now: "2026-10-13T09:00:00Z", previousManifest: manifestOf(first) }));
    expect(manifestOf(changed).generatedAt).toBe("2026-10-13T09:00:00Z");
    expect(manifestOf(changed).catalogSha256).not.toBe(manifestOf(first).catalogSha256);
  });

  it("catalog.json 不含易变时间戳，manifest 与运行时快照的哈希、计数和它一致", async () => {
    const outputs = runPipeline(inputsFor(world()));
    const catalogText = outputs.files["data/schools/catalog.json"];
    expect(catalogText).not.toContain("2026-10-12T03:00:00Z");
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(catalogText).digest("hex");
    const manifest = manifestOf(outputs);
    const runtime = runtimeOf(outputs);
    expect(manifest.catalogSha256).toBe(sha);
    expect(runtime.catalogSha256).toBe(sha);
    expect(manifest.mode).toBe("CURATED");
    expect(manifest.catalogVersion).toBe("us-curated-2024dir-usnews2027-v2");
    expect(manifest.tierMappingVersion).toBe("usnews-2027-game-v2");
    expect(runtime.schools).toHaveLength(manifest.counts.eligible);
    expect(runtime.schools.map((school) => school.unitid)).toEqual([...runtime.schools.map((school) => school.unitid)].sort());
    expect(JSON.parse(catalogText).schools).toHaveLength(manifest.counts.eligible);
  });
});
