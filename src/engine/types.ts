// 引擎与界面共用的类型契约。规则来源：docs/03（数值）、06（状态与随机）、13（申请）、07（结局）、14（结局卡）。
// 这里只有类型，没有逻辑。

// ---------- 基础枚举 ----------

export type StatKey = "money" | "academics" | "career" | "wellbeing";
export type Stats = Record<StatKey, number>;
export type Focus = "STUDY" | "CAREER" | "CAMPUS" | "WORK" | "REST";
export type FocusCounts = Record<Focus, number>;
export type ArcId = "RESEARCH" | "INTERNSHIP" | "FRIENDSHIP" | "FAMILY" | "REORIENTATION" | "CREATIVE";
export type Degree = "UG" | "MS";
/** 当前所处学段。SETUP 之后、选校之前为 HS；毕业（或中途离场）之后的几年为 LIFE（第四版，docs/24）。 */
export type Stage = "HS" | Degree | "LIFE";
export type Opportunity = "PHD" | "LOCAL_JOB" | "HOME_JOB";
export type FinalRoute = Opportunity | "TRANSITION";
/** 毕业（或中途离场）之后所在的轨道（docs/24 §4）。前四个与毕业去向同名；DROPOUT 是中途结局之后。 */
export type LifeTrack = FinalRoute | "DROPOUT";
export type Outcome = "INELIGIBLE" | "OFFERED" | "NOT_OFFERED";
export type Economy = "LOW" | "MID" | "HIGH";
export type Expectation = "ACADEMIC" | "STABILITY" | "AUTONOMY";
/** 第一版的六种特质。第二版里它们是六张固定天赋（T_FOCUSED 等），这个类型只用于文案表的键。 */
export type Trait = "FOCUSED" | "PRACTICAL" | "OUTGOING" | "FRUGAL" | "RESILIENT" | "REFLECTIVE";
export type TalentRarity = "N" | "R" | "SR" | "SSR";
/** standard：正式玩法（docs/16）。classic：只给测试用，见 docs/16 第 7 节。 */
export type RunMode = "standard" | "classic";
/** 开局分配的四项点数（docs/22 §2），每项 0–10。 */
export interface Points {
  family: number;
  academics: number;
  career: number;
  wellbeing: number;
}
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
    | { kind: "random"; scope: "UG" }
    | { kind: "arc"; arc: ArcId; beat: 1 | 2 | 3 }
    | { kind: "masters"; node: 1 | 2 | 3 | 4 }
  );

// ---------- 第二版新增内容（docs/16–21） ----------

export interface TalentEffects {
  initial?: Partial<Stats>;
  stipend?: number;
  upkeep?: number;
  focus?: Partial<Record<Focus, Partial<Stats>>>;
  focusWellbeingRelief?: number;
  readiness?: number;
  chance?: Partial<Record<Opportunity, number>>;
  efficiencyFloor?: 8 | 10;
  arcWeight?: Partial<Record<ArcId, number>>;
  growth?: Partial<Stats>;
  /** 可分配点数的增减（基础 20）。 */
  points?: number;
  /** 第四版：每学期期末 GPA 的加成，单位是 0.01（20 表示 +0.20）。 */
  gpa?: number;
  /** 第四版：毕业后每年基础变化的加成（加在 LIFE_BASE 上）。 */
  lifeGrowth?: Partial<Stats>;
}
export interface Talent {
  id: string;
  name: string;
  rarity: TalentRarity;
  /** 一句话说明效果，带数字。 */
  text: string;
  effects: TalentEffects;
  /** 一开始不在十连抽的池子里，要靠每局结束时的随机解锁拿到（docs/22 §7.2）。 */
  locked?: boolean;
}
/**
 * 结局的触发条件（docs/22 §4）。写了的每一项都必须满足；没写的不限制。
 * 属性取当时的四属性（去向结局取最终检查点的冻结快照），次数取累计的安排次数。
 */
