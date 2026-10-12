// 排名证据：读取、格式校验、机械复核（带缓存）、按 UNITID 合并。
// VERIFIED 的唯一标准：重新抓取 sourceUrl 得到 HTTP 2xx，规范化正文包含 quote（以及 categoryQuote，若有），
// 正文出现 “2027”；另加两条客观护栏——能确认页面说的是这所学校（页面在该校自己的官网域名下，
// 或正文出现来源里的校名写法／IPEDS 校名）、quote 里出现名次数字。
// 绝不按校名模糊匹配，绝不跨校区继承：只认 unitid，且 ipedsName 必须与目录里的 INSTNM 完全一致。

import { createHash } from "node:crypto";
import { containsQuote, normalizeForMatch } from "./text.ts";
import type { FetchedPage } from "./text.ts";
import { RANK_CATEGORIES, RANK_EDITION } from "./types.ts";
import type { RankCategory, RawEvidenceEntry, RawEvidenceFile } from "./types.ts";

export const VERIFICATION_STANDARD = "quote-match-v2";
export const PUBLISHER_HOSTS = new Set(["www.prnewswire.com", "prnewswire.com"]);

export type Fetcher = (url: string) => FetchedPage;

export interface QuoteCheck {
  fetched: boolean;
  http2xx: boolean;
  mentions2027: boolean | null;
  quoteMatch: boolean;
  categoryQuoteMatch: boolean | null;
  /** OFFICIAL_DOMAIN：页面在该校 IPEDS 登记官网的同一注册域下；NAME_ON_PAGE：正文出现校名；false：两者都不满足；null：不检查。 */
  schoolIdentified: "OFFICIAL_DOMAIN" | "NAME_ON_PAGE" | false | null;
  rankNumberInQuote: boolean | null;
}

export interface VerificationRecord {
  sourceUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  pageSha256: string | null;
  fetchedAt: string | null;
  checks: QuoteCheck;
  verification: "VERIFIED" | "UNVERIFIED";
  failure: string | null;
  /** 网络类失败（抓取出错、非 2xx），联网时值得重试。 */
  transient: boolean;
}

export interface EvidenceCache {
  schemaVersion: "1.0";
  standard: string;
  records: Record<string, VerificationRecord>;
}

export function emptyCache(): EvidenceCache {
  return { schemaVersion: "1.0", standard: VERIFICATION_STANDARD, records: {} };
}

export interface VerifyOptions {
  offline: boolean;
  refresh: boolean;
  fetcher: Fetcher;
}

function hashKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** 带页面级记忆与持久缓存的复核器；一次构建内同一 URL 只抓一次。 */
export class QuoteVerifier {
  private readonly pages = new Map<string, FetchedPage | Error>();
  private readonly used = new Map<string, VerificationRecord>();
  private readonly previous: EvidenceCache;
  private readonly options: VerifyOptions;

  constructor(previous: EvidenceCache, options: VerifyOptions) {
    this.previous = previous.standard === VERIFICATION_STANDARD ? previous : emptyCache();
    this.options = options;
  }

  private page(url: string): FetchedPage | Error {
    const hit = this.pages.get(url);
    if (hit) return hit;
    let result: FetchedPage | Error;
    try {
      result = this.options.fetcher(url);
    } catch (error) {
      result = error instanceof Error ? error : new Error(String(error));
    }
    this.pages.set(url, result);
    return result;
  }

