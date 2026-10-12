// @vitest-environment jsdom
// 整套流程：首页 → 选三张天赋 → 分点 → 人生轨迹逐段显示 → 人生总结。玩家只在开局两步做选择。

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENDING_CARDS } from "../../content";
import { setupView, startPreview, timeline } from "../../engine";
import {
  allocateEvenly,
  app,
  click,
  counters,
  createMemoryStorage,
  defaultStart,
  findSeed,
  flush,
  headless,
  mount,
  openSeed,
  phase,
  pickTalents,
  playToSummary,
  playToTimeline,
  pointsLeft,
  savedEnding,
  savedProgress,
  savedReveal,
  shownEntries,
  stats,
  talentIds,
} from "./harness";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const CHOICE_CONTROLS =
  "[data-testid^='choice-'], [data-testid^='plan-'], [data-testid^='offer-'], [data-testid^='route-'], [data-testid^='masters-'], [aria-expanded], select";

/** 人生轨迹这一屏除了“继续 / 自动播放 / 直接看结局 / 人生总结”之外没有别的控件。 */
function expectOnlyTimelineControls() {
  expect(app().querySelectorAll(CHOICE_CONTROLS).length).toBe(0);
  const ids = Array.from(app().querySelectorAll("main button, main input")).map((node) => node.getAttribute("data-testid"));
  for (const id of ids) expect(["reveal-next", "auto-play", "skip-to-end", "to-summary"]).toContain(id);
}

