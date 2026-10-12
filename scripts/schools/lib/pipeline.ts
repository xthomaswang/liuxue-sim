// 精选学校目录的组装：精选名单 ∪ 已核实证据 → IPEDS 资格检查 → 分档 → 全部输出文件。
// 这里只做纯计算（网络访问经由注入的 QuoteVerifier），便于测试与字节稳定性检查。

import { createHash } from "node:crypto";
import {
  applyOverrides, deriveDraft, finalizeEligibility,
  HD_DECISION_COLUMNS, IC_DECISION_COLUMNS,
} from "./eligibility.ts";
import type { EligibilityResult } from "./eligibility.ts";
import {
  processEvidence, resolveRankings, sharedRankWarnings, QuoteVerifier, VERIFICATION_STANDARD,
} from "./evidence.ts";
import type { EvidenceCache, ProcessedEvidence, RankingResolution } from "./evidence.ts";
import { DIRECTORY_YEAR, IPEDS_DATA_BASE_URL } from "./ipeds.ts";
import type { IpedsFileMeta, IpedsRow, IpedsSnapshot } from "./ipeds.ts";
import { isOutOfScopeRank, SCOPE_RANK_LIMITS, SCOPE_RULE_DESCRIPTION, SCOPE_RULE_VERSION } from "./scope.ts";
import { tierBoundarySelfCheck, tierForRank } from "./tier-mapping.ts";
import {
  CATALOG_VERSION, ELIGIBILITY_RULE_VERSION, IMPORTER_VERSION, OFFER_TIERS, RANK_EDITION,
  SCHOOL_GROUPS, TIER_MAPPING_VERSION,
} from "./types.ts";
import type {
  AliasFile, CatalogCounts, CatalogManifest, CuratedSchoolEntry, CuratedSchoolFile, EligibilityOverride,
  EvidenceRef, OfferTier, OverrideFile, RankCategory, RawEvidenceFile, RuntimeCatalog, RuntimeSchool,
  SchoolGroup, SchoolRecord, TierBasis,
} from "./types.ts";

export const MIN_POOL_SIZE = 3;
export const RUNTIME_CATALOG_PATH = "src/content/schools/catalog.runtime.json";
export const DATA_DIR = "data/schools";

const RELEASE_SUPPORT = {
  url: "https://nces.ed.gov/ipeds/use-the-data/download-access-database",
  quote: "2024-25 Excel (IPEDS202425Tablesdoc.xlsx, 1261kb) Provisional March 2026",
};

export const SCOPE_NOTE =
  "精选目录，不是全国目录：U.S. News 综合大学 1–200 名、约前 50 名的文理学院、少量专门院校，以及有 2027 版已核实名次的地区类学校。";

export interface PipelineInputs {
  snapshot: IpedsSnapshot;
  curated: CuratedSchoolFile;
  aliases: AliasFile;
  overrides: OverrideFile;
  evidenceFiles: Array<{ file: string; data: RawEvidenceFile }>;
  verifier: QuoteVerifier;
  /** 上一次构建的 manifest；目录内容没变时沿用它的 generatedAt，保证重跑字节稳定。 */
  previousManifest: CatalogManifest | null;
  now: string;
}

export interface PipelineSummary {
  releaseStatus: "DRAFT" | "VALIDATED";
  counts: CatalogCounts;
  failedChecks: string[];
  evidence: { verified: number; unverified: number; rejected: number };
}

export interface PipelineOutputs {
  /** 相对项目根的路径 → 文件内容。 */
  files: Record<string, string>;
  cache: EvidenceCache;
  summary: PipelineSummary;
  catalog: SchoolRecord[];
}

