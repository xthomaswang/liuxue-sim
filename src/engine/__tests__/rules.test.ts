// 数值规则。期望值全部来自 docs/03（§3、§4、§5.1、§6、§7.2、§7.3、§9）与 docs/06 §3。

import { describe, expect, it } from "vitest";
import { STIPEND, TERM_GROWTH } from "../constants";
import {
  eligibility, freezeGraduation, mastersBudget, outcomeFor, probabilities, revealGraduation,
} from "../graduation";
import type { GradInput } from "../graduation";
import type { Degree, Economy, Focus, FocusCounts, Stats, Trait } from "../index";
import { draw01 } from "../rng";
import {
  applyDelta, arcSlotForTerm, arcWeights, efficiencyFactor, focusVector, pickArc, upkeep, zeroFocusCounts,
} from "../rules";

const stats = (money: number, academics: number, career: number, wellbeing: number): Stats => ({ money, academics, career, wellbeing });
const counts = (partial: Partial<FocusCounts>): FocusCounts => ({ ...zeroFocusCounts(), ...partial });

describe("截断（03 §1、§4）", () => {
  it("四项同时更新、各自截断，不结转溢出", () => {
    const { after, applied } = applyDelta(stats(99, 3, 50, 99), stats(14, -8, 0, 6));
    expect(after).toEqual(stats(100, 0, 50, 100));
    expect(applied).toEqual(stats(1, -3, 0, 1));
  });

  it("每步各自截断：身心 99，+6 后为 100，再 -8 为 92，不是 97", () => {
    const first = applyDelta(stats(0, 0, 0, 99), stats(0, 0, 0, 6)).after;
    expect(first.wellbeing).toBe(100);
    expect(applyDelta(first, stats(0, 0, 0, -8)).after.wellbeing).toBe(92);
  });

  it("资金 99 收到资助先截断到 100，再进行后续支出", () => {
    const funded = applyDelta(stats(99, 0, 0, 50), stats(STIPEND.HIGH, 0, 0, 0));
    expect(funded.after.money).toBe(100);
    expect(funded.applied.money).toBe(1);
    expect(applyDelta(funded.after, stats(-12, 0, 0, 0)).after.money).toBe(88);
  });
});