describe("整套流程", () => {
  it("首页 → 选三张 → 分点 → 轨迹逐段显示 → 总结", async () => {
    const seed = 7;
    const storage = createMemoryStorage();
    await mount(storage);
    const expected = defaultStart(seed);
    const view = setupView(expected.setup);

    // 首页
    expect(phase()).toBe("HOME");
    expect(screen.getByTestId("screen-home")).toBeTruthy();
    expect(screen.getByTestId("stage-title").textContent).toBe("留学人生模拟器");
    expect(screen.getByTestId("start-run").textContent).toBe("立即重开");
    expect(screen.queryByTestId("continue-run")).toBeNull();
    expect(screen.getByTestId("sample-banner")).toBeTruthy();
    counters.clicks = 0;
    await openSeed(seed);

    // 天赋：十张各占一行，选满三张才能下一步
    expect(screen.getByTestId("screen-talents")).toBeTruthy();
    expect(talentIds()).toEqual(view.draw.map((talent) => talent.id));
    expect(talentIds().length).toBe(10);
    for (const talent of view.draw) {
      const row = screen.getByTestId(`talent-${talent.id}`);
      expect(row.textContent).toContain(talent.name);
      expect(row.textContent).toContain(talent.text);
      expect(row.querySelector(".rarity")?.textContent).toBe(talent.rarity);
      expect(row.className).toContain(`rarity-row-${talent.rarity}`);
      expect(row.getAttribute("aria-pressed")).toBe("false");
    }
    const next = () => screen.getByTestId("to-allocate") as HTMLButtonElement;
    const ids = talentIds();
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 0 / 3");
    expect(next().disabled).toBe(true);
    await click(`talent-${ids[0]}`);
    await click(`talent-${ids[1]}`);
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 2 / 3");
    expect(next().disabled).toBe(true);
    await click(`talent-${ids[2]}`);
    expect(screen.getByTestId(`talent-${ids[2]}`).getAttribute("aria-pressed")).toBe("true");
    expect(next().disabled).toBe(false);
    // 第四张点了也不算。
    await click(`talent-${ids[3]}`);
    expect(screen.getByTestId(`talent-${ids[3]}`).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("talent-count").textContent).toBe("已选 3 / 3");
    // 取消一张就不能前进，再选回来。
    await click(`talent-${ids[2]}`);
    expect(next().disabled).toBe(true);
    await click(`talent-${ids[2]}`);
    await click("to-allocate");

    // 分点：点数没分完不能开始
    expect(phase()).toBe("ALLOCATE");
    const begin = () => screen.getByTestId("begin-life") as HTMLButtonElement;
    const budget = startPreview(expected.setup, expected.talents, { family: 0, academics: 0, career: 0, wellbeing: 0 }).pointBudget;
    expect(pointsLeft()).toBe(budget);
    expect(begin().disabled).toBe(true);
    for (const key of ["family", "academics", "career", "wellbeing"]) {
      expect((screen.getByTestId(`point-minus-${key}`) as HTMLButtonElement).disabled).toBe(true);
    }
    const points = await allocateEvenly();
    expect(points).toEqual(expected.points);
    expect(pointsLeft()).toBe(0);
    expect(begin().disabled).toBe(false);
    for (const key of ["family", "academics", "career", "wellbeing"]) {
      expect((screen.getByTestId(`point-plus-${key}`) as HTMLButtonElement).disabled).toBe(true);
    }
    // 实时预览与引擎算的一致。
    const preview = startPreview(expected.setup, expected.talents, expected.points);
    expect(screen.getByTestId("preview-money").textContent).toBe(`资金 ${preview.stats.money}`);
    expect(screen.getByTestId("preview-wellbeing").textContent).toBe(`身心 ${preview.stats.wellbeing}`);
    expect(screen.getByTestId("start-preview").textContent).toContain(`每学期资助 ${preview.stipend}`);
    expect(screen.getByTestId("start-preview").textContent).toContain(`申请准备度 ${preview.readiness}`);
    // 少分一点就不能开始。
    await click("point-minus-family");
    expect(pointsLeft()).toBe(1);
    expect(begin().disabled).toBe(true);
    await click("point-plus-family");
    await click("begin-life");

    // 人生轨迹：整局已经算完，和不经过界面直接算的是同一局
    expect(phase()).toBe("TIMELINE");
    const ending = savedEnding(storage);
    expect(ending.ending?.card.combo).toBe(headless(seed).state.ending?.card.combo);
    const entries = timeline(ending);
    expect(entries.length).toBeGreaterThan(3);
    expect(screen.getByTestId("timeline").getAttribute("data-shown")).toBe("0");
    expect(shownEntries()).toEqual([]);
    expect(stats()).toEqual(preview.stats);
    expectOnlyTimelineControls();
    for (let index = 0; index < entries.length; index++) {
      expect(screen.queryByTestId("to-summary")).toBeNull();
      await click("reveal-next");
      const entry = entries[index];
      expect(shownEntries()).toEqual(entries.slice(0, index + 1).map((item) => item.id));
      const node = screen.getByTestId(`timeline-entry-${entry.id}`);
      expect(node.textContent).toContain(entry.label);
      for (const line of entry.lines) expect(node.textContent).toContain(line.text);
      expect(stats()).toEqual(entry.statsAfter);
      expect(savedReveal(storage).shown).toBe(index + 1);
      expectOnlyTimelineControls();
    }
    expect(screen.queryByTestId("reveal-next")).toBeNull();
    expect(screen.queryByTestId("auto-play")).toBeNull();
    expect(savedProgress(storage).runs).toBe(0);
    await click("to-summary");
    const pathClicks = counters.clicks;

    // 人生总结
    expect(phase()).toBe("SUMMARY");
    const card = ending.ending?.card;
    expect(screen.getByTestId("ending-title").textContent?.length).toBeGreaterThan(0);
    expect(screen.getByTestId("ending-label").textContent?.length).toBeGreaterThan(0);
    expect(screen.getByTestId("ending-card").getAttribute("data-tier")).toBe(card?.tier);
    expect(screen.getByTestId("card-combo").textContent).toBe(card?.combo);
    expect(screen.getByTestId("ending-card").textContent).toContain(ENDING_CARDS.disclaimer);
    expect(screen.getByTestId("ending-epilogue").textContent?.length).toBeGreaterThan(5);
    expect(screen.getByTestId("final-money").textContent).toContain(String(ending.stats.money));
    expect(screen.getByTestId("summary-talents").querySelectorAll(".rarity").length).toBe(3);
    if (card?.flavor) expect(screen.getByTestId("ending-flavor").textContent).toBe(card.flavor.name);
    if (card?.early) expect(screen.getByTestId("ending-early").textContent).toBe(card.name);
    expect(app().querySelectorAll(CHOICE_CONTROLS).length).toBe(0);
    // 本局收获与直接用引擎判定的一致。
    const rewards = headless(seed).rewards;
    expect(rewards.achievements.length).toBeGreaterThan(0);
    for (const id of rewards.achievements) expect(screen.getByTestId(`reward-achievement-${id}`)).toBeTruthy();
    expect(screen.getByTestId("rewards").querySelectorAll("[data-testid^='reward-achievement-']").length).toBe(rewards.achievements.length);
    expect(screen.queryByTestId("reward-talent") !== null).toBe(rewards.unlockedTalent !== null);
    expect(savedProgress(storage).runs).toBe(1);

    // 种子 1 次 + 天赋 3 次（外加上面多点的 3 次）+ 下一步 + 分点 + 开始 + 每段一次“继续” + 人生总结。
    console.info(
      `一局的点击次数（seed ${seed}，逐段点继续）：${pathClicks}；其中分点 ${budget + 2} 次、轨迹 ${entries.length} 段。` +
        `最少路径（随机分配 + 直接看结局）：1 + 3 + 1 + 1 + 1 + 1 + 1 = 9 次。`,
    );

    // 再次重开：直接进入新一局的天赋屏。
    await click("play-again");
    expect(phase()).toBe("TALENTS");
    expect(app().getAttribute("data-run-id")).not.toBe(ending.runId);
  });

  it("最少路径：随机分配 + 直接看结局，一共 9 次点击", async () => {
    const storage = createMemoryStorage();
    await mount(storage);
    counters.clicks = 0;
    await click("start-run");
    for (const id of talentIds().slice(0, 3)) await click(`talent-${id}`);
    await click("to-allocate");
    await click("random-allocate");
    expect(pointsLeft()).toBe(0);
    await click("begin-life");
    await click("skip-to-end");
    await click("to-summary");
    expect(phase()).toBe("SUMMARY");
    expect(counters.clicks).toBe(9);
  });
});