  /**
   * 复核一组引文。requirements 里的可选项为 null 表示不检查。
   * 返回的记录同时写入本次缓存（按 key）。
   */
  verify(
    key: string,
    sourceUrl: string,
    requirements: {
      quote: string;
      categoryQuote: string | null;
      /** 可接受的校名写法；null 表示不做学校识别检查。 */
      schoolNames: string[] | null;
      /** 该校 IPEDS WEBADDR 的主机名，用于判断来源页是否就在学校自己的官网上。 */
      schoolSiteHost: string | null;
      rankNumbers: number[] | null;
      requireEditionMention: boolean;
    },
  ): VerificationRecord {
    const seen = this.used.get(key);
    if (seen) return seen;
    const cached = this.previous.records[key];
    if (cached && !this.options.refresh && (this.options.offline || !cached.transient)) {
      this.used.set(key, cached);
      return cached;
    }
    if (this.options.offline) {
      return {
        sourceUrl,
        finalUrl: null,
        httpStatus: null,
        pageSha256: null,
        fetchedAt: null,
        checks: {
          fetched: false, http2xx: false, mentions2027: null, quoteMatch: false,
          categoryQuoteMatch: null, schoolIdentified: null, rankNumberInQuote: null,
        },
        verification: "UNVERIFIED",
        failure: "NOT_IN_CACHE_OFFLINE",
        transient: true,
      };
    }

    const quoteText = normalizeForMatch(requirements.quote);
    const rankNumberInQuote =
      requirements.rankNumbers === null
        ? null
        : requirements.rankNumbers.every((n) => new RegExp(`(?<![0-9])${n}(?![0-9])`).test(quoteText));

    const page = this.page(sourceUrl);
    let record: VerificationRecord;
    if (page instanceof Error) {
      record = {
        sourceUrl, finalUrl: null, httpStatus: null, pageSha256: null, fetchedAt: null,
        checks: {
          fetched: false, http2xx: false, mentions2027: null, quoteMatch: false,
          categoryQuoteMatch: null, schoolIdentified: null, rankNumberInQuote,
        },
        verification: "UNVERIFIED",
        failure: "FETCH_FAILED",
        transient: true,
      };
    } else {
      const http2xx = page.httpStatus >= 200 && page.httpStatus < 300;
      const checks: QuoteCheck = {
        fetched: true,
        http2xx,
        mentions2027: requirements.requireEditionMention ? page.text.includes(String(RANK_EDITION)) : null,
        quoteMatch: http2xx && containsQuote(page.text, requirements.quote),
        categoryQuoteMatch:
          requirements.categoryQuote === null ? null : http2xx && containsQuote(page.text, requirements.categoryQuote),
        schoolIdentified: identifySchool(page, http2xx, requirements.schoolNames, requirements.schoolSiteHost),
        rankNumberInQuote,
      };
      let failure: string | null = null;
      if (!http2xx) failure = `HTTP_${page.httpStatus}`;
      else if (checks.mentions2027 === false) failure = "PAGE_DOES_NOT_MENTION_2027";
      else if (!checks.quoteMatch) failure = "QUOTE_NOT_FOUND";
      else if (checks.categoryQuoteMatch === false) failure = "CATEGORY_QUOTE_NOT_FOUND";
      else if (checks.schoolIdentified === false) failure = "SCHOOL_NOT_IDENTIFIED_ON_PAGE";
      else if (checks.rankNumberInQuote === false) failure = "QUOTE_MISSING_RANK_NUMBER";
      record = {
        sourceUrl,
        finalUrl: page.finalUrl,
        httpStatus: page.httpStatus,
        pageSha256: page.sha256,
        fetchedAt: page.fetchedAt,
        checks,
        verification: failure === null ? "VERIFIED" : "UNVERIFIED",
        failure,
        transient: !http2xx,
      };
    }
    this.used.set(key, record);
    return record;
  }

  /** 只保留本次用到的记录，键排序，保证缓存文件稳定。 */
  exportCache(): EvidenceCache {
    const records: Record<string, VerificationRecord> = {};
    for (const key of [...this.used.keys()].sort()) records[key] = this.used.get(key)!;
    return { schemaVersion: "1.0", standard: VERIFICATION_STANDARD, records };
  }
}

function identifySchool(
  page: FetchedPage,
  http2xx: boolean,
  names: string[] | null,
  siteHost: string | null,
): QuoteCheck["schoolIdentified"] {
  if (names === null) return null;
  if (!http2xx) return false;
  const pageHost = hostOf(page.finalUrl) ?? hostOf(page.url);
  if (siteHost && pageHost && registrableDomain(siteHost) === registrableDomain(pageHost)) return "OFFICIAL_DOMAIN";
  return names.some((name) => name.trim().length >= 3 && containsQuote(page.text, name)) ? "NAME_ON_PAGE" : false;
}

/** 来源里的校名写法常带括注（如 "Kansas State University (K-State)"），拆开后任一写法出现在正文即可。 */
export function schoolNameVariants(entry: RawEvidenceEntry): string[] {
  const parts = entry.schoolNameInSource.split(/[()]/).map((part) => part.trim()).filter(Boolean);
  return [...new Set([entry.schoolNameInSource, ...parts, entry.ipedsName])];
}

export function evidenceKey(entry: RawEvidenceEntry): string {
  return `rank:${hashKey([entry.sourceUrl, entry.quote, entry.categoryQuote ?? null, entry.schoolNameInSource, entry.rankMin, entry.rankMax])}`;
}

export type EvidenceStatus = "VERIFIED" | "UNVERIFIED" | "REJECTED";