describe("投入与低身心效率（03 §3、§2.3）", () => {
  it("效率分界：19→60%，20/39→80%，40→100%", () => {
    expect(efficiencyFactor(0)).toBe(6);
    expect(efficiencyFactor(19)).toBe(6);
    expect(efficiencyFactor(20)).toBe(8);
    expect(efficiencyFactor(39)).toBe(8);
    expect(efficiencyFactor(40)).toBe(10);
    expect(efficiencyFactor(100)).toBe(10);
  });

  it("基础向量", () => {
    expect(focusVector("STUDY", "FRUGAL", 70).requested).toEqual(stats(0, 11, 1, -7));
    expect(focusVector("CAREER", "FRUGAL", 70).requested).toEqual(stats(0, 2, 10, -6));
    expect(focusVector("CAMPUS", "FRUGAL", 70).requested).toEqual(stats(0, 3, 4, 6));
    expect(focusVector("WORK", "FRUGAL", 70).requested).toEqual(stats(12, 1, 3, -7));
    expect(focusVector("REST", "FRUGAL", 70).requested).toEqual(stats(0, 1, 0, 15));
  });

  it("特质加成", () => {
    expect(focusVector("STUDY", "FOCUSED", 70).requested).toEqual(stats(0, 13, 1, -7));
    expect(focusVector("CAREER", "PRACTICAL", 70).requested).toEqual(stats(0, 2, 12, -6));
    expect(focusVector("CAMPUS", "OUTGOING", 70).requested).toEqual(stats(0, 3, 6, 6));
    expect(focusVector("REST", "REFLECTIVE", 70).requested).toEqual(stats(0, 2, 0, 18));
    // RESILIENT：投入的负身心少扣 2，正身心不变
    expect(focusVector("STUDY", "RESILIENT", 70).requested.wellbeing).toBe(-5);
    expect(focusVector("CAREER", "RESILIENT", 70).requested.wellbeing).toBe(-4);
    expect(focusVector("WORK", "RESILIENT", 70).requested.wellbeing).toBe(-5);
    expect(focusVector("CAMPUS", "RESILIENT", 70).requested.wellbeing).toBe(6);
    expect(focusVector("REST", "RESILIENT", 70).requested.wellbeing).toBe(15);
    // 特质只作用于自己的那一项投入
    expect(focusVector("CAREER", "FOCUSED", 70).traitApplied).toBe(false);
    expect(focusVector("STUDY", "FOCUSED", 70).traitApplied).toBe(true);
  });

  it("03 §3 例：身心 19、FOCUSED、STUDY → 学业 +8、职业 +1、身心 -7", () => {
    expect(focusVector("STUDY", "FOCUSED", 19).requested).toEqual(stats(0, 8, 1, -7));
  });

  it("身心 19/20/39/40 的学习收益分别按 60%/80%/80%/100% 半入", () => {
    expect(focusVector("STUDY", "FRUGAL", 19).requested.academics).toBe(7); // 6.6
    expect(focusVector("STUDY", "FRUGAL", 20).requested.academics).toBe(9); // 8.8
    expect(focusVector("STUDY", "FRUGAL", 39).requested.academics).toBe(9);
    expect(focusVector("STUDY", "FRUGAL", 40).requested.academics).toBe(11);
    expect(focusVector("CAREER", "PRACTICAL", 19).requested).toEqual(stats(0, 1, 7, -6)); // 1.2→1，7.2→7
    expect(focusVector("CAREER", "PRACTICAL", 39).requested).toEqual(stats(0, 2, 10, -6)); // 1.6→2，9.6→10
  });

  it("折减不影响兼职资金与休息的身心恢复", () => {
    expect(focusVector("WORK", "FRUGAL", 0).requested).toEqual(stats(12, 1, 2, -7)); // 0.6→1，1.8→2
    expect(focusVector("REST", "FRUGAL", 0).requested).toEqual(stats(0, 1, 0, 15));
    expect(focusVector("REST", "REFLECTIVE", 10).requested).toEqual(stats(0, 1, 0, 18)); // 学业 2×0.6=1.2→1
    expect(focusVector("CAMPUS", "FRUGAL", 10).requested.wellbeing).toBe(6);
  });
});

describe("必要开销与短缺（03 §4.2）", () => {
  it("成本：FRUGAL 11，其余 12", () => {
    expect(upkeep(50, "FRUGAL").cost).toBe(11);
    expect(upkeep(50, "FOCUSED").cost).toBe(12);
    expect(upkeep(50, "FOCUSED")).toMatchObject({ paid: 12, shortfall: 0, stress: 0 });
  });

  it("03 §4.2 例：钱 5、身心 20 → 短缺 7、压力 9；开销后钱 0、身心 11；再加基础变化身心 8", () => {
    const result = upkeep(5, "OUTGOING");
    expect(result).toMatchObject({ cost: 12, paid: 5, shortfall: 7, stress: 9 });
    const afterUpkeep = applyDelta(stats(5, 30, 30, 20), result.requested).after;
    expect(afterUpkeep).toEqual(stats(0, 30, 30, 11));
    expect(applyDelta(afterUpkeep, { ...TERM_GROWTH }).after).toEqual(stats(0, 32, 31, 8));
  });

  it("压力公式 6 + ceil(shortfall/3)", () => {
    expect(upkeep(11, "FOCUSED").stress).toBe(7); // 短缺 1
    expect(upkeep(9, "FOCUSED").stress).toBe(7); // 短缺 3
    expect(upkeep(8, "FOCUSED").stress).toBe(8); // 短缺 4
    expect(upkeep(0, "FOCUSED").stress).toBe(10); // 短缺 12
    expect(upkeep(0, "FRUGAL").stress).toBe(10); // 短缺 11 → ceil(11/3)=4
    expect(upkeep(11, "FRUGAL").stress).toBe(0);
  });

  it("身心已为 0 时短缺仍可结算", () => {
    const result = upkeep(0, "FOCUSED");
    expect(applyDelta(stats(0, 10, 10, 0), result.requested).after).toEqual(stats(0, 10, 10, 0));
  });
});

