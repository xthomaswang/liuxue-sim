// @vitest-environment jsdom
// 各屏的呈现约定：开局抽天赋、没有展开、资金不足的选项、样本目录提示、种子、图鉴、重开确认。

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { createMemoryStorage } from "../../app/storage";
import { ENDING_CARDS, TALENTS } from "../../content";
import { currentEvent, focusView, setupView, termLedger } from "../../engine";
import type { RunState } from "../../engine";
import {
  advanceUntil,
  app,
  brokePolicy,
  click,
  findSeed,
  flush,
  mount,
  newRun,
  newTrail,
  phase,
  revision,
  seededStorage,
  simulate,
  stats,
  steadyPolicy,
  step,
} from "./harness";

afterEach(() => cleanup());

const talentButtons = () => Array.from(app().querySelectorAll<HTMLButtonElement>("button[data-testid^='talent-']"));
const startButton = () => screen.getByTestId("start") as HTMLButtonElement;

describe("开局：出身是抽的，十张天赋选三张", () => {
  it("必须选满才可开始；可以取消；选满后其余不可再点", async () => {
    await mount(seededStorage(7));
    const view = setupView(newRun(7));
    expect(view.pickCount).toBe(3);
    const cards = talentButtons();
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual(view.draw.map((talent) => `talent-${talent.id}`));
    for (const talent of view.draw) {
      const card = screen.getByTestId(`talent-${talent.id}`);
      expect(card.textContent).toContain(talent.name);
      expect(card.textContent).toContain(talent.text);
      expect(card.querySelector(".rarity")?.textContent).toBe(talent.rarity);
      expect(card.getAttribute("aria-pressed")).toBe("false");
    }
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 0 / 3");
    expect(startButton().disabled).toBe(true);

    const ids = view.draw.map((talent) => `talent-${talent.id}`);
    await click(ids[0]);
    await click(ids[1]);
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 2 / 3");
    expect(startButton().disabled).toBe(true);
    await click(ids[2]);
    expect(screen.getByTestId(ids[2]).getAttribute("aria-pressed")).toBe("true");
    expect(startButton().disabled).toBe(false);
    // 选满之后，第四张点不了。
    expect((screen.getByTestId(ids[3]) as HTMLButtonElement).disabled).toBe(true);
    await click(ids[3]);
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 3 / 3");

    // 取消一张：回到不可开始，其余重新可点；换一张再开始。
    await click(ids[1]);
    expect(screen.getByTestId(ids[1]).getAttribute("aria-pressed")).toBe("false");
    expect(startButton().disabled).toBe(true);
    expect((screen.getByTestId(ids[3]) as HTMLButtonElement).disabled).toBe(false);
    expect(revision()).toBe(0);
    await click(ids[3]);
    await click("start");
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    expect(screen.getByTestId("stat-money")).toBeTruthy();
  });

  it("同一个种子得到相同的出身与十张天赋；换一批得到新的一局", async () => {
    const readSetup = async () => {
      const view = await mount(createMemoryStorage());
      fireEvent.click(screen.getByTestId("seed-toggle"));
      fireEvent.change(screen.getByTestId("seed-input"), { target: { value: "42" } });
      await click("seed-apply");
      expect(app().getAttribute("data-seed")).toBe("42");
      const snapshot = {
        origin: screen.getByTestId("origin-card").textContent,
        talents: talentButtons().map((card) => card.textContent),
      };
      view.unmount();
      return snapshot;
    };
    const first = await readSetup();
    const second = await readSetup();
    expect(second).toEqual(first);
    expect(first.talents.length).toBe(10);
    // docs/09 第 4 节：seed 42 的基础申请准备度是 65。
    expect(first.origin).toContain("申请准备度 65");

    // 开局阶段的“换一批”不需要确认。
    await mount(seededStorage(42));
    const runId = app().getAttribute("data-run-id");
    await click("restart");
    expect(screen.queryByTestId("restart-confirm")).toBeNull();
    expect(phase()).toBe("SETUP");
    expect(app().getAttribute("data-run-id")).not.toBe(runId);
  });

  it("不合法的种子不会开新局", async () => {
    await mount(seededStorage(5));
    fireEvent.change(screen.getByTestId("seed-input"), { target: { value: "4294967296" } });
    await click("seed-apply");
    expect(screen.getByRole("alert").textContent).toContain("0 到 4294967295");
    expect(app().getAttribute("data-seed")).toBe("5");
  });

  it("天赋池里的稀有度都有对应的样式类", () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(TALENTS.map((talent) => talent.rarity))).toEqual(new Set(["N", "R", "SR", "SSR"]));
  });
});

