// 测试用的构造器：合成的 IPEDS 行、快照、证据与假抓取器。不触网、不读真实数据。

import { emptyCache, QuoteVerifier } from "../lib/evidence.ts";
import type { EvidenceCache, Fetcher } from "../lib/evidence.ts";
import type { IpedsFileMeta, IpedsRow, IpedsSnapshot } from "../lib/ipeds.ts";
import { htmlToText } from "../lib/text.ts";
import type { FetchedPage } from "../lib/text.ts";
import type {
  AliasFile, CuratedSchoolEntry, CuratedSchoolFile, OverrideFile, RawEvidenceEntry, RawEvidenceFile,
} from "../lib/types.ts";

/** 一所合格的四年制大学在 HD 里的样子；用 overrides 改出各种情形。 */
export function hdRow(overrides: Partial<IpedsRow> = {}): IpedsRow {
  return {
    UNITID: "100001", INSTNM: "Test University", IALIAS: "", CITY: "Testville", STABBR: "PA", FIPS: "42",
    OBEREG: "2", OPEID: "00100000", WEBADDR: "www.test.edu/", SECTOR: "2", HLOFFER: "9", UGOFFER: "1",
    HDEGOFR1: "11", DEGGRANT: "1", OPENPUBL: "1", ACT: "A", NEWID: "-2", CLOSEDAT: "-2", CYACTIVE: "1",
    INSTCAT: "2", F1SYSTYP: "2", F1SYSNAM: "",
    ...overrides,
  } as IpedsRow;
}

export function icRow(overrides: Partial<IpedsRow> = {}): IpedsRow {
  return {
    UNITID: "100001", LEVEL5: "1", FT_UG: "1", FT_FTUG: "1", PT_UG: "1", PT_FTUG: "1", DISTNCED: "2",
    ...overrides,
  } as IpedsRow;
}

function meta(base: string, rows: number): IpedsFileMeta {
  return {
    id: `ipeds-${base.toLowerCase()}`, zipFilename: `${base}.zip`, zipSha256: "a".repeat(64), zipBytes: 1,
    csvMember: `${base}.csv`, csvSha256: "b".repeat(64), csvBytes: 1, csvEncoding: "utf-8",
    dictionaryZipFilename: `${base}_Dict.zip`, dictionaryZipSha256: "c".repeat(64),
    dictionaryMember: `${base}_dict.xlsx`, dictionaryTitle: `${base} dictionary`, releaseLabel: null,
    dataRows: rows, problems: [],
  };
}

export function snapshotOf(hd: IpedsRow[], ic: IpedsRow[]): IpedsSnapshot {
  return {
    dir: "/synthetic", fetchedAt: "2026-10-12T00:00:00Z", hd, ic,
    hdMeta: meta("HD2024", hd.length), icMeta: meta("IC2024", ic.length),
    directoryRelease: "UNVERIFIED", directoryReleaseBasis: { rule: "synthetic" },
    fipsLabels: { "42": "Pennsylvania", "6": "California", "64": "Federated States of Micronesia" },
    stabbrLabels: { PA: "Pennsylvania", CA: "California", FM: "Federated States of Micronesia" },
  };
}

/** 成批造学校：unitid 从 start 递增，校名 `${prefix} ${n}`。 */
export function schools(count: number, start: number, prefix: string): { hd: IpedsRow[]; ic: IpedsRow[] } {
  const hd: IpedsRow[] = [];
  const ic: IpedsRow[] = [];
  for (let i = 0; i < count; i++) {
    const unitid = String(start + i);
    hd.push(hdRow({ UNITID: unitid, INSTNM: `${prefix} ${i + 1}`, WEBADDR: `www.${prefix.toLowerCase().replace(/\W+/g, "")}${i + 1}.edu/` }));
    ic.push(icRow({ UNITID: unitid }));
  }
  return { hd, ic };
}

export function curatedFile(entries: CuratedSchoolEntry[]): CuratedSchoolFile {
  return { schemaVersion: "1.0", listVersion: "test-list", tierBasis: "APPROXIMATE", tierBasisNote: "test", entries };
}

export function curatedEntry(overrides: Partial<CuratedSchoolEntry> = {}): CuratedSchoolEntry {
  return { unitid: "100001", ipedsName: "Test University", group: "NU", approxTier: "B", note: "test", ...overrides };
}

export const NO_ALIASES: AliasFile = { schemaVersion: "1.0", reviewStatus: "MODEL_CURATED_PENDING_HUMAN_REVIEW", note: "", entries: [] };
export const NO_OVERRIDES: OverrideFile = { schemaVersion: "1.0", ruleVersion: "eligibility-v1", note: "", overrides: [] };

export function evidenceEntry(overrides: Partial<RawEvidenceEntry> = {}): RawEvidenceEntry {
  return {
    unitid: "100001", ipedsName: "Test University", schoolNameInSource: "Test University", category: "NU",
    rankMin: 42, rankMax: 42, tied: false, edition: 2027, sourceUrl: "https://news.test.edu/rank",
    sourceType: "INSTITUTION_OFFICIAL", publishedAt: "2026-09-22",
    quote: "Test University is ranked No. 42 among National Universities", categoryQuote: null, notes: "",
    ...overrides,
  };
}

export function evidenceFile(collector: string, entries: RawEvidenceEntry[]): { file: string; data: RawEvidenceFile } {
  return { file: `data/schools/evidence/${collector}.json`, data: { collector, collectedAt: "2026-10-11", entries } };
}

export interface FakeSite {
  fetcher: Fetcher;
  calls: string[];
}

/** pages：URL → HTML（默认 200）或 { status, html }；没列出的 URL 一律抛错，模拟网络失败。 */
export function fakeSite(pages: Record<string, string | { status: number; html: string }>): FakeSite {
  const calls: string[] = [];
  const fetcher: Fetcher = (url) => {
    calls.push(url);
    const page = pages[url];
    if (page === undefined) throw new Error(`network unreachable: ${url}`);
    const status = typeof page === "string" ? 200 : page.status;
    const html = typeof page === "string" ? page : page.html;
    const fetched: FetchedPage = {
      url, finalUrl: url, httpStatus: status, contentType: "text/html", bytes: html.length,
      sha256: `sha-of-${url}`, fetchedAt: "2026-10-12T00:00:00.000Z", text: htmlToText(html),
    };
    return fetched;
  };
  return { fetcher, calls };
}

export function verifierFor(site: FakeSite, options: { offline?: boolean; refresh?: boolean; cache?: EvidenceCache } = {}): QuoteVerifier {
  return new QuoteVerifier(options.cache ?? emptyCache(), {
    offline: options.offline ?? false,
    refresh: options.refresh ?? false,
    fetcher: site.fetcher,
  });
}

/** 一段提到 2027 版与给定句子的页面。 */
export function rankPage(...sentences: string[]): string {
  return `<html><body><h1>2027 U.S. News Best Colleges</h1>${sentences.map((s) => `<p>${s}</p>`).join("")}</body></html>`;
}
