// 中途结局（docs/22 第 4 节）与去向结局（第 5.2 节）。两者都是数据：条件 when 见 conditions.ts，
// 名称与文案在 src/content/earlyEndings.json、endingFlavors.json。

import { EARLY_ENDINGS, ENDING_FLAVORS } from "../content";
import { MS_TERM_LABELS, UG_TERM_LABELS } from "./constants";
import { conditionFacts, conditionMet } from "./conditions";
import type { ConditionContext } from "./conditions";
import { draw01, pickWeighted } from "./rng";
import type { Degree, EarlyEnding, EndingFlavor, EpilogueDraw, FinalRoute } from "./types";

export interface EarlyHit {
  ending: EarlyEnding;
  /** 触发它的真实数值，逐条中文短句。 */
  facts: string[];
  /** 触发它的那次抽签（必然触发的条件为空）。 */
  draws: EpilogueDraw[];
}

/** 学期的叫法：大一上 … 大四下；硕一上 … 硕二下。 */
export function termLabel(stage: Degree, term: number): string {
  const labels = stage === "UG" ? UG_TERM_LABELS : MS_TERM_LABELS;
  return labels[term - 1] ?? `${stage === "UG" ? "本科" : "硕士"}第 ${term} 学期`;
}

/**
 * 每个本科或硕士学期期末结算之后按数组顺序逐条检查：
 * when 的每一项都满足，且 draw01(seed, "early:" + id + ":" + stage + ":" + term) < chancePermille / 1000，就在这里结束。
 */
export function checkEarlyEnding(
  seed: number,
  ctx: ConditionContext,
  endings: readonly EarlyEnding[] = EARLY_ENDINGS,
): EarlyHit | null {
  for (const ending of endings) {
    if (!conditionMet(ending.when, ctx)) continue;
    const key = `early:${ending.id}:${ctx.stage}:${ctx.term}`;
    const roll = draw01(seed, key);
    if (!(roll < ending.chancePermille / 1000)) continue;
    const facts = [`${termLabel(ctx.stage, ctx.term)}期末`, ...conditionFacts(ending.when, ctx)];
    const draws: EpilogueDraw[] = [];
    if (ending.chancePermille < 1000) {
      const percent = ending.chancePermille / 10;
      facts.push(`每学期 ${percent}% 的机会，这次撞上了`);
      draws.push({ key, label: ending.name, probabilityPercent: percent, roll, success: true });
    }
    return { ending, facts, draws };
  }
  return null;
}

export function findEarlyEnding(id: string | null | undefined): EarlyEnding | undefined {
  return id ? EARLY_ENDINGS.find((ending) => ending.id === id) : undefined;
}

/**
 * 去向结局：该去向下 when 全部满足的条目（数组顺序）按权重抽一条；
 * r = draw01(seed, "flavor:" + route) × 候选权重之和，取第一条累计值严格大于 r 的。
 * 每个去向都有一条没有条件的兜底，正常不会为空；真的为空（内容缺失）时返回 null。
 */
export function pickFlavor(
  seed: number,
  route: FinalRoute,
  ctx: ConditionContext,
  flavors: readonly EndingFlavor[] = ENDING_FLAVORS,
): EndingFlavor | null {
  const candidates = flavors.filter((flavor) => flavor.route === route && conditionMet(flavor.when, ctx));
  return pickWeighted(seed, `flavor:${route}`, candidates, (flavor) => flavor.weight);
}