describe("人生轨迹的三种看法", () => {
  it("直接看结局：一次显示全部，出现“人生总结”", async () => {
    const storage = createMemoryStorage();
    await mount(storage);
    await playToTimeline(11);
    const entries = timeline(savedEnding(storage));
    await click("reveal-next");
    expect(shownEntries().length).toBe(1);
    await click("skip-to-end");
    expect(shownEntries()).toEqual(entries.map((entry) => entry.id));
    expect(stats()).toEqual(entries[entries.length - 1].statsAfter);
    expect(screen.getByTestId("to-summary")).toBeTruthy();
    expect(screen.queryByTestId("skip-to-end")).toBeNull();
    expect(savedReveal(storage).shown).toBe(entries.length);
  });

  it("点列表区域也能显示下一段", async () => {
    const storage = createMemoryStorage();
    await mount(storage);
    await playToTimeline(11);
    await click("timeline");
    await click("timeline");
    expect(shownEntries().length).toBe(2);
  });

  it("自动播放：每隔一会儿显示下一段，可以暂停，到结尾自己停下", async () => {
    const storage = createMemoryStorage();
    await mount(storage);
    await playToTimeline(11);
    const total = timeline(savedEnding(storage)).length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tick = async (ms: number) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
      await flush();
    };

    await click("auto-play");
    expect(screen.getByTestId("auto-play").textContent).toBe("暂停");
    expect(shownEntries().length).toBe(0);
    await tick(800);
    expect(shownEntries().length).toBe(1);
    await tick(800);
    expect(shownEntries().length).toBe(2);

    // 暂停后不再前进。
    await click("auto-play");
    expect(screen.getByTestId("auto-play").textContent).toBe("自动播放");
    await tick(5000);
    expect(shownEntries().length).toBe(2);

    // 继续播放直到结尾。
    await click("auto-play");
    for (let i = 0; i < total; i++) await tick(800);
    expect(shownEntries().length).toBe(total);
    expect(screen.getByTestId("to-summary")).toBeTruthy();
    await tick(5000);
    expect(shownEntries().length).toBe(total);
  });
});

