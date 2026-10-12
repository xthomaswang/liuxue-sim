// 学校目录的 canonical schema（docs/11 §5，按“精选目录”范围修订）与本管线内部用到的类型。
// 仅类型与常量，Node 24 可直接运行（类型会被剥离）。

export const TIER_MAPPING_VERSION = "usnews-2027-game-v2";
export const ELIGIBILITY_RULE_VERSION = "eligibility-v1";
export const IMPORTER_VERSION = "schools-importer-2.1.0";
export const RANK_EDITION = 2027;
export const CATALOG_VERSION = "us-curated-2024dir-usnews2027-v2";

export type OfferTier = "S" | "A" | "B" | "C" | "D" | "U";
export const OFFER_TIERS: OfferTier[] = ["S", "A", "B", "C", "D", "U"];

export type Verification = "VERIFIED" | "PARTIAL" | "UNVERIFIED" | "CONFLICT";
export type EligibilityStatus = "ELIGIBLE" | "EXCLUDED" | "REVIEW_REQUIRED";

export type RankCategory =
  | "NU" | "LAC"
  | "RU_NORTH" | "RU_SOUTH" | "RU_MIDWEST" | "RU_WEST"
  | "RC_NORTH" | "RC_SOUTH" | "RC_MIDWEST" | "RC_WEST";
export const RANK_CATEGORIES: RankCategory[] = [
  "NU", "LAC",
  "RU_NORTH", "RU_SOUTH", "RU_MIDWEST", "RU_WEST",
  "RC_NORTH", "RC_SOUTH", "RC_MIDWEST", "RC_WEST",
];

/** 精选目录的来源分组。REGIONAL 只来自已核实的地区类排名证据。 */
export type SchoolGroup = "NU" | "LAC" | "REGIONAL" | "SPECIAL";
export const SCHOOL_GROUPS: SchoolGroup[] = ["NU", "LAC", "REGIONAL", "SPECIAL"];

/**
 * 档位依据：
 * - VERIFIED_2027：有可机械复核的 2027 版名次证据，按 v2 表映射。
 * - APPROXIMATE：模型依据近几版榜单整理的大致区间，未逐校核实，不带名次。
 * - UNRANKED_SPECIAL：专门院校（艺术/音乐/工程等），按不进综合总榜处理，进 U 池；同样未逐校核实。
 */
export type TierBasis = "VERIFIED_2027" | "APPROXIMATE" | "UNRANKED_SPECIAL";

export type SourceType = "IPEDS" | "SCORECARD" | "RANK_PUBLISHER" | "INSTITUTION_OFFICIAL";

export interface EvidenceRef {
  sourceId: string;
  sourceUrl: string;
  sourceType: SourceType;
  sourceYear: number | null;
  publishedAt: string | null;
  retrievedAt: string;
  verification: Verification;
  fieldOrLocator: string;
  rawValue: string | number | boolean | null;
}

export interface InstitutionFacts {
  operating: boolean | null;
  offersBachelor: boolean | null;
  acceptsNewUndergraduates: boolean | null;
  inPersonUndergraduateExperience: boolean | null;
  specialEligibilitySupported: boolean | null;
  usLocation: boolean | null;
}

export type RankingStatus = "VERIFIED" | "UNRANKED" | "MISSING" | "CONFLICT";

export interface SchoolRecord {
  unitid: string;
  officialName: string;
  name: string;
  nameZh: string | null;
  aliases: string[];
  city: string;
  stateOrTerritory: string;
  country: "US";
  website: string | null;
  campusLabel: string | null;
  parentSystemName: string | null;
  scorecardId: string | null;
  opeids: string[];
  group: SchoolGroup;
  curation: {
    /** 是否出现在 curated-schools.json；false 表示仅因已核实证据入选。 */
    listed: boolean;
    approxTier: OfferTier | null;
    note: string | null;
  };
  institutionFacts: InstitutionFacts;
  offerEligibility: {
    status: EligibilityStatus;
    reasonCodes: string[];
    explanation: string;
    ruleVersion: string;
    evidence: EvidenceRef[];
  };
  ranking: {
    publisher: "US_NEWS";
    edition: 2027;
    category: RankCategory | null;
    rankMin: number | null;
    rankMax: number | null;
    tied: boolean | null;
    status: RankingStatus;
    evidence: EvidenceRef[];
  };
  tier: {
    value: OfferTier;
    mappingVersion: typeof TIER_MAPPING_VERSION;
    basis: TierBasis;
    reason: string;
  };
  storyProfile: {
    campusTemplate: "GENERIC_US_CAMPUS";
    verifiedLocationTags: string[];
  };
  fieldEvidence: Record<string, EvidenceRef[]>;
  sourceSnapshotIds: string[];
}

export type DirectoryRelease = "PROVISIONAL" | "FINAL" | "UNVERIFIED";
export type CatalogMode = "CURATED" | "SAMPLE";