export interface EndingCondition {
  /** 中途结局：当前学段。去向结局：最终检查点。 */
  stage?: Degree;
  /** 中途结局：当前学期的范围（含两端）。 */
  termMin?: number;
  termMax?: number;
  statMin?: Partial<Stats>;
  statMax?: Partial<Stats>;
  countMin?: Partial<FocusCounts>;
  countMax?: Partial<FocusCounts>;
  pointsMin?: Partial<Points>;
  pointsMax?: Partial<Points>;
  /** 必须全部拥有的历史标记。 */
  flagsAll?: string[];
  /** 拥有其中任意一张天赋。 */
  talentsAny?: string[];
  /** 中途结局：到本学期为止，连续 n 个学期期末出现资金短缺。 */
  shortfallStreak?: number;
  /** 中途结局：到本学期为止，连续 n 个学期期末身心为 0。 */
  zeroWellbeingStreak?: number;
  /** 学校所在州或属地的邮政缩写在列表里。 */
  schoolStates?: string[];
  schoolTiers?: OfferTier[];
  /** 抽到的个人愿望在列表里。 */
  aspirations?: Aspiration[];
  /** 去向结局：过渡期的两种情形。 */
  transitionMode?: TransitionMode;
  /** 去向结局：结局卡等级在列表里。 */
  tiers?: EndingTierId[];

  // ---- 第四版新增（docs/24 §6）。上下文里没有对应信息时，除 *None 外一律视为不满足 ----
  /** 日常：本学期的安排类别在列表里。 */
  focusAny?: Focus[];
  /** 毕业后：当前轨道在列表里。 */
  tracks?: LifeTrack[];
  /** 毕业后：第几年（1 起，含两端）。 */
  yearMin?: number;
  yearMax?: number;
  /** 毕业后：人生标记全部拥有 / 至少有一个 / 一个都没有。 */
  lifeFlagsAll?: string[];
  lifeFlagsAny?: string[];
  lifeFlagsNone?: string[];
  /** 一张天赋都没有（例如“没有签证锦鲤才会被 check”）。 */
  talentsNone?: string[];
  /** 毕业后：当年的去向结局 id 在列表里。 */
  flavors?: string[];
  /** 毕业后：当年的中途结局 id 在列表里。 */
  earlies?: string[];
  /** 毕业后：当年的毕业去向在列表里（中途结局没有去向）。 */
  routes?: FinalRoute[];
  /** 毕业后：离开学校时的学段在列表里（读过硕士为 MS）。 */
  degrees?: Degree[];
  /** 家境档在列表里。 */
  economies?: Economy[];
}
/** 中途结局（docs/22 §4），内容在 src/content/earlyEndings.json，数组顺序即检查顺序。 */
export interface EarlyEnding {
  id: string;
  tier: EndingTierId;
  status: EndingStatusId;
  name: string;
  roast: string;
  title: string;
  text: string;
  epilogue: string;
  /** 给玩家看的达成条件（图册里显示），必须与 when、chancePermille 一致。 */
  condition: string;
  hint: string;
  when: EndingCondition;
  /** 条件满足时每个学期期末的触发概率，千分之几；1000 表示必然。 */
  chancePermille: number;
  /** 第四版：离场之后的几年走哪条轨道；缺省为 DROPOUT。 */
  lifeTrack?: LifeTrack;
}
/** 去向结局（docs/22 §5.3）：毕业去向之上的一层“你后来成了什么人”，内容在 src/content/endingFlavors.json。 */
export interface EndingFlavor {
  id: string;
  route: FinalRoute;
  name: string;
  roast: string;
  /** 一两句话的结局描述。 */
  text: string;
  hint: string;
  when: EndingCondition;
  /** 候选之间的相对权重，1–10。 */
  weight: number;
  /** 每个去向恰好一张：没有任何条件的兜底。 */
  fallback?: boolean;
}
/** 成就（docs/23），内容在 src/content/achievements.json。 */
export interface Achievement {
  id: string;
  name: string;
  grade: TalentRarity;
  text: string;
}
export interface PlanCard {
  /** 五张基础安排的 id 就是类别名。 */
  id: string;
  focus: Focus;
  name: string;
  base?: boolean;
  delta: Stats;
}
export interface Happening {
  id: string;
  scope: "ANY" | "UG" | "MS";
  text: string;
  effects: Stats;
  /** 第四版：出现的条件（按发生那一刻的状态判断）；缺省为不限。 */
  when?: EndingCondition;
}

