// 跨局进度（docs/22 第 7 节）：结局图鉴、成就、已解锁的天赋、下一局要继承的天赋。
// 与单局存档分开保存；一局只结算一次（按 runId 幂等）。这里只做记账，判定由引擎的 evaluateRun 完成。

import type { EndingCard, ProgressSnapshot, RunRewards } from "../engine";

export interface ProgressEntry {
  count: number;
  firstSeed: number;
  firstAt: string;
}

export interface ProgressState {
  version: 2;
  /** 已结算的局数。 */
  runs: number;
  tiers: Record<string, ProgressEntry>;
  hidden: Record<string, ProgressEntry>;
  early: Record<string, ProgressEntry>;
  /** 去向结局（docs/22 §5.2），如“湾区码农”。 */
  flavors: Record<string, ProgressEntry>;
  /** 五年后的结局（docs/24 §9）。仍是 version 2：旧进度没有这一项时按空处理，不清空任何人的图册。 */
  outcomes: Record<string, ProgressEntry>;
  achievements: Record<string, { seed: number; at: string }>;
  /** 已解锁的锁定天赋 id。 */
  unlockedTalents: string[];
  /** 下一局十连抽里固定出现的那张；开新局时用掉并清空。 */
  inherit: string | null;
  /** 已结算过的 runId，保证同一局刷新后不重复计数、不重复解锁。 */
  rewardedRuns: string[];
  /** 最近一次结算的收获，刷新后总结页还能显示同样的内容。 */
  lastRewards: (RunRewards & { runId: string }) | null;
}

const MAX_REMEMBERED_RUNS = 500;

export function emptyProgress(): ProgressState {
  return {
    version: 2,
    runs: 0,
    tiers: {},
    hidden: {},
    early: {},
    flavors: {},
    outcomes: {},
    achievements: {},
    unlockedTalents: [],
    inherit: null,
    rewardedRuns: [],
    lastRewards: null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEntries(raw: unknown): Record<string, ProgressEntry> {
  const result: Record<string, ProgressEntry> = {};
  if (!isObject(raw)) return result;
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    if (
      typeof value.count === "number" &&
      Number.isInteger(value.count) &&
      value.count > 0 &&
      typeof value.firstSeed === "number" &&
      typeof value.firstAt === "string"
    ) {
      result[id] = { count: value.count, firstSeed: value.firstSeed, firstAt: value.firstAt };
    }
  }
  return result;
}

function readStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

/** 读不出来或格式不对时返回 null（调用方回到空进度）；进度损坏不应该挡住游戏。 */
export function parseProgress(text: string | null): ProgressState | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || raw.version !== 2) return null;
    const achievements: ProgressState["achievements"] = {};
    if (isObject(raw.achievements)) {
      for (const [id, value] of Object.entries(raw.achievements)) {
        if (isObject(value) && typeof value.seed === "number" && typeof value.at === "string") {
          achievements[id] = { seed: value.seed, at: value.at };
        }
      }
    }
    let lastRewards: ProgressState["lastRewards"] = null;
    if (isObject(raw.lastRewards) && typeof raw.lastRewards.runId === "string") {
      lastRewards = {
        runId: raw.lastRewards.runId,
        achievements: readStrings(raw.lastRewards.achievements),
        unlockedTalent: typeof raw.lastRewards.unlockedTalent === "string" ? raw.lastRewards.unlockedTalent : null,
      };
    }
    return {
      version: 2,
      runs: typeof raw.runs === "number" && Number.isInteger(raw.runs) && raw.runs >= 0 ? raw.runs : 0,
      tiers: readEntries(raw.tiers),
      hidden: readEntries(raw.hidden),
      early: readEntries(raw.early),
      flavors: readEntries(raw.flavors),
      outcomes: readEntries(raw.outcomes),
      achievements,
      unlockedTalents: readStrings(raw.unlockedTalents),
      inherit: typeof raw.inherit === "string" ? raw.inherit : null,
      rewardedRuns: readStrings(raw.rewardedRuns),
      lastRewards,
    };
  } catch {
    return null;
  }
}

