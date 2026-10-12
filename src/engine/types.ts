// 引擎与界面共用的类型契约。规则来源：docs/03（数值）、06（状态与随机）、13（申请）、07（结局）、14（结局卡）。
// 这里只有类型，没有逻辑。

// ---------- 基础枚举 ----------

export type StatKey = "money" | "academics" | "career" | "wellbeing";
export type Stats = Record<StatKey, number>;
export type Focus = "STUDY" | "CAREER" | "CAMPUS" | "WORK" | "REST";
export type FocusCounts = Record<Focus, number>;
export type ArcId = "RESEARCH" | "INTERNSHIP" | "FRIENDSHIP" | "FAMILY" | "REORIENTATION" | "CREATIVE";
export type Degree = "UG" | "MS";
/** 当前所处学段。SETUP 之后、选校之前为 HS。 */
export type Stage = "HS" | Degree;
export type Opportunity = "PHD" | "LOCAL_JOB" | "HOME_JOB";
export type FinalRoute = Opportunity | "TRANSITION";
export type Outcome = "INELIGIBLE" | "OFFERED" | "NOT_OFFERED";
export type Economy = "LOW" | "MID" | "HIGH";
export type Expectation = "ACADEMIC" | "STABILITY" | "AUTONOMY";
export type Trait = "FOCUSED" | "PRACTICAL" | "OUTGOING" | "FRUGAL" | "RESILIENT" | "REFLECTIVE";
export type Aspiration = "DISCOVERY" | "INDEPENDENCE" | "BELONGING";
export type Strategy = "REACH" | "STEADY";
export type OfferTier = "S" | "A" | "B" | "C" | "D" | "U";
export type MastersProgram = "MS_1Y" | "MS_2Y";
export type ChoiceId = "A" | "B";
export type TransitionMode = "SELF_CHOSEN" | "NO_OFFER";
export type PhdEntryMode = "undergrad_direct" | "masters_entry";
export type EducationPath = "UG" | MastersProgram;
export type WellbeingBand = "DRAINED" | "STRETCHED" | "STEADY";
export type MoneyBand = "NARROW" | "LIMITED" | "BUFFERED";
/** 投入效率，十分之几：10 / 8 / 6。 */
export type EfficiencyFactor = 10 | 8 | 6;

// ---------- 事件内容（docs/06 第 2 节） ----------

export interface Callback {
  ifFlag: string;
  shortText: string;
  text: string;
}
export interface Choice {
  id: ChoiceId;
  label: string;
  effects: Stats;
  setFlags: string[];
  shortResult: string;
  result: string;
}
interface EventBase {
  id: string;
  title: string;
  summary: string;
  body: string;
  callbacks: Callback[];
  choices: Choice[];
}
export type StoryEvent = EventBase &
  (
    | { kind: "highschool"; node: 1 | 2 }
    | { kind: "core"; stage: number }
    | { kind: "arc"; arc: ArcId; beat: 1 | 2 | 3 }
    | { kind: "masters"; node: 1 | 2 | 3 | 4 }
  );

// ---------- 学校目录（运行时精简快照，由 scripts/schools 生成） ----------

export type SchoolGroup = "NU" | "LAC" | "REGIONAL" | "SPECIAL";
export type TierBasis = "VERIFIED_2027" | "APPROXIMATE" | "UNRANKED_SPECIAL";

export interface RuntimeSchool {
  /** IPEDS UNITID 的十进制字符串，唯一键。 */
  unitid: string;
  /** 官方英文名。 */
  name: string;
  nameZh: string | null;
  city: string;
  /** 州或属地的邮政缩写。 */
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
  mode: "CURATED" | "SAMPLE";
  releaseStatus: "DRAFT" | "VALIDATED";
  directoryYear: number;
  directoryRelease: "PROVISIONAL" | "FINAL" | "UNVERIFIED";
  rankEdition: number;
  tierMappingVersion: string;
  generatedAt: string;
  counts: {
    eligible: number;
    rankedVerified: number;
    verified: number;
    approximate: number;
    special: number;
    byTier: Record<OfferTier, number>;
  };
  /** 只含可发 offer 的学校，按 unitid 字符串升序。 */
  schools: RuntimeSchool[];
}

// ---------- 运行状态（docs/06 第 4 节） ----------

export type Phase =
  | "SETUP"
  | "HIGH_SCHOOL_EVENT"
  | "SCHOOL_OFFERS"
  | "FOCUS"
  | "CORE_EVENT"
  | "ARC_EVENT"
  | "TERM_REVIEW"
  | "GRAD_PREVIEW"
  | "GRAD_RESULTS"
  | "ENDING";

