// 界面测试的公共工具（第三版）：用内存存储与合成样本目录挂载 App，按“首页 → 天赋 → 分点 → 轨迹 → 总结”点过去。
// 同样的开局（seed、前三张天赋、平均分点）也能不经过界面直接交给引擎算，用来找具有某种结果的种子。

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { emptyProgress, parseProgress, snapshotOf } from "../../app/progress";
import type { ProgressState } from "../../app/progress";
import { PROGRESS_KEY, REVEAL_KEY, SAVE_KEY, createMemoryStorage } from "../../app/storage";
import type { SaveStorage } from "../../app/storage";
import { createRun, evaluateRun, loadSave, setupView, simulate, startPreview } from "../../engine";
import type { ActiveRun, Points, RunRewards, RunState, RuntimeCatalog, SetupRun, StatKey } from "../../engine";
import { App } from "../App";

export const catalog: RuntimeCatalog = makeSampleCatalog();
const context = { catalog };

export type MemoryStorage = ReturnType<typeof createMemoryStorage>;
export { createMemoryStorage };

export const POINT_KEYS: Array<keyof Points> = ["family", "academics", "career", "wellbeing"];
export const ZERO_POINTS: Points = { family: 0, academics: 0, career: 0, wellbeing: 0 };

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
export function mainText(): string {
  return app().querySelector("main")?.textContent ?? "";
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

// ---------- 读存储 ----------

/** 存档里的这一局（顺带经过引擎的重放校验）。 */
export function savedState(storage: MemoryStorage): RunState {
  const loaded = loadSave(storage.dump()[SAVE_KEY], context);
  if (!loaded.ok) throw new Error(`存档无法读取：${loaded.reason} ${loaded.detail}`);
  return loaded.state;
}
export function savedEnding(storage: MemoryStorage): ActiveRun {
  const state = savedState(storage);
  if (state.phase !== "ENDING") throw new Error(`存档不在结局阶段：${state.phase}`);
  return state;
}
export function savedProgress(storage: MemoryStorage): ProgressState {
  return parseProgress(storage.dump()[PROGRESS_KEY] ?? null) ?? emptyProgress();
}
export function savedReveal(storage: MemoryStorage): { runId: string; shown: number; summarySeen: boolean } {
  return JSON.parse(storage.dump()[REVEAL_KEY]);
}

// ---------- 默认的开局：前三张天赋 + 平均分点 ----------

export function newRun(seed: number, unlockedTalents: string[] = [], inheritedTalent: string | null = null): SetupRun {
  return createRun({ seed, runId: `sim-${seed}`, catalog, unlockedTalents, inheritedTalent });
}

/** 把点数尽量平均地分完（每项不超过上限）。 */
export function evenPoints(budget: number, max: number): Points {
  const points: Points = { ...ZERO_POINTS };
  for (let i = 0, left = budget; left > 0 && i < 400; i++) {
    const key = POINT_KEYS[i % POINT_KEYS.length];
    if (points[key] < max) {
      points[key] += 1;
      left -= 1;
    }
  }
  return points;
}

export interface DefaultStart {
  setup: SetupRun;
  talents: string[];
  points: Points;
}
export function defaultStart(seed: number, unlockedTalents: string[] = [], inheritedTalent: string | null = null): DefaultStart {
  const setup = newRun(seed, unlockedTalents, inheritedTalent);
  const view = setupView(setup);
  const talents = view.draw.slice(0, view.pickCount).map((talent) => talent.id);
  const budget = startPreview(setup, talents, ZERO_POINTS).pointBudget;
  return { setup, talents, points: evenPoints(budget, view.pointMax) };
}

/** 不经过界面，直接算出默认开局的一生与（在给定进度下的）收获。 */
export function headless(seed: number, progress: ProgressState = emptyProgress()): { state: ActiveRun; rewards: RunRewards } {
  const start = defaultStart(seed, progress.unlockedTalents, null);
  const result = simulate(start.setup, { talents: start.talents, points: start.points }, context);
  const state = result.state;
  if (state.phase !== "ENDING") throw new Error(`seed ${seed} 没有走到结局`);
  return { state, rewards: evaluateRun(state, snapshotOf(progress)) };
}

/** 在 [from, to] 里找第一个满足条件的种子。引擎是确定的，所以结果稳定。 */
export function findSeed(test: (seed: number) => boolean, from = 1, to = 800): number {
  for (let seed = from; seed <= to; seed++) {
    if (test(seed)) return seed;
  }
  throw new Error(`在种子 ${from}–${to} 里没有找到符合条件的一局`);
}

// ---------- 按屏操作 ----------

/** 首页：用指定种子开局，进入天赋屏。 */
export async function openSeed(seed: number): Promise<void> {
  expect(phase()).toBe("HOME");
  fireEvent.change(screen.getByTestId("seed-input"), { target: { value: String(seed) } });
  await click("seed-apply");
  expect(phase()).toBe("TALENTS");
  expect(app().getAttribute("data-seed")).toBe(String(seed));
}

export function talentRows(): HTMLButtonElement[] {
  return Array.from(app().querySelectorAll<HTMLButtonElement>("button[data-testid^='talent-']"));
}
export function talentIds(): string[] {
  return talentRows().map((row) => (row.getAttribute("data-testid") ?? "").replace(/^talent-/, ""));
}

/** 天赋屏：点前三张（或指定的几张），再点下一步。 */
export async function pickTalents(ids: string[] = talentIds().slice(0, 3)): Promise<string[]> {
  for (const id of ids) await click(`talent-${id}`);
  await click("to-allocate");
  expect(phase()).toBe("ALLOCATE");
  return ids;
}

export function pointsLeft(): number {
  return Number(/(-?\d+)/.exec(screen.getByTestId("points-left").textContent ?? "")?.[1]);
}
export function pointValues(): Points {
  const read = (key: keyof Points) => Number(screen.getByTestId(`point-value-${key}`).textContent);
  return { family: read("family"), academics: read("academics"), career: read("career"), wellbeing: read("wellbeing") };
}

/** 分点屏：用 ＋ 号把点数平均分完。 */
export async function allocateEvenly(): Promise<Points> {
  for (let guard = 0; pointsLeft() > 0 && guard < 100; guard++) {
    const key = POINT_KEYS.find(
      (candidate) =>
        !(screen.getByTestId(`point-plus-${candidate}`) as HTMLButtonElement).disabled &&
        pointValues()[candidate] === Math.min(...POINT_KEYS.map((other) => pointValues()[other])),
    );
    await click(`point-plus-${key ?? POINT_KEYS.find((c) => !(screen.getByTestId(`point-plus-${c}`) as HTMLButtonElement).disabled)}`);
  }
  return pointValues();
}

/** 从首页一路到人生轨迹（默认开局：前三张天赋、平均分点）。 */
export async function playToTimeline(seed: number): Promise<void> {
  await openSeed(seed);
  await pickTalents();
  await allocateEvenly();
  await click("begin-life");
  expect(phase()).toBe("TIMELINE");
}

/** 从首页一路到人生总结。 */
export async function playToSummary(seed: number): Promise<void> {
  await playToTimeline(seed);
  await click("skip-to-end");
  await click("to-summary");
  expect(phase()).toBe("SUMMARY");
}

export function shownEntries(): string[] {
  return Array.from(app().querySelectorAll("[data-testid^='timeline-entry-']")).map((node) =>
    (node.getAttribute("data-testid") ?? "").replace(/^timeline-entry-/, ""),
  );
}
