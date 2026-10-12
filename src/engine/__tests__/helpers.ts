// 引擎测试共用的驱动工具：全部通过公开的 applyAction 与选择器推进，不绕过状态机。

import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import type { ConditionContext } from "../conditions";
import {
  applyAction, autoAction, createRun, currentEvent, focusView, mastersOptions, routeOptions, setupView, startPreview,
} from "../index";
import type {
  Action, ActionResult, ActiveRun, ChoiceId, Economy, EngineContext, EventView, Focus, FocusView, MastersOption,
  Points, RouteOption, RunState, SetupRun, SetupView,
} from "../index";
import { hash32 } from "../rng";

export const catalog = makeSampleCatalog();
export const ctx: EngineContext = { catalog };

export function tryAct(state: RunState, action: Action, context: EngineContext = ctx): ActionResult {
  return applyAction(state, { ...action, revision: state.revision }, context);
}

/** 带着指定的 revision 发出操作（模拟连点或过期的操作）。 */
export function actWithRevision(state: RunState, action: Action, revision: number, context: EngineContext = ctx): ActionResult {
  return applyAction(state, { ...action, revision }, context);
}

/** 执行一步，失败即抛错（测试里表示“这一步应当成功”）。 */
export function act(state: RunState, action: Action, context: EngineContext = ctx): RunState {
  const result = tryAct(state, action, context);
  if (!result.ok) throw new Error(`${action.type} 被拒绝：${result.error.code} ${result.error.message}`);
  return result.state;
}

export function asActive(state: RunState): ActiveRun {
  if (state.phase === "SETUP") throw new Error("仍在 SETUP");
  return state;
}

export function asSetup(state: RunState): SetupRun {
  if (state.phase !== "SETUP") throw new Error("已经离开 SETUP");
  return state;
}

/** 正式玩法（standard）的新局；可以带上已解锁的天赋与继承的天赋。 */
export function start(
  seed: number,
  context: EngineContext = ctx,
  inputs: { unlockedTalents?: string[]; inheritedTalent?: string | null } = {},
): SetupRun {
  return createRun({ seed, runId: `test-${seed}`, catalog: context.catalog, ...inputs });
}