export interface Profile {
  /** 可为空字符串；叙事回退“你”。不进入任何随机 key。 */
  name: string;
  economy: Economy;
  expectation: Expectation;
  trait: Trait;
  aspiration: Aspiration;
}

export interface AdmissionSnapshot {
  baseReadiness: number;
  readinessBonus: number | null;
  readiness: number | null;
  strategy: Strategy | null;
  /** S/A/B/C/D 五个整数权重，总和 5000。 */
  weights: number[] | null;
  poolRoll: number | null;
  tierRoll: number | null;
  tier: OfferTier | null;
}

export interface Graduation {
  degree: Degree;
  frozenStats: Stats;
  frozenFocusCounts: FocusCounts;
  frozenFlags: string[];
  /** 整数百分比；无资格为 null。 */
  probabilities: Record<Opportunity, number | null>;
  /** 揭晓前为 null。 */
  rolls: Record<Opportunity, number> | null;
  outcomes: Record<Opportunity, Outcome> | null;
  resolution: FinalRoute | "MASTERS" | null;
}

export type HistoryKind = "EVENT" | "STIPEND" | "FOCUS" | "UPKEEP" | "GROWTH" | "MASTERS_FEE";

/** 每一次对四属性的原子应用记一条。requested 是名义变化，applied 是截断后真正发生的变化。 */
export interface HistoryEntry {
  kind: HistoryKind;
  stage: Stage;
  termIndex: number;
  /** 触发这次变化的操作被接受时的 revision（操作前的值）。 */
  revision: number;
  actionId: string;
  beforeStats: Stats;
  requestedDelta: Stats;
  appliedDelta: Stats;
  afterStats: Stats;
  eventId?: string;
  choiceId?: ChoiceId;
  focus?: Focus;
  efficiency?: EfficiencyFactor;
  /** UPKEEP：必要开销、实付、短缺与短缺带来的身心压力。 */
  upkeep?: { cost: number; paid: number; shortfall: number; stress: number };
  program?: MastersProgram;
}

// ---------- 结局卡（docs/14） ----------

export type EndingTierId = "EX" | "UR" | "SSR" | "SR_PLUS" | "SR" | "R_PLUS" | "R" | "N" | "D" | "BE";
export type HiddenEndingId =
  | "H01" | "H02" | "H03" | "H04" | "H05" | "H06"
  | "H07" | "H08" | "H09" | "H10" | "H11" | "H12";
export type EndingStatusId = "TE" | "OPEN" | "HE" | "TBC";

export interface EpilogueDraw {
  key: string;
  /** 给玩家看的名字，如“身份抽签”。 */
  label: string;
  probabilityPercent: number;
  roll: number;
  success: boolean;
}

export interface EndingCard {
  tier: EndingTierId;
  /** 如 "SR＋"。 */
  tierLabel: string;
  /** 如 "精英结局"。 */
  tierKind: string;
  name: string;
  roast: string;
  /** 命中这一档所依据的真实数值与经历，逐条中文短句。 */
  facts: string[];
  hidden: Array<{ id: HiddenEndingId; name: string; roast: string; facts: string[] }>;
  status: EndingStatusId;
  statusLabel: string;
  /** 如 "SSR＋H01＋HE"。 */
  combo: string;
  /** 本卡实际读取并使用的尾声抽签（未满足前置条件的不列出）。 */
  draws: EpilogueDraw[];
}

export interface EndingRecord {
  route: FinalRoute;
  /** 最终选择发生的检查点。 */
  degree: Degree;
  transitionMode: TransitionMode | null;
  entryMode: PhdEntryMode | null;
  card: EndingCard;
}

// ---------- RunState ----------

interface RunCommon {
  schemaVersion: 1;
  rulesVersion: string;
  contentVersion: string;
  catalogVersion: string;
  catalogSha256: string;
  tierMappingVersion: string;
  rankEdition: number;
  runId: string;
  /** 0 到 4294967295 的整数。 */
  seed: number;
  /** 每接受一次操作加 1。操作必须带上当前 revision，否则被拒绝。 */
  revision: number;
}

/** 开局：只有 seed 与版本。家庭候选和基础准备度都由 seed 推出，不存进状态。 */
export interface SetupRun extends RunCommon {
  phase: "SETUP";
}

export interface ActiveRun extends RunCommon {
  phase: Exclude<Phase, "SETUP">;
  stage: Stage;
  /** HS 为 0；本科 1–8；硕士 1–2 或 1–4。 */
  termIndex: number;
  highSchoolNode: null | 1 | 2;
  mastersYears: null | 1 | 2;
  profile: Profile;
  stats: Stats;
  focusCounts: FocusCounts;
  /** 只增不删，按获得顺序。 */
  flags: string[];
  arcs: { A: ArcId | null; B: ArcId | null };
  admission: AdmissionSnapshot;
  /** HS_02 结算后一次生成的三所同档学校，按抽取顺序；之后不变。 */
  offers: RuntimeSchool[] | null;
  school: RuntimeSchool | null;
  history: HistoryEntry[];
  graduations: { UG: Graduation | null; MS: Graduation | null };
  ending: EndingRecord | null;
}

