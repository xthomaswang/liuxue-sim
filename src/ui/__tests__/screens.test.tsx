// @vitest-environment jsdom
// 各界面的呈现约定：默认短文、展开不改状态、资金不足的选项、样本目录提示、种子、图鉴、重开确认。

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { createMemoryStorage } from "../../app/storage";
import { ENDING_CARDS, EVENT_BY_ID } from "../../content";
import {
  advanceUntil,
  click,
  flush,
  mount,
  newTrail,
  phase,
  revision,
  seed13Policy,
  seededStorage,
  spendthrift,
  stats,
  step,
} from "./harness";
import type { Policy } from "./harness";

afterEach(() => cleanup());

describe("默认短文与展开", () => {
  it("事件默认只显示 summary 与 shortResult；展开看长文不改变 revision", async () => {
    await mount(seededStorage(7));
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");

    const hs01 = EVENT_BY_ID.HS_01;
    expect(screen.getByTestId("event-summary").textContent).toBe(hs01.summary);
    expect(screen.queryByText(hs01.body)).toBeNull();
    const before = { revision: revision(), stats: stats() };
    await click("expand-story");
    expect(screen.getByText(hs01.body)).toBeTruthy();
    await click("expand-intro");
    expect(revision()).toBe(before.revision);
    expect(stats()).toEqual(before.stats);
    await click("expand-story");
    expect(screen.queryByText(hs01.body)).toBeNull();

    await click("choice-A");
    const choice = hs01.choices[0];
    const outcome = screen.getByTestId("last-outcome");
    expect(outcome.textContent).toContain(choice.shortResult);
    expect(outcome.textContent).not.toContain(choice.result);
    const afterChoice = revision();
    await click("expand-result");
    expect(screen.getByTestId("last-outcome").textContent).toContain(choice.result);
    expect(revision()).toBe(afterChoice);

    // HS_02 命中上一张事件的回响：默认只出短回响，长回响在展开区。
    const callback = EVENT_BY_ID.HS_02.callbacks.find((item) => item.ifFlag === "HS_01_A");
    expect(screen.getByText(callback?.shortText ?? "?")).toBeTruthy();
    expect(screen.queryByText(callback?.text ?? "?")).toBeNull();
    await click("expand-story");
    expect(screen.getByText(callback?.text ?? "?")).toBeTruthy();
    expect(revision()).toBe(afterChoice);
  });

  it("实际变化用截断后的值显示：选项预览与结算后的属性一致", async () => {
    await mount(seededStorage(7));
    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    const before = stats();
    const preview = screen.getByTestId("choice-A").querySelector("[data-stat='academics']")?.textContent ?? "";
    const expected = Number(/[+-]\d+/.exec(preview)?.[0]);
    await click("choice-A");
    expect(stats().academics - before.academics).toBe(expected);
  });
});

describe("资金不足的选项", () => {
  it("被禁用并写明差额，而且每张事件始终有能点的选项", async () => {
    const policy: Policy = { economy: "LOW", aspiration: "BELONGING", focus: () => "STUDY", choice: spendthrift };
    await mount(seededStorage(13));
    const trail = newTrail();
    let checked = 0;
    await advanceUntil(policy, trail, () => {
      if (["CORE_EVENT", "ARC_EVENT"].includes(phase())) {
        for (const id of ["A", "B"]) {
          const button = screen.getByTestId(`choice-${id}`) as HTMLButtonElement;
          if (button.disabled) {
            const note = screen.getByTestId(`short-${id}`).textContent ?? "";
            const match = /^需要 (\d+)，当前 (\d+)$/.exec(note);
            expect(match).toBeTruthy();
            expect(Number(match?.[2])).toBe(stats().money);
            expect(Number(match?.[1])).toBeGreaterThan(stats().money);
            checked += 1;
          }
        }
      }
      return phase() === "GRAD_PREVIEW";
    });
    expect(checked).toBeGreaterThan(0);
    expect(trail.disabledSeen.length).toBeGreaterThan(0);
    // 资金见底也照常走到毕业。
    expect(phase()).toBe("GRAD_PREVIEW");
  });

  it("期末资金短缺时，学期小结写明短缺与额外的身心消耗", async () => {
    const policy: Policy = { economy: "LOW", aspiration: "BELONGING", focus: () => "STUDY", choice: spendthrift };
    await mount(seededStorage(13));
    const trail = newTrail();
    let seen = false;
    await advanceUntil(policy, trail, () => {
      if (phase() === "TERM_REVIEW" && screen.queryByTestId("shortfall-note")) {
        expect(screen.getByTestId("shortfall-note").textContent).toMatch(/^资金短缺 \d+：.*身心额外 -\d+。$/);
        expect(stats().money).toBe(0);
        seen = true;
      }
      return seen || phase() === "GRAD_PREVIEW";
    });
    expect(seen).toBe(true);
  });
});