describe("刷新后回到同一局、同一进度", () => {
  it("在轨迹中途刷新：同样的几段、同样的属性，不重新模拟", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await playToTimeline(21);
    await click("reveal-next");
    await click("reveal-next");
    await click("reveal-next");
    const before = { phase: phase(), runId: app().getAttribute("data-run-id"), entries: shownEntries(), stats: stats(), text: app().querySelector("main")?.textContent };
    const saved = storage.dump();
    view.unmount();
    view = await mount(storage);
    expect({ phase: phase(), runId: app().getAttribute("data-run-id"), entries: shownEntries(), stats: stats(), text: app().querySelector("main")?.textContent }).toEqual(before);
    expect(phase()).toBe("TIMELINE");
    expect(shownEntries().length).toBe(3);
    expect(storage.dump()).toEqual(saved);
    // 还没看总结：不结算。
    expect(savedProgress(storage).runs).toBe(0);
    await click("reveal-next");
    expect(shownEntries().length).toBe(4);
    view.unmount();
  });

  it("在总结页刷新：同一张结局卡、同样的本局收获，不重复结算", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await playToSummary(21);
    const read = () => ({
      phase: phase(),
      runId: app().getAttribute("data-run-id"),
      combo: screen.getByTestId("card-combo").textContent,
      rewards: screen.getByTestId("rewards").textContent,
      text: app().querySelector("main")?.textContent,
    });
    const before = read();
    const progress = savedProgress(storage);
    expect(progress.runs).toBe(1);
    const saved = storage.dump();

    view.unmount();
    view = await mount(storage);
    expect(read()).toEqual(before);
    expect(storage.dump()).toEqual(saved);

    // 回首页再回来看，也不会再算一次。
    await click("go-home");
    expect(phase()).toBe("HOME");
    expect(screen.queryByTestId("continue-run")).toBeNull();
    await click("view-last");
    expect(read()).toEqual(before);
    expect(savedProgress(storage)).toEqual(progress);
    view.unmount();
  });

  it("停在天赋或分点时刷新：回到首页，“继续上次”还是同一局的十张", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await openSeed(33);
    const ids = talentIds();
    await pickTalents();
    view.unmount();
    view = await mount(storage);
    expect(phase()).toBe("HOME");
    await click("continue-run");
    expect(phase()).toBe("TALENTS");
    expect(app().getAttribute("data-seed")).toBe("33");
    expect(talentIds()).toEqual(ids);
    view.unmount();
  });
});

describe("两类结局的总结页", () => {
  it("毕业结局：去向结局是最醒目的一行，下面有三路机会；中途结局：用它自己的名称，没有机会列表", async () => {
    const graduation = findSeed((seed) => headless(seed).state.ending?.card.early === null);
    const early = findSeed((seed) => headless(seed).state.ending?.card.early !== null, 1, 3000);

    const storage = createMemoryStorage();
    const view = await mount(storage);
    await playToSummary(graduation);
    const card = savedEnding(storage).ending?.card;
    expect(card?.flavor).toBeTruthy();
    expect(screen.getByTestId("ending-flavor").textContent).toBe(card?.flavor?.name);
    expect(app().textContent).toContain(card?.flavor?.roast ?? "?");
    expect(screen.getByTestId("ending-card").hasAttribute("data-early")).toBe(false);
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) expect(screen.getByTestId(`opportunity-${id}`)).toBeTruthy();
    expect(savedProgress(storage).flavors[card?.flavor?.id ?? ""]?.count).toBe(1);

    await click("go-home");
    await playToSummary(early);
    const earlyCard = savedEnding(storage).ending?.card;
    expect(earlyCard?.early).toBeTruthy();
    expect(screen.getByTestId("ending-early").textContent).toBe(earlyCard?.name);
    expect(screen.queryByTestId("ending-flavor")).toBeNull();
    expect(screen.getByTestId("ending-card").getAttribute("data-early")).toBe(earlyCard?.early);
    expect(screen.queryByTestId("opportunity-PHD")).toBeNull();
    // 中途结局记入“中途结局”一栏，同时也算解锁了对应的主线等级。
    const progress = savedProgress(storage);
    expect(progress.early[earlyCard?.early ?? ""]?.count).toBe(1);
    expect(progress.tiers[earlyCard?.tier ?? ""]?.count).toBeGreaterThanOrEqual(1);
    expect(progress.runs).toBe(2);
    view.unmount();
  });
});
