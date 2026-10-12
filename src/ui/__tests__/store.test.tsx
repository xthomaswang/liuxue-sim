// @vitest-environment jsdom
// 跨局进度与存档：结算幂等、成就与天赋解锁、继承天赋、存档问题、写入失败。

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_GALLERY_KEY, PROGRESS_KEY, SAVE_KEY } from "../../app/storage";
import type { SaveStorage } from "../../app/storage";
import { ACHIEVEMENTS, TALENTS } from "../../content";
import { loadSave, serializeSave } from "../../engine";
import {
  allocateEvenly,
  app,
  catalog,
  click,
  createMemoryStorage,
  findSeed,
  flush,
  headless,
  mount,
  newRun,
  openSeed,
  phase,
  pickTalents,
  playToSummary,
  savedEnding,
  savedProgress,
  savedState,
  talentIds,
  talentRows,
} from "./harness";

afterEach(() => cleanup());

const LOCKED = TALENTS.filter((talent) => talent.locked).map((talent) => talent.id);

describe("一局只结算一次", () => {
  it("到达总结时结算；刷新、回看都不重复计数，也不重复解锁", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await playToSummary(5);
    const ending = savedEnding(storage);
    const first = savedProgress(storage);
    expect(first.runs).toBe(1);
    expect(first.rewardedRuns).toEqual([ending.runId]);
    expect(first.tiers[ending.ending?.card.tier ?? ""]?.count).toBe(1);
    expect(first.lastRewards?.runId).toBe(ending.runId);
    // 结算结果与直接用引擎判定的一致。
    const expected = headless(5).rewards;
    expect(first.lastRewards?.achievements).toEqual(expected.achievements);
    expect(first.lastRewards?.unlockedTalent).toBe(expected.unlockedTalent);
    expect(Object.keys(first.achievements).sort()).toEqual([...expected.achievements].sort());

    for (let i = 0; i < 2; i++) {
      view.unmount();
      view = await mount(storage);
      expect(phase()).toBe("SUMMARY");
      expect(savedProgress(storage)).toEqual(first);
    }
    await click("go-home");
    await click("view-last");
    expect(savedProgress(storage)).toEqual(first);
    view.unmount();
  });

  it("同一局里已经得到的成就，下一局不再算成新成就", async () => {
    const storage = createMemoryStorage();
    const view = await mount(storage);
    await playToSummary(5);
    const first = savedProgress(storage);
    expect(first.achievements.A_FIRST).toBeTruthy();
    expect(screen.getByTestId("reward-achievement-A_FIRST")).toBeTruthy();

    await click("go-home");
    await playToSummary(6);
    const second = savedProgress(storage);
    expect(second.runs).toBe(2);
    expect(screen.queryByTestId("reward-achievement-A_FIRST")).toBeNull();
    expect(second.achievements.A_FIRST).toEqual(first.achievements.A_FIRST);
    // 第二局的收获按“结算前的进度”判定。
    const expected = headless(6, first).rewards;
    expect(second.lastRewards?.achievements).toEqual(expected.achievements);
    view.unmount();
  });

  it("连点“开始人生”只模拟一次", async () => {
    const storage = createMemoryStorage();
    await mount(storage);
    await openSeed(9);
    await pickTalents();
    await allocateEvenly();
    const button = screen.getByTestId("begin-life");
    await act(async () => {
      button.click();
      button.click();
    });
    await flush();
    expect(phase()).toBe("TIMELINE");
    expect(savedEnding(storage).ending?.card.combo).toBe(headless(9).state.ending?.card.combo);
  });
});

