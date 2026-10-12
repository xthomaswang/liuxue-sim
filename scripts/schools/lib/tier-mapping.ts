// 2027 U.S. News 排名 → 游戏档位的粗映射（docs/11 §3 的 v2 修订）。纯函数，阈值全部是游戏参数。
// 映射版本 usnews-2027-game-v2：目录范围收窄到综合大学前 200 左右，NU 的 C/D 分界由 200/201 改为 150/151。
// 改任何一个阈值都必须换版本号。

import { RANK_CATEGORIES, TIER_MAPPING_VERSION } from "./types.ts";
import type { OfferTier, RankCategory } from "./types.ts";

export { TIER_MAPPING_VERSION };

type Band = { min: number; max: number; tier: Exclude<OfferTier, "U"> };

const NU_BANDS: Band[] = [
  { min: 1, max: 20, tier: "S" },
  { min: 21, max: 50, tier: "A" },
  { min: 51, max: 100, tier: "B" },
  { min: 101, max: 150, tier: "C" },
  { min: 151, max: Infinity, tier: "D" },
];
const LAC_BANDS: Band[] = [
  { min: 1, max: 10, tier: "S" },
  { min: 11, max: 25, tier: "A" },
  { min: 26, max: 50, tier: "B" },
  { min: 51, max: 100, tier: "C" },
  { min: 101, max: Infinity, tier: "D" },
];
/** Regional Universities：各区域独立名次，没有 S/A。 */
const RU_BANDS: Band[] = [
  { min: 1, max: 10, tier: "B" },
  { min: 11, max: 40, tier: "C" },
  { min: 41, max: Infinity, tier: "D" },
];
/** Regional Colleges：各区域独立名次，没有 S/A。 */
const RC_BANDS: Band[] = [
  { min: 1, max: 5, tier: "B" },
  { min: 6, max: 20, tier: "C" },
  { min: 21, max: Infinity, tier: "D" },
];

export function bandsFor(category: RankCategory): Band[] {
  if (category === "NU") return NU_BANDS;
  if (category === "LAC") return LAC_BANDS;
  if (category.startsWith("RU_")) return RU_BANDS;
  return RC_BANDS;
}

export interface TierInput {
  category: RankCategory | string | null;
  rankMin: number | null;
  rankMax: number | null;
}

export interface TierResult {
  tier: OfferTier;
  /** 机器可读的原因码，写进 SchoolRecord.tier.reason。 */
  reason: string;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * 名次或区间 → 档位。
 * - 并列按实际名次映射，不拆并列。
 * - 区间整体落在同一档才进该档；跨档边界进 U（RANK_RANGE_CROSSES_TIER），不取中点。
 * - 缺类别、缺名次、非法数值一律 U，不赋“很大的排名”。
 */
export function tierForRank(input: TierInput): TierResult {
  const { category, rankMin, rankMax } = input;
  if (category === null || rankMin === null || rankMax === null) return { tier: "U", reason: "RANK_MISSING" };
  if (!RANK_CATEGORIES.includes(category as RankCategory)) return { tier: "U", reason: "RANK_CATEGORY_UNKNOWN" };
  if (!isPositiveInteger(rankMin) || !isPositiveInteger(rankMax) || rankMin > rankMax) {
    return { tier: "U", reason: "RANK_INVALID" };
  }
  const bands = bandsFor(category as RankCategory);
  const low = bands.find((band) => rankMin >= band.min && rankMin <= band.max);
  const high = bands.find((band) => rankMax >= band.min && rankMax <= band.max);
  if (!low || !high) return { tier: "U", reason: "RANK_INVALID" };
  if (low.tier !== high.tier) return { tier: "U", reason: "RANK_RANGE_CROSSES_TIER" };
  const rankLabel = rankMin === rankMax ? String(rankMin) : `${rankMin}-${rankMax}`;
  const bandLabel = Number.isFinite(low.max) ? `${low.min}-${low.max}` : `${low.min}+`;
  return { tier: low.tier, reason: `${category}_RANK_${rankLabel}_IN_BAND_${bandLabel}` };
}

/** docs/11 §10 第 7 条的边界自检，构建时与测试里都会跑。返回不符合预期的用例（空数组 = 通过）。 */
export function tierBoundarySelfCheck(): string[] {
  const cases: Array<[TierInput, OfferTier]> = [
    [{ category: "NU", rankMin: 1, rankMax: 1 }, "S"],
    [{ category: "NU", rankMin: 20, rankMax: 20 }, "S"],
    [{ category: "NU", rankMin: 21, rankMax: 21 }, "A"],
    [{ category: "NU", rankMin: 50, rankMax: 50 }, "A"],
    [{ category: "NU", rankMin: 51, rankMax: 51 }, "B"],
    [{ category: "NU", rankMin: 100, rankMax: 100 }, "B"],
    [{ category: "NU", rankMin: 101, rankMax: 101 }, "C"],
    [{ category: "NU", rankMin: 150, rankMax: 150 }, "C"],
    [{ category: "NU", rankMin: 151, rankMax: 151 }, "D"],
    [{ category: "NU", rankMin: 200, rankMax: 200 }, "D"],
    [{ category: "NU", rankMin: 201, rankMax: 201 }, "D"],
    [{ category: "LAC", rankMin: 10, rankMax: 10 }, "S"],
    [{ category: "LAC", rankMin: 11, rankMax: 11 }, "A"],
    [{ category: "LAC", rankMin: 25, rankMax: 25 }, "A"],
    [{ category: "LAC", rankMin: 26, rankMax: 26 }, "B"],
    [{ category: "LAC", rankMin: 50, rankMax: 50 }, "B"],
    [{ category: "LAC", rankMin: 51, rankMax: 51 }, "C"],
    [{ category: "LAC", rankMin: 100, rankMax: 100 }, "C"],
    [{ category: "LAC", rankMin: 101, rankMax: 101 }, "D"],
    [{ category: "RU_NORTH", rankMin: 1, rankMax: 1 }, "B"],
    [{ category: "RU_SOUTH", rankMin: 10, rankMax: 10 }, "B"],
    [{ category: "RU_MIDWEST", rankMin: 11, rankMax: 11 }, "C"],
    [{ category: "RU_WEST", rankMin: 40, rankMax: 40 }, "C"],
    [{ category: "RU_NORTH", rankMin: 41, rankMax: 41 }, "D"],
    [{ category: "RC_NORTH", rankMin: 5, rankMax: 5 }, "B"],
    [{ category: "RC_SOUTH", rankMin: 6, rankMax: 6 }, "C"],
    [{ category: "RC_MIDWEST", rankMin: 20, rankMax: 20 }, "C"],
    [{ category: "RC_WEST", rankMin: 21, rankMax: 21 }, "D"],
    [{ category: "NU", rankMin: 145, rankMax: 155 }, "U"],
    [{ category: "NU", rankMin: 195, rankMax: 205 }, "D"],
    [{ category: "NU", rankMin: 392, rankMax: 434 }, "D"],
    [{ category: "LAC", rankMin: 9, rankMax: 12 }, "U"],
    [{ category: null, rankMin: null, rankMax: null }, "U"],
  ];
  const failures: string[] = [];
  for (const [input, expected] of cases) {
    const actual = tierForRank(input).tier;
    if (actual !== expected) failures.push(`${JSON.stringify(input)} expected ${expected} got ${actual}`);
  }
  return failures;
}
