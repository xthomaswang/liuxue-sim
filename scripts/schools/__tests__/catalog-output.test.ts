// 对已生成的产物（data/schools/*.json 与运行时快照）做不变量检查；
// 本机有 IPEDS 原始文件时，再用真实数据验证字典绑定、资格规则抽查、离线可重现与输入顺序无关。

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveEligibility } from "../lib/eligibility.ts";
import { emptyCache, QuoteVerifier } from "../lib/evidence.ts";
import type { EvidenceCache } from "../lib/evidence.ts";
import { loadIpedsSnapshot } from "../lib/ipeds.ts";
import type { IpedsSnapshot } from "../lib/ipeds.ts";
import { MIN_POOL_SIZE, runPipeline, RUNTIME_CATALOG_PATH } from "../lib/pipeline.ts";
import { isOutOfScopeRank, SCOPE_RULE_VERSION } from "../lib/scope.ts";
import { tierForRank } from "../lib/tier-mapping.ts";
import { OFFER_TIERS, SCHOOL_GROUPS } from "../lib/types.ts";
import type {
  AliasFile, CatalogManifest, CuratedSchoolFile, OverrideFile, RawEvidenceFile, RuntimeCatalog, SchoolRecord,
} from "../lib/types.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const DATA = "data/schools";
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");
const json = <T>(relativePath: string) => JSON.parse(read(relativePath)) as T;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const runtime = json<RuntimeCatalog>(RUNTIME_CATALOG_PATH);
const manifest = json<CatalogManifest>(`${DATA}/manifest.json`);
const catalog = json<{ schools: SchoolRecord[] }>(`${DATA}/catalog.json`);
const curated = json<CuratedSchoolFile>(`${DATA}/curated-schools.json`);
const aliases = json<AliasFile>(`${DATA}/school-aliases.json`);
const overrides = json<OverrideFile>(`${DATA}/eligibility-overrides.json`);
const coverage = json<Record<string, any>>(`${DATA}/coverage-report.json`);
const rankEvidence = json<{ entries: Array<Record<string, any>> }>(`${DATA}/rank-evidence.json`);