describe("成就、天赋解锁与图册", () => {
  it("锁定的天赋在解锁前不会出现在十连抽里", async () => {
    expect(LOCKED.length).toBeGreaterThan(0);
    const storage = createMemoryStorage();
    const view = await mount(storage);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await openSeed(seed);
      expect(talentIds().length).toBe(10);
      for (const id of talentIds()) expect(LOCKED).not.toContain(id);
      await click("go-home");
    }
    view.unmount();
  });

  it("新解锁的天赋显示在总结页、进入图册，并进入之后各局的天赋池", async () => {
    const seed = findSeed((candidate) => headless(candidate).rewards.unlockedTalent !== null);
    const unlocked = headless(seed).rewards.unlockedTalent as string;
    const talent = TALENTS.find((item) => item.id === unlocked);
    expect(talent?.locked).toBe(true);

    const storage = createMemoryStorage();
    const view = await mount(storage);
    await playToSummary(seed);
    const reward = screen.getByTestId("reward-talent");
    expect(reward.getAttribute("data-talent")).toBe(unlocked);
    expect(reward.textContent).toContain(`解锁了新天赋：${talent?.name}（${talent?.rarity}）`);
    expect(savedProgress(storage).unlockedTalents).toEqual([unlocked]);

    // 图册：这一张解锁了，其余锁定天赋仍然只显示“未解锁”。
    await click("open-gallery");
    const item = screen.getByTestId(`gallery-talent-${unlocked}`);
    expect(item.getAttribute("data-unlocked")).toBe("true");
    expect(item.textContent).toContain(talent?.name ?? "?");
    for (const id of LOCKED.filter((other) => other !== unlocked)) {
      const other = screen.getByTestId(`gallery-talent-${id}`);
      expect(other.getAttribute("data-unlocked")).toBe("false");
      expect(other.textContent).toContain("未解锁");
      expect(other.textContent).not.toContain(TALENTS.find((t) => t.id === id)?.name ?? "?");
    }
    await click("close-gallery");

    // 下一局的输入里带着已解锁的天赋。
    await click("play-again");
    const next = savedState(storage);
    expect(next.phase).toBe("SETUP");
    expect(next.phase === "SETUP" && next.unlockedTalents).toEqual([unlocked]);
    view.unmount();
  });

  it("新成就显示在总结页并进入图册", async () => {
    const storage = createMemoryStorage();
    const view = await mount(storage);
    await click("open-gallery");
    expect(screen.getByTestId("gallery-achievement-A_FIRST").getAttribute("data-unlocked")).toBe("false");
    await click("close-gallery");
    await playToSummary(5);
    const earned = savedProgress(storage).lastRewards?.achievements ?? [];
    expect(earned).toContain("A_FIRST");
    await click("open-gallery");
    for (const item of ACHIEVEMENTS) {
      expect(screen.getByTestId(`gallery-achievement-${item.id}`).getAttribute("data-unlocked")).toBe(String(earned.includes(item.id)));
    }
    view.unmount();
  });
});

describe("继承天赋", () => {
  it("总结页选一张，下一局十连抽的第一张就是它；用掉之后不再继承", async () => {
    const storage = createMemoryStorage();
    const view = await mount(storage);
    await playToSummary(15);
    const [first, second] = savedEnding(storage).profile.talents;

    // 可选可不选；再点一次取消；换一张。
    expect(savedProgress(storage).inherit).toBeNull();
    await click(`inherit-${first}`);
    expect(screen.getByTestId(`inherit-${first}`).getAttribute("aria-pressed")).toBe("true");
    expect(savedProgress(storage).inherit).toBe(first);
    await click(`inherit-${first}`);
    expect(savedProgress(storage).inherit).toBeNull();
    await click(`inherit-${second}`);
    expect(screen.getByTestId(`inherit-${first}`).getAttribute("aria-pressed")).toBe("false");
    expect(savedProgress(storage).inherit).toBe(second);

    await click("play-again");
    expect(phase()).toBe("TALENTS");
    expect(talentIds()[0]).toBe(second);
    expect(new Set(talentIds()).size).toBe(10);
    expect(talentRows()[0].textContent).toContain("继承");
    expect(talentRows().filter((row) => row.textContent?.includes("继承")).length).toBe(1);
    const run = savedState(storage);
    expect(run.phase === "SETUP" && run.inheritedTalent).toBe(second);
    // 用掉了：进度里清空。
    expect(savedProgress(storage).inherit).toBeNull();

    // 再开一局，没有继承的那张了。
    await click("go-home");
    await click("start-run");
    expect(talentRows().filter((row) => row.textContent?.includes("继承")).length).toBe(0);
    const later = savedState(storage);
    expect(later.phase === "SETUP" && later.inheritedTalent).toBeNull();
    view.unmount();
  });
});

