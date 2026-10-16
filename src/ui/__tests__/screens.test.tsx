// @vitest-environment jsdom
// 各屏的呈现约定：分点的限制与随机分配、图册三块、目录与种子。

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { ACHIEVEMENTS, EARLY_ENDINGS, ENDING_CARDS, ENDING_FLAVORS, TALENTS } from "../../content";
import { setupView, startPreview, summaryView } from "../../engine";
import { LIFE_TRACK_LIST } from "../lifeTracks";
import {
  POINT_KEYS,
  ZERO_POINTS,
  app,
  click,
  createMemoryStorage,
  defaultStart,
  mount,
  openSeed,
  phase,
  pickTalents,
  playToSummary,
  pointValues,
  pointsLeft,
  savedEnding,
  talentIds,
} from "./harness";

afterEach(() => cleanup());

const button = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

describe("分点", () => {
  it("每项 0 到上限，总和不能超过可分配点数；点数用完才能开始", async () => {
    const seed = 12;
    const start = defaultStart(seed);
    const view = setupView(start.setup);
    const budget = startPreview(start.setup, start.talents, ZERO_POINTS).pointBudget;
    await mount(createMemoryStorage());
    await openSeed(seed);
    await pickTalents();

    expect(pointsLeft()).toBe(budget);
    expect(pointValues()).toEqual(ZERO_POINTS);
    // 一项加到上限就不能再加。
    for (let i = 0; i < view.pointMax; i++) await click("point-plus-family");
    expect(pointValues().family).toBe(view.pointMax);
    expect(button("point-plus-family").disabled).toBe(true);
    expect(button("begin-life").disabled).toBe(true);
    // 预览跟着变：家境决定开局资金与资助。
    const preview = startPreview(start.setup, start.talents, { ...ZERO_POINTS, family: view.pointMax });
    expect(screen.getByTestId("preview-money").textContent).toBe(`资金 ${preview.stats.money}`);
    expect(screen.getByTestId("start-preview").textContent).toContain(`每学期资助 ${preview.stipend}`);
    // 把剩下的点数加完：之后所有 ＋ 都不能点。
    let guard = 0;
    while (pointsLeft() > 0 && guard++ < 100) {
      const key = POINT_KEYS.find((candidate) => !button(`point-plus-${candidate}`).disabled);
      await click(`point-plus-${key}`);
    }
    expect(pointsLeft()).toBe(0);
    for (const key of POINT_KEYS) expect(button(`point-plus-${key}`).disabled).toBe(true);
    expect(button("begin-life").disabled).toBe(false);
    const total = POINT_KEYS.reduce((sum, key) => sum + pointValues()[key], 0);
    expect(total).toBe(budget);
  });

  it("随机分配：每次都把点数分完，且每项不超过上限", async () => {
    const seed = 12;
    const start = defaultStart(seed);
    const view = setupView(start.setup);
    const budget = startPreview(start.setup, start.talents, ZERO_POINTS).pointBudget;
    await mount(createMemoryStorage());
    await openSeed(seed);
    await pickTalents();
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await click("random-allocate");
      const values = pointValues();
      expect(pointsLeft()).toBe(0);
      expect(POINT_KEYS.reduce((sum, key) => sum + values[key], 0)).toBe(budget);
      for (const key of POINT_KEYS) {
        expect(values[key]).toBeGreaterThanOrEqual(0);
        expect(values[key]).toBeLessThanOrEqual(view.pointMax);
      }
      expect(button("begin-life").disabled).toBe(false);
      seen.add(JSON.stringify(values));
    }
    // 确实是随机的：十二次里不会次次一样。
    expect(seen.size).toBeGreaterThan(1);
    await click("begin-life");
    expect(phase()).toBe("TIMELINE");
  });

  it("可以返回重选天赋，回来时保留刚才选的三张", async () => {
    await mount(createMemoryStorage());
    await openSeed(12);
    const chosen = await pickTalents();
    await click("back-to-talents");
    expect(phase()).toBe("TALENTS");
    for (const id of talentIds()) {
      expect(screen.getByTestId(`talent-${id}`).getAttribute("aria-pressed")).toBe(String(chosen.includes(id)));
    }
    expect(button("to-allocate").disabled).toBe(false);
  });

  it("抽出来的家庭期待与愿望显示在分点屏", async () => {
    await mount(createMemoryStorage());
    await openSeed(12);
    await pickTalents();
    const text = screen.getByTestId("start-preview").textContent ?? "";
    expect(text).toContain("家里：");
    expect(text).toContain("愿望：");
  });
});

