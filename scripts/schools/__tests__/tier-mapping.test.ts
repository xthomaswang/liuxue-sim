import { describe, expect, it } from "vitest";
import { tierBoundarySelfCheck, tierForRank, TIER_MAPPING_VERSION } from "../lib/tier-mapping.ts";
import type { OfferTier, RankCategory } from "../lib/types.ts";

const single = (category: RankCategory, rank: number) => tierForRank({ category, rankMin: rank, rankMax: rank }).tier;

describe("分档 v2（usnews-2027-game-v2）", () => {
  it("版本号是 v2", () => {
    expect(TIER_MAPPING_VERSION).toBe("usnews-2027-game-v2");
  });

  it("综合大学：20/21、50/51、100/101、150/151 每个边界都有确定结果", () => {
    const cases: Array<[number, OfferTier]> = [
      [1, "S"], [20, "S"], [21, "A"], [50, "A"], [51, "B"], [100, "B"],
      [101, "C"], [150, "C"], [151, "D"], [200, "D"], [201, "D"], [434, "D"],
    ];
    for (const [rank, tier] of cases) expect(single("NU", rank), `NU ${rank}`).toBe(tier);
  });

  it("文理学院：10/11、25/26、50/51、100/101", () => {
    const cases: Array<[number, OfferTier]> = [
      [1, "S"], [10, "S"], [11, "A"], [25, "A"], [26, "B"], [50, "B"], [51, "C"], [100, "C"], [101, "D"], [180, "D"],
    ];
    for (const [rank, tier] of cases) expect(single("LAC", rank), `LAC ${rank}`).toBe(tier);
  });

  it("地区大学：各区域 1–10 → B，11–40 → C，41+ → D，永远没有 S/A", () => {
    for (const region of ["NORTH", "SOUTH", "MIDWEST", "WEST"] as const) {
      const category = `RU_${region}` as RankCategory;
      expect(single(category, 1)).toBe("B");
      expect(single(category, 10)).toBe("B");
      expect(single(category, 11)).toBe("C");
      expect(single(category, 40)).toBe("C");
      expect(single(category, 41)).toBe("D");
      expect(single(category, 120)).toBe("D");
    }
  });

  it("地区学院：各区域 1–5 → B，6–20 → C，21+ → D", () => {
    for (const region of ["NORTH", "SOUTH", "MIDWEST", "WEST"] as const) {
      const category = `RC_${region}` as RankCategory;
      expect(single(category, 1)).toBe("B");
      expect(single(category, 5)).toBe("B");
      expect(single(category, 6)).toBe("C");
      expect(single(category, 20)).toBe("C");
      expect(single(category, 21)).toBe("D");
    }
  });

  it("并列按实际名次映射：第 20 名并列仍是 S，不会被拆到 A", () => {
    expect(tierForRank({ category: "NU", rankMin: 20, rankMax: 20 })).toEqual({ tier: "S", reason: "NU_RANK_20_IN_BAND_1-20" });
  });

  it("区间整体落在同一档就进该档", () => {
    expect(tierForRank({ category: "NU", rankMin: 392, rankMax: 434 }).tier).toBe("D");
    expect(tierForRank({ category: "NU", rankMin: 105, rankMax: 110 }).tier).toBe("C");
    expect(tierForRank({ category: "LAC", rankMin: 160, rankMax: 185 }).tier).toBe("D");
  });

  it("区间跨档边界进 U，并写明 RANK_RANGE_CROSSES_TIER，不取中点", () => {
    expect(tierForRank({ category: "NU", rankMin: 145, rankMax: 155 })).toEqual({ tier: "U", reason: "RANK_RANGE_CROSSES_TIER" });
    expect(tierForRank({ category: "LAC", rankMin: 9, rankMax: 12 })).toEqual({ tier: "U", reason: "RANK_RANGE_CROSSES_TIER" });
    expect(tierForRank({ category: "RU_WEST", rankMin: 38, rankMax: 44 }).tier).toBe("U");
  });

  it("缺类别、缺名次或数值非法一律 U，不赋一个很大的排名", () => {
    expect(tierForRank({ category: null, rankMin: null, rankMax: null })).toEqual({ tier: "U", reason: "RANK_MISSING" });
    expect(tierForRank({ category: "NU", rankMin: null, rankMax: 5 }).tier).toBe("U");
    expect(tierForRank({ category: "PUBLIC", rankMin: 1, rankMax: 1 })).toEqual({ tier: "U", reason: "RANK_CATEGORY_UNKNOWN" });
    expect(tierForRank({ category: "NU", rankMin: 0, rankMax: 0 }).reason).toBe("RANK_INVALID");
    expect(tierForRank({ category: "NU", rankMin: 12.5, rankMax: 12.5 }).reason).toBe("RANK_INVALID");
    expect(tierForRank({ category: "NU", rankMin: 30, rankMax: 20 }).reason).toBe("RANK_INVALID");
  });

  it("构建时用的边界自检全部通过", () => {
    expect(tierBoundarySelfCheck()).toEqual([]);
  });
});