/** 把 budget 点尽量平均地分到四项上（每项不超过 10），多出来的按 家境、学业、职业、身心 的顺序各加 1。 */
export function evenPoints(budget: number): Points {
  const keys = ["family", "academics", "career", "wellbeing"] as const;
  const points: Points = { family: 0, academics: 0, career: 0, wellbeing: 0 };
  let left = budget;
  while (left > 0) {
    let placed = false;
    for (const key of keys) {
      if (left > 0 && points[key] < 10) {
        points[key] += 1;
        left -= 1;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return points;
}

/** 以 base 为起点把点数调到恰好等于 budget：多了从后往前减，少了从前往后加。 */
export function fitPoints(base: Points, budget: number): Points {
  const keys = ["family", "academics", "career", "wellbeing"] as const;
  const points = { ...base };
  let diff = budget - keys.reduce((sum, key) => sum + points[key], 0);
  for (let guard = 0; diff !== 0 && guard < 200; guard++) {
    const key = keys[diff > 0 ? guard % 4 : 3 - (guard % 4)];
    if (diff > 0 && points[key] < 10) {
      points[key] += 1;
      diff -= 1;
    } else if (diff < 0 && points[key] > 0) {
      points[key] -= 1;
      diff += 1;
    }
  }
  return points;
}

/**
 * 把一种分点方案调到恰好等于 budget，同时保住它的特点（0 还是 0、10 还是 10）：
 * 多出来的点依次加到“已有点数且未满”的最小一项上，不够时从未满的最大一项里减；实在没处放才动 0 和 10。
 */
export function scalePoints(base: Points, budget: number): Points {
  const keys = ["family", "academics", "career", "wellbeing"] as const;
  const points = { ...base };
  let diff = budget - keys.reduce((sum, key) => sum + points[key], 0);
  for (let guard = 0; diff !== 0 && guard < 200; guard++) {
    if (diff > 0) {
      const open = keys.filter((key) => points[key] < 10);
      if (open.length === 0) break;
      const preferred = open.filter((key) => points[key] > 0);
      const pool = preferred.length > 0 ? preferred : open;
      points[pool.reduce((best, key) => (points[key] < points[best] ? key : best))] += 1;
      diff -= 1;
    } else {
      const open = keys.filter((key) => points[key] > 0);
      if (open.length === 0) break;
      const preferred = open.filter((key) => points[key] < 10);
      const pool = preferred.length > 0 ? preferred : open;
      points[pool.reduce((best, key) => (points[key] > points[best] ? key : best))] -= 1;
      diff += 1;
    }
  }
  return points;
}

const AUTO_SHAPES: readonly Points[] = [
  { family: 5, academics: 5, career: 5, wellbeing: 5 }, { family: 2, academics: 10, career: 4, wellbeing: 4 },
  { family: 2, academics: 4, career: 10, wellbeing: 4 }, { family: 10, academics: 4, career: 3, wellbeing: 3 },
  { family: 0, academics: 8, career: 6, wellbeing: 6 }, { family: 6, academics: 7, career: 7, wellbeing: 0 },
  { family: 4, academics: 3, career: 3, wellbeing: 10 },
];

/** 把 budget 点随机分到四项上（由 seed 决定，每项不超过 10）。 */
export function randomPoints(seed: number, budget: number): Points {
  const keys = ["family", "academics", "career", "wellbeing"] as const;
  const points: Points = { family: 0, academics: 0, career: 0, wellbeing: 0 };
  for (let i = 0, left = Math.min(budget, 40); left > 0 && i < 4000; i++) {
    const key = keys[Math.floor(testRandom(seed, `points:${i}`) * 4)];
    if (points[key] < 10) {
      points[key] += 1;
      left -= 1;
    }
  }
  return points;
}

/**
 * 给自动模拟用的一组开局输入（由 seed 决定）：天赋取十张里连着的三张；
 * 点数一半用固定的几种形状（均衡、各种偏科、见底），一半随机。
 */
export function autoInput(seed: number, context: EngineContext = ctx): { setup: SetupRun; input: { talents: string[]; points: Points } } {
  const setup = start(seed, context);
  const draw = setupView(setup).draw;
  const from = seed % 8;
  const talents = draw.slice(from, from + 3).map((talent) => talent.id);
  const budget = startPreview(setup, talents, { family: 0, academics: 0, career: 0, wellbeing: 0 }).pointBudget;
  const points = seed % 2 === 0 ? randomPoints(seed, budget) : scalePoints(AUTO_SHAPES[(seed >> 1) % AUTO_SHAPES.length], budget);
  return { setup, input: { talents, points } };
}

/** 经典模式的新局：给定经济档，之后在六张特质天赋里选一张。 */
export function startClassic(seed: number, economy: Economy, context: EngineContext = ctx): SetupRun {
  return createRun({ seed, runId: `classic-${seed}`, catalog: context.catalog, mode: "classic", classicEconomy: economy });
}

export interface Policy {
  /** 选哪几张天赋；缺省取抽到的前 pickCount 张。 */
  talents?(view: SetupView, state: SetupRun): string[];
  /** 正式玩法的分点；缺省把可分配的点数平均分到四项。经典模式没有分点。 */
  points?(budget: number, state: SetupRun): Points;
  event(view: EventView, state: ActiveRun): ChoiceId;
  /** 返回想选的安排 id；不在本学期名单里或买不起时，驱动会改选第一张可选的。 */
  plan(view: FocusView, state: ActiveRun): string;
  /** 毕业结果出来后做什么；缺省：有机会就按 PHD > LOCAL_JOB > HOME_JOB 接受，否则过渡期。 */
  graduate?(state: ActiveRun, routes: RouteOption[], masters: MastersOption[]): Action;
  school?(state: ActiveRun): string;
}

export function defaultGraduate(_state: ActiveRun, routes: RouteOption[]): Action {
  const pick = routes.find((option) => option.available && option.route !== "TRANSITION");
  return { type: "CHOOSE_ROUTE", route: pick ? pick.route : "TRANSITION" };
}

/** 按当前 phase 生成下一步操作；ENDING 返回 null。 */
export function nextAction(state: RunState, policy: Policy): Action | null {
  if (state.phase === "SETUP") {
    const view = setupView(state);
    const talents = policy.talents ? policy.talents(view, state) : view.draw.slice(0, view.pickCount).map((talent) => talent.id);
    if (state.mode === "classic") return { type: "CONFIRM_SETUP", talents };
    const budget = startPreview(state, talents, { family: 0, academics: 0, career: 0, wellbeing: 0 }).pointBudget;
    return { type: "CONFIRM_SETUP", talents, points: policy.points ? policy.points(budget, state) : evenPoints(budget) };
  }
  switch (state.phase) {
    case "HIGH_SCHOOL_EVENT":
    case "CORE_EVENT":
    case "ARC_EVENT": {
      const view = currentEvent(state);
      if (!view) throw new Error(`${state.phase} 没有当前事件`);
      const wanted = policy.event(view, state);
      const choice = view.choices.find((item) => item.choice.id === wanted && item.available) ?? view.choices.find((item) => item.available);
      if (!choice) throw new Error(`${view.event.id} 没有可选项`);
      return { type: "CHOOSE_EVENT", eventId: view.event.id, choiceId: choice.choice.id };
    }
    case "SCHOOL_OFFERS":
      return { type: "CHOOSE_SCHOOL", unitid: policy.school ? policy.school(state) : (state.offers ?? [])[0].unitid };
    case "FOCUS": {
      const view = focusView(state);
      if (!view) throw new Error("FOCUS 没有安排视图");
      const wanted = policy.plan(view, state);
      const option = view.options.find((item) => item.plan.id === wanted && item.available) ?? view.options.find((item) => item.available);
      if (!option) throw new Error("这学期没有可选的安排");
      return { type: "CHOOSE_PLAN", planId: option.plan.id };
    }
    case "GRAD_PREVIEW":
      return { type: "REVEAL_GRADUATION" };
    case "GRAD_RESULTS":
      return (policy.graduate ?? defaultGraduate)(state, routeOptions(state), mastersOptions(state));
    case "ENDING":
      return null;
  }
}

export interface Played {
  state: RunState;
  log: Action[];
}

/** 从给定状态一直推进到 stop 返回 true（在执行下一步之前检查）或到达 ENDING。 */
export function play(from: RunState, policy: Policy, stop?: (state: RunState) => boolean, log: Action[] = []): Played {
  let state = from;
  for (let guard = 0; guard < 200; guard++) {
    if (stop?.(state)) return { state, log };
    const action = nextAction(state, policy);
    if (!action) return { state, log };
    state = act(state, action);
    log.push(action);
  }
  throw new Error("推进步数超出上限，状态机可能卡住");
}

/**
 * 与引擎的 simulate 相同的循环（确认开局之后每一步都取 autoAction），但每走一步都把前后状态交给 onStep：
 * 统计与接线检查要看每个学期末，而 simulate 只返回最终状态。
 */
export function simulateObserved(
  setup: SetupRun,
  input: { talents: string[]; points: Points },
  context: EngineContext = ctx,
  onStep?: (before: RunState, action: Action, after: ActiveRun) => void,
): Played {
  const log: Action[] = [];
  let state: RunState = setup;
  let action: Action | null = { type: "CONFIRM_SETUP", talents: [...input.talents], points: { ...input.points } };
  for (let guard = 0; action !== null; guard++) {
    if (guard >= 200) throw new Error("推进步数超出上限，状态机可能卡住");
    const after = asActive(act(state, action, context));
    log.push(action);
    onStep?.(state, action, after);
    state = after;
    action = autoAction(state, context);
  }
  return { state, log };
}

/**
 * 刚走完的这一步如果结算了一个学期（记下了新的 GROWTH），重建期末那一刻检查中途结局用的上下文；否则返回 null。
 * 没有中途结局时引擎会在同一步里接着发下一学期的资助与突发小事，所以属性与历史都要截到 GROWTH 那一条为止；
 * 安排次数、标记、学校这些在期末之后不会变，直接取这一步之后的。
 */
export function termEndContext(before: RunState, after: ActiveRun): ConditionContext | null {
  const from = before.phase === "SETUP" ? 0 : before.history.length;
  for (let i = from; i < after.history.length; i++) {
    const entry = after.history[i];
    if (entry.kind !== "GROWTH") continue;
    if (entry.stage !== "UG" && entry.stage !== "MS") throw new Error(`基础成长记在了 ${entry.stage}`);
    return {
      stage: entry.stage,
      term: entry.termIndex,
      stats: entry.afterStats,
      counts: after.focusCounts,
      points: after.profile.points,
      flags: after.flags,
      talents: after.profile.talents,
      history: after.history.slice(0, i + 1),
      school: after.school,
      aspiration: after.profile.aspiration,
    };
  }
  return null;
}

/** 停在某个阶段（可再限定学期）的判定，用来写 play 的 stop。 */
export function at(phase: RunState["phase"], termIndex?: number, stage?: "UG" | "MS") {
  return (state: RunState): boolean =>
    state.phase === phase &&
    (termIndex === undefined || (state.phase !== "SETUP" && state.termIndex === termIndex)) &&
    (stage === undefined || (state.phase !== "SETUP" && state.stage === stage));
}

/** 经典模式的策略：选一张特质天赋；每学期选一个类别（基础安排的 id 就是类别名）。 */
export function classicPolicy(args: {
  talent?: string;
  focus: Focus | ((state: ActiveRun) => Focus);
  event: ChoiceId | ((view: EventView, state: ActiveRun) => ChoiceId);
  graduate?: Policy["graduate"];
}): Policy {
  const { focus, event } = args;
  return {
    talents: () => [args.talent ?? "T_OUTGOING"],
    plan: (_view, state) => (typeof focus === "function" ? focus(state) : focus),
    event: (view, state) => (typeof event === "function" ? event(view, state) : event),
    graduate: args.graduate,
  };
}

/** 经典模式的固定剧本：按给定的类别序列与事件选择表推进。 */
export function scriptedPolicy(args: {
  talent: string;
  focus: Focus[];
  choices: Record<string, ChoiceId>;
  fallback?: ChoiceId;
  graduate?: Policy["graduate"];
}): Policy {
  let focusIndex = 0;
  return {
    talents: () => [args.talent],
    plan: () => {
      const focus = args.focus[focusIndex++];
      if (!focus) throw new Error("剧本里的类别序列用完了");
      return focus;
    },
    event: (view) => {
      const choice = args.choices[view.event.id] ?? args.fallback;
      if (!choice) throw new Error(`剧本缺少 ${view.event.id} 的选择`);
      return choice;
    },
    graduate: args.graduate,
  };
}

/** seed 驱动的确定性随机数，用来写随机策略（与规则抽签的 key 不冲突）。 */
export function testRandom(seed: number, key: string): number {
  return hash32(`test:${seed}:${key}`) / 4294967296;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
