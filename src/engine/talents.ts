// 开局（docs/16 第 1 节、docs/22 第 2、6、7.2 节）：家庭期待与愿望的抽取、十连抽的按权重无放回抽样（含锁定与继承）、
// 四项点数换算成开局数值、天赋效果的合计与各作用点的生效值。

import {
  ARC_ORDER, ASPIRATION_ORDER, EXPECTATION_ORDER, FAMILY_HIGH_FROM, FAMILY_MID_FROM, FOCUS_ORDER, INITIAL_STATS,
  OPPORTUNITY_ORDER, POINT_BASE_BUDGET, POINT_KEYS, POINT_MAX, START_ACADEMICS_BASE, START_ACADEMICS_PER_POINT,
  START_CAREER_BASE, START_CAREER_PER_POINT, START_MONEY_BASE, START_MONEY_PER_POINT, START_WELLBEING_BASE,
  START_WELLBEING_PER_POINT, STAT_KEYS, STIPEND, STIPEND_POINT_BASE, TALENT_DRAW_COUNT, TALENT_WEIGHTS, TERM_GROWTH,
  UPKEEP_DEFAULT,
} from "./constants";
import { findTalent } from "./pools";
import { draw01, pickIndex } from "./rng";
import { clamp, zeroStats } from "./rules";
import type { ArcId, Aspiration, Economy, Expectation, Focus, Opportunity, Points, Profile, Stats, Talent } from "./types";

// ---------- 出身 ----------

export interface Origin {
  expectation: Expectation;
  aspiration: Aspiration;
}

/** 抽出来、不能选的家庭期待与个人愿望；只影响文案与结局卡。经济档不再抽（由家境点数决定，或经典模式由调用方给定）。 */
export function originFor(seed: number): Origin {
  return {
    expectation: EXPECTATION_ORDER[pickIndex(seed, "origin:expectation", EXPECTATION_ORDER.length)],
    aspiration: ASPIRATION_ORDER[pickIndex(seed, "origin:aspiration", ASPIRATION_ORDER.length)],
  };
}

/** 家境点数 ≤ 3 为 LOW，4–7 为 MID，≥ 8 为 HIGH。 */
export function economyFromFamily(family: number): Economy {
  return family >= FAMILY_HIGH_FROM ? "HIGH" : family >= FAMILY_MID_FROM ? "MID" : "LOW";
}

// ---------- 十连抽 ----------

/** 十连抽的池子：未锁定的天赋加上已解锁的锁定天赋，保持池内顺序。 */
export function drawPool(pool: readonly Talent[], unlockedIds: readonly string[]): Talent[] {
  return pool.filter((talent) => !talent.locked || unlockedIds.includes(talent.id));
}

/** 把一串 id 规整成“确实是锁定天赋、去重、按池内顺序”的列表。 */
export function normalizeUnlocked(pool: readonly Talent[], ids: readonly string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  return pool.filter((talent) => talent.locked === true && ids.includes(talent.id)).map((talent) => talent.id);
}

/**
 * 按稀有度权重的无放回抽样；池内顺序即数组顺序。池里不足 count 张时全部抽出。
 * 有继承天赋时：第一张固定是它，其余的照常抽（同一套 talent:draw:i 的 key、同一个池子），抽到它时跳过，直到凑满。
 */
