// 留学人生图鉴：本机累计解锁过的主线等级与隐藏结局（docs/14 第 5 节）。只是收藏册，不影响任何规则。

import type { EndingCard, EndingTierId, HiddenEndingId } from "../engine";

export interface GalleryEntry {
  count: number;
  firstSeed: number;
  firstAt: string;
}

export interface GalleryState {
  version: 1;
  tiers: Partial<Record<EndingTierId, GalleryEntry>>;
  hidden: Partial<Record<HiddenEndingId, GalleryEntry>>;
  /** 已计入的 runId，保证同一局刷新后不重复计数。 */
  runs: string[];
}

const MAX_REMEMBERED_RUNS = 500;

export function emptyGallery(): GalleryState {
  return { version: 1, tiers: {}, hidden: {}, runs: [] };
}

function readEntries(raw: unknown): Record<string, GalleryEntry> {
  const result: Record<string, GalleryEntry> = {};
  if (typeof raw !== "object" || raw === null) return result;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.count === "number" &&
      Number.isInteger(entry.count) &&
      entry.count > 0 &&
      typeof entry.firstSeed === "number" &&
      typeof entry.firstAt === "string"
    ) {
      result[id] = { count: entry.count, firstSeed: entry.firstSeed, firstAt: entry.firstAt };
    }
  }
  return result;
}

/** 读不出来或格式不对时回到空图鉴；图鉴损坏不应该挡住游戏。 */
export function parseGallery(text: string | null): GalleryState {
  if (text === null) return emptyGallery();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.version !== 1) return emptyGallery();
    return {
      version: 1,
      tiers: readEntries(raw.tiers) as GalleryState["tiers"],
      hidden: readEntries(raw.hidden) as GalleryState["hidden"],
      runs: Array.isArray(raw.runs) ? raw.runs.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return emptyGallery();
  }
}

function bump(entry: GalleryEntry | undefined, seed: number, at: string): GalleryEntry {
  return entry ? { ...entry, count: entry.count + 1 } : { count: 1, firstSeed: seed, firstAt: at };
}

/** 把一局的结局卡记入图鉴。这一局已记过则原样返回同一个对象。 */
export function recordEnding(
  gallery: GalleryState,
  run: { runId: string; seed: number; card: EndingCard; at: string },
): GalleryState {
  if (gallery.runs.includes(run.runId)) return gallery;
  const tiers = { ...gallery.tiers, [run.card.tier]: bump(gallery.tiers[run.card.tier], run.seed, run.at) };
  const hidden = { ...gallery.hidden };
  for (const item of run.card.hidden) hidden[item.id] = bump(hidden[item.id], run.seed, run.at);
  return { version: 1, tiers, hidden, runs: [...gallery.runs, run.runId].slice(-MAX_REMEMBERED_RUNS) };
}
