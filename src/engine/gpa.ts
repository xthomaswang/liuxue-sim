// 期末 GPA（docs/24 §2.4）：只在轨迹与总结里显示，不改任何数值、不进历史，也不影响任何判定之外的东西
// （“满绩”“学术警告”“院长嘉许”三条成就看它）。只在正式玩法；每个结算完的学期（历史里有它的期末结算）算一个。

import { GPA } from "./constants";
import { gpaBands } from "./pools";
import { draw01, pickIndex } from "./rng";
import { clamp } from "./rules";
import { totalsFor } from "./talents";
import type { ActiveRun, Degree, Focus, GpaBand } from "./types";

export interface TermGpa {
  stage: Degree;
  term: number;
  /** 两位小数，0.80–4.00。 */
  gpa: number;
}

/**
 * 一个学期的 GPA，以 0.01 为单位的整数：
 * GPA.BASE + GPA.PER_ACADEMIC × 期末学业 + 本学期安排的加减 + 身心太低的扣分 + 天赋 gpa 之和 + (draw01 − 0.5) × GPA.NOISE，
 * 四舍五入，截到 GPA.MIN–GPA.MAX（常数见 constants.ts 与 docs/24 §2.4）。
 */
export function termGpaHundredths(
  seed: number,
  stage: Degree,
  term: number,
  end: { academics: number; wellbeing: number },
  focus: Focus | null,
  talentGpa: number,
): number {
  let value = GPA.BASE + GPA.PER_ACADEMIC * end.academics + (focus ? GPA.FOCUS[focus] : 0) + talentGpa;
  if (end.wellbeing < GPA.WELLBEING_CRASH_BELOW) value += GPA.WELLBEING_CRASH;
  else if (end.wellbeing < GPA.WELLBEING_LOW_BELOW) value += GPA.WELLBEING_LOW;
  value += (draw01(seed, `gpa:${stage}:${term}`) - 0.5) * GPA.NOISE;
  return clamp(Math.round(value), GPA.MIN, GPA.MAX);
}

/** 这一局每个结算完的本科、硕士学期的 GPA，按时间顺序；经典模式没有 GPA，返回空数组。 */
export function termGpas(run: Pick<ActiveRun, "mode" | "seed" | "history" | "profile">): TermGpa[] {
  if (run.mode !== "standard") return [];
  const talentGpa = totalsFor(run.profile.talents).gpa;
  const out: TermGpa[] = [];
  for (const entry of run.history) {
    if (entry.kind !== "GROWTH" || (entry.stage !== "UG" && entry.stage !== "MS")) continue;
    const stage = entry.stage;
    const plan = run.history.find((item) => item.kind === "FOCUS" && item.stage === stage && item.termIndex === entry.termIndex);
    const hundredths = termGpaHundredths(run.seed, stage, entry.termIndex, entry.afterStats, plan?.focus ?? null, talentGpa);
    out.push({ stage, term: entry.termIndex, gpa: hundredths / 100 });
  }
  return out;
}

/** 几个学期 GPA 的算术平均，两位小数；一个都没有为 null。 */
export function averageGpa(list: readonly TermGpa[]): number | null {
  if (list.length === 0) return null;
  const sum = list.reduce((total, item) => total + Math.round(item.gpa * 100), 0);
  return Math.round(sum / list.length) / 100;
}

export function formatGpa(gpa: number): string {
  return gpa.toFixed(2);
}

/** 期末 GPA 那一行：按 min 从高到低取第一档 gpa ≥ min，挑一句，把 {gpa} 换成两位小数。 */
export function gpaLineText(seed: number, item: TermGpa, bands: readonly GpaBand[] = gpaBands()): string {
  const band = bands.find((entry) => item.gpa >= entry.min);
  const value = formatGpa(item.gpa);
  if (!band || band.texts.length === 0) return `期末 GPA ${value}。`;
  return band.texts[pickIndex(seed, `gpa:text:${item.stage}:${item.term}`, band.texts.length)].split("{gpa}").join(value);
}