// ---------- 第四版新增内容（docs/24） ----------

/** 暑假的种类：出国前的夏天、本科的暑假、硕士的暑假。 */
export type SummerSlot = "DEPARTURE" | "UG" | "MS";
/** 暑假里的一件事（src/content/summers.json）。有数值变化，记进历史。 */
export interface SummerEvent {
  id: string;
  slot: SummerSlot;
  text: string;
  effects: Stats;
  when: EndingCondition;
  /** 候选之间的相对权重，1–10。 */
  weight: number;
}
/** 日常的位置：任何学期、只在上学期（秋）、只在下学期（春）、下学期开头的寒假。 */
export type DailySlot = "TERM" | "FALL" | "SPRING" | "WINTER";
/** 日常（src/content/daily.json）：只是一行字，没有数值变化，不进历史；轨迹按学期现挑几条穿插进去。 */
export interface DailyLine {
  id: string;
  slot: DailySlot;
  text: string;
  when: EndingCondition;
  /** 候选之间的相对权重，1–10。条件越具体的写得越高。 */
  weight: number;
}
/** 期末 GPA 那一行的说法（src/content/gpa.json）：GPA ≥ min 的第一档，从 texts 里挑一句，{gpa} 换成数值。 */
export interface GpaBand {
  min: number;
  texts: string[];
}
/** 毕业后每年的重心（每条轨道五类各一张）。 */
export interface LifePlan {
  focus: Focus;
  name: string;
  delta: Stats;
}
/** 毕业后的一件事：里程碑（按顺序检查、按概率发生）或生活事件（每年抽一两条）。 */
export interface LifeEvent {
  id: string;
  text: string;
  delta: Stats;
  when: EndingCondition;
  /** 里程碑：条件满足时这一年发生的概率，千分之几。 */
  chancePermille?: number;
  /** 里程碑：可以在不同年份重复发生（例如每年一次的抽签）；缺省一局最多一次。 */
  repeatable?: boolean;
  /** 生活事件：候选之间的相对权重，1–10。 */
  weight?: number;
  /** 发生后加上的人生标记。 */
  setFlags?: string[];
  /** 发生后换到这条轨道（从下一年起生效）。 */
  setTrack?: LifeTrack;
}
/** 五年后的结局：过完最后一年后，按最后的轨道挑一条。 */
export interface LifeOutcome {
  id: string;
  name: string;
  roast: string;
  /** 一两句话。 */
  text: string;
  /** 图册里没解锁时显示的提示。 */
  hint: string;
  /** 稀有度着色：N／R／SR／SSR，越往后越难得。 */
  grade: TalentRarity;
  when: EndingCondition;
  /** 候选之间的相对权重，1–10。 */
  weight: number;
  /** 每条轨道恰好一条：没有任何条件的兜底。 */
  fallback?: boolean;
}
/** 一条轨道的全部内容（src/content/life/<TRACK>.json）。 */
export interface LifeTrackContent {
  track: LifeTrack;
  /** 轨道的名字，如“留美工作”。 */
  name: string;
  /** 每年固定发生的变化（工资、房租、成长），配一句从 texts 里挑的话。 */
  base: { delta: Stats; texts: string[] };
  /** 五类各一张，按 STUDY、CAREER、CAMPUS、WORK、REST 的顺序。 */
  plans: LifePlan[];
  milestones: LifeEvent[];
  events: LifeEvent[];
  outcomes: LifeOutcome[];
}

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
  | "GRAD_PREVIEW"
  | "GRAD_RESULTS"
  /** 第四版：毕业（或中途离场）之后，一年一年过。 */
  | "LIFE"
  | "ENDING";

export interface Profile {
  economy: Economy;
  expectation: Expectation;
  aspiration: Aspiration;
  /** 选中的天赋 id，按天赋池顺序。standard 恰好 3 张；classic 恰好 1 张特质天赋。 */
  talents: string[];
  /** standard：开局分配的点数；economy 由家境点数推出。classic 为 null。 */
  points: Points | null;
}

