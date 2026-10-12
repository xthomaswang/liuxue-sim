// 界面测试的公共工具：用内存存储与合成样本目录挂载 App，并按给定策略一路点下去。
// 只通过真实按钮操作界面；种子局用引擎生成初始存档，保证每次测试完全可复现。

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { SAVE_KEY, createMemoryStorage } from "../../app/storage";
import type { SaveStorage } from "../../app/storage";
import { EVENT_BY_ID } from "../../content";
import { createRun, serializeSave } from "../../engine";
import type { Aspiration, ChoiceId, Economy, Focus, RuntimeCatalog, StatKey } from "../../engine";
import { App } from "../App";

export const catalog: RuntimeCatalog = makeSampleCatalog();

/** 存有一局“刚开局、指定 seed”的内存存储。 */
export function seededStorage(seed: number, runId = `test-run-${seed}`) {
  const state = createRun({ seed, runId, catalog });
  return createMemoryStorage({ [SAVE_KEY]: serializeSave(state, []) });
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

export interface Policy {
  economy: Economy;
  aspiration: Aspiration;
  /** 第 n 次投入（从 0 起）选什么。 */
  focus: (index: number) => Focus;
  /** 事件怎么选；返回的选项不可用时自动换另一个。缺省选 A。 */
  choice?: (eventId: string, available: Record<ChoiceId, boolean>) => ChoiceId;
  offer?: number;
}

export interface Trail {
  focusCount: number;
  events: string[];
  /** 出现过被禁用选项的事件。 */
  disabledSeen: string[];
}

export function newTrail(): Trail {
  return { focusCount: 0, events: [], disabledSeen: [] };
}

function choiceButton(id: ChoiceId): HTMLButtonElement {
  return screen.getByTestId(`choice-${id}`) as HTMLButtonElement;
}

/** 按当前阶段走一步。GRAD_RESULTS 与 ENDING 不处理，由测试自己决定。 */
export async function step(policy: Policy, trail: Trail): Promise<void> {
  const current = phase();
  switch (current) {
    case "SETUP":
      await click(`family-${policy.economy}`);
      await click(`aspiration-${policy.aspiration}`);
      await click("start");
      return;
    case "HIGH_SCHOOL_EVENT":
    case "CORE_EVENT":
    case "ARC_EVENT": {
      const eventId = screen.getByTestId("screen-event").getAttribute("data-event-id") ?? "";
      const available = { A: !choiceButton("A").disabled, B: !choiceButton("B").disabled };
      // 任何资金局面下每个事件都必须至少有一个能点的选项。
      expect(available.A || available.B).toBe(true);
      if (!available.A || !available.B) trail.disabledSeen.push(eventId);
      let pick: ChoiceId = policy.choice ? policy.choice(eventId, available) : "A";
      if (!available[pick]) pick = pick === "A" ? "B" : "A";
      trail.events.push(`${eventId}_${pick}`);
      await click(`choice-${pick}`);
      return;
    }
    case "SCHOOL_OFFERS":
      await click(`offer-${policy.offer ?? 0}`);
      return;
    case "FOCUS":
      await click(`focus-${policy.focus(trail.focusCount)}`);
      trail.focusCount += 1;
      return;
    case "TERM_REVIEW":
      await click("next-term");
      return;
    case "GRAD_PREVIEW":
      await click("reveal");
      return;
    default:
      throw new Error(`step() 不处理阶段 ${current}`);
  }
}

export async function advanceUntil(policy: Policy, trail: Trail, stop: () => boolean, maxSteps = 200): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    if (stop()) return;
    await step(policy, trail);
  }
  throw new Error(`走了 ${maxSteps} 步仍未到达目标，当前阶段 ${phase()}`);
}

/** 选资金变化最小（最花钱）的可用选项，用来把钱花光。 */
export function spendthrift(eventId: string, available: Record<ChoiceId, boolean>): ChoiceId {
  const event = EVENT_BY_ID[eventId];
  const options = event.choices.filter((choice) => available[choice.id]);
  options.sort((a, b) => a.effects.money - b.effects.money);
  return options[0].id;
}

// docs/09 第 3 节：seed=13、LOW 家庭的可复核路线，本科结束时博士取得、两种工作未取得，两个硕士方案均可选。
export const SEED13_FOCUS: Focus[] = ["WORK", "STUDY", "WORK", "STUDY", "WORK", "STUDY", "WORK", "WORK"];
export const SEED13_CHOICES: Record<string, ChoiceId> = {
  HS_01: "A",
  HS_02: "B",
  CORE_01: "B",
  CORE_02: "B",
  ARC_CREATIVE_1: "B",
  CORE_03: "B",
  ARC_RESEARCH_1: "B",
  CORE_04: "B",
  ARC_CREATIVE_2: "B",
  CORE_05: "B",
  ARC_RESEARCH_2: "A",
  CORE_06: "A",
  ARC_CREATIVE_3: "B",
  CORE_07: "A",
  ARC_RESEARCH_3: "A",
  CORE_08: "A",
};
export const seed13Policy: Policy = {
  economy: "LOW",
  aspiration: "DISCOVERY",
  // 本科按文档顺序；之后（硕士）一律休息。
  focus: (index) => SEED13_FOCUS[index] ?? "REST",
  choice: (eventId) => SEED13_CHOICES[eventId] ?? "A",
};