describe("运行时快照 catalog.runtime.json", () => {
  it("声明的是精选目录、v2 分档、2024 目录年份", () => {
    expect(runtime.schemaVersion).toBe("1.0");
    expect(runtime.mode).toBe("CURATED");
    expect(runtime.catalogVersion).toBe("us-curated-2024dir-usnews2027-v2");
    expect(runtime.tierMappingVersion).toBe("usnews-2027-game-v2");
    expect(runtime.rankEdition).toBe(2027);
    expect(runtime.directoryYear).toBe(2024);
    expect(["PROVISIONAL", "FINAL", "UNVERIFIED"]).toContain(runtime.directoryRelease);
  });

  it("UNITID 是 6 位数字字符串，唯一，且按字符串升序", () => {
    const ids = runtime.schools.map((school) => school.unitid);
    expect(ids.every((id) => /^\d{6}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("每所学校都有校名、城市、州，档位、分组与依据取值合法", () => {
    for (const school of runtime.schools) {
      expect(school.name.trim(), school.unitid).not.toBe("");
      expect(school.city.trim(), school.unitid).not.toBe("");
      expect(school.state, school.unitid).toMatch(/^[A-Z]{2}$/);
      expect(OFFER_TIERS, school.unitid).toContain(school.tier);
      expect(SCHOOL_GROUPS, school.unitid).toContain(school.group);
      expect(["VERIFIED_2027", "APPROXIMATE", "UNRANKED_SPECIAL"], school.unitid).toContain(school.tierBasis);
      expect(school.nameZh === null || school.nameZh.trim() !== "", school.unitid).toBe(true);
    }
  });

  it("只有 VERIFIED_2027 带名次，且档位就是 v2 表对该名次的映射；其余不带名次", () => {
    for (const school of runtime.schools) {
      if (school.tierBasis === "VERIFIED_2027") {
        expect(school.rank, school.unitid).not.toBeNull();
        expect(tierForRank(school.rank!).tier, school.unitid).toBe(school.tier);
        const expectedGroup = school.rank!.category === "NU" ? "NU" : school.rank!.category === "LAC" ? "LAC" : "REGIONAL";
        expect(school.group, school.unitid).toBe(expectedGroup);
      } else {
        expect(school.rank, school.unitid).toBeNull();
      }
      if (school.tierBasis === "UNRANKED_SPECIAL") expect([school.group, school.tier], school.unitid).toEqual(["SPECIAL", "U"]);
      if (school.tierBasis === "APPROXIMATE") {
        expect(["NU", "LAC"], school.unitid).toContain(school.group);
        expect(school.tier, school.unitid).not.toBe("U");
      }
      if (school.group === "REGIONAL") expect(school.tierBasis, school.unitid).toBe("VERIFIED_2027");
    }
  });

  it("counts 与学校数组一致", () => {
    const byTier = Object.fromEntries(OFFER_TIERS.map((tier) => [tier, runtime.schools.filter((school) => school.tier === tier).length]));
    const basis = (name: string) => runtime.schools.filter((school) => school.tierBasis === name).length;
    expect(runtime.counts).toEqual({
      eligible: runtime.schools.length,
      rankedVerified: basis("VERIFIED_2027"),
      verified: basis("VERIFIED_2027"),
      approximate: basis("APPROXIMATE"),
      special: basis("UNRANKED_SPECIAL"),
      byTier,
    });
  });

  it("VALIDATED 意味着 S/A/B/C/D/U 每池至少 3 所", () => {
    const small = OFFER_TIERS.filter((tier) => runtime.counts.byTier[tier] < MIN_POOL_SIZE);
    if (runtime.releaseStatus === "VALIDATED") expect(small).toEqual([]);
    else expect(coverage.checks.some((check: { status: string }) => check.status === "FAIL")).toBe(true);
  });

  it("范围上限：没有已核实名次超过综合大学 200 / 文理学院 50 的学校", () => {
    for (const school of runtime.schools) {
      if (school.rank) expect(isOutOfScopeRank(school.rank.category as never, school.rank.rankMin), school.unitid).toBe(false);
    }
    const ids = new Set(runtime.schools.map((school) => school.unitid));
    for (const item of coverage.outOfScopeRank) {
      expect(ids.has(item.unitid), item.unitid).toBe(false);
      expect(isOutOfScopeRank(item.category, item.rankMin), item.unitid).toBe(true);
      expect(item.evidenceUrls.length, item.unitid).toBeGreaterThan(0);
      expect(item.name, item.unitid).toBeTruthy();
    }
    expect(coverage.scopeRule.version).toBe(SCOPE_RULE_VERSION);
    expect(manifest.scopeRuleVersion).toBe(SCOPE_RULE_VERSION);
  });

  it("不含联邦军校，也不含按官方依据剔除的军事学院", () => {
    const ids = new Set(runtime.schools.map((school) => school.unitid));
    for (const unitid of ["128328", "130624", "164155", "197027", "197036", "217864"]) expect(ids.has(unitid), unitid).toBe(false);
  });
});

describe("catalog.json、manifest 与运行时快照互相一致", () => {
  it("catalogSha256 就是 catalog.json 的 SHA-256", () => {
    const sha = sha256(read(`${DATA}/catalog.json`));
    expect(manifest.catalogSha256).toBe(sha);
    expect(runtime.catalogSha256).toBe(sha);
    expect(runtime.generatedAt).toBe(manifest.generatedAt);
    expect(runtime.releaseStatus).toBe(manifest.releaseStatus);
    expect(manifest.mode).toBe("CURATED");
    expect(manifest.directoryYear).toBe(2024);
    expect(manifest.counts.eligible).toBe(runtime.schools.length);
  });

  it("完整记录与运行时记录一一对应；目录里只有 ELIGIBLE 且六项事实全为 true", () => {
    expect(catalog.schools.map((record) => record.unitid)).toEqual(runtime.schools.map((school) => school.unitid));
    catalog.schools.forEach((record, index) => {
      const school = runtime.schools[index];
      expect([record.name, record.nameZh, record.city, record.stateOrTerritory, record.tier.value, record.group, record.tier.basis])
        .toEqual([school.name, school.nameZh, school.city, school.state, school.tier, school.group, school.tierBasis]);
      expect(record.offerEligibility.status, record.unitid).toBe("ELIGIBLE");
      expect(Object.values(record.institutionFacts), record.unitid).toEqual([true, true, true, true, true, true]);
      expect(record.offerEligibility.evidence.length, record.unitid).toBeGreaterThanOrEqual(2);
      expect(record.country).toBe("US");
      if (record.tier.basis === "VERIFIED_2027") {
        expect(record.ranking.status, record.unitid).toBe("VERIFIED");
        expect(record.ranking.evidence.length, record.unitid).toBeGreaterThan(0);
        for (const ref of record.ranking.evidence) {
          expect(ref.verification).toBe("VERIFIED");
          expect(ref.sourceUrl).toMatch(/^https?:\/\//);
          expect(["RANK_PUBLISHER", "INSTITUTION_OFFICIAL"]).toContain(ref.sourceType);
        }
      } else {
        expect([record.ranking.rankMin, record.ranking.rankMax, record.ranking.category], record.unitid).toEqual([null, null, null]);
      }
    });
  });

  it("manifest 记录了 IPEDS 两个压缩包及字典的 SHA-256，没有写成 latest", () => {
    const ipeds = manifest.sources.filter((source) => source.id.startsWith("ipeds-"));
    expect(ipeds.map((source) => source.filename)).toEqual(["HD2024.zip", "IC2024.zip"]);
    for (const source of ipeds) {
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.dictionarySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.sourceYear).toBe(2024);
      expect(source.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe("精选名单与中文名映射", () => {
  it("名单规模符合范围：综合大学约 200、文理学院约 40–60、专门院校 12–20", () => {
    const count = (group: string) => curated.entries.filter((entry) => entry.group === group).length;
    expect(count("NU")).toBeGreaterThanOrEqual(180);
    expect(count("NU")).toBeLessThanOrEqual(230);
    expect(count("LAC")).toBeGreaterThanOrEqual(40);
    expect(count("LAC")).toBeLessThanOrEqual(60);
    expect(count("SPECIAL")).toBeGreaterThanOrEqual(12);
    expect(count("SPECIAL")).toBeLessThanOrEqual(20);
  });

  it("名单条目唯一、分组与大致档位自洽，并明确标注为 APPROXIMATE、不含名次", () => {
    expect(curated.tierBasis).toBe("APPROXIMATE");
    const ids = curated.entries.map((entry) => entry.unitid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of curated.entries) {
      expect(entry.unitid, entry.ipedsName).toMatch(/^\d{6}$/);
      expect(Object.keys(entry).sort(), entry.ipedsName).toEqual(["approxTier", "group", "ipedsName", "note", "unitid"]);
      if (entry.group === "SPECIAL") expect(entry.approxTier, entry.ipedsName).toBe("U");
      else expect(["S", "A", "B", "C", "D"], entry.ipedsName).toContain(entry.approxTier);
    }
  });

  it("中文名映射标注为模型整理、待人工审核", () => {
    expect(aliases.reviewStatus).toBe("MODEL_CURATED_PENDING_HUMAN_REVIEW");
    const ids = aliases.entries.map((entry) => entry.unitid);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("覆盖报告与证据清单", () => {
  it("报告里的数量与目录一致，并逐池给出是否 ≥3", () => {
    expect(coverage.mode).toBe("CURATED");
    expect(coverage.counts.inCatalog).toBe(runtime.schools.length);
    expect(coverage.counts.verified + coverage.counts.approximate + coverage.counts.special).toBe(runtime.schools.length);
    expect(coverage.counts.curatedJoined + coverage.counts.evidenceOnlyAdded).toBe(coverage.counts.candidates);
    expect(coverage.counts.outOfScopeRank).toBe(coverage.outOfScopeRank.length);
    expect(coverage.counts.candidates - coverage.counts.removed - coverage.counts.outOfScopeRank).toBe(coverage.counts.inCatalog);
    for (const tier of OFFER_TIERS) {
      expect(coverage.pools[tier].count).toBe(runtime.counts.byTier[tier]);
      expect(coverage.pools[tier].atLeast3).toBe(runtime.counts.byTier[tier] >= MIN_POOL_SIZE);
    }
    for (const key of ["removedSchools", "outOfScopeRank", "joinFailures", "tierDiscrepancies", "categoryChanges", "rankConflicts"]) {
      expect(Array.isArray(coverage[key]), key).toBe(true);
    }
    for (const removed of coverage.removedSchools) expect(removed.reasonCodes.length, removed.unitid).toBeGreaterThan(0);
  });

  it("每条 VERIFIED 证据都有 2027 版、类别、来源 URL，且各项机械检查为真", () => {
    const verified = rankEvidence.entries.filter((entry) => entry.verification === "VERIFIED");
    expect(verified.length).toBeGreaterThan(0);
    for (const entry of verified) {
      expect(entry.edition, entry.unitid).toBe(2027);
      expect(entry.category, entry.unitid).toBeTruthy();
      expect(entry.sourceUrl, entry.unitid).toMatch(/^https?:\/\//);
      expect(entry.checks, entry.unitid).toMatchObject({ http2xx: true, mentions2027: true, quoteMatch: true, rankNumberInQuote: true });
      expect(entry.checks.schoolIdentified, entry.unitid).toBeTruthy();
      expect(entry.checks.categoryQuoteMatch, entry.unitid).not.toBe(false);
      expect(entry.pageSha256, entry.unitid).toBeTruthy();
    }
    for (const entry of rankEvidence.entries.filter((item) => item.verification !== "VERIFIED")) {
      expect(entry.problems.length, entry.unitid).toBeGreaterThan(0);
    }
    // 因范围上限未收入的学校，证据仍以 VERIFIED 保留在清单里。
    const outOfScope = new Set(coverage.outOfScopeRank.map((item: { unitid: string }) => item.unitid));
    for (const unitid of outOfScope) {
      const kept = verified.filter((entry) => entry.unitid === unitid);
      expect(kept.length, String(unitid)).toBeGreaterThan(0);
      for (const entry of kept) expect([entry.inCatalog, entry.outOfScopeRank], String(unitid)).toEqual([false, true]);
    }
  });
});

const ipedsDir = process.env.LIUXUE_IPEDS_DIR ?? join(homedir(), "Developer/ml_source/datasets/ipeds/2024");
const hasIpeds = existsSync(join(ipedsDir, "HD2024.zip")) && existsSync(join(ipedsDir, "IC2024.zip"));

describe.skipIf(!hasIpeds)("真实 IPEDS 2024 数据（本机有原始文件时才跑）", () => {
  let snapshot: IpedsSnapshot;
  const load = () => (snapshot ??= loadIpedsSnapshot(ipedsDir));

  const evidenceFiles = () =>
    readdirSync(join(ROOT, DATA, "evidence"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => ({ file: `${DATA}/evidence/${name}`, data: json<RawEvidenceFile>(`${DATA}/evidence/${name}`) }));

  const offlineRun = (source: IpedsSnapshot, list: CuratedSchoolFile) =>
    runPipeline({
      snapshot: source,
      curated: list,
      aliases,
      overrides,
      evidenceFiles: evidenceFiles(),
      verifier: new QuoteVerifier(
        existsSync(join(ROOT, DATA, "evidence-verification.json")) ? json<EvidenceCache>(`${DATA}/evidence-verification.json`) : emptyCache(),
        { offline: true, refresh: false, fetcher: () => { throw new Error("offline"); } },
      ),
      previousManifest: manifest,
      now: "2099-01-01T00:00:00Z",
    });

  it("字典绑定通过，行数与来源哈希对得上 manifest", () => {
    const s = load();
    expect(s.hd).toHaveLength(6072);
    expect(s.ic).toHaveLength(5963);
    expect(s.hdMeta.problems).toEqual([]);
    expect(s.directoryRelease).toBe(manifest.directoryRelease);
    expect(s.hdMeta.zipSha256).toBe(manifest.sources.find((source) => source.id === "ipeds-hd2024")!.sha256);
    expect(s.icMeta.zipSha256).toBe(manifest.sources.find((source) => source.id === "ipeds-ic2024")!.sha256);
    expect(manifest.counts.sourceRows).toBe(6072);
  });

  it("资格规则在真实行上的抽查", () => {
    const s = load();
    const hd = new Map(s.hd.map((row) => [row.UNITID, row]));
    const ic = new Map(s.ic.map((row) => [row.UNITID, row]));
    const context = { fipsLabels: s.fipsLabels, stabbrLabels: s.stabbrLabels };
    const check = (unitid: string) => deriveEligibility(hd.get(unitid)!, ic.get(unitid), context);
    const expectations: Array<[string, string, string, string | null]> = [
      ["166683", "Massachusetts Institute of Technology", "ELIGIBLE", null],
      ["110635", "University of California-Berkeley", "ELIGIBLE", null],
      ["197036", "United States Military Academy", "EXCLUDED", "US_SERVICE_SCHOOL"],
      ["164155", "United States Naval Academy", "EXCLUDED", "US_SERVICE_SCHOOL"],
      ["119678", "Naval Postgraduate School", "EXCLUDED", "GRADUATE_ONLY"],
      ["433387", "Western Governors University", "EXCLUDED", "ONLINE_ONLY_STORY_MISMATCH"],
      ["100812", "Athens State University", "EXCLUDED", "NO_FIRST_TIME_UNDERGRADUATE_ENROLLMENT"],
      ["124557", "University of California-System Administration Central Office", "EXCLUDED", "ADMINISTRATIVE_UNIT"],
      ["243638", "College of Micronesia-FSM", "EXCLUDED", "FREELY_ASSOCIATED_STATE"],
      ["403469", "Frontier Community College", "EXCLUDED", "NO_BACHELOR_PROGRAM"],
      ["500139", "Purdue University - Indianapolis", "REVIEW_REQUIRED", "CHILD_CAMPUS_REPORTED_WITH_PARENT"],
    ];
    for (const [unitid, name, status, code] of expectations) {
      expect(hd.get(unitid)!.INSTNM, unitid).toBe(name);
      const result = check(unitid);
      expect(result.status, name).toBe(status);
      if (code) expect(result.reasonCodes, name).toContain(code);
    }
    const statuses = { ELIGIBLE: 0, EXCLUDED: 0, REVIEW_REQUIRED: 0 };
    for (const row of s.hd) statuses[deriveEligibility(row, ic.get(row.UNITID), context).status]++;
    expect(statuses.ELIGIBLE + statuses.EXCLUDED + statuses.REVIEW_REQUIRED).toBe(6072);
    expect(statuses.ELIGIBLE).toBeGreaterThan(2000);
    expect(statuses.ELIGIBLE).toBeLessThan(2529);
  });

  it("已生成的产物可以由输入离线重现（证据文件有新增条目时需先重跑 npm run schools:build）", () => {
    const outputs = offlineRun(load(), curated);
    const stale = JSON.parse(outputs.files[`${DATA}/rank-evidence.json`]).entries
      .filter((entry: { problems: string[] }) => entry.problems.includes("NOT_IN_CACHE_OFFLINE"))
      .map((entry: { unitid: string; ipedsName: string }) => `${entry.unitid} ${entry.ipedsName}`);
    expect(stale, "这些证据条目还没有复核结果：请联网运行 npm run schools:build 后再提交").toEqual([]);
    for (const [relativePath, content] of Object.entries(outputs.files)) {
      expect(sha256(content), relativePath).toBe(sha256(read(relativePath)));
    }
  });

  it("把 IPEDS 行与精选名单的顺序打乱，catalog.json 字节不变", () => {
    const s = load();
    const baseline = offlineRun(s, curated).files[`${DATA}/catalog.json`];
    const rotate = <T,>(items: T[], by: number) => [...items.slice(by), ...items.slice(0, by)].reverse();
    const mixed = offlineRun(
      { ...s, hd: rotate(s.hd, 1234), ic: rotate(s.ic, 4321) },
      { ...curated, entries: rotate(curated.entries, 77) },
    ).files[`${DATA}/catalog.json`];
    expect(sha256(mixed)).toBe(sha256(baseline));
  });
});