export interface ProcessedEvidence {
  file: string;
  collector: string;
  entry: RawEvidenceEntry;
  status: EvidenceStatus;
  /** 拒收或未通过的原因码；VERIFIED 时为空。 */
  problems: string[];
  record: VerificationRecord | null;
}

export interface DirectoryLookup {
  /** UNITID → { instnm, webaddr }；不存在返回 undefined。 */
  (unitid: string): { instnm: string; webaddr: string } | undefined;
}

function squash(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function registrableDomain(host: string): string {
  return host.split(".").slice(-2).join(".");
}

function websiteHost(webaddr: string): string | null {
  const trimmed = squash(webaddr);
  if (!trimmed) return null;
  return hostOf(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

/** 字段类型与取值校验；返回问题列表（空 = 合法）。 */
export function validateEntryShape(entry: unknown): string[] {
  const problems: string[] = [];
  if (typeof entry !== "object" || entry === null) return ["SCHEMA_INVALID:not-an-object"];
  const e = entry as Record<string, unknown>;
  const str = (name: string, allowEmpty = false) => {
    if (typeof e[name] !== "string" || (!allowEmpty && squash(e[name]) === "")) problems.push(`SCHEMA_INVALID:${name}`);
  };
  str("unitid");
  str("ipedsName");
  str("schoolNameInSource");
  str("sourceUrl");
  str("quote");
  if (typeof e.unitid === "string" && !/^\d{6}$/.test(e.unitid)) problems.push("SCHEMA_INVALID:unitid-format");
  if (!RANK_CATEGORIES.includes(e.category as RankCategory)) problems.push("SCHEMA_INVALID:category");
  for (const name of ["rankMin", "rankMax"]) {
    if (typeof e[name] !== "number" || !Number.isInteger(e[name]) || (e[name] as number) < 1) problems.push(`SCHEMA_INVALID:${name}`);
  }
  if (typeof e.rankMin === "number" && typeof e.rankMax === "number" && e.rankMin > e.rankMax) problems.push("SCHEMA_INVALID:rank-order");
  if (typeof e.tied !== "boolean") problems.push("SCHEMA_INVALID:tied");
  if (e.sourceType !== "INSTITUTION_OFFICIAL" && e.sourceType !== "RANK_PUBLISHER") problems.push("SCHEMA_INVALID:sourceType");
  if (!(e.publishedAt === null || typeof e.publishedAt === "string")) problems.push("SCHEMA_INVALID:publishedAt");
  if (!(e.categoryQuote === null || e.categoryQuote === undefined || typeof e.categoryQuote === "string")) {
    problems.push("SCHEMA_INVALID:categoryQuote");
  }
  if (typeof e.sourceUrl === "string" && hostOf(e.sourceUrl) === null) problems.push("SCHEMA_INVALID:sourceUrl");
  return problems;
}

/**
 * 来源域名政策：
 * - RANK_PUBLISHER 只认 U.S. News 在 PR Newswire 的新闻稿（usnews.com 本机抓不到，无法复核）。
 * - INSTITUTION_OFFICIAL 必须是 .edu 域名，或与该校 IPEDS WEBADDR 同一注册域。
 */
export function sourceDomainProblem(entry: RawEvidenceEntry, webaddr: string): string | null {
  const host = hostOf(entry.sourceUrl);
  if (!host) return "SCHEMA_INVALID:sourceUrl";
  if (entry.sourceType === "RANK_PUBLISHER") return PUBLISHER_HOSTS.has(host) ? null : "SOURCE_DOMAIN_NOT_PUBLISHER";
  if (host.endsWith(".edu")) return null;
  const site = websiteHost(webaddr);
  if (site && registrableDomain(site) === registrableDomain(host)) return null;
  return "SOURCE_DOMAIN_NOT_OFFICIAL";
}

/** 处理全部证据文件：格式 → 版次 → 来源域名 → UNITID 连接 → 机械复核。结果按稳定顺序返回。 */
export function processEvidence(
  files: Array<{ file: string; data: RawEvidenceFile }>,
  lookup: DirectoryLookup,
  verifier: QuoteVerifier,
): ProcessedEvidence[] {
  const out: ProcessedEvidence[] = [];
  for (const { file, data } of [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const collector = typeof data?.collector === "string" ? data.collector : file;
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    for (const raw of entries) {
      const shape = validateEntryShape(raw);
      if (shape.length > 0) {
        out.push({ file, collector, entry: raw as RawEvidenceEntry, status: "REJECTED", problems: shape, record: null });
        continue;
      }
      const entry: RawEvidenceEntry = { ...raw, categoryQuote: raw.categoryQuote ?? null, notes: raw.notes ?? "" };
      const problems: string[] = [];
      if (entry.edition !== RANK_EDITION) problems.push("EDITION_NOT_2027");
      const school = lookup(entry.unitid);
      if (!school) problems.push("UNITID_NOT_IN_DIRECTORY");
      else {
        if (squash(school.instnm) !== squash(entry.ipedsName)) problems.push("IPEDS_NAME_MISMATCH");
        const domain = sourceDomainProblem(entry, school.webaddr);
        if (domain) problems.push(domain);
      }
      if (problems.length > 0) {
        out.push({ file, collector, entry, status: "REJECTED", problems, record: null });
        continue;
      }
      const numbers = entry.rankMin === entry.rankMax ? [entry.rankMin] : [entry.rankMin, entry.rankMax];
      const record = verifier.verify(evidenceKey(entry), entry.sourceUrl, {
        quote: entry.quote,
        categoryQuote: entry.categoryQuote,
        schoolNames: schoolNameVariants(entry),
        schoolSiteHost: websiteHost(school!.webaddr),
        rankNumbers: numbers,
        requireEditionMention: true,
      });
      out.push({
        file,
        collector,
        entry,
        status: record.verification === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
        problems: record.failure ? [record.failure] : [],
        record,
      });
    }
  }
  const order = (p: ProcessedEvidence) =>
    [p.entry?.unitid ?? "", p.entry?.category ?? "", String(p.entry?.rankMin ?? ""), p.entry?.sourceUrl ?? "", p.entry?.quote ?? "", p.file].join("\u0000");
  return out.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
}

export interface RankingResolution {
  unitid: string;
  status: "VERIFIED" | "CONFLICT";
  category: RankCategory | null;
  rankMin: number | null;
  rankMax: number | null;
  tied: boolean | null;
  /** 参与判定的 VERIFIED 证据。 */
  evidence: ProcessedEvidence[];
  conflictDetail: string | null;
}

/** 同一 UNITID 的 VERIFIED 证据：类别与名次一致则合并；不一致 → CONFLICT。 */
export function resolveRankings(processed: ProcessedEvidence[]): Map<string, RankingResolution> {
  const byUnitid = new Map<string, ProcessedEvidence[]>();
  for (const item of processed) {
    if (item.status !== "VERIFIED") continue;
    const list = byUnitid.get(item.entry.unitid) ?? [];
    list.push(item);
    byUnitid.set(item.entry.unitid, list);
  }
  const out = new Map<string, RankingResolution>();
  for (const unitid of [...byUnitid.keys()].sort()) {
    const list = byUnitid.get(unitid)!;
    const signatures = new Set(list.map((item) => `${item.entry.category}:${item.entry.rankMin}-${item.entry.rankMax}`));
    if (signatures.size === 1) {
      const first = list[0].entry;
      out.set(unitid, {
        unitid,
        status: "VERIFIED",
        category: first.category,
        rankMin: first.rankMin,
        rankMax: first.rankMax,
        tied: list.some((item) => item.entry.tied),
        evidence: list,
        conflictDetail: null,
      });
    } else {
      out.set(unitid, {
        unitid,
        status: "CONFLICT",
        category: null,
        rankMin: null,
        rankMax: null,
        tied: null,
        evidence: list,
        conflictDetail: [...signatures].sort().join(" vs "),
      });
    }
  }
  return out;
}

/** 提示性检查：同类别同名次出现在多所学校且有人没标并列。只进报告，不拒收。 */
export function sharedRankWarnings(resolutions: Map<string, RankingResolution>): string[] {
  const groups = new Map<string, RankingResolution[]>();
  for (const resolution of resolutions.values()) {
    if (resolution.status !== "VERIFIED") continue;
    const key = `${resolution.category} ${resolution.rankMin === resolution.rankMax ? resolution.rankMin : `${resolution.rankMin}-${resolution.rankMax}`}`;
    const list = groups.get(key) ?? [];
    list.push(resolution);
    groups.set(key, list);
  }
  const warnings: string[] = [];
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key)!;
    if (list.length > 1 && list.some((item) => item.tied === false)) {
      warnings.push(
        `SHARED_RANK_WITHOUT_TIE_FLAG ${key}: ${list.map((item) => `${item.unitid}${item.tied ? "(tie)" : ""}`).join(", ")}`,
      );
    }
  }
  return warnings;
}
