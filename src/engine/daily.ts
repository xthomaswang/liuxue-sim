// 日常（docs/24 §2.3）：只是一行字，轨迹现挑，不改状态、不进历史、不影响任何数值或判定。只在正式玩法。
// 每个结算完的学期：下学期（偶数学期）开头 70% 一条寒假；每学期两条（任何学期的加上这个季节的）。一局之内不重复。
// 条件的上下文取学期末：期末四属性、本学期的安排、到那时为止的安排次数与标记。

import { EVENT_BY_ID } from "../content";
import { conditionMet } from "./conditions";
import type { ConditionContext } from "./conditions";
import { DAILY_PER_TERM, DAILY_WINTER_PROBABILITY } from "./constants";
import { dailyPool } from "./pools";
import { draw01, pickWeighted } from "./rng";
import { zeroFocusCounts } from "./rules";
import type { ActiveRun, DailyLine, DailySlot, Degree } from "./types";

export interface DailyPick {
  stage: Degree;
  term: number;
  /** WINTER 是下学期开头那一条；0、1 是学期里的两条（第一条跟在安排后面，第二条跟在主线事件与期中小事后面）。 */
  slot: "WINTER" | 0 | 1;
  line: DailyLine;
}

/** 某个学期期末（历史第 index 条是它的基础成长）那一刻的条件上下文。 */
export function termEndContext(run: ActiveRun, index: number): ConditionContext {
  const growth = run.history[index];
  if (!growth || growth.kind !== "GROWTH" || (growth.stage !== "UG" && growth.stage !== "MS")) throw new Error("TERM_END_INDEX_INVALID");
  const counts = zeroFocusCounts();
  const flags: string[] = [];
  let focus: ConditionContext["focus"] = null;
  for (const entry of run.history.slice(0, index + 1)) {
    if (entry.kind === "FOCUS" && entry.focus) {
      counts[entry.focus] += 1;
      if (entry.stage === growth.stage && entry.termIndex === growth.termIndex) focus = entry.focus;
    }
    if (entry.kind === "EVENT" && entry.eventId) {
      const choice = EVENT_BY_ID[entry.eventId]?.choices.find((item) => item.id === entry.choiceId);
      for (const flag of choice?.setFlags ?? []) if (!flags.includes(flag)) flags.push(flag);
    }
  }
  return {
    stage: growth.stage,
    term: growth.termIndex,
    stats: growth.afterStats,
    counts,
    points: run.profile.points,
    flags,
    talents: run.profile.talents,
    history: run.history.slice(0, index + 1),
    school: run.school,
    aspiration: run.profile.aspiration,
    economy: run.profile.economy,
    focus,
  };
}

/** 这一局到目前为止（只看结算完的学期）挑出来的全部日常，按时间顺序。经典模式没有。 */
export function dailyPicksFor(run: ActiveRun, pool: readonly DailyLine[] = dailyPool()): DailyPick[] {
  if (run.mode !== "standard") return [];
  const used = new Set<string>();
  const picks: DailyPick[] = [];
  const choose = (slots: readonly DailySlot[], key: string, context: ConditionContext): DailyLine | null => {
    const candidates = pool.filter((line) => slots.includes(line.slot) && !used.has(line.id) && conditionMet(line.when, context));
    const picked = pickWeighted(run.seed, key, candidates, (line) => line.weight);
    if (picked) used.add(picked.id);
    return picked;
  };
  run.history.forEach((entry, index) => {
    if (entry.kind !== "GROWTH" || (entry.stage !== "UG" && entry.stage !== "MS")) return;
    const stage = entry.stage;
    const term = entry.termIndex;
    const context = termEndContext(run, index);
    if (term % 2 === 0 && draw01(run.seed, `daily:roll:${stage}:${term}:winter`) < DAILY_WINTER_PROBABILITY) {
      const line = choose(["WINTER"], `daily:${stage}:${term}:winter`, context);
      if (line) picks.push({ stage, term, slot: "WINTER", line });
    }
    const season: DailySlot = term % 2 === 1 ? "FALL" : "SPRING";
    for (let k = 0; k < DAILY_PER_TERM; k++) {
      const line = choose(["TERM", season], `daily:${stage}:${term}:${k}`, context);
      if (line) picks.push({ stage, term, slot: k === 0 ? 0 : 1, line });
    }
  });
  return picks;
}