export interface AdmissionSnapshot {
  baseReadiness: number;
  /** 开局即确定的准备度加成：学业点数加上天赋的 readiness（classic 没有点数，只有天赋）。 */
  talentBonus: number;
  /** HS_01 选择带来的加成。 */
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

export type HistoryKind =
  | "EVENT" | "STIPEND" | "HAPPENING" | "FOCUS" | "UPKEEP" | "GROWTH" | "MASTERS_FEE"
  // 第四版（docs/24）
  | "SUMMER" | "LIFE_BASE" | "LIFE_PLAN" | "LIFE_EVENT";

/** 毕业（或中途离场）之后的几年（docs/24 §4）。进入时创建，每过一年更新；经典模式没有。 */
export interface LifeState {
  /** 当前所在的轨道。某一年里发生的换轨从下一年起生效。 */
  track: LifeTrack;
  /** 走过的轨道，按顺序，含起点（换过一次轨就有两项）。 */
  tracks: LifeTrack[];
  /** 已经过完的年数，0 到 LIFE_YEARS。 */
  year: number;
  /** 离开学校那年的年龄。第 k 年结束时的年龄是 startAge + k。 */
  startAge: number;
  /** 离开学校时（毕业确定去向，或中途结局那一刻）的四属性。 */
  startStats: Stats;
  /** 毕业后的事件加上的人生标记，只增不删，按获得顺序。 */
  flags: string[];
  /** 毕业后各类重心的次数（不并入学期的 focusCounts）。 */
  focusCounts: FocusCounts;
  /** 五年后的结局；过完最后一年才有。 */
  outcome: null | { id: string; track: LifeTrack };
}

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
  /** FOCUS：选中的学期安排。 */
  planId?: string;
  efficiency?: EfficiencyFactor;
  /** HAPPENING：突发小事的 id。 */
  happeningId?: string;
  /** UPKEEP：必要开销、实付、短缺与短缺带来的身心压力。 */
  upkeep?: { cost: number; paid: number; shortfall: number; stress: number };
  program?: MastersProgram;
  /** SUMMER：暑假里那件事的 id。 */
  summerId?: string;
  /** LIFE_BASE／LIFE_PLAN／LIFE_EVENT：这一年所在的轨道。LIFE_PLAN 的类别记在 focus。 */
  track?: LifeTrack;
  /** LIFE_BASE：从 base.texts 里挑中的那一句的下标。 */
  textIndex?: number;
  /** LIFE_EVENT：事件 id，以及它是不是里程碑。 */
  lifeEventId?: string;
  milestone?: boolean;
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
  /** 中途结局的 id；毕业结局为 null。 */
  early: string | null;
  /** 去向结局（如“湾区码农”）；中途结局为 null。 */
  flavor: null | { id: string; name: string; roast: string; text: string };
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
  /**
   * 可以公开给玩家看的尾声抽签。身份抽签在前置条件满足时列出（无论中没中）；
   * 隐藏结局相关的抽签只在命中时列出，没命中的不写，避免提前剧透。
   */
  draws: EpilogueDraw[];
}

export interface EndingRecord {
  /** GRADUATION：走到毕业并确定去向。EARLY：中途结局（docs/22 §4）。 */
  kind: "GRADUATION" | "EARLY";
  /** 中途结局为 null。 */
  route: FinalRoute | null;
  /** 中途结局的 id；毕业结局为 null。 */
  early: string | null;
  /** 最终选择发生的检查点；中途结局是当时所在的学段。 */
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
  mode: RunMode;
}

/** 开局：只有 seed 与版本。出身、十张天赋和基础准备度都由 seed 推出，不存进状态。 */
export interface SetupRun extends RunCommon {
  phase: "SETUP";
  /** 仅 classic 模式：由调用方指定的经济档。 */
  classicEconomy?: Economy;
  /** standard：开局时已解锁的锁定天赋 id（天赋池顺序）。它决定十连抽的池子。 */
  unlockedTalents: string[];
  /** standard：上一局选择继承的天赋；十连抽的第一张固定是它。 */
  inheritedTalent: string | null;
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
  /** 开局时的输入，原样带着走：读档重放与成就判定要用它重新推出这一局的十连抽。 */
  unlockedTalents?: string[];
  inheritedTalent?: string | null;
  /** 第四版：毕业（或中途离场）之后的几年；还没走到、或经典模式为 null／缺省。 */
  life?: LifeState | null;
}