/** 03 §9 的基础循环夹具：不施加任何事件效果，只走资助→投入→必要开销→基础变化。用纯函数拼，不经过状态机。 */
function baseLoop(economy: Economy, trait: Trait, focuses: Focus[], start: Stats): { stats: Stats; counts: FocusCounts } {
  let current = { ...start };
  const tally = zeroFocusCounts();
  for (const focus of focuses) {
    current = applyDelta(current, stats(STIPEND[economy], 0, 0, 0)).after;
    current = applyDelta(current, focusVector(focus, trait, current.wellbeing).requested).after;
    tally[focus] += 1;
    current = applyDelta(current, upkeep(current.money, trait).requested).after;
    current = applyDelta(current, { ...TERM_GROWTH }).after;
  }
  return { stats: current, counts: tally };
}

describe("基础循环核对（03 §9）", () => {
  const low = stats(28, 18, 12, 70);
  const mid = stats(42, 18, 12, 70);

  it("LOW：WORK, STUDY, CAREER, REST, WORK, STUDY, CAREER, STUDY → 4/72/47/14，PHD 46%、LOCAL 60%、HOME 71%", () => {
    const result = baseLoop("LOW", "OUTGOING", ["WORK", "STUDY", "CAREER", "REST", "WORK", "STUDY", "CAREER", "STUDY"], low);
    expect(result.stats).toEqual(stats(4, 72, 47, 14));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] })).toEqual({
      PHD: 46, LOCAL_JOB: 60, HOME_JOB: 71,
    });
  });

  it("LOW：…, CAREER, REST → 4/64/46/36，PHD 无资格、LOCAL 58%、HOME 69%", () => {
    const result = baseLoop("LOW", "OUTGOING", ["WORK", "STUDY", "CAREER", "REST", "WORK", "STUDY", "CAREER", "REST"], low);
    expect(result.stats).toEqual(stats(4, 64, 46, 36));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] })).toEqual({
      PHD: null, LOCAL_JOB: 58, HOME_JOB: 69,
    });
  });

  it("MID：STUDY, STUDY, REST, STUDY, STUDY, REST, STUDY, STUDY → 26/100/26/34，PHD 73%", () => {
    const result = baseLoop("MID", "OUTGOING", ["STUDY", "STUDY", "REST", "STUDY", "STUDY", "REST", "STUDY", "STUDY"], mid);
    expect(result.stats).toEqual(stats(26, 100, 26, 34));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] }).PHD).toBe(73);
  });

  it("MID：STUDY × 8 → 26/100/28/0，PHD 仍是 73%", () => {
    const result = baseLoop("MID", "OUTGOING", Array<Focus>(8).fill("STUDY"), mid);
    expect(result.stats).toEqual(stats(26, 100, 28, 0));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] }).PHD).toBe(73);
  });
});

