// 第二版的学期内容（docs/16 第 2–4 节）：每学期的四张安排、主线槽事件、突发小事。
// 这三样都只由 seed、学段、学期（以及“本局已经出现过哪些随机事件／突发小事”）推出，与玩家的选择无关；
// 不存进状态，需要时现算。内容池一律作为参数传入，便于单独测试。

import {
  FOCUS_ORDER, HAPPENING_PROBABILITY, RANDOM_EVENT_FIRST_TERM, RANDOM_EVENT_LAST_TERM, RANDOM_EVENT_PROBABILITY,
} from "./constants";
import { draw01, pickIndex } from "./rng";
import type { Degree, Focus, Happening, PlanCard, StoryEvent } from "./types";

// ---------- 学期安排 ----------

export interface TermSlate {
  /** 这学期缺席的类别；经典模式（五张全给）为 null。 */
  missing: Focus | null;
  /** 展示顺序固定为 STUDY、CAREER、CAMPUS、WORK、REST 中出现的那几个。 */
  plans: PlanCard[];
}

/**
 * 某学段第 term 学期给出的安排。从该学段第 1 学期起迭代推出：
 * 每学期缺一个类别（不会连续两学期缺同一个），其余类别各出一张（尽量不与上一学期同类别的那张重复）。
 */
export function termSlate(seed: number, stage: Degree, term: number, pool: readonly PlanCard[]): TermSlate {
  let previousMissing: Focus | null = null;
  let previousPicks: Partial<Record<Focus, string>> = {};
  let slate: TermSlate = { missing: null, plans: [] };
  for (let t = 1; t <= term; t++) {
    const allowed = FOCUS_ORDER.filter((focus) => focus !== previousMissing);
    const missing = allowed[pickIndex(seed, `plan:missing:${stage}:${t}`, allowed.length)];
    const picks: Partial<Record<Focus, string>> = {};
    const plans: PlanCard[] = [];
    for (const category of FOCUS_ORDER) {
      if (category === missing) continue;
      const all = pool.filter((plan) => plan.focus === category);
      if (all.length === 0) continue; // 内容池缺这个类别：不出牌（正式内容里每个类别至少有基础安排）
      const last = previousPicks[category];
      // 去掉上一学期这个类别出过的那张；候选不足 2 张时不去掉。
      const candidates = last !== undefined && all.length >= 2 ? all.filter((plan) => plan.id !== last) : all;
      const plan = candidates[pickIndex(seed, `plan:pick:${stage}:${t}:${category}`, candidates.length)];
      picks[category] = plan.id;
      plans.push(plan);
    }
    previousMissing = missing;
    previousPicks = picks;
    slate = { missing, plans };
  }
  return slate;
}

// ---------- 主线槽事件 ----------

/**
 * 本科第 term 学期主线槽的事件。
 * 第 1、8 学期只从节点候选里取；第 2–7 学期先按 45% 看是否换成本局还没出现过的随机事件。
 * usedRandomIds 是本局此前已经出现过的随机事件（只取决于 seed，因为每学期出什么与玩家的选择无关）。
 */
export function mainSlotEvent(
  seed: number,
  term: number,
  candidates: readonly StoryEvent[],
  randomPool: readonly StoryEvent[],
  usedRandomIds: readonly string[],
): StoryEvent {
  if (candidates.length === 0) throw new Error(`MAIN_EVENT_CANDIDATES_EMPTY: 第 ${term} 学期没有主线候选`);
  if (term >= RANDOM_EVENT_FIRST_TERM && term <= RANDOM_EVENT_LAST_TERM) {
    const remaining = randomPool.filter((event) => !usedRandomIds.includes(event.id));
    if (draw01(seed, `event:kind:${term}`) < RANDOM_EVENT_PROBABILITY && remaining.length > 0) {
      return remaining[pickIndex(seed, `event:random:${term}`, remaining.length)];
    }
  }
  return candidates[pickIndex(seed, `event:main:${term}`, candidates.length)];
}

// ---------- 突发小事 ----------

/** 每学期开头、资助到账之后：60% 的概率从适用于当前学段且本局没出现过的突发小事里取一条；否则 null。 */
export function rollHappening(
  seed: number,
  stage: Degree,
  term: number,
  pool: readonly Happening[],
  usedIds: readonly string[],
): Happening | null {
  if (!(draw01(seed, `happening:roll:${stage}:${term}`) < HAPPENING_PROBABILITY)) return null;
  const available = pool.filter((item) => (item.scope === "ANY" || item.scope === stage) && !usedIds.includes(item.id));
  if (available.length === 0) return null;
  return available[pickIndex(seed, `happening:pick:${stage}:${term}`, available.length)];
}
