// 学期内的数值规则（docs/03 §1–§4、docs/06 §3、docs/16 §1.3 与 §2）：截断、安排向量与效率、必要开销与短缺、支线权重。
// 全部是不依赖状态机的纯函数，供 reducer、views 和测试共用。天赋的影响以“合计后的数值”作为参数传入。

import {
  ARC_ORDER, EFFICIENCY_FULL_FROM, EFFICIENCY_REDUCED_FROM, FOCUS_ORDER, SHORTFALL_STRESS_BASE,
  SHORTFALL_STRESS_DIVISOR, STAT_KEYS, STAT_MAX, STAT_MIN,
} from "./constants";
import { draw01 } from "./rng";
import type { ArcId, Economy, EfficiencyFactor, FocusCounts, Stats } from "./types";

export function clamp(value: number, lo: number = STAT_MIN, hi: number = STAT_MAX): number {
  return Math.min(hi, Math.max(lo, value));
}

export function zeroStats(): Stats {
  return { money: 0, academics: 0, career: 0, wellbeing: 0 };
}

export function zeroFocusCounts(): FocusCounts {
  return { STUDY: 0, CAREER: 0, CAMPUS: 0, WORK: 0, REST: 0 };
}

/** 拷贝四属性。加 0 是为了把 -0 归一成 0：-0 存成 JSON 会变成 0，读档比较时不能因此不一致。 */
export function copyStats(stats: Stats): Stats {
  return {
    money: stats.money + 0,
    academics: stats.academics + 0,
    career: stats.career + 0,
    wellbeing: stats.wellbeing + 0,
  };
}

/** 应用一个完整变化向量：四项同时更新、各自截断。返回截断后的属性与真正发生的变化。 */
export function applyDelta(stats: Stats, requested: Stats): { after: Stats; applied: Stats } {
  const after = zeroStats();
  const applied = zeroStats();
  for (const key of STAT_KEYS) {
    after[key] = clamp(stats[key] + requested[key]);
    applied[key] = after[key] - stats[key];
  }
  return { after, applied };
}

export function totalFocus(counts: FocusCounts): number {
  return FOCUS_ORDER.reduce((sum, focus) => sum + counts[focus], 0);
}

// ---------- 学期安排 ----------

/** 按选择前的身心定效率；天赋可以给一个下限（8 或 10），0 表示没有下限。 */
export function efficiencyFactor(wellbeingBefore: number, floor: 0 | 8 | 10 = 0): EfficiencyFactor {
  const natural: EfficiencyFactor = wellbeingBefore >= EFFICIENCY_FULL_FROM ? 10 : wellbeingBefore >= EFFICIENCY_REDUCED_FROM ? 8 : 6;
  return (floor > natural ? floor : natural) as EfficiencyFactor;
}

export interface PlanVector {
  /** 安排自己的向量。 */
  base: Stats;
  /** 合并天赋与效率之后、截断之前。 */
  requested: Stats;
  factor: EfficiencyFactor;
  talentApplied: boolean;
  efficiencyApplied: boolean;
}

/**
 * 一张安排实际要应用的向量：
 * 先加上天赋对这个类别的加成，再处理负身心减免 min(0, 身心变化 + N)，
 * 最后只对正的 academics/career 按效率半入；money 与 wellbeing 不折减。
 */
export function planVector(
  base: Stats,
  focusBonus: Stats,
  wellbeingRelief: number,
  wellbeingBefore: number,
  efficiencyFloor: 0 | 8 | 10 = 0,
): PlanVector {
  const withTalent = zeroStats();
  for (const key of STAT_KEYS) withTalent[key] = base[key] + focusBonus[key];
  if (wellbeingRelief > 0 && withTalent.wellbeing < 0) {
    withTalent.wellbeing = Math.min(0, withTalent.wellbeing + wellbeingRelief);
  }
  const talentApplied = STAT_KEYS.some((key) => withTalent[key] !== base[key]);

  const factor = efficiencyFactor(wellbeingBefore, efficiencyFloor);
  const requested = copyStats(withTalent);
  let efficiencyApplied = false;
  for (const key of ["academics", "career"] as const) {
    if (requested[key] > 0) {
      requested[key] = Math.floor((requested[key] * factor + 5) / 10);
      if (factor !== 10) efficiencyApplied = true;
    }
  }
  return { base: copyStats(base), requested, factor, talentApplied, efficiencyApplied };
}

// ---------- 期末 ----------

export interface UpkeepResult {
  cost: number;
  paid: number;
  shortfall: number;
  stress: number;
  requested: Stats;
}

/** 必要开销与短缺压力（03 §4.2）。cost 是天赋生效后的必要开销。只算出要应用的变化，不动属性。 */
export function upkeep(money: number, cost: number): UpkeepResult {
  const shortfall = Math.max(0, cost - money);
  const stress = shortfall === 0 ? 0 : SHORTFALL_STRESS_BASE + Math.ceil(shortfall / SHORTFALL_STRESS_DIVISOR);
  return {
    cost,
    paid: Math.min(money, cost),
    shortfall,
    stress,
    requested: { money: cost === 0 ? 0 : -cost, academics: 0, career: 0, wellbeing: stress === 0 ? 0 : -stress },
  };
}

// ---------- 支线分配（06 §3） ----------

export interface ArcWeightInput {
  focusCounts: FocusCounts;
  stats: Stats;
  economy: Economy;
  /** 天赋给各条支线的权重加成（T_OUTGOING：友情 +2；T_REFLECTIVE：创作 +1）。 */
  bonus: Record<ArcId, number>;
}

export function arcWeights(input: ArcWeightInput): Record<ArcId, number> {
  const { focusCounts: c, stats, economy, bonus } = input;
  return {
    RESEARCH: 1 + 2 * c.STUDY + Math.floor(stats.academics / 25) + bonus.RESEARCH,
    INTERNSHIP: 1 + 2 * c.CAREER + Math.floor(stats.career / 25) + bonus.INTERNSHIP,
    FRIENDSHIP: 1 + 2 * c.CAMPUS + bonus.FRIENDSHIP,
    FAMILY: 1 + (economy === "LOW" ? 1 : 0) + bonus.FAMILY,
    REORIENTATION: 1 + 2 * c.REST + (stats.wellbeing < 40 ? 2 : 0) + bonus.REORIENTATION,
    CREATIVE: 1 + c.CAMPUS + c.CAREER + bonus.CREATIVE,
  };
}

/** 按固定顺序累计，取第一个累计值严格大于 r 的支线；浮点极端情况下最后一项兜底。 */
export function pickArc(seed: number, slot: "A" | "B", weights: Record<ArcId, number>, exclude: ArcId | null): ArcId {
  const candidates = ARC_ORDER.filter((arc) => arc !== exclude);
  const total = candidates.reduce((sum, arc) => sum + weights[arc], 0);
  const r = draw01(seed, `arc:${slot}`) * total;
  let cumulative = 0;
  for (const arc of candidates) {
    cumulative += weights[arc];
    if (cumulative > r) return arc;
  }
  return candidates[candidates.length - 1];
}

/** 本科第 termIndex 学期推进哪个支线槽的第几幕；S1、S8 没有支线。 */
export function arcSlotForTerm(termIndex: number): { slot: "A" | "B"; beat: 1 | 2 | 3 } | null {
  if (termIndex < 2 || termIndex > 7) return null;
  if (termIndex % 2 === 0) return { slot: "A", beat: (termIndex / 2) as 1 | 2 | 3 };
  return { slot: "B", beat: ((termIndex - 1) / 2) as 1 | 2 | 3 };
}