describe("资金不足", () => {
  // 专挑花钱选项的打法下，途中至少出现一次“选项因资金不足不可选”的第一个种子。
  const sawUnavailable = (state: RunState): boolean => {
    if (state.phase === "FOCUS") return focusView(state)?.options.some((option) => !option.available) ?? false;
    if (state.phase === "CORE_EVENT" || state.phase === "ARC_EVENT") {
      return currentEvent(state)?.choices.some((item) => !item.available) ?? false;
    }
    return false;
  };
  const brokeSeed = () =>
    findSeed((candidate) => {
      let seen = false;
      simulate(candidate, brokePolicy, (state) => {
        seen = seen || sawUnavailable(state);
        return state.phase === "GRAD_PREVIEW";
      });
      return seen;
    });

  it("不可选的选项被禁用并写明差额；每一屏始终有能点的选项；资金见底也能走到毕业", async () => {
    const storage = seededStorage(brokeSeed());
    await mount(storage);
    let checked = 0;
    let shortfallSeen = false;
    await advanceUntil(storage, brokePolicy, newTrail(), () => phase() === "GRAD_PREVIEW", (state) => {
      if (state.phase === "SETUP") return;
      const buttons = Array.from(
        app().querySelectorAll<HTMLButtonElement>("button[data-testid^='plan-'], button[data-testid^='choice-']"),
      );
      if (buttons.length > 0) expect(buttons.some((button) => !button.disabled)).toBe(true);
      for (const button of buttons.filter((item) => item.disabled)) {
        const id = (button.getAttribute("data-testid") ?? "").replace(/^(plan|choice)-/, "");
        const match = /^资金不足：需要 (\d+)，当前 (\d+)$/.exec(screen.getByTestId(`short-${id}`).textContent ?? "");
        expect(match).toBeTruthy();
        expect(Number(match?.[2])).toBe(stats().money);
        expect(Number(match?.[1])).toBeGreaterThan(stats().money);
        checked += 1;
      }
      // 上学期出现过短缺时，结算那一行会多一句说明。
      const ledger = termLedger(state);
      if (state.phase === "FOCUS" && ledger && ledger.shortfall > 0) {
        expect(screen.getByTestId("term-settlement").textContent).toContain(
          `资金短缺 ${ledger.shortfall}，身心多扣 ${ledger.stress}。`,
        );
        shortfallSeen = true;
      }
    });
    expect(checked).toBeGreaterThan(0);
    expect(shortfallSeen).toBe(true);
    expect(phase()).toBe("GRAD_PREVIEW");
  });
});

describe("目录与重新开始", () => {
  it("样本目录有明显提示", async () => {
    await mount(createMemoryStorage());
    expect(screen.getByTestId("sample-banner").textContent).toBe("样本目录（开发用，非正式学校数据）");
  });

  it("某个池不足 3 所时不允许开局，并说明是数据问题", async () => {
    await mount(createMemoryStorage(), makeSampleCatalog({ D: 2 }));
    const problem = screen.getByTestId("catalog-problem");
    expect(problem.textContent).toContain("学校数据暂不可用");
    expect(problem.textContent).toContain("D 档 2");
    expect(screen.queryByTestId("screen-setup")).toBeNull();
  });

  it("游戏进行中重新开始需要一次确认", async () => {
    const storage = seededStorage(5);
    await mount(storage);
    await step(storage, steadyPolicy, newTrail());
    const runId = app().getAttribute("data-run-id");
    await click("restart");
    expect(screen.getByTestId("restart-confirm")).toBeTruthy();
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    await click("restart-no");
    expect(screen.queryByTestId("restart-confirm")).toBeNull();
    expect(app().getAttribute("data-run-id")).toBe(runId);

    await click("restart");
    await click("restart-yes");
    expect(phase()).toBe("SETUP");
    expect(app().getAttribute("data-run-id")).not.toBe(runId);
  });
});

describe("留学人生图鉴", () => {
  it("结局后记录对应等级；刷新不重复计数；未解锁的隐藏结局不露名字", async () => {
    const storage = seededStorage(13);
    let view = await mount(storage);

    // 开局就能打开图鉴，此时全部未解锁。
    await click("open-gallery");
    expect(screen.getByTestId("screen-gallery")).toBeTruthy();
    for (const tier of ENDING_CARDS.tiers) {
      const item = screen.getByTestId(`gallery-tier-${tier.id}`);
      expect(item.getAttribute("data-unlocked")).toBe("false");
      expect(item.textContent).toContain(tier.name);
      expect(item.textContent).not.toContain(tier.roast);
    }
    for (const hidden of ENDING_CARDS.hidden) {
      const item = screen.getByTestId(`gallery-hidden-${hidden.id}`);
      expect(item.textContent).toContain("？？？");
      expect(item.textContent).not.toContain(hidden.name);
    }
    await click("close-gallery");
    expect(phase()).toBe("SETUP");

    await advanceUntil(storage, steadyPolicy, newTrail(), () => phase() === "ENDING");
    await flush();
    const tierId = screen.getByTestId("ending-card").getAttribute("data-tier") ?? "";
    const hiddenIds = Array.from(screen.getByTestId("ending-card").querySelectorAll("[data-testid^='card-hidden-']")).map(
      (node) => (node.getAttribute("data-testid") ?? "").replace("card-hidden-", ""),
    );

    const check = async (times: number) => {
      await click("open-gallery");
      const item = screen.getByTestId(`gallery-tier-${tierId}`);
      expect(item.getAttribute("data-unlocked")).toBe("true");
      expect(item.textContent).toContain(`解锁 ${times} 次 · 首次种子 13`);
      for (const id of hiddenIds) {
        expect(screen.getByTestId(`gallery-hidden-${id}`).getAttribute("data-unlocked")).toBe("true");
      }
      const unlocked = ENDING_CARDS.tiers.filter(
        (tier) => screen.getByTestId(`gallery-tier-${tier.id}`).getAttribute("data-unlocked") === "true",
      );
      expect(unlocked.map((tier) => tier.id)).toEqual([tierId]);
      await click("close-gallery");
    };
    await check(1);

    view.unmount();
    view = await mount(storage);
    expect(phase()).toBe("ENDING");
    await check(1);

    // 同一个种子再玩一局（新的 runId）到同一个结局，次数才会加一。
    await click("replay-seed");
    expect(phase()).toBe("SETUP");
    await advanceUntil(storage, steadyPolicy, newTrail(), () => phase() === "ENDING");
    await flush();
    expect(screen.getByTestId("ending-card").getAttribute("data-tier")).toBe(tierId);
    await check(2);
    view.unmount();
  });
});
