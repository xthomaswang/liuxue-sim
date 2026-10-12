import { describe, expect, it } from "vitest";
import { isOutOfScopeRank, SCOPE_RANK_LIMITS, SCOPE_RULE_VERSION } from "../lib/scope.ts";
import { RANK_CATEGORIES } from "../lib/types.ts";

describe("范围上限 curated-scope-v2", () => {
  it("版本与上限：综合大学 200、文理学院 50，其余类别不设上限", () => {
    expect(SCOPE_RULE_VERSION).toBe("curated-scope-v2");
    expect(SCOPE_RANK_LIMITS).toEqual({ NU: 200, LAC: 50 });
  });

  it("综合大学：200 在范围内，201 起在范围外", () => {
    expect(isOutOfScopeRank("NU", 1)).toBe(false);
    expect(isOutOfScopeRank("NU", 200)).toBe(false);
    expect(isOutOfScopeRank("NU", 201)).toBe(true);
    expect(isOutOfScopeRank("NU", 353)).toBe(true);
  });

  it("文理学院：50 在范围内，51 起在范围外", () => {
    expect(isOutOfScopeRank("LAC", 50)).toBe(false);
    expect(isOutOfScopeRank("LAC", 51)).toBe(true);
    expect(isOutOfScopeRank("LAC", 132)).toBe(true);
  });

  it("地区大学与地区学院任何名次都不受这条规则影响", () => {
    for (const category of RANK_CATEGORIES.filter((item) => item.startsWith("RU_") || item.startsWith("RC_"))) {
      expect(isOutOfScopeRank(category, 1), category).toBe(false);
      expect(isOutOfScopeRank(category, 500), category).toBe(false);
    }
  });
});