describe("旧数据", () => {
  it("首次读取时把旧版图鉴并进新的跨局进度", async () => {
    const legacy = {
      version: 1,
      tiers: { N: { count: 2, firstSeed: 13, firstAt: "2026-10-11T00:00:00.000Z" } },
      hidden: { H04: { count: 1, firstSeed: 13, firstAt: "2026-10-11T00:00:00.000Z" } },
      runs: ["old-1", "old-2"],
    };
    const storage = createMemoryStorage({ [LEGACY_GALLERY_KEY]: JSON.stringify(legacy) });
    const view = await mount(storage);
    const progress = savedProgress(storage);
    expect(storage.dump()[PROGRESS_KEY]).toBeTruthy();
    expect(progress.runs).toBe(2);
    expect(progress.tiers.N.count).toBe(2);
    expect(progress.hidden.H04.count).toBe(1);
    await click("open-gallery");
    expect(screen.getByTestId("gallery-tier-N").getAttribute("data-unlocked")).toBe("true");
    expect(screen.getByTestId("gallery-tier-N").textContent).toContain("2 次 · 首次种子 13");
    expect(screen.getByTestId("gallery-hidden-H04").getAttribute("data-unlocked")).toBe("true");
    view.unmount();
  });
});

describe("存档问题", () => {
  it("损坏的存档：先说明，丢掉之后回到首页；图册进度不受影响", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await playToSummary(5);
    const progress = savedProgress(storage);
    view.unmount();

    await storage.write(SAVE_KEY, "{这不是一份存档");
    view = await mount(storage);
    const problem = screen.getByTestId("save-problem");
    expect(problem.getAttribute("data-reason")).toBe("CORRUPT");
    expect(problem.textContent).toContain("存档读不出来");
    expect(screen.queryByTestId("screen-home")).toBeNull();
    // 说明页出现时，原来的内容还在存储里，没有被覆盖。
    expect(storage.dump()[SAVE_KEY]).toBe("{这不是一份存档");
    await click("save-problem-restart");
    expect(phase()).toBe("HOME");
    expect(screen.queryByTestId("continue-run")).toBeNull();
    expect(storage.dump()[SAVE_KEY]).toBeUndefined();
    expect(savedProgress(storage)).toEqual(progress);
    view.unmount();
  });

  it("版本不符的存档：说明规则有更新，不接着玩", async () => {
    const envelope = JSON.parse(serializeSave(newRun(3), []));
    envelope.state.rulesVersion = "0.0.1";
    const text = JSON.stringify(envelope);
    const loaded = loadSave(text, { catalog });
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.reason).toBe("VERSION_MISMATCH");

    const storage = createMemoryStorage({ [SAVE_KEY]: text });
    const view = await mount(storage);
    const problem = screen.getByTestId("save-problem");
    expect(problem.getAttribute("data-reason")).toBe("VERSION_MISMATCH");
    expect(problem.textContent).toContain("游戏更新了");
    expect(problem.textContent).not.toContain("存档读不出来");
    await click("save-problem-restart");
    expect(phase()).toBe("HOME");
    view.unmount();
  });

  it("被改过数值的存档（结构合法但对不上重放）同样被拒绝", async () => {
    const storage = createMemoryStorage();
    let view = await mount(storage);
    await playToSummary(5);
    view.unmount();
    const envelope = JSON.parse(storage.dump()[SAVE_KEY]);
    envelope.state.stats.money = envelope.state.stats.money === 99 ? 98 : 99;
    await storage.write(SAVE_KEY, JSON.stringify(envelope));
    view = await mount(storage);
    expect(screen.getByTestId("save-problem")).toBeTruthy();
    view.unmount();
  });

  it("本机存储写不进去时显示“当前未保存”，但可以一路玩到总结", async () => {
    const storage: SaveStorage = {
      read: async () => null,
      write: async () => {
        throw new Error("QuotaExceededError");
      },
      remove: async () => undefined,
    };
    const view = await mount(storage);
    expect(phase()).toBe("HOME");
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
    await playToSummary(5);
    expect(screen.getByTestId("save-status").textContent).toBe("当前未保存");
    expect(screen.getByTestId("unsaved-hint")).toBeTruthy();
    expect(screen.getByTestId("ending-card")).toBeTruthy();
    view.unmount();
  });

  it("写入恢复后回到“已保存”", async () => {
    const inner = createMemoryStorage();
    let failing = true;
    const storage: SaveStorage = {
      read: (key) => inner.read(key),
      write: async (key, value) => {
        if (failing) throw new Error("暂时写不进去");
        await inner.write(key, value);
      },
      remove: (key) => inner.remove(key),
    };
    const view = await mount(storage);
    await click("start-run");
    expect(screen.getByTestId("save-status").textContent).toBe("当前未保存");
    failing = false;
    await click("go-home");
    await click("start-run");
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
    expect(app().querySelector("[data-testid='unsaved-hint']")).toBeNull();
    view.unmount();
  });
});
