// 界面测试的公共工具：用内存存储与合成样本目录挂载 App，并按策略一路点下去。
// 第二版里安排与事件每局不同，所以策略不再是固定脚本，而是“看当前状态决定下一步操作”的函数：
// 同一个策略既能直接喂给引擎（用来找合适的种子），也能翻译成真实按钮点击（用来测界面）。

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { SAVE_KEY, createMemoryStorage } from "../../app/storage";
import type { SaveStorage } from "../../app/storage";
import {
  applyAction,
  createRun,
  currentEvent,
  focusView,
  loadSave,
  mastersOptions,
  routeOptions,
  serializeSave,
  setupView,
} from "../../engine";
import type { Action, ChoiceId, EventView, Focus, RunState, RuntimeCatalog, SetupRun, StatKey } from "../../engine";
import { App } from "../App";

export const catalog: RuntimeCatalog = makeSampleCatalog();
const context = { catalog };

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

/** 存有一局“刚开局、指定 seed”的内存存储。 */
export function seededStorage(seed: number, runId = `test-run-${seed}`): MemoryStorage {
  const state = createRun({ seed, runId, catalog });
  return createMemoryStorage({ [SAVE_KEY]: serializeSave(state, []) });
}

/** 存档里的当前状态（顺带经过引擎的重放校验）。 */
export function savedState(storage: MemoryStorage): RunState {
  const loaded = loadSave(storage.dump()[SAVE_KEY], context);
  if (!loaded.ok) throw new Error(`存档无法读取：${loaded.reason} ${loaded.detail}`);
  return loaded.state;
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function mount(storage: SaveStorage, withCatalog: RuntimeCatalog = catalog): Promise<RenderResult> {
  const result = render(<App catalog={withCatalog} storage={storage} />);
  await waitFor(() => expect(screen.queryByText("正在读取存档…")).toBeNull());
  await flush();
  return result;
}

export function app(): HTMLElement {
  return screen.getByTestId("app");
}
export function mainText(): string {
  return app().querySelector("main")?.textContent ?? "";
}
export function phase(): string {
  return app().getAttribute("data-phase") ?? "";
}
export function revision(): number {
  return Number(app().getAttribute("data-revision"));
}
export function stat(key: StatKey): number {
  return Number(screen.getByTestId(`stat-${key}`).textContent);
}
export function stats(): Record<StatKey, number> {
  return { money: stat("money"), academics: stat("academics"), career: stat("career"), wellbeing: stat("wellbeing") };
}

export const counters = { clicks: 0 };

export async function click(testId: string): Promise<void> {
  counters.clicks += 1;
  fireEvent.click(screen.getByTestId(testId));
  await flush();
}

// ---------- 策略 ----------

export type Policy = (state: RunState) => Action;

export interface PolicyOptions {
  /** 类别的优先顺序；选第一个可选的。 */
  planOrder: Focus[];
  /** 事件怎么选；只会在可选的选项里挑。 */
  choice: (view: EventView) => ChoiceId;
  /** 毕业结果揭晓后怎么走。 */
  atResults: (state: RunState) => Action;
}

/** 钱最多的选项（省钱）；并列取 A。 */
export function thrifty(view: EventView): ChoiceId {
  const options = view.choices.filter((item) => item.available);
  options.sort((a, b) => b.choice.effects.money - a.choice.effects.money);
  return options[0].choice.id;
}
/** 最花钱的选项，用来把钱花光。 */
export function spendthrift(view: EventView): ChoiceId {
  const options = view.choices.filter((item) => item.available);
  options.sort((a, b) => a.choice.effects.money - b.choice.effects.money);
  return options[0].choice.id;
}

export const toTransition = (): Action => ({ type: "CHOOSE_ROUTE", route: "TRANSITION" });
/** 能读硕士就读（优先两年），否则进入过渡期。 */
export function preferMasters(state: RunState): Action {
  const options = mastersOptions(state).filter((option) => option.eligible);
  const pick = options.find((option) => option.program === "MS_2Y") ?? options[0];
  return pick ? { type: "ENTER_MASTERS", program: pick.program } : toTransition();
}
/** 接受第一个取得的机会，没有就进入过渡期。 */
export function acceptFirstOffer(state: RunState): Action {
  const offered = routeOptions(state).find((option) => option.available && option.route !== "TRANSITION");
  return { type: "CHOOSE_ROUTE", route: offered ? offered.route : "TRANSITION" };
}

export function makePolicy(options: PolicyOptions): Policy {
  return (state) => {
    switch (state.phase) {
      case "SETUP": {
        const view = setupView(state);
        return { type: "CONFIRM_SETUP", talents: view.draw.slice(0, view.pickCount).map((talent) => talent.id) };
      }
      case "HIGH_SCHOOL_EVENT":
      case "CORE_EVENT":
      case "ARC_EVENT": {
        const view = currentEvent(state);
        if (!view) throw new Error(`阶段 ${state.phase} 没有事件`);
        return { type: "CHOOSE_EVENT", eventId: view.event.id, choiceId: options.choice(view) };
      }
      case "SCHOOL_OFFERS": {
        const offers = state.offers ?? [];
        return { type: "CHOOSE_SCHOOL", unitid: offers[0].unitid };
      }
      case "FOCUS": {
        const view = focusView(state);
        if (!view) throw new Error("FOCUS 阶段没有安排");
        const available = view.options.filter((option) => option.available);
        const pick =
          options.planOrder.map((focus) => available.find((option) => option.focus === focus)).find((option) => option) ??
          available[0];
        return { type: "CHOOSE_PLAN", planId: pick.plan.id };
      }
      case "GRAD_PREVIEW":
        return { type: "REVEAL_GRADUATION" };
      case "GRAD_RESULTS":
        return options.atResults(state);
      case "ENDING":
        throw new Error("已经是结局，没有下一步");
    }
  };
}

/** 偏学习、省钱：本科常常没有工作机会、学业够、资金够，适合用来找能读硕士的种子。 */
export const scholarPolicy = makePolicy({
  planOrder: ["STUDY", "REST", "WORK", "CAMPUS", "CAREER"],
  choice: thrifty,
  atResults: preferMasters,
});
/** 四平八稳，本科结束就进入过渡期。 */
export const steadyPolicy = makePolicy({
  planOrder: ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"],
  choice: (view) => view.choices.filter((item) => item.available)[0].choice.id,
  atResults: toTransition,
});
/** 只学习、专挑花钱的选项：用来触发资金不足。 */
export const brokePolicy = makePolicy({
  planOrder: ["STUDY", "CAMPUS", "REST", "CAREER", "WORK"],
  choice: spendthrift,
  atResults: toTransition,
});

// ---------- 不经过界面，直接用引擎走一局（找种子用） ----------

export function newRun(seed: number): SetupRun {
  return createRun({ seed, runId: `sim-${seed}`, catalog });
}

export function simulate(seed: number, policy: Policy, stop: (state: RunState) => boolean): RunState {
  let state: RunState = newRun(seed);
  for (let i = 0; i < 200; i++) {
    if (stop(state) || state.phase === "ENDING") return state;
    const result = applyAction(state, { ...policy(state), revision: state.revision }, context);
    if (!result.ok) throw new Error(`seed ${seed} 在 ${state.phase} 被拒绝：${result.error.code}`);
    state = result.state;
  }
  throw new Error(`seed ${seed} 走了 200 步仍未结束`);
}

export const atUndergradResults = (state: RunState): boolean => state.phase === "GRAD_RESULTS" && state.stage === "UG";

/** 在 [from, to] 里找第一个满足条件的种子。引擎是确定的，所以结果稳定。 */
export function findSeed(test: (seed: number) => boolean, from = 1, to = 600): number {
  for (let seed = from; seed <= to; seed++) {
    if (test(seed)) return seed;
  }
  throw new Error(`在种子 ${from}–${to} 里没有找到符合条件的一局`);
}

// ---------- 把引擎操作翻译成真实点击 ----------

export async function perform(action: Action): Promise<void> {
  switch (action.type) {
    case "CONFIRM_SETUP":
      for (const id of action.talents) await click(`talent-${id}`);
      await click("start");
      return;
    case "CHOOSE_EVENT":
      expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe(action.eventId);
      await click(`choice-${action.choiceId}`);
      return;
    case "CHOOSE_SCHOOL": {
      const index = [0, 1, 2].find(
        (i) => screen.getByTestId(`offer-${i}`).getAttribute("data-unitid") === action.unitid,
      );
      await click(`offer-${index}`);
      return;
    }
    case "CHOOSE_PLAN":
      await click(`plan-${action.planId}`);
      return;
    case "REVEAL_GRADUATION":
      await click("reveal");
      return;
    case "CHOOSE_ROUTE":
      await click(`route-${action.route}`);
      return;
    case "ENTER_MASTERS":
      await click(`masters-${action.program}`);
      return;
  }
}

export interface Trail {
  actions: Action[];
  /** 每一屏（每个 revision）离开前的正文字符数，用来统计默认界面要读多少字。 */
  screenChars: number[];
}
export function newTrail(): Trail {
  return { actions: [], screenChars: [] };
}

/** 走一步：读存档里的状态 → 策略决定 → 点对应的按钮。each 在点之前调用，用来做每一屏的检查。 */
export async function step(storage: MemoryStorage, policy: Policy, trail: Trail, each?: (state: RunState) => void): Promise<void> {
  const state = savedState(storage);
  expect(state.revision).toBe(revision());
  each?.(state);
  const action = policy(state);
  trail.actions.push(action);
  trail.screenChars.push(mainText().length);
  await perform(action);
}

export async function advanceUntil(
  storage: MemoryStorage,
  policy: Policy,
  trail: Trail,
  stop: () => boolean,
  each?: (state: RunState) => void,
): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (stop()) return;
    await step(storage, policy, trail, each);
  }
  throw new Error(`走了 200 步仍未到达目标，当前阶段 ${phase()}`);
}
