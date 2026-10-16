// 跨局进度（docs/24 §9）与自动播放节奏的纯函数测试，不依赖整局模拟。

import { describe, expect, it } from "vitest";
import { emptyProgress, migrateLegacyGallery, parseProgress, settleRun, snapshotOf } from "../../app/progress";
import type { EndingCard } from "../../engine";
import { autoDelay } from "../screens/TimelineScreen";

const card = (overrides: Partial<EndingCard> = {}): EndingCard => ({
  early: null,
  flavor: { id: "F_LOCAL_DEFAULT", name: "OPT 打工人", roast: "", text: "" },
  tier: "SR_PLUS",
  tierLabel: "SR＋",
  tierKind: "精英结局",
  name: "职业上岸，身份仍在加载",
  roast: "",
  facts: [],
  hidden: [],
  status: "TBC",
  statusLabel: "未完待续",
  combo: "SR＋＋未完待续",
  draws: [],
  ...overrides,
});

describe("跨局进度：五年后的结局", () => {
  it("第三版留下的进度没有 outcomes：读进来按空处理，版本号不变，其它内容一项不丢", () => {
    const old = {
      version: 2,
      runs: 3,
      tiers: { N: { count: 2, firstSeed: 13, firstAt: "2026-10-12T00:00:00.000Z" } },
      hidden: { H04: { count: 1, firstSeed: 13, firstAt: "2026-10-12T00:00:00.000Z" } },
      early: { E_BROKE: { count: 1, firstSeed: 7, firstAt: "2026-10-12T00:00:00.000Z" } },
      flavors: { F_LOCAL_DEFAULT: { count: 1, firstSeed: 9, firstAt: "2026-10-12T00:00:00.000Z" } },
      achievements: { A_FIRST: { seed: 13, at: "2026-10-12T00:00:00.000Z" } },
      unlockedTalents: ["T_LUCKY"],
      inherit: "T_FOCUSED",
      rewardedRuns: ["a", "b", "c"],
      lastRewards: { runId: "c", achievements: ["A_FIRST"], unlockedTalent: null },
    };
    const progress = parseProgress(JSON.stringify(old));
    expect(progress).not.toBeNull();
    expect(progress?.version).toBe(2);
    expect(progress?.outcomes).toEqual({});
    expect(progress?.runs).toBe(3);
    expect(progress?.tiers).toEqual(old.tiers);
    expect(progress?.hidden).toEqual(old.hidden);
    expect(progress?.early).toEqual(old.early);
    expect(progress?.flavors).toEqual(old.flavors);
    expect(progress?.achievements).toEqual(old.achievements);
    expect(progress?.unlockedTalents).toEqual(["T_LUCKY"]);
    expect(progress?.inherit).toBe("T_FOCUSED");
    expect(progress?.rewardedRuns).toEqual(["a", "b", "c"]);
    expect(snapshotOf(progress ?? emptyProgress()).outcomes).toEqual({});
  });

  it("结算时记下五年后的结局；同一局只记一次；快照带上 outcomes", () => {
    const rewards = { achievements: [], unlockedTalent: null };
    const at = "2026-10-15T00:00:00.000Z";
    const first = settleRun(emptyProgress(), { runId: "r1", seed: 11, card: card(), outcomeId: "LO_LOCAL_JOB_DEFAULT", rewards, at });
    expect(first.outcomes).toEqual({ LO_LOCAL_JOB_DEFAULT: { count: 1, firstSeed: 11, firstAt: at } });
    expect(settleRun(first, { runId: "r1", seed: 11, card: card(), outcomeId: "LO_LOCAL_JOB_DEFAULT", rewards, at })).toBe(first);
    const second = settleRun(first, { runId: "r2", seed: 12, card: card(), outcomeId: "LO_LOCAL_JOB_DEFAULT", rewards, at });
    expect(second.outcomes.LO_LOCAL_JOB_DEFAULT).toEqual({ count: 2, firstSeed: 11, firstAt: at });
    expect(snapshotOf(second).outcomes).toEqual({ LO_LOCAL_JOB_DEFAULT: 2 });
    // 经典模式没有毕业后的五年：不记任何五年后的结局。
    const classic = settleRun(second, { runId: "r3", seed: 13, card: card(), outcomeId: null, rewards, at });
    expect(classic.outcomes).toEqual(second.outcomes);
    expect(classic.runs).toBe(3);
  });

  it("写回再读出来，outcomes 原样保留", () => {
    const rewards = { achievements: [], unlockedTalent: null };
    const settled = settleRun(emptyProgress(), {
      runId: "r1",
      seed: 5,
      card: card(),
      outcomeId: "LO_PHD_DEFAULT",
      rewards,
      at: "2026-10-15T00:00:00.000Z",
    });
    expect(parseProgress(JSON.stringify(settled))).toEqual(settled);
  });

  it("旧版图鉴并入时也带上空的 outcomes", () => {
    expect(migrateLegacyGallery(null).outcomes).toEqual({});
    expect(migrateLegacyGallery(JSON.stringify({ version: 1, tiers: {}, hidden: {}, runs: [] })).outcomes).toEqual({});
  });
});

describe("自动播放的节奏", () => {
  it("间隔 = clamp(700 + 260 × 行数, 1000, 2800) 毫秒", () => {
    expect(autoDelay(0)).toBe(1000);
    expect(autoDelay(1)).toBe(1000);
    expect(autoDelay(2)).toBe(1220);
    expect(autoDelay(5)).toBe(2000);
    expect(autoDelay(8)).toBe(2780);
    expect(autoDelay(9)).toBe(2800);
    expect(autoDelay(30)).toBe(2800);
  });
});