export interface CatalogCounts {
  /** HD2024.csv 的数据行数（连接用的全集，不是目录规模）。 */
  sourceRows: number;
  /** 候选实体数 = 精选名单 ∪ 仅凭已核实证据入选的学校。 */
  candidates: number;
  eligible: number;
  excluded: number;
  reviewRequired: number;
  /** 有已核实名次但超出范围上限（NU > 200、LAC > 50）而未收入的学校数。 */
  outOfScopeRank: number;
  verified: number;
  approximate: number;
  special: number;
  rankedVerified: number;
  byTier: Record<OfferTier, number>;
  byGroup: Record<SchoolGroup, number>;
}

export interface CatalogManifest {
  schemaVersion: "1.0";
  catalogVersion: string;
  releaseStatus: "DRAFT" | "VALIDATED";
  mode: CatalogMode;
  scopeNote: string;
  directoryYear: number;
  /** docs/11 只列了 PROVISIONAL/FINAL；读不到官方标注时如实写 UNVERIFIED（有意扩展）。 */
  directoryRelease: DirectoryRelease;
  directoryReleaseBasis: Record<string, string | null>;
  rankEdition: 2027;
  tierMappingVersion: typeof TIER_MAPPING_VERSION;
  eligibilityRuleVersion: string;
  scopeRuleVersion: string;
  curatedListVersion: string;
  importerVersion: string;
  catalogSha256: string;
  generatedAt: string;
  sources: Array<{
    id: string;
    publisher: string;
    url: string;
    filename: string;
    sha256: string;
    dictionarySha256: string | null;
    sourceYear: number | null;
    fetchedAt: string;
  }>;
  counts: CatalogCounts;
}

export interface RuntimeSchool {
  unitid: string;
  name: string;
  nameZh: string | null;
  city: string;
  state: string;
  tier: OfferTier;
  group: SchoolGroup;
  tierBasis: TierBasis;
  rank: null | { category: string; rankMin: number; rankMax: number; tied: boolean };
}

export interface RuntimeCatalog {
  schemaVersion: "1.0";
  catalogVersion: string;
  catalogSha256: string;
  mode: CatalogMode;
  releaseStatus: "DRAFT" | "VALIDATED";
  directoryYear: number;
  directoryRelease: DirectoryRelease;
  rankEdition: 2027;
  tierMappingVersion: typeof TIER_MAPPING_VERSION;
  generatedAt: string;
  counts: {
    eligible: number;
    rankedVerified: number;
    verified: number;
    approximate: number;
    special: number;
    byTier: Record<OfferTier, number>;
  };
  schools: RuntimeSchool[];
}

/** data/schools/curated-schools.json 的单条。 */
export interface CuratedSchoolEntry {
  unitid: string;
  /** 连接护栏：必须与 HD2024 该 UNITID 的 INSTNM 完全一致，否则构建失败。 */
  ipedsName: string;
  group: SchoolGroup;
  approxTier: OfferTier;
  note: string;
}

export interface CuratedSchoolFile {
  schemaVersion: "1.0";
  listVersion: string;
  tierBasis: "APPROXIMATE";
  tierBasisNote: string;
  entries: CuratedSchoolEntry[];
}

export interface AliasEntry {
  unitid: string;
  ipedsName: string;
  nameZh: string | null;
}

export interface AliasFile {
  schemaVersion: "1.0";
  reviewStatus: "MODEL_CURATED_PENDING_HUMAN_REVIEW" | "HUMAN_REVIEWED";
  note: string;
  entries: AliasEntry[];
}

export interface EligibilityOverride {
  unitid: string;
  ipedsName: string;
  fact: keyof InstitutionFacts;
  originalValue: boolean | null;
  correctedValue: boolean;
  /** docs/11 §2.1 的原因码之一，例如 SPECIAL_ELIGIBILITY_UNSUPPORTED。correctedValue=true 时可为 null。 */
  reasonCode: string | null;
  reason: string;
  officialUrl: string;
  /** officialUrl 页面规范化正文里的一段连续原文，构建时用与排名证据相同的方式机械复核。 */
  quote: string;
  verifiedAt: string;
}

export interface OverrideFile {
  schemaVersion: "1.0";
  ruleVersion: string;
  note: string;
  overrides: EligibilityOverride[];
}

/** 检索 agent 写入 data/schools/evidence/*.json 的单条证据。 */
export interface RawEvidenceEntry {
  unitid: string;
  ipedsName: string;
  schoolNameInSource: string;
  category: RankCategory;
  rankMin: number;
  rankMax: number;
  tied: boolean;
  edition: number;
  sourceUrl: string;
  sourceType: "INSTITUTION_OFFICIAL" | "RANK_PUBLISHER";
  publishedAt: string | null;
  quote: string;
  categoryQuote: string | null;
  notes: string;
}

export interface RawEvidenceFile {
  collector: string;
  collectedAt: string;
  entries: RawEvidenceEntry[];
  rejected?: unknown[];
}
