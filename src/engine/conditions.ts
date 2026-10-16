// 结局的触发条件（docs/22 第 4 节的 when 表；第四版新增的键见 docs/24 §6）：中途结局、去向结局、
// 突发小事、暑假、日常、毕业后的里程碑／生活小事／五年后的结局共用同一套键。
// 写了的每一项都必须满足，没写的不限制；出现引擎不认识的键属于内容错误，直接报错而不是悄悄忽略。
// 上下文里没有对应信息时（例如开学那一刻还没有“本学期的安排”），带 None 的键视为满足，其余一律视为不满足。

import { EVENT_BY_ID, TEXTS } from "../content";
import { FOCUS_ORDER, POINT_KEYS, STAT_KEYS } from "./constants";
import { FOCUS_SUMMARY_NAMES } from "./labels";
import { findTalent } from "./pools";
import type {
  Aspiration, Degree, Economy, EndingCondition, EndingTierId, FinalRoute, Focus, FocusCounts, HistoryEntry, LifeTrack,
  Points, RuntimeSchool, Stats, TransitionMode,
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
  /** 家境档（引擎给出的上下文都带）。 */
  economy?: Economy;
  /** 本学期的安排类别：期中小事、暑假（刚结束那学期的）、日常、中途结局有；开学那一刻与出国前没有。 */
  focus?: Focus | null;
  /** 去向结局与毕业后才有。 */
  transitionMode?: TransitionMode | null;
  tier?: EndingTierId;
  // ---- 只有毕业（或离校）之后才有 ----
  /** 当前所在的轨道。 */
  track?: LifeTrack;
  /** 毕业后第几年（1 起）。 */
  year?: number;
  /** 毕业后的人生标记。 */
  lifeFlags?: readonly string[];
  /** 当年的去向结局 id（中途结局为 null）。 */
  flavor?: string | null;
  /** 当年的中途结局 id（毕业结局为 null）。 */
  early?: string | null;
  /** 当年的毕业去向（中途结局为 null）。 */
  route?: FinalRoute | null;
  /** 离开学校时的学段。 */
  degree?: Degree;
}

const KNOWN_KEYS: readonly (keyof EndingCondition)[] = [
  "stage", "termMin", "termMax", "statMin", "statMax", "countMin", "countMax", "pointsMin", "pointsMax", "flagsAll",
  "talentsAny", "shortfallStreak", "zeroWellbeingStreak", "schoolStates", "schoolTiers", "aspirations", "transitionMode",
  "tiers",
  // 第四版
  "focusAny", "tracks", "yearMin", "yearMax", "lifeFlagsAll", "lifeFlagsAny", "lifeFlagsNone", "talentsNone", "flavors",
  "earlies", "routes", "degrees", "economies",
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
  // 第四版（docs/24 §6）
  if (when.focusAny && !(ctx.focus != null && when.focusAny.includes(ctx.focus))) return false;
  if (when.tracks && !(ctx.track !== undefined && when.tracks.includes(ctx.track))) return false;
  if (when.yearMin !== undefined && !(ctx.year !== undefined && ctx.year >= when.yearMin)) return false;
  if (when.yearMax !== undefined && !(ctx.year !== undefined && ctx.year <= when.yearMax)) return false;
  const lifeFlags = ctx.lifeFlags;
  if (when.lifeFlagsAll && !(lifeFlags && when.lifeFlagsAll.every((flag) => lifeFlags.includes(flag)))) return false;
  if (when.lifeFlagsAny && !(lifeFlags && when.lifeFlagsAny.some((flag) => lifeFlags.includes(flag)))) return false;
  if (when.lifeFlagsNone && lifeFlags && when.lifeFlagsNone.some((flag) => lifeFlags.includes(flag))) return false;
  if (when.talentsNone && when.talentsNone.some((id) => ctx.talents.includes(id))) return false;
  if (when.flavors && !(ctx.flavor != null && when.flavors.includes(ctx.flavor))) return false;
  if (when.earlies && !(ctx.early != null && when.earlies.includes(ctx.early))) return false;
  if (when.routes && !(ctx.route != null && when.routes.includes(ctx.route))) return false;
  if (when.degrees && !(ctx.degree !== undefined && when.degrees.includes(ctx.degree))) return false;
  if (when.economies && !(ctx.economy !== undefined && when.economies.includes(ctx.economy))) return false;
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
  if (when.focusAny && ctx.focus) facts.push(`这学期的安排是${FOCUS_SUMMARY_NAMES[ctx.focus]}`);
  if (when.economies && ctx.economy) facts.push(`家境：${TEXTS.economy[ctx.economy].shortName}`);
  return facts;
}
