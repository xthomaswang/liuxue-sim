// 高中申请（docs/13）：准备度、策略、有序档权重插值、U 池、同档三校 offer。只在申请这一刻使用。

import {
  ADMISSION_ANCHORS, ADMISSION_WEIGHT_TOTAL, MIN_POOL_SIZE, OFFER_COUNT, ORDERED_DISPLAY_TENTHS, ORDERED_TIERS,
  READINESS_BASE_MIN, READINESS_BASE_SPAN, READINESS_BONUS, STRATEGY_BY_FLAG, U_POOL_DISPLAY_TENTHS,
  U_POOL_PROBABILITY,
} from "./constants";
import { draw01 } from "./rng";
import { clamp } from "./rules";
import type { OfferTier, RuntimeCatalog, RuntimeSchool, Strategy, TierOdds } from "./types";

/** 20–80 的整数；同一 seed 下与家庭档无关。 */
export function baseReadinessFor(seed: number): number {
  return READINESS_BASE_MIN + Math.floor(draw01(seed, "admission:readiness") * READINESS_BASE_SPAN);
}

/** 从唯一标记推导；缺失或双选属于数据错误，不默认选 A。 */
function singleFromFlags<T>(flags: readonly string[], table: Readonly<Record<string, T>>, what: string): T {
  const hits = Object.keys(table).filter((flag) => flags.includes(flag));
  if (hits.length !== 1) throw new Error(`ADMISSION_FLAGS_INVALID: ${what} 需要恰好一个标记，实际 ${hits.length} 个`);
  return table[hits[0]];
}

export function readinessBonusFromFlags(flags: readonly string[]): number {
  return singleFromFlags(flags, READINESS_BONUS, "HS_01");
}

export function strategyFromFlags(flags: readonly string[]): Strategy {
  return singleFromFlags(flags, STRATEGY_BY_FLAG, "HS_02");
}

/** readiness = clamp(基础 + HS_01 加成 + 天赋加成, 0, 100)。 */
export function finalReadiness(base: number, bonus: number, talentBonus: number = 0): number {
  return clamp(base + bonus + talentBonus, 0, 100);
}

/** S/A/B/C/D 五个非负整数权重，精确总和 5000（13 §3.2）。 */
export function tierWeights(readiness: number, strategy: Strategy): number[] {
  const anchors = ADMISSION_ANCHORS[strategy];
  const lower = readiness <= 50 ? anchors[0] : anchors[50];
  const upper = readiness <= 50 ? anchors[50] : anchors[100];
  const d = readiness <= 50 ? readiness : readiness - 50;
  return lower.map((value, index) => value * (50 - d) + upper[index] * d);
}

/** poolRoll < 0.10 进 U；否则 bucket=floor(tierRoll*5000)，取累计权重严格大于 bucket 的第一档。 */
export function drawTier(weights: readonly number[], poolRoll: number, tierRoll: number): OfferTier {
  if (poolRoll < U_POOL_PROBABILITY) return "U";
  const bucket = Math.floor(tierRoll * ADMISSION_WEIGHT_TOTAL);
  let cumulative = 0;
  for (let i = 0; i < ORDERED_TIERS.length; i++) {
    cumulative += weights[i];
    if (cumulative > bucket) return ORDERED_TIERS[i];
  }
  // 权重总和为 5000 且 bucket <= 4999，正常不会走到这里；兜底取最后一个非零档。
  for (let i = ORDERED_TIERS.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return ORDERED_TIERS[i];
  }
  throw new Error("ADMISSION_WEIGHTS_EMPTY");
}

/** 含 U 的最终概率与一位小数显示（最大余数法，13 §4）。固定顺序 S,A,B,C,D,U。显示舍入不反馈到抽签。 */
export function tierOdds(weights: readonly number[]): TierOdds[] {
  // 有序各档的 0.1% 单位数为 900*w/5000 = 9*w/50；先取 floor，余下的按余数从大到小各补 1。
  const tenths = weights.map((w) => Math.floor((9 * w) / 50));
  const remainders = weights.map((w) => (9 * w) % 50);
  let missing = ORDERED_DISPLAY_TENTHS - tenths.reduce((sum, t) => sum + t, 0);
  const order = weights.map((_, index) => index).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const index of order) {
    if (missing <= 0) break;
    tenths[index] += 1;
    missing -= 1;
  }
  const label = (exact: number, units: number): string =>
    exact === 0 ? "0%" : units === 0 ? "低于 0.1%" : `${(units / 10).toFixed(1)}%`;
  const ordered: TierOdds[] = ORDERED_TIERS.map((tier, index) => {
    const exact = ((1 - U_POOL_PROBABILITY) * weights[index]) / ADMISSION_WEIGHT_TOTAL;
    return { tier, exact, tenths: tenths[index], label: label(exact, tenths[index]) };
  });
  ordered.push({
    tier: "U",
    exact: U_POOL_PROBABILITY,
    tenths: U_POOL_DISPLAY_TENTHS,
    label: label(U_POOL_PROBABILITY, U_POOL_DISPLAY_TENTHS),
  });
  return ordered;
}

export function poolCounts(catalog: RuntimeCatalog): Record<OfferTier, number> {
  const counts: Record<OfferTier, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, U: 0 };
  const seen = new Set<string>();
  for (const school of catalog.schools) {
    if (seen.has(school.unitid)) continue; // 重复记录不重复计数
    seen.add(school.unitid);
    if (counts[school.tier] !== undefined) counts[school.tier] += 1;
  }
  return counts;
}

/** 同档三所：按 unitid 字符串升序后，用 school:offer:0/1/2 均匀无放回抽取。池不足 3 所时抛 CATALOG_POOL_TOO_SMALL。 */
export function sampleOffers(seed: number, tier: OfferTier, catalog: RuntimeCatalog): RuntimeSchool[] {
  const byId = new Map<string, RuntimeSchool>();
  for (const school of catalog.schools) {
    if (school.tier === tier && !byId.has(school.unitid)) byId.set(school.unitid, school);
  }
  const remaining = [...byId.values()].sort((a, b) => (a.unitid < b.unitid ? -1 : a.unitid > b.unitid ? 1 : 0));
  if (remaining.length < MIN_POOL_SIZE) {
    throw new Error(`CATALOG_POOL_TOO_SMALL: ${tier} 池只有 ${remaining.length} 所学校`);
  }
  const offers: RuntimeSchool[] = [];
  for (let k = 0; k < OFFER_COUNT; k++) {
    const index = Math.floor(draw01(seed, `school:offer:${k}`) * remaining.length);
    offers.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return offers;
}

export interface AdmissionDraw {
  readinessBonus: number;
  readiness: number;
  strategy: Strategy;
  weights: number[];
  poolRoll: number;
  tierRoll: number;
  tier: OfferTier;
}

/** HS_02 结算后一次性生成的申请结果（不含选校）。进 U 也读取并记录 tierRoll。 */
export function resolveAdmission(
  seed: number,
  baseReadiness: number,
  flags: readonly string[],
  talentBonus: number = 0,
): AdmissionDraw {
  const readinessBonus = readinessBonusFromFlags(flags);
  const strategy = strategyFromFlags(flags);
  const readiness = finalReadiness(baseReadiness, readinessBonus, talentBonus);
  const weights = tierWeights(readiness, strategy);
  const poolRoll = draw01(seed, "admission:pool");
  const tierRoll = draw01(seed, "admission:tier");
  return { readinessBonus, readiness, strategy, weights, poolRoll, tierRoll, tier: drawTier(weights, poolRoll, tierRoll) };
}
