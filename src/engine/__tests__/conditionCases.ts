// 按一条 when 通用地构造“恰好满足”与“只差一项”的条件上下文（docs/22 §4、docs/24 §6 的全部键）。
// 中途结局、去向结局、突发小事、暑假、日常、毕业后的里程碑／小事／结局的测试共用；不依赖具体内容条目。

import { TALENTS } from "../../content";
import type { ConditionContext } from "../conditions";
import { ASPIRATION_ORDER, ECONOMY_ORDER, ENDING_TIER_ORDER, FOCUS_ORDER, LIFE_TRACK_ORDER } from "../constants";
import type { Degree, EndingCondition, FinalRoute, Focus, HistoryEntry, OfferTier, Points, RuntimeSchool, Stats } from "../index";
import { catalog } from "./helpers";

const STATS = ["money", "academics", "career", "wellbeing"] as const;
const FOCUSES: readonly Focus[] = FOCUS_ORDER;
const POINTS = ["family", "academics", "career", "wellbeing"] as const;
const OFFER_TIERS: OfferTier[] = ["S", "A", "B", "C", "D", "U"];
const ROUTES: FinalRoute[] = ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"];
const DEGREES: Degree[] = ["UG", "MS"];

export const zero = (): Stats => ({ money: 0, academics: 0, career: 0, wellbeing: 0 });

export function entry(kind: HistoryEntry["kind"], term: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    kind, stage: "UG", termIndex: term, revision: term, actionId: `t-${term}`, beforeStats: zero(), requestedDelta: zero(),
    appliedDelta: zero(), afterStats: { money: 10, academics: 10, career: 10, wellbeing: 10 }, ...extra,
  };
}

/** 一段历史：最近 shortfall 个学期期末资金短缺、最近 zeroWellbeing 个学期期末身心为 0；之前的学期一切正常。 */
export function historyWith(shortfall: number, zeroWellbeing: number): HistoryEntry[] {
  const terms = Math.max(shortfall, zeroWellbeing) + 1;
  const history: HistoryEntry[] = [];
  for (let term = 1; term <= terms; term++) {
    const short = term > terms - shortfall;
    const empty = term > terms - zeroWellbeing;
    history.push(entry("STIPEND", term), entry("FOCUS", term));
    history.push(entry("UPKEEP", term, { upkeep: { cost: 12, paid: short ? 5 : 12, shortfall: short ? 7 : 0, stress: short ? 4 : 0 } }));
    history.push(entry("GROWTH", term, { afterStats: { money: 10, academics: 10, career: 10, wellbeing: empty ? 0 : 10 } }));
  }
  return history;
}

export const school = (state: string, tier: OfferTier): RuntimeSchool => ({ ...catalog.schools[0], state, tier });

/** 按一条 when 构造一个恰好满足它的上下文：写了的取边界值，没写的取不会碍事的中间值。 */
export function satisfying(when: EndingCondition): ConditionContext {
  const stats = zero();
  for (const key of STATS) stats[key] = when.statMin?.[key] ?? Math.min(when.statMax?.[key] ?? 50, 50);
  const counts = { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 };
  for (const focus of FOCUSES) counts[focus] = when.countMin?.[focus] ?? 0;
  const points: Points = { family: 5, academics: 5, career: 5, wellbeing: 5 };
  for (const key of POINTS) points[key] = when.pointsMin?.[key] ?? Math.min(when.pointsMax?.[key] ?? 5, 5);
  return {
    stage: when.stage ?? "UG",
    term: when.termMin ?? Math.min(when.termMax ?? 3, 3),
    stats,
    counts,
    points,
    flags: [...(when.flagsAll ?? [])],
    talents: when.talentsAny ? [when.talentsAny[0]] : [],
    history: historyWith(when.shortfallStreak ?? 0, when.zeroWellbeingStreak ?? 0),
    school: school(when.schoolStates?.[0] ?? "ZZ", when.schoolTiers?.[0] ?? "B"),
    aspiration: when.aspirations?.[0] ?? "DISCOVERY",
    transitionMode: when.transitionMode ?? null,
    tier: when.tiers?.[0] ?? "R",
    // 第四版
    economy: when.economies?.[0] ?? "MID",
    focus: when.focusAny?.[0] ?? null,
    track: when.tracks?.[0] ?? "LOCAL_JOB",
    year: when.yearMin ?? Math.min(when.yearMax ?? 1, 1),
    lifeFlags: [...(when.lifeFlagsAll ?? []), ...(when.lifeFlagsAny ? [when.lifeFlagsAny[0]] : [])].filter((flag) => !(when.lifeFlagsNone ?? []).includes(flag)),
    flavor: when.flavors?.[0] ?? null,
    early: when.earlies?.[0] ?? null,
    route: when.routes?.[0] ?? null,
    degree: when.degrees?.[0] ?? "UG",
  };
}

