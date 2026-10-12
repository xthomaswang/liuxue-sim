// 测试专用的合成学校目录（mode = SAMPLE）。校名是明显的占位名，只用于规则与界面测试，绝不随游戏发布。

import type { OfferTier, RuntimeCatalog, RuntimeSchool } from "../../src/engine/types";

export const SAMPLE_TIERS: OfferTier[] = ["S", "A", "B", "C", "D", "U"];

export function makeSampleCatalog(perTier: number | Partial<Record<OfferTier, number>> = 4): RuntimeCatalog {
  const schools: RuntimeSchool[] = [];
  const byTier = { S: 0, A: 0, B: 0, C: 0, D: 0, U: 0 } as Record<OfferTier, number>;
  let next = 900001;
  for (const tier of SAMPLE_TIERS) {
    const count = typeof perTier === "number" ? perTier : (perTier[tier] ?? 4);
    for (let i = 1; i <= count; i++) {
      schools.push({
        unitid: String(next++),
        name: `Sample ${tier === "U" ? "Institute" : "University"} ${tier}${i}`,
        nameZh: `样本学校 ${tier}${i}`,
        city: "Sampleville",
        state: "ZZ",
        tier,
        group: tier === "U" ? "SPECIAL" : "NU",
        tierBasis: tier === "U" ? "UNRANKED_SPECIAL" : "APPROXIMATE",
        rank: null,
      });
      byTier[tier]++;
    }
  }
  return {
    schemaVersion: "1.0",
    catalogVersion: "sample-test-v0",
    catalogSha256: "0".repeat(64),
    mode: "SAMPLE",
    releaseStatus: "DRAFT",
    directoryYear: 2024,
    directoryRelease: "UNVERIFIED",
    rankEdition: 2027,
    tierMappingVersion: "usnews-2027-game-v2",
    generatedAt: "2026-10-11T00:00:00.000Z",
    counts: {
      eligible: schools.length,
      rankedVerified: 0,
      verified: 0,
      approximate: schools.filter((s) => s.tierBasis === "APPROXIMATE").length,
      special: schools.filter((s) => s.tierBasis === "UNRANKED_SPECIAL").length,
      byTier,
    },
    schools,
  };
}
