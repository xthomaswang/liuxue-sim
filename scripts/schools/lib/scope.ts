// 精选目录的范围上限（curated-scope-v2）。
// 用户定的范围是“U.S. News 综合大学 1–200 + 最好的一批文理学院 + 少量特殊学院”，
// 所以有已核实名次、但名次落在范围之外的学校不进目录——无论它是否在精选名单里。
// v1 是没有上限的旧行为（有已核实证据就收）。

import type { RankCategory } from "./types.ts";

export const SCOPE_RULE_VERSION = "curated-scope-v2";

/** 各类别允许进入目录的最大名次；没列出的类别（地区大学／地区学院）不设上限。 */
export const SCOPE_RANK_LIMITS: Partial<Record<RankCategory, number>> = {
  NU: 200,
  LAC: 50,
};

export const SCOPE_RULE_DESCRIPTION =
  "有 2027 版已核实名次的学校：综合大学（NU）名次大于 200、文理学院（LAC）名次大于 50 的不进目录，无论是否在精选名单里；区间名次按下限 rankMin 判断。地区类（RU_*/RC_*）与专门院校不设上限，只有大致档位（APPROXIMATE）的学校不受影响。";

/** 已核实名次是否超出目录范围。区间名次按 rankMin 判断。 */
export function isOutOfScopeRank(category: RankCategory, rankMin: number): boolean {
  const limit = SCOPE_RANK_LIMITS[category];
  return limit !== undefined && rankMin > limit;
}