export type RunState = SetupRun | ActiveRun;

// ---------- 操作 ----------

export type Action =
  | { type: "CONFIRM_SETUP"; economy: Economy; aspiration: Aspiration; name: string }
  | { type: "CHOOSE_EVENT"; eventId: string; choiceId: ChoiceId }
  | { type: "CHOOSE_SCHOOL"; unitid: string }
  | { type: "CHOOSE_FOCUS"; focus: Focus }
  | { type: "NEXT_TERM" }
  | { type: "REVEAL_GRADUATION" }
  | { type: "CHOOSE_ROUTE"; route: FinalRoute }
  | { type: "ENTER_MASTERS"; program: MastersProgram };

/** 操作加上发出时看到的 revision；与当前 revision 不一致即视为重复或过期。 */
export type Command = Action & { revision: number };

export type EngineErrorCode =
  | "STALE_REVISION"
  | "WRONG_PHASE"
  | "WRONG_EVENT"
  | "INVALID_ACTION"
  | "INSUFFICIENT_FUNDS"
  | "SCHOOL_NOT_OFFERED"
  | "ROUTE_NOT_OFFERED"
  | "MASTERS_NOT_AVAILABLE"
  | "CATALOG_POOL_TOO_SMALL";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ActionResult = { ok: true; state: RunState } | { ok: false; error: EngineError; state: RunState };

export interface EngineContext {
  catalog: RuntimeCatalog;
}

export type CatalogCheck =
  | { ok: true; counts: Record<OfferTier, number> }
  | { ok: false; code: "CATALOG_POOL_TOO_SMALL"; counts: Record<OfferTier, number>; message: string };

// ---------- 存档 ----------

export interface SaveEnvelope {
  format: "liuxue-sim-save";
  schemaVersion: 1;
  state: RunState;
  /** 从开局到当前的全部已接受操作；读档时可从 seed 重放并与 state 逐字段比对。 */
  log: Action[];
}

export type LoadResult =
  | { ok: true; state: RunState; log: Action[] }
  | { ok: false; reason: "CORRUPT" | "VERSION_MISMATCH"; detail: string };

// ---------- 给界面的只读视图 ----------

export interface Delta {
  requested: Stats;
  applied: Stats;
}

export interface FamilyCandidate {
  economy: Economy;
  expectation: Expectation;
  trait: Trait;
  initialStats: Stats;
  stipend: number;
  upkeep: number;
}

export interface TierOdds {
  tier: OfferTier;
  /** 精确概率，0 到 1。 */
  exact: number;
  /** 最大余数法得到的 0.1% 单位数，六档合计 1000。只用于显示。 */
  tenths: number;
  /** 如 "17.6%"、"低于 0.1%"、"0%"。 */
  label: string;
}

export interface StageInfo {
  stage: "SETUP" | Stage | "END";
  /** 如 “高中最后一年”“本科 · 一年级秋”“硕士 · 第 1 学期”“本科毕业”“人生回顾”。 */
  title: string;
  /** 如 “节点 3 / 8”；不适用为 null。 */
  step: string | null;
  termIndex: number;
  termCount: number;
}

export interface SceneIntro {
  short: string;
  long: string;
}

export interface ChoiceView {
  choice: Choice;
  available: boolean;
  /** 资金不足时：需要 need，当前 have。 */
  shortBy: null | { need: number; have: number };
  delta: Delta;
  /** 本学期预计结算（不含之后可能出现的支线事件）；高中阶段为 null。 */
  projected: null | { moneyAfterChoice: number; upkeep: number; moneyAfterUpkeep: number; shortfall: number };
  /** 仅高中事件：这次选择对申请的作用。 */
  admission: null | {
    readinessBonus: number | null;
    readinessAfter: number | null;
    strategy: Strategy | null;
    odds: TierOdds[] | null;
  };
}

export interface EventView {
  event: StoryEvent;
  /** 如 “高中”“主线”“支线 · 科研 第 1 幕”“硕士”。 */
  kindLabel: string;
  /** 事件出现时即固定的全部命中回响，按数组顺序。 */
  matchedCallbacks: Callback[];
  /** 默认只展示的那一条：最后一个命中的；没有则 null。 */
  defaultCallback: Callback | null;
  choices: ChoiceView[];
}

