// 引擎测试共用的驱动工具：全部通过公开的 applyAction 与选择器推进，不绕过状态机。

import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import {
  applyAction, createRun, currentEvent, focusView, mastersOptions, routeOptions, setupView,
} from "../index";
import type {
  Action, ActionResult, ActiveRun, ChoiceId, Economy, EngineContext, EventView, Focus, FocusView, MastersOption,
  RouteOption, RunState, SetupRun, SetupView,
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

/** 正式玩法（standard）的新局。 */
export function start(seed: number, context: EngineContext = ctx): SetupRun {
  return createRun({ seed, runId: `test-${seed}`, catalog: context.catalog });
}

/** 经典模式的新局：给定经济档，之后在六张特质天赋里选一张。 */
export function startClassic(seed: number, economy: Economy, context: EngineContext = ctx): SetupRun {
  return createRun({ seed, runId: `classic-${seed}`, catalog: context.catalog, mode: "classic", classicEconomy: economy });
}

export interface Policy {
  /** 选哪几张天赋；缺省取抽到的前 pickCount 张。 */
  talents?(view: SetupView, state: SetupRun): string[];
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
    return { type: "CONFIRM_SETUP", talents: policy.talents ? policy.talents(view, state) : view.draw.slice(0, view.pickCount).map((talent) => talent.id) };
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
