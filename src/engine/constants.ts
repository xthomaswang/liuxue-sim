// 全部数值常量集中在这里。数值规则以 docs/03 为准，申请以 docs/13 为准，结局卡以 docs/14 为准，
// 第二版玩法（天赋、学期安排、主线槽、突发小事）以 docs/16 为准，第三版（分点、自动决定、中途结局、成就）以 docs/22、23 为准。
// 版本号：规则或内容有会改变结果的修改时必须提升，旧存档据此判为不兼容。
// 3.0.0 = docs/22 第三版玩法（只选天赋和分点，其余自动模拟；中途结局；成就与天赋解锁）。

import type {
  ArcId, Aspiration, Economy, EndingTierId, Expectation, Focus, MastersProgram, Opportunity, OfferTier, Stats,
  StatKey, Strategy, TalentRarity,
} from "./types";

export const RULES_VERSION = "3.0.0";
export const CONTENT_VERSION = "3.0.0";
export const SAVE_FORMAT = "liuxue-sim-save";

// ---------- 固定顺序 ----------

export const STAT_KEYS: readonly StatKey[] = ["money", "academics", "career", "wellbeing"];
export const FOCUS_ORDER: readonly Focus[] = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
export const ARC_ORDER: readonly ArcId[] = ["RESEARCH", "INTERNSHIP", "FRIENDSHIP", "FAMILY", "REORIENTATION", "CREATIVE"];
export const OPPORTUNITY_ORDER: readonly Opportunity[] = ["PHD", "LOCAL_JOB", "HOME_JOB"];
export const ECONOMY_ORDER: readonly Economy[] = ["LOW", "MID", "HIGH"];
export const EXPECTATION_ORDER: readonly Expectation[] = ["ACADEMIC", "STABILITY", "AUTONOMY"];
export const ASPIRATION_ORDER: readonly Aspiration[] = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
/** 有序档；U 是独立池，不在这个序列里。 */
export const ORDERED_TIERS: readonly OfferTier[] = ["S", "A", "B", "C", "D"];
export const ALL_TIERS: readonly OfferTier[] = ["S", "A", "B", "C", "D", "U"];

// ---------- 03 §1–§4：属性、开局、投入、学期 ----------

export const STAT_MIN = 0;
export const STAT_MAX = 100;

/** 高中事件开始前的初始值（03 §2.1）。 */
export const INITIAL_STATS: Readonly<Record<Economy, Stats>> = {
  LOW: { money: 28, academics: 18, career: 12, wellbeing: 70 },
  MID: { money: 42, academics: 18, career: 12, wellbeing: 70 },
  HIGH: { money: 56, academics: 18, career: 12, wellbeing: 70 },
};
export const STIPEND: Readonly<Record<Economy, number>> = { LOW: 6, MID: 10, HIGH: 14 };
/** 每学期必要开销的基础值；天赋的 upkeep 效果在此之上增减（T_FRUGAL 为 -1）。 */
export const UPKEEP_DEFAULT = 12;

/** 五种投入的基础向量（03 §3），也就是五张“基础安排”的向量。 */
export const FOCUS_BASE: Readonly<Record<Focus, Stats>> = {
  STUDY: { money: 0, academics: 11, career: 1, wellbeing: -7 },
  CAREER: { money: 0, academics: 2, career: 10, wellbeing: -6 },
  CAMPUS: { money: 0, academics: 3, career: 4, wellbeing: 6 },
  WORK: { money: 12, academics: 1, career: 3, wellbeing: -7 },
  REST: { money: 0, academics: 1, career: 0, wellbeing: 15 },
};
/** 效率分界：>=40 → 10，20–39 → 8，0–19 → 6（十分数）。 */
export const EFFICIENCY_FULL_FROM = 40;
export const EFFICIENCY_REDUCED_FROM = 20;

export const TERM_GROWTH: Readonly<Stats> = { money: 0, academics: 2, career: 1, wellbeing: -3 };
export const SHORTFALL_STRESS_BASE = 6;
export const SHORTFALL_STRESS_DIVISOR = 3;

export const UG_TERMS = 8;
export const UG_TERM_NAMES: readonly string[] = [
  "一年级秋", "一年级末", "二年级秋", "二年级末", "三年级秋", "三年级末", "四年级秋", "毕业前",
];
export const CORE_EVENT_IDS: readonly string[] = [
  "CORE_01", "CORE_02", "CORE_03", "CORE_04", "CORE_05", "CORE_06", "CORE_07", "CORE_08",
];
export const HIGH_SCHOOL_EVENT_IDS: readonly string[] = ["HS_01", "HS_02"];