export interface FocusOptionView {
  focus: Focus;
  name: string;
  /** 03 表里的基础值。 */
  base: Stats;
  /** 合并特质与效率之后、截断之前。 */
  requested: Stats;
  /** 截断之后真正会发生的变化。 */
  applied: Stats;
  traitApplied: boolean;
  efficiencyApplied: boolean;
}

export interface FocusView {
  /** 本学期已到账的资助。 */
  stipend: Delta;
  upkeep: number;
  efficiency: { factor: EfficiencyFactor; note: string };
  options: FocusOptionView[];
}

export interface LastOutcome {
  kind: "EVENT" | "FOCUS" | "MASTERS_FEE";
  heading: string;
  choiceLabel: string | null;
  shortText: string;
  longText: string | null;
  delta: Delta;
}

export interface LedgerLine {
  kind: HistoryKind;
  label: string;
  detail: string | null;
  delta: Delta;
}

export interface TermLedger {
  stage: Degree;
  termIndex: number;
  termCount: number;
  title: string;
  startStats: Stats;
  endStats: Stats;
  lines: LedgerLine[];
  shortfall: number;
  stress: number;
  isFinalTerm: boolean;
}

export interface AdmissionPreview {
  baseReadiness: number;
  readinessBonus: number | null;
  /** 已知的准备度：选完 HS_01 后为 base+bonus，否则为 base。 */
  readinessSoFar: number;
  odds: Record<Strategy, TierOdds[]>;
}

export interface AdmissionResult {
  baseReadiness: number;
  readinessBonus: number;
  readiness: number;
  strategy: Strategy;
  odds: TierOdds[];
  tier: OfferTier;
  poolRoll: number;
  tierRoll: number;
  offers: RuntimeSchool[];
  chosen: RuntimeSchool | null;
}

export interface OpportunityView {
  id: Opportunity;
  name: string;
  eligible: boolean;
  /** 整数百分比；无资格为 null。 */
  probability: number | null;
  /** 揭晓前为 null。 */
  outcome: Outcome | null;
  roll: number | null;
  /** 资格路径（任一满足即可），带当前是否满足。 */
  requirements: Array<{ text: string; met: boolean }>;
  /** 概率的逐项贡献，单位是百分点的百分之一（整数），合计为截断前的原值。 */
  breakdown: Array<{ label: string; hundredths: number }>;
  clampedTo: null | "MIN" | "MAX";
}

export interface GraduationView {
  degree: Degree;
  revealed: boolean;
  frozenStats: Stats;
  frozenFocusCounts: FocusCounts;
  opportunities: OpportunityView[];
  resolution: FinalRoute | "MASTERS" | null;
}

export interface RouteOption {
  route: FinalRoute;
  name: string;
  available: boolean;
  /** 一句说明：为什么可选/不可选，或选了意味着什么。 */
  note: string;
}

export interface MastersOption {
  program: MastersProgram;
  name: string;
  terms: number;
  fee: number;
  stipendTotal: number;
  upkeepTotal: number;
  requiredReserve: number;
  money: number;
  eligible: boolean;
  blockers: Array<{ code: "HAS_JOB_OFFER" | "ACADEMICS_BELOW_55" | "FUNDS_SHORT"; text: string }>;
}

export interface ReviewEntry {
  eventId: string;
  title: string;
  choiceId: ChoiceId;
  choiceLabel: string;
  result: string;
  /** 如 “高中”“本科 · 一年级秋”“硕士 · 第 2 学期”。 */
  when: string;
}

export interface EndingView {
  seed: number;
  route: FinalRoute;
  degree: Degree;
  educationPath: EducationPath;
  transitionMode: TransitionMode | null;
  entryMode: PhdEntryMode | null;
  title: string;
  /** 学历/去向标签，如 “本科直博 · 即将入学”。 */
  label: string;
  /** PHD + MS 时附带的 “一年制硕士”/“两年制硕士”，否则 null。 */
  labelExtra: string | null;
  short: {
    text: string;
    keyExperience: string;
    /** 身心短句与资金短句合成的一段。 */
    status: string;
  };
  /** 最终检查点的三路机会。 */
  opportunities: OpportunityView[];
  full: {
    body: string;
    bridge: string;
    wellbeing: { band: WellbeingBand; text: string };
    money: { band: MoneyBand; text: string };
    aspiration: string;
    family: string;
    applicationSummary: string;
    review: ReviewEntry[];
    /** 两条支线第三幕对应的回顾短句。 */
    arcRecaps: string[];
    focusSummary: Array<{ focus: Focus; name: string; count: number }>;
    epilogue: string;
    /** 读过硕士时：本科毕业时的机会（已在进入硕士时放弃）；否则 null。 */
    undergradOpportunities: OpportunityView[] | null;
  };
  card: EndingCard;
}