/** 把旧版图鉴（只有主线等级与隐藏结局的计数）并成新的跨局进度。 */
export function migrateLegacyGallery(text: string | null): ProgressState {
  const progress = emptyProgress();
  if (text === null) return progress;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || raw.version !== 1) return progress;
    progress.tiers = readEntries(raw.tiers);
    progress.hidden = readEntries(raw.hidden);
    progress.rewardedRuns = readStrings(raw.runs).slice(-MAX_REMEMBERED_RUNS);
    progress.runs = progress.rewardedRuns.length;
  } catch {
    // 旧图鉴读不出来就从空进度开始。
  }
  return progress;
}

function counts(entries: Record<string, ProgressEntry>): Record<string, number> {
  return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, entry.count]));
}

/** 给引擎判定用的快照：结算这一局之前的进度。 */
export function snapshotOf(progress: ProgressState): ProgressSnapshot {
  return {
    runs: progress.runs,
    tiers: counts(progress.tiers),
    hidden: counts(progress.hidden),
    early: counts(progress.early),
    flavors: counts(progress.flavors),
    outcomes: counts(progress.outcomes),
    achievements: Object.keys(progress.achievements),
    unlockedTalents: [...progress.unlockedTalents],
  };
}

function bump(entry: ProgressEntry | undefined, seed: number, at: string): ProgressEntry {
  return entry ? { ...entry, count: entry.count + 1 } : { count: 1, firstSeed: seed, firstAt: at };
}

/** 把一局记入进度。这一局已结算过则原样返回同一个对象。 */
export function settleRun(
  progress: ProgressState,
  run: { runId: string; seed: number; card: EndingCard; outcomeId: string | null; rewards: RunRewards; at: string },
): ProgressState {
  if (progress.rewardedRuns.includes(run.runId)) return progress;
  const { card, rewards } = run;
  // 中途结局同时也算解锁了对应的主线等级。
  const tiers = { ...progress.tiers, [card.tier]: bump(progress.tiers[card.tier], run.seed, run.at) };
  const hidden = { ...progress.hidden };
  for (const item of card.hidden) hidden[item.id] = bump(hidden[item.id], run.seed, run.at);
  const early = { ...progress.early };
  if (card.early) early[card.early] = bump(early[card.early], run.seed, run.at);
  const flavors = { ...progress.flavors };
  if (card.flavor) flavors[card.flavor.id] = bump(flavors[card.flavor.id], run.seed, run.at);
  const outcomes = { ...progress.outcomes };
  if (run.outcomeId) outcomes[run.outcomeId] = bump(outcomes[run.outcomeId], run.seed, run.at);
  const achievements = { ...progress.achievements };
  for (const id of rewards.achievements) {
    if (!achievements[id]) achievements[id] = { seed: run.seed, at: run.at };
  }
  const unlockedTalents =
    rewards.unlockedTalent && !progress.unlockedTalents.includes(rewards.unlockedTalent)
      ? [...progress.unlockedTalents, rewards.unlockedTalent]
      : progress.unlockedTalents;
  return {
    ...progress,
    runs: progress.runs + 1,
    tiers,
    hidden,
    early,
    flavors,
    outcomes,
    achievements,
    unlockedTalents,
    rewardedRuns: [...progress.rewardedRuns, run.runId].slice(-MAX_REMEMBERED_RUNS),
    lastRewards: { runId: run.runId, achievements: [...rewards.achievements], unlockedTalent: rewards.unlockedTalent },
  };
}

// ---------- 显示进度 ----------

/** 当前这一局显示到哪里。整局在确认分点时就算完了，界面只是分段显示。 */
export interface RevealState {
  runId: string;
  /** 人生轨迹已经显示的段数。 */
  shown: number;
  summarySeen: boolean;
}

export function parseReveal(text: string | null, runId: string): RevealState {
  const fresh: RevealState = { runId, shown: 0, summarySeen: false };
  if (text === null) return fresh;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || raw.runId !== runId) return fresh;
    const shown = typeof raw.shown === "number" && Number.isInteger(raw.shown) && raw.shown >= 0 ? raw.shown : 0;
    return { runId, shown, summarySeen: raw.summarySeen === true };
  } catch {
    return fresh;
  }
}
