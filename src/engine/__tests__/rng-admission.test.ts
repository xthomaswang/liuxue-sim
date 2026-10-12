// 随机源与高中申请。期望值来自 docs/09 §4、docs/13 §2–§5，不从实现反推。

import { describe, expect, it } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import {
  baseReadinessFor, drawTier, finalReadiness, readinessBonusFromFlags, resolveAdmission, sampleOffers,
  strategyFromFlags, tierOdds, tierWeights,
} from "../admission";
import { baseReadiness, checkCatalog, createRun } from "../index";
import type { OfferTier, Strategy } from "../index";
import { draw01, hash32, pickIndex } from "../rng";

describe("随机源（06 §1、09 §4）", () => {
  const vectors: Array<[number, string, number, number]> = [
    [0, "grad:UG:PHD", 3759835791, 0.875404987251386],
    [42, "grad:UG:PHD", 2793983821, 0.6505250514019281],
    [42, "grad:MS:PHD", 1280292120, 0.2980912383645773],
    [20261011, "arc:A", 4131378773, 0.9619115788955241],
    [42, "admission:readiness", 3237752238, 0.7538479375652969],
  ];
  it.each(vectors)("seed %i key %s", (seed, key, u32, roll) => {
    expect(hash32(`${seed}:${key}`)).toBe(u32);
    expect(draw01(seed, key)).toBe(u32 / 4294967296);
    expect(draw01(seed, key)).toBeCloseTo(roll, 15);
  });

  it("同 seed 同 key 永远相同，范围在 [0,1)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const value = draw01(seed, "arc:B");
      expect(value).toBe(draw01(seed, "arc:B"));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("pickIndex 落在数组范围内，空池报错", () => {
    for (let seed = 0; seed < 200; seed++) {
      const index = pickIndex(seed, "family:LOW:trait", 6);
      expect(Number.isInteger(index) && index >= 0 && index < 6).toBe(true);
    }
    expect(() => pickIndex(1, "x", 0)).toThrow("EMPTY_POOL");
  });
});

describe("基础准备度", () => {
  it("seed 42 的基础准备度为 65，HS_01_A 后 75、B 后 71", () => {
    expect(baseReadiness(42)).toBe(65);
    expect(finalReadiness(65, 10)).toBe(75);
    expect(finalReadiness(65, 6)).toBe(71);
  });

  it("基础准备度是 20–80 的整数，只由 seed 决定", () => {
    for (let seed = 0; seed < 2000; seed++) {
      const value = baseReadinessFor(seed);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(20);
      expect(value).toBeLessThanOrEqual(80);
    }
  });

  it("天赋的准备度加成与 HS_01 加成相加后截断到 0–100（16 §1.3）", () => {
    expect(finalReadiness(65, 10, 6)).toBe(81);
    expect(finalReadiness(80, 10, 18)).toBe(100);
    expect(finalReadiness(20, 6, -10)).toBe(16);
    expect(finalReadiness(20, 0, -30)).toBe(0);
    for (let seed = 0; seed < 100; seed++) {
      const base = baseReadinessFor(seed);
      const plain = resolveAdmission(seed, base, ["HS_01_A", "HS_02_B"]);
      const boosted = resolveAdmission(seed, base, ["HS_01_A", "HS_02_B"], 8);
      expect(plain.readiness).toBe(base + 10);
      expect(boosted.readiness).toBe(Math.min(100, base + 18));
      // 天赋只改变准备度（从而改变权重），不改变抽签用的 roll
      expect(boosted.poolRoll).toBe(plain.poolRoll);
      expect(boosted.tierRoll).toBe(plain.tierRoll);
      expect(boosted.weights).toEqual(tierWeights(boosted.readiness, "STEADY"));
    }
  });
});

describe("申请权重与档次（13 §3–§4）", () => {
  const strategies: Strategy[] = ["REACH", "STEADY"];

  it("202 组：非负整数、总和 5000、前 k 档累计随准备度单调不降、显示单位合计 1000", () => {
    let cases = 0;
    for (const strategy of strategies) {
      let previous: number[] | null = null;
      for (let r = 0; r <= 100; r++) {
        const weights = tierWeights(r, strategy);
        expect(weights).toHaveLength(5);
        expect(weights.every((w) => Number.isInteger(w) && w >= 0)).toBe(true);
        expect(weights.reduce((sum, w) => sum + w, 0)).toBe(5000);
        const prefixes = [1, 2, 3, 4].map((k) => weights.slice(0, k).reduce((sum, w) => sum + w, 0));
        if (previous) prefixes.forEach((value, index) => expect(value).toBeGreaterThanOrEqual((previous as number[])[index]));
        previous = prefixes;
        const odds = tierOdds(weights);
        expect(odds.map((item) => item.tier)).toEqual(["S", "A", "B", "C", "D", "U"]);
        expect(odds.reduce((sum, item) => sum + item.tenths, 0)).toBe(1000);
        expect(odds[5].tenths).toBe(100);
        expect(odds.reduce((sum, item) => sum + item.exact, 0)).toBeCloseTo(1, 12);
        cases++;
      }
    }
    expect(cases).toBe(202);
  });

  it("三个锚点与 r=50 的连续性", () => {
    expect(tierWeights(0, "REACH")).toEqual([50, 200, 750, 1500, 2500]);
    expect(tierWeights(50, "REACH")).toEqual([600, 1000, 1250, 1250, 900]);
    expect(tierWeights(100, "REACH")).toEqual([2500, 1250, 750, 350, 150]);
    expect(tierWeights(0, "STEADY")).toEqual([0, 50, 450, 2750, 1750]);
    expect(tierWeights(50, "STEADY")).toEqual([100, 650, 2750, 1250, 250]);
    expect(tierWeights(100, "STEADY")).toEqual([1250, 3100, 500, 150, 0]);
  });

  it("13 §3.3：准备度 60 的两行权重", () => {
    expect(tierWeights(60, "REACH")).toEqual([980, 1050, 1150, 1070, 750]);
    expect(tierWeights(60, "STEADY")).toEqual([330, 1140, 2300, 1030, 200]);
  });

  it("13 §4：准备度 60、冲刺的最终概率 17.64/18.90/20.70/19.26/13.50/10", () => {
    const odds = tierOdds(tierWeights(60, "REACH"));
    const expected = [0.1764, 0.189, 0.207, 0.1926, 0.135, 0.1];
    odds.forEach((item, index) => expect(item.exact).toBeCloseTo(expected[index], 12));
    // 最大余数法：176.4/189/207/192.6/135 → 余数最大的 192.6 进一位
    expect(odds.map((item) => item.tenths)).toEqual([176, 189, 207, 193, 135, 100]);
    expect(odds.map((item) => item.label)).toEqual(["17.6%", "18.9%", "20.7%", "19.3%", "13.5%", "10.0%"]);
  });

  it("显示标签：实际为 0 写 0%，非零但不足 0.1% 写“低于 0.1%”", () => {
    expect(tierOdds(tierWeights(0, "STEADY"))[0].label).toBe("0%");
    expect(tierOdds(tierWeights(100, "STEADY"))[4].label).toBe("0%");
    expect(tierOdds([0, 0, 0, 0, 5000])[0].label).toBe("0%");
    // 权重 0 < w < 6 时 floor(9w/50)=0，若最大余数也没补到它，就显示“低于 0.1%”
    const tiny = tierOdds([1, 0, 0, 0, 4999]);
    expect(tiny[0].exact).toBeGreaterThan(0);
    expect(tiny.reduce((sum, item) => sum + item.tenths, 0)).toBe(1000);
    expect(tiny[0].tenths).toBe(0);
    expect(tiny[0].label).toBe("低于 0.1%");
    expect(tiny[4].label).toBe("90.0%");
  });

  it("U 池：poolRoll 0.0999… 进 U，0.10 进有序池", () => {
    const weights = tierWeights(60, "REACH");
    expect(drawTier(weights, 0.099999, 0.5)).toBe("U");
    expect(drawTier(weights, 0, 0.5)).toBe("U");
    expect(drawTier(weights, 0.1, 0.5)).not.toBe("U");
    expect(drawTier(weights, 0.999999, 0.5)).not.toBe("U");
  });

  it("抽档累计边界的等号属于下一档", () => {
    const weights = tierWeights(60, "REACH"); // 980/1050/1150/1070/750
    const at = (bucket: number): OfferTier => drawTier(weights, 0.5, (bucket + 0.5) / 5000);
    expect(at(0)).toBe("S");
    expect(at(979)).toBe("S");
    expect(at(980)).toBe("A");
    expect(at(2029)).toBe("A");
    expect(at(2030)).toBe("B");
    expect(at(3179)).toBe("B");
    expect(at(3180)).toBe("C");
    expect(at(4249)).toBe("C");
    expect(at(4250)).toBe("D");
    expect(at(4999)).toBe("D");
    // tierRoll 恰好等于累计边界 980/5000 时 bucket=980，进入下一档
    expect(drawTier(weights, 0.5, 980 / 5000)).toBe("A");
  });

  it("零权重档永远抽不到", () => {
    const steadyLow = tierWeights(0, "STEADY"); // S 权重 0
    const steadyHigh = tierWeights(100, "STEADY"); // D 权重 0
    for (let bucket = 0; bucket < 5000; bucket += 7) {
      expect(drawTier(steadyLow, 0.5, (bucket + 0.5) / 5000)).not.toBe("S");
      expect(drawTier(steadyHigh, 0.5, (bucket + 0.5) / 5000)).not.toBe("D");
    }
    expect(drawTier(steadyLow, 0.5, 0)).toBe("A");
    expect(drawTier(steadyHigh, 0.5, 4999.9 / 5000)).toBe("C");
  });

  it("标记推导：缺失或双选属于数据错误", () => {
    expect(readinessBonusFromFlags(["HS_01_A"])).toBe(10);
    expect(readinessBonusFromFlags(["HS_01_B", "HS_02_A"])).toBe(6);
    expect(strategyFromFlags(["HS_01_A", "HS_02_A"])).toBe("REACH");
    expect(strategyFromFlags(["HS_01_A", "HS_02_B"])).toBe("STEADY");
    expect(() => readinessBonusFromFlags([])).toThrow();
    expect(() => readinessBonusFromFlags(["HS_01_A", "HS_01_B"])).toThrow();
    expect(() => strategyFromFlags(["HS_01_A"])).toThrow();
  });

  it("resolveAdmission 用固定 key，进 U 也记录 tierRoll", () => {
    for (let seed = 0; seed < 300; seed++) {
      const drawn = resolveAdmission(seed, baseReadinessFor(seed), ["HS_01_B", "HS_02_A"]);
      expect(drawn.poolRoll).toBe(draw01(seed, "admission:pool"));
      expect(drawn.tierRoll).toBe(draw01(seed, "admission:tier"));
      expect(drawn.readiness).toBe(baseReadinessFor(seed) + 6);
      expect(drawn.tier === "U").toBe(drawn.poolRoll < 0.1);
      expect(drawn.weights).toEqual(tierWeights(drawn.readiness, "REACH"));
    }
  });
});

describe("同档三校 offer（13 §5、11 §4）", () => {
  const catalog = makeSampleCatalog(6);

  it("三所不同、同档，等于按 unitid 字符串排序后的无放回抽取", () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const tier of ["S", "A", "B", "C", "D", "U"] as OfferTier[]) {
        const offers = sampleOffers(seed, tier, catalog);
        expect(offers).toHaveLength(3);
        expect(new Set(offers.map((school) => school.unitid)).size).toBe(3);
        expect(offers.every((school) => school.tier === tier)).toBe(true);
        const remaining = catalog.schools
          .filter((school) => school.tier === tier)
          .map((school) => school.unitid)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const expected: string[] = [];
        for (let k = 0; k < 3; k++) {
          const index = Math.floor(draw01(seed, `school:offer:${k}`) * remaining.length);
          expected.push(remaining[index]);
          remaining.splice(index, 1);
        }
        expect(offers.map((school) => school.unitid)).toEqual(expected);
      }
    }
  });

  it("按字符串而不是数值排序", () => {
    const mixed = makeSampleCatalog(0);
    const ids = ["9", "10", "100", "2", "33"];
    mixed.schools = ids.map((unitid) => ({ ...catalog.schools[0], unitid, tier: "S" as OfferTier }));
    const sorted = [...ids].sort(); // "10","100","2","33","9"
    for (let seed = 0; seed < 50; seed++) {
      const first = sampleOffers(seed, "S", mixed)[0].unitid;
      expect(first).toBe(sorted[Math.floor(draw01(seed, "school:offer:0") * 5)]);
    }
  });

  it("打乱目录数组顺序不改变结果", () => {
    const shuffled = { ...catalog, schools: [...catalog.schools].reverse() };
    const rotated = { ...catalog, schools: [...catalog.schools.slice(7), ...catalog.schools.slice(0, 7)] };
    for (let seed = 0; seed < 100; seed++) {
      const base = sampleOffers(seed, "B", catalog).map((school) => school.unitid);
      expect(sampleOffers(seed, "B", shuffled).map((school) => school.unitid)).toEqual(base);
      expect(sampleOffers(seed, "B", rotated).map((school) => school.unitid)).toEqual(base);
    }
  });

  it("池不足三所时报配置错误，不跨档补位；重复记录不算两所", () => {
    const small = makeSampleCatalog({ S: 2 });
    expect(() => sampleOffers(1, "S", small)).toThrow("CATALOG_POOL_TOO_SMALL");
    const check = checkCatalog(small);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe("CATALOG_POOL_TOO_SMALL");
      expect(check.counts.S).toBe(2);
    }
    expect(() => createRun({ seed: 1, runId: "x", catalog: small })).toThrow("CATALOG_POOL_TOO_SMALL");

    const duplicated = makeSampleCatalog({ U: 2 });
    duplicated.schools.push({ ...duplicated.schools[duplicated.schools.length - 1] });
    expect(checkCatalog(duplicated).ok).toBe(false);
    expect(() => sampleOffers(1, "U", duplicated)).toThrow("CATALOG_POOL_TOO_SMALL");

    expect(checkCatalog(makeSampleCatalog(3)).ok).toBe(true);
  });

  it("有限样本下每所学校都会出现（3/N 的均匀抽取）", () => {
    const seen = new Map<string, number>();
    const runs = 3000;
    for (let seed = 0; seed < runs; seed++) {
      for (const school of sampleOffers(seed, "C", catalog)) seen.set(school.unitid, (seen.get(school.unitid) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const count of seen.values()) {
      expect(count / runs).toBeGreaterThan(0.44);
      expect(count / runs).toBeLessThan(0.56);
    }
  });
});