export type RunState = SetupRun | ActiveRun;

// ---------- 操作 ----------

export type Action =
  | { type: "CONFIRM_SETUP"; talents: string[]; points?: Points }
  | { type: "CHOOSE_EVENT"; eventId: string; choiceId: ChoiceId }
  | { type: "CHOOSE_SCHOOL"; unitid: string }
  | { type: "CHOOSE_PLAN"; planId: string }
  | { type: "REVEAL_GRADUATION" }
  | { type: "CHOOSE_ROUTE"; route: FinalRoute }
  | { type: "ENTER_MASTERS"; program: MastersProgram }
  /** 第四版：过一年，focus 是这一年的重心（由角色按倾向自动选）。 */
  | { type: "LIVE_YEAR"; focus: Focus };

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

/** 开局需要的信息：抽出来的家庭期待与愿望、十张天赋、基础准备度。 */
export interface SetupView {
  origin: {
    expectation: Expectation;
    aspiration: Aspiration;
  };
  /** 十连抽的结果，按抽出顺序；有继承天赋时第一张是它。 */
  draw: Talent[];
  pickCount: number;
  /** 每项点数的上限。 */
  pointMax: number;
  baseReadiness: number;
  inherited: string | null;
}

/** 分点一屏的实时预览：按选中的天赋与当前点数，开局会是什么样。 */
export interface StartPreview {
  /** 可分配的总点数（20 加上天赋的 points）。 */
  pointBudget: number;
  /** 已分配的点数之和。 */
  pointsUsed: number;
  /** 点数合法（每项 0–pointMax 且总和等于 pointBudget）时为 true。 */
  valid: boolean;
  economy: Economy;
  stats: Stats;
  stipend: number;
  upkeep: number;
  /** 基础准备度 + 学业点数 + 天赋加成（不含高中事件的加成）。 */
  readiness: number;
}

/** 人生轨迹里的一行。 */
export interface TimelineLine {
  kind:
    | "EVENT" | "PLAN" | "HAPPENING" | "SHORTFALL" | "ADMISSION" | "SCHOOL"
    | "OPPORTUNITY" | "ROUTE" | "MASTERS" | "EARLY_END" | "FLAVOR"
    // 第四版（docs/24 §7）
    | "SUMMER" | "DAILY" | "GPA" | "LIFE_BASE" | "LIFE_PLAN" | "LIFE_EVENT" | "MILESTONE" | "OUTCOME";
  text: string;
  /** 这一行实际造成的四属性变化；没有数值变化为 null。 */
  delta: Stats | null;
}
/** 人生轨迹里的一段（高三、申请季、出国前的夏天、每个学期、暑假、毕业、中途结局、毕业后的每一年、五年后）。 */
export interface TimelineEntry {
  /** 稳定的键，如 "HS"、"ADMISSION"、"SUMMER:HS:0"、"UG:3"、"SUMMER:UG:2"、"GRAD:UG"、"MS:1"、"EARLY"、"LIFE:1"、"OUTCOME"。 */
  id: string;
  /** 左侧的时间标签，如 “高三”“申请季”“大二上”“大一暑假”“本科毕业”“毕业第 1 年”“五年后”。 */
  label: string;
  /** 这一段的年龄（docs/24 §7.1）；没有明确年龄的段为 null。 */
  age: number | null;
  /** 分组：在校（含高三、申请季、毕业、中途结局）、暑假、毕业后、五年后。界面据此加分隔与配色。 */
  group: "SCHOOL" | "SUMMER" | "LIFE" | "END";
  lines: TimelineLine[];
  /** 这一段结束时的四属性。 */
  statsAfter: Stats;
}