describe("开局、目录与种子", () => {
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

  it("指定同一个种子，得到相同的三张家庭卡与申请准备度", async () => {
    const readSetup = async () => {
      const view = await mount(createMemoryStorage());
      await click("seed-toggle");
      fireEvent.change(screen.getByTestId("seed-input"), { target: { value: "42" } });
      await click("seed-apply");
      expect(screen.getByTestId("app").getAttribute("data-seed")).toBe("42");
      const snapshot = {
        readiness: screen.getByTestId("base-readiness").textContent,
        cards: ["LOW", "MID", "HIGH"].map((economy) => screen.getByTestId(`family-card-${economy}`).textContent),
      };
      view.unmount();
      return snapshot;
    };
    const first = await readSetup();
    const second = await readSetup();
    expect(second).toEqual(first);
    // docs/09 第 4 节：seed 42 的基础申请准备度是 65。
    expect(first.readiness).toBe("申请准备度 65");
  });

  it("不合法的种子不会开新局", async () => {
    await mount(seededStorage(5));
    await click("seed-toggle");
    fireEvent.change(screen.getByTestId("seed-input"), { target: { value: "4294967296" } });
    await click("seed-apply");
    expect(screen.getByRole("alert").textContent).toContain("0 到 4294967295");
    expect(screen.getByTestId("app").getAttribute("data-seed")).toBe("5");
  });

  it("开局页不显示四属性；未选家庭与愿望时不能开始", async () => {
    await mount(seededStorage(5));
    expect(screen.queryByTestId("stat-money")).toBeNull();
    expect((screen.getByTestId("start") as HTMLButtonElement).disabled).toBe(true);
    await click("family-LOW");
    expect((screen.getByTestId("start") as HTMLButtonElement).disabled).toBe(true);
    await click("aspiration-BELONGING");
    expect((screen.getByTestId("start") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId("name-input"), { target: { value: "  阿树  " } });
    await click("start");
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    expect(stats().money).toBe(28);
  });
});

describe("重新开始", () => {
  it("游戏进行中需要一次确认；开局页直接换一局", async () => {
    await mount(seededStorage(5));
    const firstRun = screen.getByTestId("app").getAttribute("data-run-id");
    await click("restart");
    expect(screen.queryByTestId("restart-confirm")).toBeNull();
    const secondRun = screen.getByTestId("app").getAttribute("data-run-id");
    expect(secondRun).not.toBe(firstRun);

    await click("family-MID");
    await click("aspiration-DISCOVERY");
    await click("start");
    await click("restart");
    expect(screen.getByTestId("restart-confirm")).toBeTruthy();
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    await click("restart-no");
    expect(screen.queryByTestId("restart-confirm")).toBeNull();
    expect(screen.getByTestId("app").getAttribute("data-run-id")).toBe(secondRun);

    await click("restart");
    await click("restart-yes");
    expect(phase()).toBe("SETUP");
    expect(screen.getByTestId("app").getAttribute("data-run-id")).not.toBe(secondRun);
  });
});

describe("留学人生图鉴", () => {
  it("结局后记录对应等级；刷新不重复计数；未解锁的隐藏结局不露名字", async () => {
    const storage = seededStorage(13);
    let view = await mount(storage);
    const trail = newTrail();

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

    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    await click("route-PHD");
    await flush();
    const tierId = screen.getByTestId("ending-card").getAttribute("data-tier") ?? "";
    const hiddenIds = Array.from(screen.getByTestId("ending-card").querySelectorAll("[data-testid^='card-hidden-']")).map(
      (node) => (node.getAttribute("data-testid") ?? "").replace("card-hidden-", ""),
    );

    const check = async () => {
      await click("open-gallery");
      const item = screen.getByTestId(`gallery-tier-${tierId}`);
      expect(item.getAttribute("data-unlocked")).toBe("true");
      expect(item.textContent).toContain("解锁 1 次 · 首次种子 13");
      for (const id of hiddenIds) {
        expect(screen.getByTestId(`gallery-hidden-${id}`).getAttribute("data-unlocked")).toBe("true");
      }
      const unlockedTiers = ENDING_CARDS.tiers.filter(
        (tier) => screen.getByTestId(`gallery-tier-${tier.id}`).getAttribute("data-unlocked") === "true",
      );
      expect(unlockedTiers.map((tier) => tier.id)).toEqual([tierId]);
      await click("close-gallery");
    };
    await check();

    view.unmount();
    view = await mount(storage);
    expect(phase()).toBe("ENDING");
    await check();

    // 再玩一局（新 runId）到同一个结局，次数才会加一。
    await click("replay-seed");
    expect(phase()).toBe("SETUP");
    const again = newTrail();
    await step(seed13Policy, again);
    await advanceUntil(seed13Policy, again, () => phase() === "GRAD_RESULTS");
    await click("route-PHD");
    await flush();
    await click("open-gallery");
    expect(screen.getByTestId(`gallery-tier-${tierId}`).textContent).toContain("解锁 2 次 · 首次种子 13");
    view.unmount();
  });
});
