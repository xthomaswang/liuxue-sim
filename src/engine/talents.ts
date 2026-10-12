// 出身与天赋（docs/16 第 1 节）：出身抽取、十连抽的按权重无放回抽样、天赋效果的合计与各作用点的生效值。

import {
  ARC_ORDER, ASPIRATION_ORDER, EXPECTATION_ORDER, FOCUS_ORDER, INITIAL_STATS, OPPORTUNITY_ORDER, ORIGIN_LOW_BELOW,
  ORIGIN_MID_BELOW, STAT_KEYS, STIPEND, TALENT_DRAW_COUNT, TALENT_WEIGHTS, TERM_GROWTH, UPKEEP_DEFAULT,
} from "./constants";
import { findTalent } from "./pools";
import { draw01, pickIndex } from "./rng";
import { clamp, zeroStats } from "./rules";
import type { ArcId, Aspiration, Economy, Expectation, Focus, Opportunity, Stats, Talent } from "./types";

// ---------- 出身 ----------

export interface Origin {
  economy: Economy;
  expectation: Expectation;
  aspiration: Aspiration;
}

export function economyFor(seed: number): Economy {
  const r = draw01(seed, "origin:economy");
  return r < ORIGIN_LOW_BELOW ? "LOW" : r < ORIGIN_MID_BELOW ? "MID" : "HIGH";
}

/** 抽出来、不能选的出身。经典模式由调用方给定经济档，期待与愿望仍按同样的 key 抽。 */
export function originFor(seed: number, classicEconomy?: Economy): Origin {
  return {
    economy: classicEconomy ?? economyFor(seed),
    expectation: EXPECTATION_ORDER[pickIndex(seed, "origin:expectation", EXPECTATION_ORDER.length)],
    aspiration: ASPIRATION_ORDER[pickIndex(seed, "origin:aspiration", ASPIRATION_ORDER.length)],
  };
}

// ---------- 十连抽 ----------

/** 按稀有度权重的无放回抽样；池内顺序即数组顺序。池里不足 count 张时全部抽出。 */
export function drawTalents(seed: number, pool: readonly Talent[], count: number = TALENT_DRAW_COUNT): Talent[] {
  const remaining = [...pool];
  const drawn: Talent[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const total = remaining.reduce((sum, talent) => sum + TALENT_WEIGHTS[talent.rarity], 0);
    const r = draw01(seed, `talent:draw:${i}`) * total;
    let cumulative = 0;
    let index = remaining.length - 1; // 浮点极端情况取最后一张
    for (let k = 0; k < remaining.length; k++) {
      cumulative += TALENT_WEIGHTS[remaining[k].rarity];
      if (cumulative > r) {
        index = k;
        break;
      }
    }
    drawn.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return drawn;
}

// ---------- 效果合计 ----------

export interface TalentTotals {
  initial: Stats;
  stipend: number;
  upkeep: number;
  focus: Record<Focus, Stats>;
  focusWellbeingRelief: number;
  readiness: number;
  chance: Record<Opportunity, number>;
  /** 0 表示没有下限。 */
  efficiencyFloor: 0 | 8 | 10;
  arcWeight: Record<ArcId, number>;
  growth: Stats;
}

function addPartial(target: Stats, source: Partial<Stats> | undefined): void {
  if (!source) return;
  for (const key of STAT_KEYS) target[key] += source[key] ?? 0;
}

/** 同类效果相加；效率下限取最高的那个。 */
export function sumTalentEffects(talents: readonly Pick<Talent, "effects">[]): TalentTotals {
  const totals: TalentTotals = {
    initial: zeroStats(),
    stipend: 0,
    upkeep: 0,
    focus: Object.fromEntries(FOCUS_ORDER.map((focus) => [focus, zeroStats()])) as Record<Focus, Stats>,
    focusWellbeingRelief: 0,
    readiness: 0,
    chance: Object.fromEntries(OPPORTUNITY_ORDER.map((key) => [key, 0])) as Record<Opportunity, number>,
    efficiencyFloor: 0,
    arcWeight: Object.fromEntries(ARC_ORDER.map((arc) => [arc, 0])) as Record<ArcId, number>,
    growth: zeroStats(),
  };
  for (const { effects } of talents) {
    addPartial(totals.initial, effects.initial);
    addPartial(totals.growth, effects.growth);
    totals.stipend += effects.stipend ?? 0;
    totals.upkeep += effects.upkeep ?? 0;
    totals.focusWellbeingRelief += effects.focusWellbeingRelief ?? 0;
    totals.readiness += effects.readiness ?? 0;
    for (const focus of FOCUS_ORDER) addPartial(totals.focus[focus], effects.focus?.[focus]);
    for (const key of OPPORTUNITY_ORDER) totals.chance[key] += effects.chance?.[key] ?? 0;
    for (const arc of ARC_ORDER) totals.arcWeight[arc] += effects.arcWeight?.[arc] ?? 0;
    if (effects.efficiencyFloor !== undefined && effects.efficiencyFloor > totals.efficiencyFloor) {
      totals.efficiencyFloor = effects.efficiencyFloor;
    }
  }
  return totals;
}

export function talentsByIds(ids: readonly string[]): Talent[] {
  return ids.map((id) => {
    const talent = findTalent(id);
    if (!talent) throw new Error(`UNKNOWN_TALENT: ${id}`);
    return talent;
  });
}

export function totalsFor(ids: readonly string[]): TalentTotals {
  return sumTalentEffects(talentsByIds(ids));
}

// ---------- 各作用点的生效值 ----------

/** 开局四属性：经济档初始值加上天赋的 initial 之和，再截断到 0–100。 */
export function initialStatsFor(economy: Economy, totals: TalentTotals): Stats {
  const stats = zeroStats();
  for (const key of STAT_KEYS) stats[key] = clamp(INITIAL_STATS[economy][key] + totals.initial[key]);
  return stats;
}

/** 每学期资助，不低于 0。 */
export function effectiveStipend(economy: Economy, totals: TalentTotals): number {
  return Math.max(0, STIPEND[economy] + totals.stipend);
}

/** 每学期必要开销，不低于 0。 */
export function effectiveUpkeep(totals: TalentTotals): number {
  return Math.max(0, UPKEEP_DEFAULT + totals.upkeep);
}

/** 期末的基础成长：03 §4 的基础变化加上天赋的 growth。 */
export function effectiveGrowth(totals: TalentTotals): Stats {
  const growth = zeroStats();
  for (const key of STAT_KEYS) growth[key] = TERM_GROWTH[key] + totals.growth[key];
  return growth;
}