function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function squash(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function blankToNull(value: string | undefined): string | null {
  const text = squash(value);
  return text === "" || text === "-1" || text === "-2" ? null : text;
}

const TIER_INDEX: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function groupForCategory(category: RankCategory): SchoolGroup {
  if (category === "NU") return "NU";
  if (category === "LAC") return "LAC";
  return "REGIONAL";
}

function ipedsRef(meta: IpedsFileMeta, fetchedAt: string, unitid: string, columns: string[], row: IpedsRow): EvidenceRef {
  return {
    sourceId: meta.id,
    sourceUrl: `${IPEDS_DATA_BASE_URL}${meta.zipFilename}`,
    sourceType: "IPEDS",
    sourceYear: DIRECTORY_YEAR,
    publishedAt: null,
    retrievedAt: fetchedAt,
    verification: "VERIFIED",
    fieldOrLocator: `${meta.csvMember}:UNITID=${unitid}:${columns.join(",")}`,
    rawValue: columns.map((column) => row[column] ?? "").join("|"),
  };
}

function rankRef(item: ProcessedEvidence): EvidenceRef {
  return {
    sourceId: `rank-page-${sha256(item.entry.sourceUrl).slice(0, 12)}`,
    sourceUrl: item.entry.sourceUrl,
    sourceType: item.entry.sourceType,
    sourceYear: RANK_EDITION,
    publishedAt: item.entry.publishedAt,
    retrievedAt: item.record?.fetchedAt ?? "",
    verification: item.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
    fieldOrLocator: item.entry.categoryQuote ? `quote + categoryQuote: ${item.entry.categoryQuote}` : "quote",
    rawValue: item.entry.quote,
  };
}

interface Candidate {
  unitid: string;
  curated: CuratedSchoolEntry | null;
  resolution: RankingResolution | null;
}

interface Removed {
  unitid: string;
  name: string;
  source: "CURATED" | "EVIDENCE_ONLY";
  stage: "JOIN" | "ELIGIBILITY" | "TIER";
  status: string;
  reasonCodes: string[];
  explanation: string;
}

interface OutOfScopeRank {
  unitid: string;
  name: string;
  listedInCurated: boolean;
  category: RankCategory;
  rankMin: number;
  rankMax: number;
  tied: boolean;
  limit: number;
  evidenceUrls: string[];
}

interface CheckResult {
  id: string;
  description: string;
  status: "PASS" | "FAIL";
  detail: string;
}

interface Assembly {
  records: SchoolRecord[];
  removed: Removed[];
  outOfScopeRank: OutOfScopeRank[];
  joinFailures: Array<{ unitid: string; ipedsName: string; problem: string }>;
  tierDiscrepancies: Array<Record<string, unknown>>;
  categoryChanges: Array<Record<string, unknown>>;
  rankConflicts: Array<Record<string, unknown>>;
  curatedListed: number;
  curatedJoined: number;
  evidenceOnlyAdded: number;
  aliasProblems: string[];
  curatedProblems: string[];
}

function validateCuratedEntry(entry: CuratedSchoolEntry): string | null {
  if (!/^\d{6}$/.test(entry.unitid ?? "")) return "UNITID_FORMAT";
  if (!SCHOOL_GROUPS.includes(entry.group)) return "GROUP_INVALID";
  if (!OFFER_TIERS.includes(entry.approxTier)) return "APPROX_TIER_INVALID";
  if (entry.group === "SPECIAL" && entry.approxTier !== "U") return "SPECIAL_MUST_BE_U";
  if ((entry.group === "NU" || entry.group === "LAC") && entry.approxTier === "U") return "RANKED_GROUP_NEEDS_APPROX_TIER";
  return null;
}

function assemble(
  inputs: PipelineInputs,
  resolutions: Map<string, RankingResolution>,
  verifiedOverrides: Map<string, EligibilityOverride[]>,
): Assembly {
  const { snapshot, curated, aliases } = inputs;
  const hdBy = new Map(snapshot.hd.map((row) => [row.UNITID, row]));
  const icBy = new Map(snapshot.ic.map((row) => [row.UNITID, row]));
  const context = { fipsLabels: snapshot.fipsLabels, stabbrLabels: snapshot.stabbrLabels };

  const joinFailures: Assembly["joinFailures"] = [];
  const curatedProblems: string[] = [];
  const candidates = new Map<string, Candidate>();
  let curatedJoined = 0;
  for (const entry of curated.entries) {
    const shape = validateCuratedEntry(entry);
    if (shape) {
      curatedProblems.push(`${entry.unitid} ${entry.ipedsName}: ${shape}`);
      continue;
    }
    if (candidates.has(entry.unitid)) {
      curatedProblems.push(`${entry.unitid} ${entry.ipedsName}: DUPLICATE_UNITID`);
      continue;
    }
    const row = hdBy.get(entry.unitid);
    if (!row) {
      joinFailures.push({ unitid: entry.unitid, ipedsName: entry.ipedsName, problem: "UNITID_NOT_IN_HD2024" });
      continue;
    }
    if (squash(row.INSTNM) !== squash(entry.ipedsName)) {
      joinFailures.push({
        unitid: entry.unitid,
        ipedsName: entry.ipedsName,
        problem: `IPEDS_NAME_MISMATCH（HD2024 为「${squash(row.INSTNM)}」）`,
      });
      continue;
    }
    curatedJoined++;
    candidates.set(entry.unitid, { unitid: entry.unitid, curated: entry, resolution: resolutions.get(entry.unitid) ?? null });
  }
  let evidenceOnlyAdded = 0;
  for (const resolution of resolutions.values()) {
    if (candidates.has(resolution.unitid)) continue;
    candidates.set(resolution.unitid, { unitid: resolution.unitid, curated: null, resolution });
    evidenceOnlyAdded++;
  }

  const aliasBy = new Map<string, string | null>();
  const aliasProblems: string[] = [];
  for (const alias of aliases.entries) {
    const row = hdBy.get(alias.unitid);
    if (!row) aliasProblems.push(`${alias.unitid} ${alias.ipedsName}: UNITID_NOT_IN_HD2024`);
    else if (squash(row.INSTNM) !== squash(alias.ipedsName)) aliasProblems.push(`${alias.unitid} ${alias.ipedsName}: IPEDS_NAME_MISMATCH`);
    else if (aliasBy.has(alias.unitid)) aliasProblems.push(`${alias.unitid} ${alias.ipedsName}: DUPLICATE_UNITID`);
    else aliasBy.set(alias.unitid, alias.nameZh && squash(alias.nameZh) ? squash(alias.nameZh) : null);
  }

  const records: SchoolRecord[] = [];
  const removed: Removed[] = [];
  const outOfScopeRank: OutOfScopeRank[] = [];
  const tierDiscrepancies: Assembly["tierDiscrepancies"] = [];
  const categoryChanges: Assembly["categoryChanges"] = [];
  const rankConflicts: Assembly["rankConflicts"] = [];

  for (const unitid of [...candidates.keys()].sort()) {
    const candidate = candidates.get(unitid)!;
    const hd = hdBy.get(unitid)!;
    const ic = icBy.get(unitid);
    const name = squash(hd.INSTNM);
    const source = candidate.curated ? "CURATED" : "EVIDENCE_ONLY";

    const draft = applyOverrides(deriveDraft(hd, ic, context), verifiedOverrides.get(unitid) ?? []);
    const eligibility: EligibilityResult = finalizeEligibility(draft);
    if (eligibility.status !== "ELIGIBLE") {
      removed.push({
        unitid, name, source, stage: "ELIGIBILITY",
        status: eligibility.status, reasonCodes: eligibility.reasonCodes, explanation: eligibility.explanation,
      });
      continue;
    }

    const resolution = candidate.resolution;
    const curatedEntry = candidate.curated;

    // 范围上限：已核实名次落在目录范围之外的学校不收，单列在报告里；证据本身仍保留。
    if (resolution && resolution.status === "VERIFIED" && isOutOfScopeRank(resolution.category!, resolution.rankMin!)) {
      outOfScopeRank.push({
        unitid,
        name,
        listedInCurated: curatedEntry !== null,
        category: resolution.category!,
        rankMin: resolution.rankMin!,
        rankMax: resolution.rankMax!,
        tied: resolution.tied ?? false,
        limit: SCOPE_RANK_LIMITS[resolution.category!]!,
        evidenceUrls: [...new Set(resolution.evidence.map((item) => item.entry.sourceUrl))].sort(),
      });
      continue;
    }

    let group: SchoolGroup;
    let tierValue: OfferTier;
    let basis: TierBasis;
    let tierReason: string;
    let ranking: SchoolRecord["ranking"];
    const verifiedRefs = (resolution?.evidence ?? []).map(rankRef);

    if (resolution && resolution.status === "VERIFIED") {
      const mapped = tierForRank(resolution);
      group = groupForCategory(resolution.category!);
      tierValue = mapped.tier;
      basis = "VERIFIED_2027";
      tierReason = mapped.reason;
      ranking = {
        publisher: "US_NEWS", edition: 2027,
        category: resolution.category, rankMin: resolution.rankMin, rankMax: resolution.rankMax, tied: resolution.tied,
        status: "VERIFIED", evidence: verifiedRefs,
      };
      if (curatedEntry) {
        if (curatedEntry.group !== group) {
          categoryChanges.push({
            unitid, name, curatedGroup: curatedEntry.group, verifiedCategory: resolution.category,
            note: "精选名单的分组与 2027 版已核实类别不同，以证据为准。",
          });
        }
        const a = TIER_INDEX[curatedEntry.approxTier];
        const b = TIER_INDEX[tierValue];
        if (a !== undefined && b !== undefined && Math.abs(a - b) >= 2) {
          tierDiscrepancies.push({
            unitid, name, approxTier: curatedEntry.approxTier, verifiedTier: tierValue,
            category: resolution.category, rankMin: resolution.rankMin, rankMax: resolution.rankMax,
            note: "大致档位与已核实名次相差两档以上，已按证据分档，请人工看一眼。",
          });
        }
      }
    } else {
      if (resolution && resolution.status === "CONFLICT") {
        rankConflicts.push({
          unitid, name, detail: resolution.conflictDetail,
          sources: resolution.evidence.map((item) => item.entry.sourceUrl),
          handling: curatedEntry ? "回退到精选名单的大致档位" : "不在精选名单中，未收入目录",
        });
      }
      if (!curatedEntry) {
        removed.push({
          unitid, name, source, stage: "TIER", status: "RANK_CONFLICT",
          reasonCodes: ["RANK_CONFLICT"], explanation: `已核实证据互相矛盾（${resolution?.conflictDetail}），且不在精选名单中。`,
        });
        continue;
      }
      if (curatedEntry.group === "REGIONAL") {
        removed.push({
          unitid, name, source, stage: "TIER", status: "REGIONAL_WITHOUT_VERIFIED_EVIDENCE",
          reasonCodes: ["REGIONAL_WITHOUT_VERIFIED_EVIDENCE"], explanation: "地区类学校只在有已核实的 2027 版名次证据时收入。",
        });
        continue;
      }
      group = curatedEntry.group;
      tierValue = curatedEntry.approxTier;
      basis = curatedEntry.group === "SPECIAL" ? "UNRANKED_SPECIAL" : "APPROXIMATE";
      tierReason =
        basis === "UNRANKED_SPECIAL"
          ? "SPECIAL_SCHOOL_UNRANKED_POOL"
          : resolution?.status === "CONFLICT"
            ? "CURATED_APPROXIMATE_TIER_AFTER_RANK_CONFLICT"
            : "CURATED_APPROXIMATE_TIER";
      ranking = {
        publisher: "US_NEWS", edition: 2027,
        category: null, rankMin: null, rankMax: null, tied: null,
        status: resolution?.status === "CONFLICT" ? "CONFLICT" : "MISSING",
        evidence: resolution?.status === "CONFLICT" ? verifiedRefs : [],
      };
    }

    const hdRef = ipedsRef(snapshot.hdMeta, snapshot.fetchedAt, unitid, HD_DECISION_COLUMNS, hd);
    const eligibilityEvidence: EvidenceRef[] = [hdRef];
    if (ic) eligibilityEvidence.push(ipedsRef(snapshot.icMeta, snapshot.fetchedAt, unitid, IC_DECISION_COLUMNS, ic));
    for (const override of verifiedOverrides.get(unitid) ?? []) {
      eligibilityEvidence.push({
        sourceId: `override-${sha256(override.officialUrl).slice(0, 12)}`,
        sourceUrl: override.officialUrl,
        sourceType: "INSTITUTION_OFFICIAL",
        sourceYear: null,
        publishedAt: null,
        retrievedAt: override.verifiedAt,
        verification: "VERIFIED",
        fieldOrLocator: `override:${override.fact}`,
        rawValue: override.quote,
      });
    }
    const identityColumns = ["INSTNM", "CITY", "STABBR", "WEBADDR", "OPEID", "IALIAS", "F1SYSTYP", "F1SYSNAM"];
    const opeid = blankToNull(hd.OPEID);

    records.push({
      unitid,
      officialName: name,
      name,
      nameZh: aliasBy.get(unitid) ?? null,
      aliases: squash(hd.IALIAS).split(/\s*[|;]\s*/).map((alias) => alias.trim()).filter(Boolean),
      city: squash(hd.CITY),
      stateOrTerritory: hd.STABBR,
      country: "US",
      website: blankToNull(hd.WEBADDR),
      campusLabel: null,
      parentSystemName: hd.F1SYSTYP === "1" ? blankToNull(hd.F1SYSNAM) : null,
      scorecardId: null,
      opeids: opeid ? [opeid] : [],
      group,
      curation: {
        listed: curatedEntry !== null,
        approxTier: curatedEntry?.approxTier ?? null,
        note: curatedEntry?.note ?? null,
      },
      institutionFacts: eligibility.facts,
      offerEligibility: {
        status: eligibility.status,
        reasonCodes: eligibility.reasonCodes,
        explanation: eligibility.explanation,
        ruleVersion: ELIGIBILITY_RULE_VERSION,
        evidence: eligibilityEvidence,
      },
      ranking,
      tier: { value: tierValue, mappingVersion: TIER_MAPPING_VERSION, basis, reason: tierReason },
      storyProfile: { campusTemplate: "GENERIC_US_CAMPUS", verifiedLocationTags: [] },
      fieldEvidence: {
        directory: [ipedsRef(snapshot.hdMeta, snapshot.fetchedAt, unitid, identityColumns, hd)],
      },
      sourceSnapshotIds: [snapshot.hdMeta.id, ...(ic ? [snapshot.icMeta.id] : [])],
    });
  }

  joinFailures.sort((x, y) => (x.unitid + x.ipedsName < y.unitid + y.ipedsName ? -1 : 1));
  curatedProblems.sort();
  aliasProblems.sort();
  return {
    records, removed, outOfScopeRank, joinFailures, tierDiscrepancies, categoryChanges, rankConflicts,
    curatedListed: curated.entries.length, curatedJoined, evidenceOnlyAdded, aliasProblems, curatedProblems,
  };
}

function countCatalog(
  records: SchoolRecord[],
  sourceRows: number,
  candidates: number,
  removed: Removed[],
  outOfScopeRank: number,
): CatalogCounts {
  const byTier = Object.fromEntries(OFFER_TIERS.map((tier) => [tier, 0])) as Record<OfferTier, number>;
  const byGroup = Object.fromEntries(SCHOOL_GROUPS.map((group) => [group, 0])) as Record<SchoolGroup, number>;
  let verified = 0;
  let approximate = 0;
  let special = 0;
  for (const record of records) {
    byTier[record.tier.value]++;
    byGroup[record.group]++;
    if (record.tier.basis === "VERIFIED_2027") verified++;
    else if (record.tier.basis === "APPROXIMATE") approximate++;
    else special++;
  }
  return {
    sourceRows,
    candidates,
    eligible: records.length,
    excluded: removed.filter((item) => item.status === "EXCLUDED").length,
    reviewRequired: removed.filter((item) => item.status === "REVIEW_REQUIRED").length,
    outOfScopeRank,
    verified,
    approximate,
    special,
    rankedVerified: verified,
    byTier,
    byGroup,
  };
}

function toRuntimeSchool(record: SchoolRecord): RuntimeSchool {
  return {
    unitid: record.unitid,
    name: record.name,
    nameZh: record.nameZh,
    city: record.city,
    state: record.stateOrTerritory,
    tier: record.tier.value,
    group: record.group,
    tierBasis: record.tier.basis,
    rank:
      record.ranking.status === "VERIFIED" && record.tier.basis === "VERIFIED_2027"
        ? {
            category: record.ranking.category!,
            rankMin: record.ranking.rankMin!,
            rankMax: record.ranking.rankMax!,
            tied: record.ranking.tied ?? false,
          }
        : null,
  };
}

/** 运行时快照：头部字段各占一行，学校一行一所，便于 diff，也不浪费体积。 */
function serializeRuntime(runtime: RuntimeCatalog): string {
  const { schools, ...header } = runtime;
  const head = JSON.stringify(header, null, 1).replace(/\n}$/, "");
  const lines = schools.map((school) => `  ${JSON.stringify(school)}`).join(",\n");
  return `${head},\n "schools": [\n${lines}\n ]\n}\n`;
}