// ---------- 03 §5：硕士 ----------

export const MASTERS_PLANS: Readonly<Record<MastersProgram, { years: 1 | 2; terms: number; fee: number; events: readonly string[] }>> = {
  MS_1Y: { years: 1, terms: 2, fee: 8, events: ["MASTER_01", "MASTER_04"] },
  MS_2Y: { years: 2, terms: 4, fee: 12, events: ["MASTER_01", "MASTER_02", "MASTER_03", "MASTER_04"] },
};
export const MASTERS_PROGRAM_ORDER: readonly MastersProgram[] = ["MS_1Y", "MS_2Y"];
export const MASTERS_ACADEMICS_MIN = 55;

// ---------- 03 §6–§7：毕业机会 ----------

export const FLAG_RESEARCH_REPORT = "ARC_RESEARCH_3_A";
export const FLAG_INTERNSHIP_PROJECT = "ARC_INTERNSHIP_3_A";
export const FLAG_CREATIVE_WORK = "ARC_CREATIVE_3_A";
export const FLAG_MASTERS_REPORT = "MASTER_04_A";
export const FLAG_MASTERS_PROJECT = "MASTER_04_B";

export const PROBABILITY_MIN = 8;
export const PROBABILITY_MAX_PHD_UG = 85;
export const PROBABILITY_MAX_PHD_MS = 95;
export const PROBABILITY_MAX_JOB = 95;
export const STUDY_COUNT_CAP = 4;
export const CAREER_COUNT_CAP = 4;
export const WORK_COUNT_CAP = 3;

// ---------- 13：申请 ----------

export const READINESS_BASE_MIN = 20;
export const READINESS_BASE_SPAN = 61;
export const READINESS_BONUS: Readonly<Record<string, number>> = { HS_01_A: 10, HS_01_B: 6 };
export const STRATEGY_BY_FLAG: Readonly<Record<string, Strategy>> = { HS_02_A: "REACH", HS_02_B: "STEADY" };
/** 有序档权重的三个锚点（S/A/B/C/D），各行总和 100。 */
export const ADMISSION_ANCHORS: Readonly<Record<Strategy, Readonly<Record<0 | 50 | 100, readonly number[]>>>> = {
  REACH: { 0: [1, 4, 15, 30, 50], 50: [12, 20, 25, 25, 18], 100: [50, 25, 15, 7, 3] },
  STEADY: { 0: [0, 1, 9, 55, 35], 50: [2, 13, 55, 25, 5], 100: [25, 62, 10, 3, 0] },
};
export const ADMISSION_WEIGHT_TOTAL = 5000;
/** poolRoll 小于此值进入 U 池。 */
export const U_POOL_PROBABILITY = 0.1;
export const U_POOL_DISPLAY_TENTHS = 100;
export const ORDERED_DISPLAY_TENTHS = 900;
export const OFFER_COUNT = 3;
export const MIN_POOL_SIZE = 3;

// ---------- 16：出身、天赋、主线槽、突发小事 ----------

export const TALENT_WEIGHTS: Readonly<Record<TalentRarity, number>> = { N: 100, R: 45, SR: 15, SSR: 4 };
export const TALENT_DRAW_COUNT = 10;
export const TALENT_PICK_STANDARD = 3;
export const TALENT_PICK_CLASSIC = 1;
/** 第一版六种特质对应的固定天赋；经典模式只在这六张里选一张。 */
export const CLASSIC_TALENT_IDS: readonly string[] = [
  "T_FOCUSED", "T_PRACTICAL", "T_OUTGOING", "T_FRUGAL", "T_RESILIENT", "T_REFLECTIVE",
];
/** 本科第 2–7 学期主线槽换成随机事件的概率。 */
export const RANDOM_EVENT_PROBABILITY = 0.45;
export const RANDOM_EVENT_FIRST_TERM = 2;
export const RANDOM_EVENT_LAST_TERM = 7;
/** 每学期开头出现突发小事的概率。 */
export const HAPPENING_PROBABILITY = 0.6;

// ---------- 07：结局 ----------

export const WELLBEING_STRETCHED_FROM = 20;
export const WELLBEING_STEADY_FROM = 40;
export const MONEY_LIMITED_FROM = 10;
export const MONEY_BUFFERED_FROM = 40;
export const KEY_EXPERIENCE_TITLE_MAX = 12;
export const KEY_EXPERIENCE_LABEL_MAX = 18;

// ---------- 14：结局卡 ----------

export const ENDING_TIER_ORDER: readonly EndingTierId[] = ["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"];