export function drawTalents(
  seed: number,
  pool: readonly Talent[],
  count: number = TALENT_DRAW_COUNT,
  inheritedId: string | null = null,
): Talent[] {
  const remaining = [...pool];
  const inherited = inheritedId === null ? undefined : remaining.find((talent) => talent.id === inheritedId);
  const drawn: Talent[] = inherited ? [inherited] : [];
  for (let i = 0; drawn.length < count && remaining.length > 0; i++) {
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
    const picked = remaining[index];
    remaining.splice(index, 1);
    if (inherited && picked.id === inherited.id) continue; // 跳过与继承天赋相同的那张
    drawn.push(picked);
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
  /** 可分配点数的增减。 */
  points: number;
  /** 第四版：期末 GPA 的加成，单位 0.01。 */
  gpa: number;
  /** 第四版：毕业后每年基础变化的加成。 */
  lifeGrowth: Stats;
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
    points: 0,
    gpa: 0,
    lifeGrowth: zeroStats(),
  };
  for (const { effects } of talents) {
    addPartial(totals.initial, effects.initial);
    addPartial(totals.growth, effects.growth);
    totals.stipend += effects.stipend ?? 0;
    totals.upkeep += effects.upkeep ?? 0;
    totals.focusWellbeingRelief += effects.focusWellbeingRelief ?? 0;
    totals.readiness += effects.readiness ?? 0;
    totals.points += effects.points ?? 0;
    totals.gpa += effects.gpa ?? 0;
    addPartial(totals.lifeGrowth, effects.lifeGrowth);
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

// ---------- 分配点数（22 §2） ----------

/** 可分配的总点数：20 加上天赋的 points，限制在 0 到四项上限之和之间。 */
export function pointBudget(totals: TalentTotals): number {
  return clamp(POINT_BASE_BUDGET + totals.points, 0, POINT_MAX * POINT_KEYS.length);
}

export function pointsUsed(points: Points): number {
  return POINT_KEYS.reduce((sum, key) => sum + points[key], 0);
}

/** 每项是 0–10 的整数，且只有这四项。 */
export function pointsWellFormed(points: unknown): points is Points {
  if (typeof points !== "object" || points === null || Array.isArray(points)) return false;
  const record = points as Record<string, unknown>;
  if (Object.keys(record).length !== POINT_KEYS.length) return false;
  return POINT_KEYS.every((key) => {
    const value = record[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= POINT_MAX;
  });
}

/** 点数合法：格式对，且总和恰好等于可分配的总点数。 */
export function pointsValid(points: unknown, totals: TalentTotals): points is Points {
  return pointsWellFormed(points) && pointsUsed(points) === pointBudget(totals);
}

/** 开局四属性：按点数换算（22 §2 的表）加上天赋的 initial 之和，再截断到 0–100。 */
export function startStatsFromPoints(points: Points, totals: TalentTotals): Stats {
  return {
    money: clamp(START_MONEY_BASE + START_MONEY_PER_POINT * points.family + totals.initial.money),
    academics: clamp(START_ACADEMICS_BASE + START_ACADEMICS_PER_POINT * points.academics + totals.initial.academics),
    career: clamp(START_CAREER_BASE + START_CAREER_PER_POINT * points.career + totals.initial.career),
    wellbeing: clamp(START_WELLBEING_BASE + START_WELLBEING_PER_POINT * points.wellbeing + totals.initial.wellbeing),
  };
}

// ---------- 各作用点的生效值 ----------

/** 经典模式的开局四属性：经济档初始值加上天赋的 initial 之和，再截断到 0–100。 */
export function initialStatsFor(economy: Economy, totals: TalentTotals): Stats {
  const stats = zeroStats();
  for (const key of STAT_KEYS) stats[key] = clamp(INITIAL_STATS[economy][key] + totals.initial[key]);
  return stats;
}

/** 天赋生效前的每学期资助：正式玩法是 5 + 家境点数，经典模式按经济档查表。 */
export function baseStipend(profile: Pick<Profile, "economy" | "points">): number {
  return profile.points ? STIPEND_POINT_BASE + profile.points.family : STIPEND[profile.economy];
}

/** 每学期资助，不低于 0。 */
export function effectiveStipend(profile: Pick<Profile, "economy" | "points">, totals: TalentTotals): number {
  return Math.max(0, baseStipend(profile) + totals.stipend);
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

/** 开局即确定的准备度加成：学业点数（正式玩法）加上天赋的 readiness。 */
export function readinessHeadStart(points: Points | null, totals: TalentTotals): number {
  return (points ? points.academics : 0) + totals.readiness;
}
