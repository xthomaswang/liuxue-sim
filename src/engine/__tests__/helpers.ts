// 引擎测试共用的驱动工具：全部通过公开的 applyAction 与选择器推进，不绕过状态机。

import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import {
  applyAction, createRun, currentEvent, focusView, mastersOptions, routeOptions,
} from "../index";
import type {
  Action, ActionResult, ActiveRun, Aspiration, ChoiceId, Economy, EngineContext, EventView, Focus, FocusView,
  MastersOption, RouteOption, RunState,
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

export function start(seed: number, context: EngineContext = ctx): RunState {
  return createRun({ seed, runId: `test-${seed}`, catalog: context.catalog });
}

export interface Policy {
  economy: Economy;
  aspiration?: Aspiration;
  name?: string;
  event(view: EventView, state: ActiveRun): ChoiceId;
  focus(view: FocusView, state: ActiveRun): Focus;
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
    return { type: "CONFIRM_SETUP", economy: policy.economy, aspiration: policy.aspiration ?? "DISCOVERY", name: policy.name ?? "" };
  }
  switch (state.phase) {
    case "HIGH_SCHOOL_EVENT":
    case "CORE_EVENT":
    case "ARC_EVENT": {
      const view = currentEvent(state);
      if (!view) throw new Error(`${state.phase} 没有当前事件`);
      if (!view.choices.some((choice) => choice.available)) throw new Error(`${view.event.id} 没有可选项`);
      const wanted = policy.event(view, state);
      const choice = view.choices.find((item) => item.choice.id === wanted && item.available) ?? view.choices.find((item) => item.available);
      if (!choice) throw new Error(`${view.event.id} 没有可选项`);
      return { type: "CHOOSE_EVENT", eventId: view.event.id, choiceId: choice.choice.id };
    }
    case "SCHOOL_OFFERS":
      return { type: "CHOOSE_SCHOOL", unitid: policy.school ? policy.school(state) : (state.offers ?? [])[0].unitid };
    case "FOCUS": {
      const view = focusView(state);
      if (!view) throw new Error("FOCUS 没有投入视图");
      return { type: "CHOOSE_FOCUS", focus: policy.focus(view, state) };
    }
    case "TERM_REVIEW":
      return { type: "NEXT_TERM" };
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

/** 固定剧本：按给定的投入序列与事件选择表推进。 */
export function scriptedPolicy(args: {
  economy: Economy;
  aspiration?: Aspiration;
  focus: Focus[];
  choices: Record<string, ChoiceId>;
  fallback?: ChoiceId;
  graduate?: Policy["graduate"];
}): Policy {
  let focusIndex = 0;
  return {
    economy: args.economy,
    aspiration: args.aspiration,
    focus: () => {
      const focus = args.focus[focusIndex++];
      if (!focus) throw new Error("剧本里的投入序列用完了");
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