function serializeCatalog(records: SchoolRecord[]): string {
  return pretty({
    schemaVersion: "1.0",
    catalogVersion: CATALOG_VERSION,
    mode: "CURATED",
    scopeNote: SCOPE_NOTE,
    directoryYear: DIRECTORY_YEAR,
    rankEdition: RANK_EDITION,
    tierMappingVersion: TIER_MAPPING_VERSION,
    eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION,
    scopeRuleVersion: SCOPE_RULE_VERSION,
    schools: records,
  });
}

function recordInvariantProblems(records: SchoolRecord[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let previous = "";
  for (const record of records) {
    if (!/^\d{6}$/.test(record.unitid)) problems.push(`${record.unitid}: UNITID 格式异常`);
    if (seen.has(record.unitid)) problems.push(`${record.unitid}: 重复`);
    seen.add(record.unitid);
    if (record.unitid <= previous) problems.push(`${record.unitid}: 未按 UNITID 字符串升序`);
    previous = record.unitid;
    if (!record.officialName || !record.city || !record.stateOrTerritory) problems.push(`${record.unitid}: 校名/城市/州为空`);
    if (record.offerEligibility.status !== "ELIGIBLE") problems.push(`${record.unitid}: 非 ELIGIBLE 进入目录`);
    if (Object.values(record.institutionFacts).some((value) => value !== true)) problems.push(`${record.unitid}: 存在非 true 的事实`);
    if (!OFFER_TIERS.includes(record.tier.value)) problems.push(`${record.unitid}: 档位非法`);
    if (record.tier.basis === "VERIFIED_2027") {
      if (record.ranking.status !== "VERIFIED" || record.ranking.rankMin === null || record.ranking.evidence.length === 0) {
        problems.push(`${record.unitid}: VERIFIED_2027 缺名次或证据`);
      }
    } else if (record.ranking.rankMin !== null || record.ranking.rankMax !== null) {
      problems.push(`${record.unitid}: 非已核实档位却带了名次`);
    }
    if (
      record.tier.basis === "VERIFIED_2027" && record.ranking.category !== null && record.ranking.rankMin !== null &&
      isOutOfScopeRank(record.ranking.category, record.ranking.rankMin)
    ) {
      problems.push(`${record.unitid}: 已核实名次超出目录范围`);
    }
    if (record.tier.basis === "UNRANKED_SPECIAL" && (record.group !== "SPECIAL" || record.tier.value !== "U")) {
      problems.push(`${record.unitid}: UNRANKED_SPECIAL 必须是 SPECIAL 且进 U`);
    }
  }
  return problems;
}

export function runPipeline(inputs: PipelineInputs): PipelineOutputs {
  const { snapshot, verifier } = inputs;
  const hdBy = new Map(snapshot.hd.map((row) => [row.UNITID, row]));
  const lookup = (unitid: string) => {
    const row = hdBy.get(unitid);
    return row ? { instnm: row.INSTNM, webaddr: row.WEBADDR ?? "" } : undefined;
  };

  // ---- 人工覆盖：与排名证据同一标准机械复核，没过的不生效并进报告 ----
  const verifiedOverrides = new Map<string, EligibilityOverride[]>();
  const overrideReport: Array<Record<string, unknown>> = [];
  for (const override of inputs.overrides.overrides) {
    const row = hdBy.get(override.unitid);
    let problem: string | null = null;
    if (!row) problem = "UNITID_NOT_IN_HD2024";
    else if (squash(row.INSTNM) !== squash(override.ipedsName)) problem = "IPEDS_NAME_MISMATCH";
    let verification = "UNVERIFIED";
    if (!problem) {
      const record = verifier.verify(`override:${sha256(JSON.stringify([override.officialUrl, override.quote])).slice(0, 32)}`, override.officialUrl, {
        quote: override.quote, categoryQuote: null, schoolNames: null, schoolSiteHost: null, rankNumbers: null, requireEditionMention: false,
      });
      verification = record.verification;
      if (record.verification !== "VERIFIED") problem = record.failure ?? "UNVERIFIED";
    }
    overrideReport.push({
      unitid: override.unitid, ipedsName: override.ipedsName, fact: override.fact,
      correctedValue: override.correctedValue, officialUrl: override.officialUrl, verification, applied: problem === null, problem,
    });
    if (problem === null) {
      const list = verifiedOverrides.get(override.unitid) ?? [];
      list.push(override);
      verifiedOverrides.set(override.unitid, list);
    }
  }

  // ---- 发布状态的旁证：NCES 官方页面把 2024-25 数据库标为 Provisional（不影响判定，只进 sources.json）----
  const releaseSupport = verifier.verify(`support:${sha256(JSON.stringify([RELEASE_SUPPORT.url, RELEASE_SUPPORT.quote])).slice(0, 32)}`, RELEASE_SUPPORT.url, {
    quote: RELEASE_SUPPORT.quote, categoryQuote: null, schoolNames: null, schoolSiteHost: null, rankNumbers: null, requireEditionMention: false,
  });

  // ---- 排名证据 ----
  const processed = processEvidence(inputs.evidenceFiles, lookup, verifier);
  const resolutions = resolveRankings(processed);

  // ---- 组装（正序一次、逆序一次，确认结果与输入顺序无关）----
  const assembly = assemble(inputs, resolutions, verifiedOverrides);
  const catalogText = serializeCatalog(assembly.records);
  const reversedInputs: PipelineInputs = {
    ...inputs,
    snapshot: { ...snapshot, hd: [...snapshot.hd].reverse(), ic: [...snapshot.ic].reverse() },
    curated: { ...inputs.curated, entries: [...inputs.curated.entries].reverse() },
    aliases: { ...inputs.aliases, entries: [...inputs.aliases.entries].reverse() },
  };
  const reversedProcessed = processEvidence([...inputs.evidenceFiles].reverse().map(({ file, data }) => ({
    file, data: { ...data, entries: [...(data.entries ?? [])].reverse() },
  })), lookup, verifier);
  const reversedText = serializeCatalog(assemble(reversedInputs, resolveRankings(reversedProcessed), verifiedOverrides).records);
  const catalogSha256 = sha256(catalogText);

  const candidates = assembly.curatedJoined + assembly.evidenceOnlyAdded;
  const counts = countCatalog(assembly.records, snapshot.hd.length, candidates, assembly.removed, assembly.outOfScopeRank.length);

  // ---- 检查 ----
  const boundaryFailures = tierBoundarySelfCheck();
  const invariantProblems = recordInvariantProblems(assembly.records);
  const smallPools = OFFER_TIERS.filter((tier) => counts.byTier[tier] < MIN_POOL_SIZE);
  const parseProblems = snapshot.hdMeta.problems.length + snapshot.icMeta.problems.length;
  const checks: CheckResult[] = [
    {
      id: "POOLS_AT_LEAST_3",
      description: `S/A/B/C/D/U 每池至少 ${MIN_POOL_SIZE} 所学校，不跨档补位、不复制。`,
      status: smallPools.length === 0 ? "PASS" : "FAIL",
      detail: OFFER_TIERS.map((tier) => `${tier}=${counts.byTier[tier]}`).join(" ") + (smallPools.length ? `；不足：${smallPools.join(",")}` : ""),
    },
    {
      id: "CURATED_JOIN_EXACT",
      description: "精选名单每条都用 UNITID 精确连接到 HD2024，且 ipedsName 与 INSTNM 完全一致。",
      status: assembly.joinFailures.length === 0 && assembly.curatedProblems.length === 0 ? "PASS" : "FAIL",
      detail: `名单 ${assembly.curatedListed} 条，连接成功 ${assembly.curatedJoined} 条，连接失败 ${assembly.joinFailures.length} 条，格式问题 ${assembly.curatedProblems.length} 条。`,
    },
    {
      id: "ALIASES_JOIN_EXACT",
      description: "中文名映射每条都能用 UNITID + INSTNM 精确对上。",
      status: assembly.aliasProblems.length === 0 ? "PASS" : "FAIL",
      detail: assembly.aliasProblems.length === 0 ? `${inputs.aliases.entries.length} 条全部对上。` : assembly.aliasProblems.join("；"),
    },
    {
      id: "IPEDS_PARSE_CLEAN",
      description: "HD2024/IC2024 解析无坏行，字典绑定通过（绑定失败会直接中止构建）。",
      status: parseProblems === 0 ? "PASS" : "FAIL",
      detail: `HD ${snapshot.hdMeta.dataRows} 行，IC ${snapshot.icMeta.dataRows} 行，坏行 ${parseProblems}。`,
    },
    {
      id: "RECORD_INVARIANTS",
      description: "目录内每所学校：UNITID 合法且唯一有序、校名/城市/州非空、六项资格事实全为 true、档位与依据自洽。",
      status: invariantProblems.length === 0 ? "PASS" : "FAIL",
      detail: invariantProblems.length === 0 ? `${assembly.records.length} 条全部满足。` : invariantProblems.slice(0, 20).join("；"),
    },
    {
      id: "SCOPE_RANK_LIMITS",
      description: `范围上限（${SCOPE_RULE_VERSION}）：目录里没有已核实名次超过 NU ${SCOPE_RANK_LIMITS.NU} / LAC ${SCOPE_RANK_LIMITS.LAC} 的学校。`,
      status: invariantProblems.some((problem) => problem.includes("超出目录范围")) ? "FAIL" : "PASS",
      detail: `因名次超出范围未收入 ${assembly.outOfScopeRank.length} 所（见 outOfScopeRank）。`,
    },
    {
      id: "TIER_BOUNDARIES_V2",
      description: "v2 分档边界（NU 20/21、50/51、100/101、150/151；LAC 10/11、25/26、50/51、100/101；RU 10/11、40/41；RC 5/6、20/21；跨档区间进 U）。",
      status: boundaryFailures.length === 0 ? "PASS" : "FAIL",
      detail: boundaryFailures.length === 0 ? "全部边界符合。" : boundaryFailures.join("；"),
    },
    {
      id: "ORDER_INDEPENDENT",
      description: "把 IPEDS 行、精选名单、中文名映射与证据的输入顺序全部颠倒，catalog.json 字节不变。",
      status: reversedText === catalogText ? "PASS" : "FAIL",
      detail: reversedText === catalogText ? `sha256 ${catalogSha256}` : "颠倒输入顺序后产物不同。",
    },
    {
      id: "VERIFIED_RANKS_TRACEABLE",
      description: "每个 VERIFIED_2027 档位都有 2027 版、带类别与来源 URL、可机械复核的证据；没有证据的不带名次。",
      status: invariantProblems.some((problem) => problem.includes("VERIFIED_2027") || problem.includes("带了名次")) ? "FAIL" : "PASS",
      detail: `VERIFIED_2027 ${counts.verified} 所，APPROXIMATE ${counts.approximate} 所，UNRANKED_SPECIAL ${counts.special} 所。`,
    },
  ];
  const failedChecks = checks.filter((check) => check.status === "FAIL").map((check) => check.id);
  const releaseStatus: "DRAFT" | "VALIDATED" = failedChecks.length === 0 ? "VALIDATED" : "DRAFT";

  // ---- 来源清单 ----
  const rankPages = new Map<string, { url: string; httpStatus: number | null; sha256: string | null; fetchedAt: string | null; entries: number; verified: number; sourceType: string }>();
  for (const item of processed) {
    if (!item.record) continue;
    const page = rankPages.get(item.entry.sourceUrl) ?? {
      url: item.entry.sourceUrl, httpStatus: item.record.httpStatus, sha256: item.record.pageSha256,
      fetchedAt: item.record.fetchedAt, entries: 0, verified: 0, sourceType: item.entry.sourceType,
    };
    page.entries++;
    if (item.status === "VERIFIED") page.verified++;
    rankPages.set(item.entry.sourceUrl, page);
  }
  const rankPageList = [...rankPages.values()].sort((a, b) => (a.url < b.url ? -1 : 1));

  const manifestSources: CatalogManifest["sources"] = [snapshot.hdMeta, snapshot.icMeta].map((meta) => ({
    id: meta.id,
    publisher: "NCES IPEDS",
    url: `${IPEDS_DATA_BASE_URL}${meta.zipFilename}`,
    filename: meta.zipFilename,
    sha256: meta.zipSha256,
    dictionarySha256: meta.dictionaryZipSha256,
    sourceYear: DIRECTORY_YEAR,
    fetchedAt: snapshot.fetchedAt,
  }));
  for (const page of rankPageList) {
    if (page.verified === 0) continue;
    manifestSources.push({
      id: `rank-page-${sha256(page.url).slice(0, 12)}`,
      publisher: page.sourceType === "RANK_PUBLISHER" ? "U.S. News & World Report（PR Newswire 新闻稿）" : new URL(page.url).hostname,
      url: page.url,
      filename: "",
      sha256: page.sha256 ?? "",
      dictionarySha256: null,
      sourceYear: RANK_EDITION,
      fetchedAt: page.fetchedAt ?? "",
    });
  }

  const manifestBody: Omit<CatalogManifest, "generatedAt"> = {
    schemaVersion: "1.0",
    catalogVersion: CATALOG_VERSION,
    releaseStatus,
    mode: "CURATED",
    scopeNote: SCOPE_NOTE,
    directoryYear: DIRECTORY_YEAR,
    directoryRelease: snapshot.directoryRelease,
    directoryReleaseBasis: snapshot.directoryReleaseBasis,
    rankEdition: 2027,
    tierMappingVersion: TIER_MAPPING_VERSION,
    eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION,
    scopeRuleVersion: SCOPE_RULE_VERSION,
    curatedListVersion: inputs.curated.listVersion,
    importerVersion: IMPORTER_VERSION,
    catalogSha256,
    sources: manifestSources,
    counts,
  };
  const previous = inputs.previousManifest;
  let generatedAt = inputs.now;
  if (previous) {
    const { generatedAt: previousGeneratedAt, ...previousBody } = previous;
    if (JSON.stringify(previousBody) === JSON.stringify(manifestBody) && typeof previousGeneratedAt === "string") {
      generatedAt = previousGeneratedAt;
    }
  }
  // 让 generatedAt 紧跟 catalogSha256，读起来顺。
  const orderedManifest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifestBody)) {
    orderedManifest[key] = value;
    if (key === "catalogSha256") orderedManifest.generatedAt = generatedAt;
  }

  const runtime: RuntimeCatalog = {
    schemaVersion: "1.0",
    catalogVersion: CATALOG_VERSION,
    catalogSha256,
    mode: "CURATED",
    releaseStatus,
    directoryYear: DIRECTORY_YEAR,
    directoryRelease: snapshot.directoryRelease,
    rankEdition: 2027,
    tierMappingVersion: TIER_MAPPING_VERSION,
    generatedAt,
    counts: {
      eligible: counts.eligible,
      rankedVerified: counts.rankedVerified,
      verified: counts.verified,
      approximate: counts.approximate,
      special: counts.special,
      byTier: counts.byTier,
    },
    schools: assembly.records.map(toRuntimeSchool),
  };

  // ---- 证据输出 ----
  const includedUnitids = new Set(assembly.records.map((record) => record.unitid));
  const outOfScopeUnitids = new Set(assembly.outOfScopeRank.map((item) => item.unitid));
  const describe = (item: ProcessedEvidence) => {
    const mapped = item.status === "VERIFIED" ? tierForRank(item.entry) : null;
    return {
      unitid: item.entry?.unitid ?? null,
      ipedsName: item.entry?.ipedsName ?? null,
      schoolNameInSource: item.entry?.schoolNameInSource ?? null,
      category: item.entry?.category ?? null,
      rankMin: item.entry?.rankMin ?? null,
      rankMax: item.entry?.rankMax ?? null,
      tied: item.entry?.tied ?? null,
      edition: item.entry?.edition ?? null,
      sourceUrl: item.entry?.sourceUrl ?? null,
      sourceType: item.entry?.sourceType ?? null,
      publishedAt: item.entry?.publishedAt ?? null,
      quote: item.entry?.quote ?? null,
      categoryQuote: item.entry?.categoryQuote ?? null,
      collector: item.collector,
      file: item.file,
      verification: item.status,
      problems: item.problems,
      checks: item.record?.checks ?? null,
      httpStatus: item.record?.httpStatus ?? null,
      pageSha256: item.record?.pageSha256 ?? null,
      retrievedAt: item.record?.fetchedAt ?? null,
      mappedTier: mapped?.tier ?? null,
      inCatalog: item.entry?.unitid ? includedUnitids.has(item.entry.unitid) : false,
      outOfScopeRank: item.entry?.unitid ? outOfScopeUnitids.has(item.entry.unitid) : false,
    };
  };
  const evidenceCounts = {
    verified: processed.filter((item) => item.status === "VERIFIED").length,
    unverified: processed.filter((item) => item.status === "UNVERIFIED").length,
    rejected: processed.filter((item) => item.status === "REJECTED").length,
  };
  const rankEvidence = {
    schemaVersion: "1.0",
    edition: RANK_EDITION,
    publisher: "US_NEWS",
    tierMappingVersion: TIER_MAPPING_VERSION,
    verificationStandard: VERIFICATION_STANDARD,
    verificationRule:
      "重新抓取 sourceUrl 得到 HTTP 2xx；规范化正文包含 quote（及 categoryQuote）；正文出现 2027；正文出现 schoolNameInSource；quote 内出现名次数字。全部满足才是 VERIFIED。",
    counts: { total: processed.length, ...evidenceCounts, schoolsWithVerifiedRank: [...resolutions.values()].filter((r) => r.status === "VERIFIED").length },
    entries: processed.map(describe),
  };

  const byFile = new Map<string, { file: string; collector: string; entries: number; verified: number; unverified: number; rejected: number; collectorRejected: number }>();
  for (const { file, data } of inputs.evidenceFiles) {
    byFile.set(file, {
      file, collector: typeof data?.collector === "string" ? data.collector : file,
      entries: Array.isArray(data?.entries) ? data.entries.length : 0, verified: 0, unverified: 0, rejected: 0,
      collectorRejected: Array.isArray(data?.rejected) ? data.rejected.length : 0,
    });
  }
  for (const item of processed) {
    const row = byFile.get(item.file);
    if (!row) continue;
    if (item.status === "VERIFIED") row.verified++;
    else if (item.status === "UNVERIFIED") row.unverified++;
    else row.rejected++;
  }

  const poolDetail = Object.fromEntries(
    OFFER_TIERS.map((tier) => {
      const inPool = assembly.records.filter((record) => record.tier.value === tier);
      return [tier, {
        count: inPool.length,
        verified: inPool.filter((record) => record.tier.basis === "VERIFIED_2027").length,
        approximate: inPool.filter((record) => record.tier.basis === "APPROXIMATE").length,
        special: inPool.filter((record) => record.tier.basis === "UNRANKED_SPECIAL").length,
        atLeast3: inPool.length >= MIN_POOL_SIZE,
      }];
    }),
  );

  const coverage = {
    schemaVersion: "1.0",
    catalogVersion: CATALOG_VERSION,
    mode: "CURATED",
    releaseStatus,
    scope: SCOPE_NOTE,
    honesty:
      "VERIFIED_2027 的档位来自可机械复核的 2027 版名次；APPROXIMATE 的档位是模型依据近几版榜单整理的大致区间，未逐校核实、不含名次；UNRANKED_SPECIAL 是按专门院校处理的未排名池，同样未逐校核实。",
    counts: {
      curatedListed: assembly.curatedListed,
      curatedJoined: assembly.curatedJoined,
      evidenceOnlyAdded: assembly.evidenceOnlyAdded,
      candidates,
      inCatalog: counts.eligible,
      removed: assembly.removed.length,
      outOfScopeRank: assembly.outOfScopeRank.length,
      verified: counts.verified,
      approximate: counts.approximate,
      special: counts.special,
      byTier: counts.byTier,
      byGroup: counts.byGroup,
      withNameZh: assembly.records.filter((record) => record.nameZh !== null).length,
    },
    pools: poolDetail,
    checks,
    scopeRule: { version: SCOPE_RULE_VERSION, limits: SCOPE_RANK_LIMITS, description: SCOPE_RULE_DESCRIPTION },
    outOfScopeRank: assembly.outOfScopeRank,
    removedSchools: assembly.removed,
    joinFailures: assembly.joinFailures,
    curatedListProblems: assembly.curatedProblems,
    tierDiscrepancies: assembly.tierDiscrepancies,
    categoryChanges: assembly.categoryChanges,
    rankConflicts: assembly.rankConflicts,
    evidence: {
      standard: VERIFICATION_STANDARD,
      files: [...byFile.values()].sort((a, b) => (a.file < b.file ? -1 : 1)),
      totals: evidenceCounts,
      notVerified: processed.filter((item) => item.status !== "VERIFIED").map((item) => ({
        file: item.file,
        unitid: item.entry?.unitid ?? null,
        ipedsName: item.entry?.ipedsName ?? null,
        category: item.entry?.category ?? null,
        rankMin: item.entry?.rankMin ?? null,
        rankMax: item.entry?.rankMax ?? null,
        sourceUrl: item.entry?.sourceUrl ?? null,
        status: item.status,
        problems: item.problems,
      })),
      warnings: sharedRankWarnings(resolutions),
    },
    overrides: overrideReport,
    schoolsWithoutNameZh: assembly.records.filter((record) => record.nameZh === null).map((record) => `${record.unitid} ${record.name}`),
    ipeds: {
      directoryYear: DIRECTORY_YEAR,
      directoryRelease: snapshot.directoryRelease,
      hdRows: snapshot.hdMeta.dataRows,
      icRows: snapshot.icMeta.dataRows,
      parseProblems: [...snapshot.hdMeta.problems, ...snapshot.icMeta.problems],
    },
    knownGaps: [
      "APPROXIMATE 与 UNRANKED_SPECIAL 的档位未逐校核实；2027 版约两成学校调整了类别，个别学校的真实类别/名次可能与大致区间不同。",
      "资格规则只用 IPEDS 字段，识别不了单一性别、特定信仰或军事化管理等入学限制；这类情况要在 eligibility-overrides.json 里附官方依据逐校处理。",
      "中文校名是模型整理的通行译名，尚未经人工审核（见 school-aliases.json 的 reviewStatus）。",
      "目录年份是 IPEDS 2024（2024-25 采集）；HD2025/IC2025 在导入时官网返回 404。",
    ],
  };

  const sources = {
    schemaVersion: "1.0",
    ipeds: [snapshot.hdMeta, snapshot.icMeta].map((meta) => ({
      id: meta.id,
      publisher: "NCES IPEDS",
      url: `${IPEDS_DATA_BASE_URL}${meta.zipFilename}`,
      filename: meta.zipFilename,
      sha256: meta.zipSha256,
      bytes: meta.zipBytes,
      csvMember: meta.csvMember,
      csvSha256: meta.csvSha256,
      csvBytes: meta.csvBytes,
      csvEncoding: meta.csvEncoding,
      dictionaryUrl: `${IPEDS_DATA_BASE_URL}${meta.dictionaryZipFilename}`,
      dictionaryFilename: meta.dictionaryZipFilename,
      dictionarySha256: meta.dictionaryZipSha256,
      dictionaryTitle: meta.dictionaryTitle,
      releaseLabel: meta.releaseLabel,
      sourceYear: DIRECTORY_YEAR,
      dataRows: meta.dataRows,
      fetchedAt: snapshot.fetchedAt,
    })),
    directoryRelease: {
      value: snapshot.directoryRelease,
      basis: snapshot.directoryReleaseBasis,
      supportingEvidence: {
        note: "旁证，不参与判定：NCES 官方 Access Database 下载页对 2024-25 的发布类型标注。",
        url: RELEASE_SUPPORT.url,
        quote: RELEASE_SUPPORT.quote,
        verification: releaseSupport.verification,
        failure: releaseSupport.failure,
        httpStatus: releaseSupport.httpStatus,
        pageSha256: releaseSupport.pageSha256,
        fetchedAt: releaseSupport.fetchedAt,
      },
    },
    notAvailable: [
      { filename: "HD2025.zip / IC2025.zip", note: "导入时 https://nces.ed.gov/ipeds/datacenter/data/ 下返回 404，docs/11 关于“2025 已可见”的说法未能证实，故使用 2024。" },
    ],
    curatedInputs: {
      curatedList: { path: `${DATA_DIR}/curated-schools.json`, listVersion: inputs.curated.listVersion, entries: inputs.curated.entries.length, basis: inputs.curated.tierBasisNote },
      aliases: { path: `${DATA_DIR}/school-aliases.json`, reviewStatus: inputs.aliases.reviewStatus, entries: inputs.aliases.entries.length },
      overrides: { path: `${DATA_DIR}/eligibility-overrides.json`, entries: inputs.overrides.overrides.length },
    },
    rankPages: rankPageList,
  };

  const files: Record<string, string> = {
    [`${DATA_DIR}/catalog.json`]: catalogText,
    [`${DATA_DIR}/manifest.json`]: pretty(orderedManifest),
    [`${DATA_DIR}/rank-evidence.json`]: pretty(rankEvidence),
    [`${DATA_DIR}/coverage-report.json`]: pretty(coverage),
    [`${DATA_DIR}/sources.json`]: pretty(sources),
    [RUNTIME_CATALOG_PATH]: serializeRuntime(runtime),
  };
  return {
    files,
    cache: verifier.exportCache(),
    summary: { releaseStatus, counts, failedChecks, evidence: evidenceCounts },
    catalog: assembly.records,
  };
}
