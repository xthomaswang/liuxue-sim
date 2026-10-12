// 结局的触发条件（docs/22 第 4 节的 when 表）：中途结局与去向结局共用同一套键。
// 写了的每一项都必须满足，没写的不限制；出现引擎不认识的键属于内容错误，直接报错而不是悄悄忽略。

import { EVENT_BY_ID, TEXTS } from "../content";
import { FOCUS_ORDER, POINT_KEYS, STAT_KEYS } from "./constants";
import { FOCUS_SUMMARY_NAMES } from "./labels";
import { findTalent } from "./pools";
import type {
  Aspiration, Degree, EndingCondition, EndingTierId, FocusCounts, HistoryEntry, Points, RuntimeSchool, Stats,
  TransitionMode,
} from "./types";

export interface ConditionContext {
  /** 中途结局：当前学段。去向结局：最终检查点。 */
  stage: Degree;
  /** 中途结局：刚结算完的学期。去向结局：最终检查点的最后一个学期。 */
  term: number;
  /** 中途结局：期末结算后的四属性。去向结局：最终检查点的冻结快照。 */
  stats: Stats;
  counts: FocusCounts;
  points: Points | null;
  flags: readonly string[];
  talents: readonly string[];
  history: readonly HistoryEntry[];
  school: RuntimeSchool | null;
  aspiration: Aspiration;
  /** 只有去向结局才有。 */
  transitionMode?: TransitionMode | null;
  tier?: EndingTierId;
}

const KNOWN_KEYS: readonly (keyof EndingCondition)[] = [
  "stage", "termMin", "termMax", "statMin", "statMax", "countMin", "countMax", "pointsMin", "pointsMax", "flagsAll",
  "talentsAny", "shortfallStreak", "zeroWellbeingStreak", "schoolStates", "schoolTiers", "aspirations", "transitionMode",
  "tiers",
];
const POINT_NAMES: Readonly<Record<keyof Points, string>> = { family: "家境", academics: "学业", career: "职业", wellbeing: "身心" };

/** 到目前为止，连续多少个学期期末出现了资金短缺。 */
export function shortfallStreak(history: readonly HistoryEntry[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.kind !== "UPKEEP") continue;
    if ((entry.upkeep?.shortfall ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

/** 到目前为止，连续多少个学期期末（基础成长之后）身心为 0。 */
export function zeroWellbeingStreak(history: readonly HistoryEntry[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.kind !== "GROWTH") continue;
    if (entry.afterStats.wellbeing === 0) streak++;
    else break;
  }
  return streak;
}

export function conditionMet(when: EndingCondition, ctx: ConditionContext): boolean {
  for (const key of Object.keys(when)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) throw new Error(`UNKNOWN_CONDITION_KEY: ${key}`);
  }
  if (when.stage !== undefined && ctx.stage !== when.stage) return false;
  if (when.termMin !== undefined && ctx.term < when.termMin) return false;
  if (when.termMax !== undefined && ctx.term > when.termMax) return false;
  for (const key of STAT_KEYS) {
    const min = when.statMin?.[key];
    const max = when.statMax?.[key];
    if (min !== undefined && ctx.stats[key] < min) return false;
    if (max !== undefined && ctx.stats[key] > max) return false;
  }
  for (const focus of FOCUS_ORDER) {
    const min = when.countMin?.[focus];
    const max = when.countMax?.[focus];
    if (min !== undefined && ctx.counts[focus] < min) return false;
    if (max !== undefined && ctx.counts[focus] > max) return false;
  }
  for (const key of POINT_KEYS) {
    const min = when.pointsMin?.[key];
    const max = when.pointsMax?.[key];
    if (min === undefined && max === undefined) continue;
    if (!ctx.points) return false; // 经典模式没有分点：带点数条件的一律不满足
    if (min !== undefined && ctx.points[key] < min) return false;
    if (max !== undefined && ctx.points[key] > max) return false;
  }
  if (when.flagsAll && !when.flagsAll.every((flag) => ctx.flags.includes(flag))) return false;
  if (when.talentsAny && !when.talentsAny.some((id) => ctx.talents.includes(id))) return false;
  if (when.shortfallStreak !== undefined && shortfallStreak(ctx.history) < when.shortfallStreak) return false;
  if (when.zeroWellbeingStreak !== undefined && zeroWellbeingStreak(ctx.history) < when.zeroWellbeingStreak) return false;
  if (when.schoolStates && !(ctx.school && when.schoolStates.includes(ctx.school.state))) return false;
  if (when.schoolTiers && !(ctx.school && when.schoolTiers.includes(ctx.school.tier))) return false;
  if (when.aspirations && !when.aspirations.includes(ctx.aspiration)) return false;
  if (when.transitionMode !== undefined && ctx.transitionMode !== when.transitionMode) return false;
  if (when.tiers && !(ctx.tier !== undefined && when.tiers.includes(ctx.tier))) return false;
  return true;
}

/** 把一条已满足的条件写成给玩家看的事实：只写条件里出现的项，数值用当时的真实值。 */
export function conditionFacts(when: EndingCondition, ctx: ConditionContext): string[] {
  const facts: string[] = [];
  for (const key of STAT_KEYS) {
    if (when.statMin?.[key] !== undefined || when.statMax?.[key] !== undefined) facts.push(`${TEXTS.stat[key].name} ${ctx.stats[key]}`);
  }
  for (const focus of FOCUS_ORDER) {
    if (when.countMin?.[focus] !== undefined || when.countMax?.[focus] !== undefined) {
      facts.push(`${FOCUS_SUMMARY_NAMES[focus]}类安排 ${ctx.counts[focus]} 次`);
    }
  }
  for (const key of POINT_KEYS) {
    if ((when.pointsMin?.[key] !== undefined || when.pointsMax?.[key] !== undefined) && ctx.points) {
      facts.push(`${POINT_NAMES[key]}点数 ${ctx.points[key]}`);
    }
  }
  for (const flag of when.flagsAll ?? []) {
    const event = EVENT_BY_ID[flag.replace(/_[AB]$/, "")];
    const choice = event?.choices.find((item) => item.setFlags.includes(flag));
    facts.push(event && choice ? `在〈${event.title}〉里选了“${choice.label}”` : `有过经历 ${flag}`);
  }
  if (when.talentsAny) {
    const owned = when.talentsAny.filter((id) => ctx.talents.includes(id)).map((id) => findTalent(id)?.name ?? id);
    if (owned.length > 0) facts.push(`带着天赋“${owned.join("”“")}”`);
  }
  if (when.shortfallStreak !== undefined) facts.push(`连续 ${shortfallStreak(ctx.history)} 个学期期末资金短缺`);
  if (when.zeroWellbeingStreak !== undefined) facts.push(`连续 ${zeroWellbeingStreak(ctx.history)} 个学期期末身心为 0`);
  if (when.schoolStates && ctx.school) facts.push(`学校在 ${ctx.school.state}`);
  if (when.schoolTiers && ctx.school) facts.push(ctx.school.tier === "U" ? "学校未分档" : `学校是 ${ctx.school.tier} 档`);
  return facts;
}