describe("图册", () => {
  it("三块：结局、成就、天赋；顶部是总进度", async () => {
    const storage = createMemoryStorage();
    const view = await mount(storage);
    await click("open-gallery");
    expect(screen.getByTestId("screen-gallery")).toBeTruthy();
    expect(screen.getByTestId("stage-title").textContent).toBe("图册");
    const locked = TALENTS.filter((talent) => talent.locked);
    const outcomes = LIFE_TRACK_LIST.flatMap((track) => track.outcomes);
    const endingTotal =
      ENDING_CARDS.tiers.length + ENDING_CARDS.hidden.length + EARLY_ENDINGS.length + ENDING_FLAVORS.length + outcomes.length;
    expect(screen.getByTestId("gallery-progress").textContent).toContain(
      `成就 0 / ${ACHIEVEMENTS.length} · 天赋 ${TALENTS.length - locked.length} / ${TALENTS.length} · 结局 0 / ${endingTotal}`,
    );

    // 结局：未解锁的主线等级显示名称但不显示吐槽；隐藏、中途、去向结局不露名字，只给提示。
    for (const tier of ENDING_CARDS.tiers) {
      const item = screen.getByTestId(`gallery-tier-${tier.id}`);
      expect(item.getAttribute("data-unlocked")).toBe("false");
      expect(item.textContent).toContain(tier.name);
      expect(item.textContent).not.toContain(tier.roast);
    }
    for (const list of [
      { prefix: "gallery-hidden-", items: ENDING_CARDS.hidden },
      { prefix: "gallery-early-", items: EARLY_ENDINGS },
      { prefix: "gallery-flavor-", items: ENDING_FLAVORS },
      { prefix: "gallery-outcome-", items: outcomes },
    ]) {
      for (const entry of list.items) {
        const item = screen.getByTestId(`${list.prefix}${entry.id}`);
        expect(item.getAttribute("data-unlocked")).toBe("false");
        expect(item.textContent).toContain("？？？");
        expect(item.textContent).toContain(entry.hint);
        expect(item.textContent).not.toContain(entry.name);
      }
    }
    // 五年后：按轨道分组，组名是轨道名。
    for (const track of LIFE_TRACK_LIST) {
      const group = screen.getByTestId(`gallery-track-${track.track}`);
      expect(group.querySelector(".group-heading")?.textContent).toContain(track.name);
      expect(group.querySelector(".group-heading")?.textContent).toContain(`0 / ${track.outcomes.length}`);
      expect(group.querySelectorAll("[data-testid^='gallery-outcome-']").length).toBe(track.outcomes.length);
    }
    expect(screen.getByTestId("jump-gallery-outcomes")).toBeTruthy();
    // 成就是公开目标：没达成也显示名称与说明。
    for (const achievement of ACHIEVEMENTS) {
      const item = screen.getByTestId(`gallery-achievement-${achievement.id}`);
      expect(item.getAttribute("data-unlocked")).toBe("false");
      expect(item.textContent).toContain(achievement.name);
      expect(item.textContent).toContain(achievement.text);
      expect(item.textContent).toContain("未达成");
    }
    // 天赋：全部列出；锁定且未解锁的只显示稀有度与“未解锁”。
    expect(app().querySelectorAll("[data-testid^='gallery-talent-']").length).toBe(TALENTS.length);
    for (const talent of TALENTS) {
      const item = screen.getByTestId(`gallery-talent-${talent.id}`);
      expect(item.querySelector(".rarity")?.textContent).toBe(talent.rarity);
      if (talent.locked) {
        expect(item.textContent).toContain("未解锁");
        expect(item.textContent).not.toContain(talent.text);
      } else {
        expect(item.textContent).toContain(talent.name);
        expect(item.textContent).toContain(talent.text);
      }
    }
    await click("close-gallery");
    expect(phase()).toBe("HOME");

    // 玩一局之后：对应的等级与结局解锁，进度数字跟着变。
    await playToSummary(5);
    const card = savedEnding(storage).ending?.card;
    await click("open-gallery");
    const tierItem = screen.getByTestId(`gallery-tier-${card?.tier}`);
    expect(tierItem.getAttribute("data-unlocked")).toBe("true");
    expect(tierItem.textContent).toContain("1 次 · 首次种子 5");
    for (const hidden of card?.hidden ?? []) {
      expect(screen.getByTestId(`gallery-hidden-${hidden.id}`).textContent).toContain(hidden.name);
    }
    if (card?.flavor) expect(screen.getByTestId(`gallery-flavor-${card.flavor.id}`).textContent).toContain(card.flavor.name);
    if (card?.early) expect(screen.getByTestId(`gallery-early-${card.early}`).getAttribute("data-unlocked")).toBe("true");
    const life = summaryView(savedEnding(storage)).life;
    if (life) {
      const item = screen.getByTestId(`gallery-outcome-${life.outcome.id}`);
      expect(item.getAttribute("data-unlocked")).toBe("true");
      expect(item.textContent).toContain(life.outcome.name);
    }
    expect(screen.getByTestId("gallery-progress").textContent).not.toContain("结局 0 /");
    expect(screen.getByTestId("gallery-progress").textContent).not.toContain("成就 0 /");
    await click("close-gallery");
    expect(phase()).toBe("SUMMARY");
    view.unmount();
  });
});

describe("首页、目录与种子", () => {
  it("样本目录有明显提示", async () => {
    await mount(createMemoryStorage());
    expect(screen.getByTestId("sample-banner").textContent).toBe("样本目录（开发用，非正式学校数据）");
  });

  it("某个池不足 3 所时不允许开局，并说明是数据问题", async () => {
    await mount(createMemoryStorage(), makeSampleCatalog({ D: 2 }));
    const problem = screen.getByTestId("catalog-problem");
    expect(problem.textContent).toContain("学校数据暂不可用");
    expect(problem.textContent).toContain("D 档 2");
    expect(screen.queryByTestId("screen-home")).toBeNull();
  });

  it("同一个种子得到相同的十张天赋；不合法的种子不会开局", async () => {
    const read = async () => {
      const view = await mount(createMemoryStorage());
      await openSeed(42);
      const ids = talentIds();
      view.unmount();
      return ids;
    };
    expect(await read()).toEqual(await read());

    await mount(createMemoryStorage());
    fireEvent.change(screen.getByTestId("seed-input"), { target: { value: "4294967296" } });
    await click("seed-apply");
    expect(screen.getByRole("alert").textContent).toContain("0 到 4294967295");
    expect(phase()).toBe("HOME");
  });

  it("立即重开每次都是新的一局", async () => {
    await mount(createMemoryStorage());
    await click("start-run");
    const first = app().getAttribute("data-run-id");
    expect(phase()).toBe("TALENTS");
    await click("go-home");
    expect(screen.getByTestId("continue-run")).toBeTruthy();
    await click("start-run");
    expect(app().getAttribute("data-run-id")).not.toBe(first);
  });
});