describe("资格与概率（03 §6–§7）", () => {
  const table: Array<[Degree, number, number, number, number, number, string[], Array<number | null>]> = [
    ["UG", 50, 50, 3, 2, 0, [], [26, 60, 67]],
    ["UG", 72, 47, 3, 2, 2, [], [46, 60, 71]],
    ["UG", 90, 90, 4, 4, 0, [], [64, 95, 95]],
    ["UG", 100, 50, 4, 2, 0, ["ARC_RESEARCH_3_A"], [85, 67, 80]],
    ["UG", 49, 30, 3, 0, 0, [], [25, null, 49]],
    ["UG", 50, 30, 3, 0, 0, [], [26, null, 50]],
    ["MS", 80, 60, 4, 2, 0, ["MASTER_04_A"], [71, 77, 84]],
    ["MS", 80, 60, 4, 2, 0, ["MASTER_04_B"], [65, 82, 89]],
    ["MS", 100, 80, 6, 4, 0, ["ARC_RESEARCH_3_A", "MASTER_04_A"], [95, 95, 95]],
  ];
  it.each(table)("03 §7.2：%s A/C=%i/%i S/J/W=%i/%i/%i %j", (degree, A, C, S, J, W, flags, expected) => {
    const input: GradInput = { degree, stats: stats(0, A, C, 0), focusCounts: counts({ STUDY: S, CAREER: J, WORK: W }), flags };
    const result = probabilities(input);
    expect([result.PHD, result.LOCAL_JOB, result.HOME_JOB]).toEqual(expected);
  });

  it("资格路径：任一条件即可", () => {
    const base = (partial: Partial<FocusCounts>, flags: string[] = [], degree: Degree = "UG") =>
      eligibility({ degree, stats: stats(0, 50, 50, 50), focusCounts: counts(partial), flags });
    expect(base({})).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: false });
    expect(base({ STUDY: 2 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({ STUDY: 3 })).toEqual({ PHD: true, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({ CAREER: 1 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({ CAREER: 2 })).toEqual({ PHD: false, LOCAL_JOB: true, HOME_JOB: true });
    expect(base({ WORK: 1 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: false });
    expect(base({ WORK: 2 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({ CAMPUS: 2 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: false });
    expect(base({ CAMPUS: 3 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({ REST: 8 })).toEqual({ PHD: false, LOCAL_JOB: false, HOME_JOB: false });
    expect(base({}, ["ARC_RESEARCH_3_A"])).toEqual({ PHD: true, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({}, ["ARC_INTERNSHIP_3_A"])).toEqual({ PHD: false, LOCAL_JOB: true, HOME_JOB: true });
    expect(base({}, ["ARC_CREATIVE_3_A"])).toEqual({ PHD: false, LOCAL_JOB: true, HOME_JOB: true });
    expect(base({}, ["MASTER_04_A"], "MS")).toEqual({ PHD: true, LOCAL_JOB: false, HOME_JOB: true });
    expect(base({}, ["MASTER_04_B"], "MS")).toEqual({ PHD: false, LOCAL_JOB: true, HOME_JOB: true });
    // 第三幕选 B 不是成果标记
    expect(base({}, ["ARC_RESEARCH_3_B", "ARC_INTERNSHIP_3_B", "ARC_CREATIVE_3_B"])).toEqual({
      PHD: false, LOCAL_JOB: false, HOME_JOB: false,
    });
  });

  it("上下限：8% 下限；本科博士 85、硕士博士 95、工作 95", () => {
    const low = probabilities({ degree: "UG", stats: stats(0, 0, 0, 0), focusCounts: counts({ STUDY: 3, CAREER: 2 }), flags: [] });
    expect(low.PHD).toBe(8); // -25 + 6 = -19 → 8
    expect(low.LOCAL_JOB).toBe(12);
    expect(low.HOME_JOB).toBe(24);
    const max = { stats: stats(0, 100, 100, 0), focusCounts: counts({ STUDY: 8, CAREER: 8, WORK: 8 }), flags: ["ARC_RESEARCH_3_A", "MASTER_04_A"] };
    expect(probabilities({ degree: "UG", ...max, flags: ["ARC_RESEARCH_3_A"] })).toEqual({ PHD: 85, LOCAL_JOB: 95, HOME_JOB: 95 });
    expect(probabilities({ degree: "MS", ...max })).toEqual({ PHD: 95, LOCAL_JOB: 95, HOME_JOB: 95 });
  });

  it("计数按上限计入公式：STUDY 4 次与 8 次概率相同", () => {
    const at = (study: number) => probabilities({ degree: "UG", stats: stats(0, 60, 40, 0), focusCounts: counts({ STUDY: study }), flags: [] }).PHD;
    expect(at(4)).toBe(at(8));
    expect(at(3)).toBe((at(4) as number) - 2);
  });

  it("概率只由快照决定：换学历只改变 M 相关项", () => {
    const input = { stats: stats(77, 60, 60, 3), focusCounts: counts({ STUDY: 3, CAREER: 2 }), flags: [] as string[] };
    const ug = probabilities({ degree: "UG", ...input });
    const ms = probabilities({ degree: "MS", ...input });
    expect((ms.PHD as number) - (ug.PHD as number)).toBe(10);
    expect((ms.LOCAL_JOB as number) - (ug.LOCAL_JOB as number)).toBe(5);
    expect((ms.HOME_JOB as number) - (ug.HOME_JOB as number)).toBe(5);
    // 资金与身心不进公式
    expect(probabilities({ degree: "UG", ...input, stats: stats(0, 60, 60, 100) })).toEqual(ug);
  });

  it("抽签：roll < p/100 才成功，等号不成功；无资格记 INELIGIBLE", () => {
    expect(outcomeFor(26, 0.25)).toBe("OFFERED");
    expect(outcomeFor(60, 0.6)).toBe("NOT_OFFERED");
    expect(outcomeFor(67, 0.2)).toBe("OFFERED");
    expect(outcomeFor(26, 0.26)).toBe("NOT_OFFERED");
    expect(outcomeFor(8, 0.0799999)).toBe("OFFERED");
    expect(outcomeFor(null, 0)).toBe("INELIGIBLE");
  });

  it("揭晓使用固定 key；本科与硕士命名空间独立；无资格也记录 roll", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const degree of ["UG", "MS"] as Degree[]) {
        const frozen = freezeGraduation({ degree, stats: stats(10, 60, 30, 20), focusCounts: counts({ STUDY: 3 }), flags: [] });
        expect(frozen.rolls).toBeNull();
        expect(frozen.outcomes).toBeNull();
        const revealed = revealGraduation(seed, frozen);
        for (const opportunity of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) {
          const roll = draw01(seed, `grad:${degree}:${opportunity}`);
          expect(revealed.rolls?.[opportunity]).toBe(roll);
          const p = frozen.probabilities[opportunity];
          expect(revealed.outcomes?.[opportunity]).toBe(p === null ? "INELIGIBLE" : roll < p / 100 ? "OFFERED" : "NOT_OFFERED");
        }
        expect(revealed.outcomes?.LOCAL_JOB).toBe("INELIGIBLE");
      }
    }
  });
});

describe("硕士预算（03 §5.1）", () => {
  it("普通特质的最低预留：LOW 20/36，MID 12/20，HIGH 8/12", () => {
    const need = (economy: Economy, program: "MS_1Y" | "MS_2Y") => mastersBudget(program, 0, economy, "FOCUSED").requiredReserve;
    expect([need("LOW", "MS_1Y"), need("LOW", "MS_2Y")]).toEqual([20, 36]);
    expect([need("MID", "MS_1Y"), need("MID", "MS_2Y")]).toEqual([12, 20]);
    expect([need("HIGH", "MS_1Y"), need("HIGH", "MS_2Y")]).toEqual([8, 12]);
  });

  it("FRUGAL 用成本 11 重算", () => {
    expect(mastersBudget("MS_1Y", 0, "LOW", "FRUGAL").requiredReserve).toBe(18);
    expect(mastersBudget("MS_2Y", 0, "LOW", "FRUGAL").requiredReserve).toBe(32);
    expect(mastersBudget("MS_2Y", 0, "MID", "FRUGAL").requiredReserve).toBe(16);
    expect(mastersBudget("MS_2Y", 0, "HIGH", "FRUGAL").requiredReserve).toBe(12);
  });

  it("资金比所需少 1 不够、刚好够", () => {
    for (const economy of ["LOW", "MID", "HIGH"] as Economy[]) {
      for (const trait of ["FOCUSED", "FRUGAL"] as Trait[]) {
        for (const program of ["MS_1Y", "MS_2Y"] as const) {
          const need = mastersBudget(program, 0, economy, trait).requiredReserve;
          expect(mastersBudget(program, need - 1, economy, trait).fundingEligible).toBe(false);
          expect(mastersBudget(program, need, economy, trait).fundingEligible).toBe(true);
        }
      }
    }
  });

  it("账目字段：一年 2 学期费 8，两年 4 学期费 12", () => {
    expect(mastersBudget("MS_1Y", 30, "MID", "FOCUSED")).toMatchObject({ terms: 2, fee: 8, stipendTotal: 20, upkeepTotal: 24 });
    expect(mastersBudget("MS_2Y", 30, "MID", "FOCUSED")).toMatchObject({ terms: 4, fee: 12, stipendTotal: 40, upkeepTotal: 48 });
  });
});

describe("支线权重与分配（06 §3）", () => {
  it("权重公式", () => {
    const weights = arcWeights({
      focusCounts: counts({ STUDY: 2, CAREER: 1, CAMPUS: 1, REST: 1 }),
      stats: stats(10, 60, 49, 39),
      trait: "OUTGOING",
      economy: "LOW",
    });
    expect(weights).toEqual({
      RESEARCH: 1 + 4 + 2,
      INTERNSHIP: 1 + 2 + 1,
      FRIENDSHIP: 1 + 2 + 2,
      FAMILY: 2,
      REORIENTATION: 1 + 2 + 2,
      CREATIVE: 1 + 1 + 1,
    });
    const plain = arcWeights({ focusCounts: counts({}), stats: stats(50, 24, 24, 40), trait: "REFLECTIVE", economy: "HIGH" });
    expect(plain).toEqual({ RESEARCH: 1, INTERNSHIP: 1, FRIENDSHIP: 1, FAMILY: 1, REORIENTATION: 1, CREATIVE: 2 });
  });

  it("09 §4 向量：seed 20261011 的 arc:A 为 0.9619…，等权重时落在最后一档", () => {
    const equal = { RESEARCH: 1, INTERNSHIP: 1, FRIENDSHIP: 1, FAMILY: 1, REORIENTATION: 1, CREATIVE: 1 };
    expect(pickArc(20261011, "A", equal, null)).toBe("CREATIVE");
  });

  it("按固定顺序取累计值严格大于 r 的第一项；B 排除 A", () => {
    const order = ["RESEARCH", "INTERNSHIP", "FRIENDSHIP", "FAMILY", "REORIENTATION", "CREATIVE"] as const;
    const weights = { RESEARCH: 5, INTERNSHIP: 1, FRIENDSHIP: 3, FAMILY: 2, REORIENTATION: 4, CREATIVE: 1 };
    for (let seed = 0; seed < 500; seed++) {
      const a = pickArc(seed, "A", weights, null);
      let r = draw01(seed, "arc:A") * 16;
      let expectedA: string = order[order.length - 1];
      for (const arc of order) {
        if (r < weights[arc]) {
          expectedA = arc;
          break;
        }
        r -= weights[arc];
      }
      expect(a).toBe(expectedA);
      const b = pickArc(seed, "B", weights, a);
      expect(b).not.toBe(a);
    }
  });

  it("支线槽：A 在 S2/S4/S6，B 在 S3/S5/S7，S1/S8 没有", () => {
    expect(arcSlotForTerm(1)).toBeNull();
    expect(arcSlotForTerm(2)).toEqual({ slot: "A", beat: 1 });
    expect(arcSlotForTerm(3)).toEqual({ slot: "B", beat: 1 });
    expect(arcSlotForTerm(4)).toEqual({ slot: "A", beat: 2 });
    expect(arcSlotForTerm(5)).toEqual({ slot: "B", beat: 2 });
    expect(arcSlotForTerm(6)).toEqual({ slot: "A", beat: 3 });
    expect(arcSlotForTerm(7)).toEqual({ slot: "B", beat: 3 });
    expect(arcSlotForTerm(8)).toBeNull();
  });
});