export const CARD = {
  EX_ACADEMICS_MIN: 95,
  EX_STUDY_MIN: 4,
  UR_MONEY_MIN: 80,
  UR_OFFERS_MIN: 3,
  SSR_CAREER_MIN: 70,
  SSR_WELLBEING_MIN: 40,
  SR_CAREER_MIN: 85,
  R_PLUS_WELLBEING_MIN: 40,
  R_PLUS_MONEY_MIN: 20,
  BE_ACADEMICS_BELOW: 55,
  D_MONEY_BELOW: 10,
  D_SHORTFALL_TERMS_MIN: 2,
  H01_CAMPUS_MIN: 3,
  H01_WELLBEING_MIN: 50,
  H09_REST_MIN: 3,
  H09_CAMPUS_MIN: 2,
  H11_MONEY_MIN: 30,
  H12_WELLBEING_MIN: 50,
  H12_REST_PLUS_CAMPUS_MIN: 4,
} as const;

/** 尾声抽签：key、给玩家看的名字、成功概率（整数百分比）。 */
export const EPILOGUE = {
  STATUS: { key: "epilogue:status", label: "身份抽签", percentUG: 35, percentMS: 50 },
  LOVE: { key: "epilogue:love", label: "爱情支线", percent: 50 },
  DREAM: { key: "epilogue:dream", label: "梦醒", percent: 3 },
  SUBSCRIPTION: { key: "epilogue:subscription", label: "订阅制创作", percent: 25 },
  SCAM: { key: "epilogue:scam", label: "被骗", percent: 6 },
} as const;

// ---------- 22 §2：分配点数 ----------

export const POINT_BASE_BUDGET = 20;
export const POINT_MAX = 10;
export const POINT_KEYS = ["family", "academics", "career", "wellbeing"] as const;
/** 开局数值 = 基数 + 系数 × 点数（再加天赋的 initial，截断到 0–100）。 */
export const START_MONEY_BASE = 20;
export const START_MONEY_PER_POINT = 4;
export const START_ACADEMICS_BASE = 8;
export const START_ACADEMICS_PER_POINT = 2;
export const START_CAREER_BASE = 2;
export const START_CAREER_PER_POINT = 2;
export const START_WELLBEING_BASE = 40;
export const START_WELLBEING_PER_POINT = 6;
/** 每学期资助 = 5 + 家境点数（再加天赋的 stipend）。 */
export const STIPEND_POINT_BASE = 5;
/** 家境点数 ≤ 3 为 LOW，4–7 为 MID，≥ 8 为 HIGH。 */
export const FAMILY_MID_FROM = 4;
export const FAMILY_HIGH_FROM = 8;

// ---------- 22 §3：自动决定 ----------

export const AUTO = {
  /** 两个选项都能选时取“更合意的那一项”的概率。 */
  PREFERRED_PROBABILITY: 0.7,
  BROKE_MONEY_BOOST: 3,
  LOW_WELLBEING_BELOW: 30,
  LOW_WELLBEING_BOOST: 3,
  PLAN_WORK_TIGHT_BONUS: 10,
  /** 资金连这学期的必要开销都不够时，打工再加的权重。 */
  PLAN_WORK_BROKE_BONUS: 10,
  PLAN_REST_EXHAUSTED_BELOW: 25,
  PLAN_REST_EXHAUSTED_BONUS: 8,
  PLAN_REST_TIRED_BELOW: 45,
  PLAN_REST_TIRED_BONUS: 3,
  /** 手里有机会却主动留白的概率。 */
  SELF_TRANSITION_PROBABILITY: 0.06,
  /** 一个机会都没有时读硕士的意愿。 */
  MASTERS_PROBABILITY: 0.75,
  /** 有机会、但按愿望排的首选那一路没取得时，再读一轮的意愿。 */
  MASTERS_RETRY_PROBABILITY: 0.35,
  MASTERS_ONE_YEAR_PROBABILITY: 0.5,
} as const;

// ---------- 22 §5.2：属性评价；§7.2：天赋解锁 ----------

/** 按最终值分档：下限从高到低。 */
export const STAT_RATINGS: ReadonlyArray<{ from: number; label: string }> = [
  { from: 95, label: "拉满" },
  { from: 80, label: "出色" },
  { from: 60, label: "不错" },
  { from: 40, label: "普通" },
  { from: 20, label: "吃紧" },
  { from: 0, label: "见底" },
];
export const UG_TERM_LABELS: readonly string[] = ["大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下"];
export const MS_TERM_LABELS: readonly string[] = ["硕一上", "硕一下", "硕二上", "硕二下"];
export const UNLOCK_BASE_PERCENT = 20;
export const UNLOCK_PERCENT_PER_ACHIEVEMENT = 20;