/** 对 when 里写了的每一项，各给出一个“只把这一项改到不满足”的上下文。 */
export function violations(when: EndingCondition): Array<{ label: string; context: ConditionContext }> {
  const base = satisfying(when);
  const out: Array<{ label: string; context: ConditionContext }> = [];
  const push = (label: string, patch: Partial<ConditionContext>) => out.push({ label, context: { ...base, ...patch } });
  if (when.stage !== undefined) push("stage", { stage: when.stage === "UG" ? "MS" : "UG" });
  if (when.termMin !== undefined) push("termMin", { term: when.termMin - 1 });
  if (when.termMax !== undefined) push("termMax", { term: when.termMax + 1 });
  for (const key of STATS) {
    const min = when.statMin?.[key];
    const max = when.statMax?.[key];
    if (min !== undefined && min > 0) push(`statMin.${key}`, { stats: { ...base.stats, [key]: min - 1 } });
    if (max !== undefined && max < 100) push(`statMax.${key}`, { stats: { ...base.stats, [key]: max + 1 } });
  }
  for (const focus of FOCUSES) {
    const min = when.countMin?.[focus];
    const max = when.countMax?.[focus];
    if (min !== undefined && min > 0) push(`countMin.${focus}`, { counts: { ...base.counts, [focus]: min - 1 } });
    if (max !== undefined) push(`countMax.${focus}`, { counts: { ...base.counts, [focus]: max + 1 } });
  }
  for (const key of POINTS) {
    const min = when.pointsMin?.[key];
    const max = when.pointsMax?.[key];
    if (min !== undefined && min > 0 && base.points) push(`pointsMin.${key}`, { points: { ...base.points, [key]: min - 1 } });
    if (max !== undefined && max < 10 && base.points) push(`pointsMax.${key}`, { points: { ...base.points, [key]: max + 1 } });
    if (min !== undefined || max !== undefined) push(`points.${key}（经典模式没有点数）`, { points: null });
  }
  if (when.flagsAll?.length) push("flagsAll", { flags: when.flagsAll.slice(1) });
  if (when.talentsAny) push("talentsAny", { talents: TALENTS.map((talent) => talent.id).filter((id) => !when.talentsAny?.includes(id)).slice(0, 3) });
  if (when.shortfallStreak) push("shortfallStreak", { history: historyWith(when.shortfallStreak - 1, when.zeroWellbeingStreak ?? 0) });
  if (when.zeroWellbeingStreak) push("zeroWellbeingStreak", { history: historyWith(when.shortfallStreak ?? 0, when.zeroWellbeingStreak - 1) });
  if (when.schoolStates) {
    push("schoolStates", { school: school("XX", base.school?.tier ?? "B") });
    push("schoolStates（还没有学校）", { school: null });
  }
  if (when.schoolTiers) {
    const other = OFFER_TIERS.find((tier) => !when.schoolTiers?.includes(tier));
    if (other) push("schoolTiers", { school: school(base.school?.state ?? "ZZ", other) });
  }
  if (when.aspirations) {
    const other = ASPIRATION_ORDER.find((aspiration) => !when.aspirations?.includes(aspiration));
    if (other) push("aspirations", { aspiration: other });
  }
  if (when.transitionMode !== undefined) {
    push("transitionMode", { transitionMode: when.transitionMode === "NO_OFFER" ? "SELF_CHOSEN" : "NO_OFFER" });
    push("transitionMode（不是过渡期）", { transitionMode: null });
  }
  if (when.tiers) {
    const other = ENDING_TIER_ORDER.find((tier) => !when.tiers?.includes(tier));
    if (other) push("tiers", { tier: other });
    push("tiers（没有等级）", { tier: undefined });
  }
  // ---- 第四版（docs/24 §6）：上下文里缺这项信息时，带 None 的视为满足，其余视为不满足 ----
  if (when.focusAny) {
    const other = FOCUSES.find((focus) => !when.focusAny?.includes(focus));
    if (other) push("focusAny", { focus: other });
    push("focusAny（还没有本学期的安排）", { focus: null });
  }
  if (when.tracks) {
    const other = LIFE_TRACK_ORDER.find((track) => !when.tracks?.includes(track));
    if (other) push("tracks", { track: other });
    push("tracks（还没离校）", { track: undefined });
  }
  if (when.yearMin !== undefined) push("yearMin", { year: when.yearMin - 1 });
  if (when.yearMax !== undefined) push("yearMax", { year: when.yearMax + 1 });
  if (when.yearMin !== undefined || when.yearMax !== undefined) push("year（还没离校）", { year: undefined });
  if (when.lifeFlagsAll?.length) push("lifeFlagsAll", { lifeFlags: (base.lifeFlags ?? []).filter((flag) => flag !== when.lifeFlagsAll?.[0]) });
  if (when.lifeFlagsAll || when.lifeFlagsAny) push("lifeFlags（还没离校）", { lifeFlags: undefined });
  if (when.lifeFlagsAny?.length) push("lifeFlagsAny", { lifeFlags: (base.lifeFlags ?? []).filter((flag) => !when.lifeFlagsAny?.includes(flag)) });
  if (when.lifeFlagsNone?.length) push("lifeFlagsNone", { lifeFlags: [...(base.lifeFlags ?? []), when.lifeFlagsNone[0]] });
  if (when.talentsNone?.length) push("talentsNone", { talents: [...base.talents, when.talentsNone[0]] });
  if (when.flavors) {
    push("flavors", { flavor: "F_NOT_THIS_ONE" });
    push("flavors（没有去向结局）", { flavor: null });
  }
  if (when.earlies) {
    push("earlies", { early: "E_NOT_THIS_ONE" });
    push("earlies（没有中途结局）", { early: null });
  }
  if (when.routes) {
    const other = ROUTES.find((route) => !when.routes?.includes(route));
    if (other) push("routes", { route: other });
    push("routes（中途结局没有去向）", { route: null });
  }
  if (when.degrees) {
    const other = DEGREES.find((degree) => !when.degrees?.includes(degree));
    if (other) push("degrees", { degree: other });
    push("degrees（还没离校）", { degree: undefined });
  }
  if (when.economies) {
    const other = ECONOMY_ORDER.find((economy) => !when.economies?.includes(economy));
    if (other) push("economies", { economy: other });
  }
  return out;
}