/** 人生总结（docs/22 §5.2）。 */
export interface SummaryView {
  seed: number;
  kind: "GRADUATION" | "EARLY";
  title: string;
  /** 学历/去向标签；中途结局是停下的时间点，如 “大三上 · 中途”。 */
  label: string;
  /** 毕业结局用 docs/07 的短结局；中途结局用它自己的正文。 */
  text: string;
  /** 毕业结局的关键经历一句；中途结局为 null。 */
  keyExperience: string | null;
  epilogue: string;
  school: RuntimeSchool | null;
  stats: Array<{ key: StatKey; name: string; value: number; rating: string }>;
  focusSummary: Array<{ focus: Focus; name: string; count: number }>;
  talents: Talent[];
  points: Points | null;
  /** 最终检查点的三路机会；中途结局为空数组。 */
  opportunities: OpportunityView[];
  card: EndingCard;
  /** 第四版：在校期间各学期 GPA 的平均（两位小数）；一个学期都没读完为 null。 */
  gpa: number | null;
  /** 第四版：毕业（或离校）之后的五年；经典模式为 null。有它时 stats 是五年后的四属性。 */
  life: LifeSummary | null;
}

/** 人生总结里“五年后”那一块（docs/24 §8）。 */
export interface LifeSummary {
  outcome: { id: string; name: string; roast: string; text: string; grade: TalentRarity };
  /** 五年后的年龄。 */
  age: number;
  /** 最后所在的轨道与它的名字。 */
  track: LifeTrack;
  trackName: string;
  /** 走过的轨道名字，按顺序（含起点）。 */
  trackNames: string[];
  /** 离开学校时的四属性与评价。 */
  startStats: Array<{ key: StatKey; name: string; value: number; rating: string }>;
}

/** 跨局进度的快照（由界面保存，判定成就与解锁时传给引擎）。 */
export interface ProgressSnapshot {
  /** 已完成的局数（不含本局）。 */
  runs: number;
  /** 各主线等级、隐藏结局、中途结局、去向结局已出现的次数（不含本局）。 */
  tiers: Record<string, number>;
  hidden: Record<string, number>;
  early: Record<string, number>;
  flavors: Record<string, number>;
  /** 第四版：五年后的结局已出现的次数（不含本局）；旧进度没有这一项时按空处理。 */
  outcomes?: Record<string, number>;
  /** 已得到的成就 id。 */
  achievements: string[];
  /** 已解锁的锁定天赋 id。 */
  unlockedTalents: string[];
}
/** 一局结束后的跨局收获。 */
export interface RunRewards {
  /** 本局新得到的成就 id，按成就清单顺序。 */
  achievements: string[];
  /** 本局新解锁的天赋 id；没有则 null。 */
  unlockedTalent: string | null;
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

export interface PlanOptionView {
  plan: PlanCard;
  focus: Focus;
  name: string;
  /** 合并天赋与效率之后、截断之前。 */
  requested: Stats;
  /** 截断之后真正会发生的变化。 */
  applied: Stats;
  available: boolean;
  /** 资金不足时：需要 need，当前 have。 */
  shortBy: null | { need: number; have: number };
  talentApplied: boolean;
  efficiencyApplied: boolean;
  /** 选了它之后，预计本学期末结算会不会出现资金短缺（不含之后事件的影响）。 */
  projectedShortfall: number;
}

/** 选安排那一屏：本学期的账目与四个安排。 */
export interface FocusView {
  /** 本学期已到账的资助。 */
  stipend: Delta;
  upkeep: number;
  efficiency: { factor: EfficiencyFactor; note: string };
  /** 本学期开头的突发小事；没有则 null。 */
  happening: null | { id: string; text: string; delta: Delta };
  options: PlanOptionView[];
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
  talentBonus: number;
  readinessBonus: number | null;
  /** 已知的准备度：基础 + 天赋加成（开局后）+ HS_01 加成（选完后）。 */
  readinessSoFar: number;
  odds: Record<Strategy, TierOdds[]>;
}

export interface AdmissionResult {
  baseReadiness: number;
  talentBonus: number;
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
  /** 本局的天赋，按天赋池顺序。 */
  talents: Talent[];
  card: EndingCard;
}
