// 数值规则。期望值全部来自 docs/03（§3、§4、§5.1、§6、§7.2、§7.3、§9）、docs/06 §3 与 docs/16 §1.3。
// 第一版的六种特质现在是六张固定天赋，这里用它们的效果合计来驱动同一批用例。

import { describe, expect, it } from "vitest";
import { FOCUS_BASE, STIPEND, TERM_GROWTH } from "../constants";
import {
  eligibility, formulaTerms, freezeGraduation, mastersBudget, outcomeFor, probabilities, revealGraduation,
} from "../graduation";
import type { GradInput } from "../graduation";
import type { Degree, Economy, Focus, FocusCounts, Stats, TalentEffects } from "../index";
import { CLASSIC_TALENT_EFFECTS } from "../pools";
import { draw01 } from "../rng";
import {
  applyDelta, arcSlotForTerm, arcWeights, efficiencyFactor, pickArc, planVector, upkeep, zeroFocusCounts,
} from "../rules";
import { effectiveGrowth, effectiveStipend, effectiveUpkeep, initialStatsFor, sumTalentEffects } from "../talents";
import type { TalentTotals } from "../talents";

const stats = (money: number, academics: number, career: number, wellbeing: number): Stats => ({ money, academics, career, wellbeing });
const counts = (partial: Partial<FocusCounts>): FocusCounts => ({ ...zeroFocusCounts(), ...partial });
const totalsOf = (...effects: TalentEffects[]): TalentTotals => sumTalentEffects(effects.map((item) => ({ effects: item })));
const NONE = totalsOf();
/** 经典模式的档案片段：按经济档查资助表。 */
const classic = (economy: Economy) => ({ economy, points: null });
/** 第一版的特质 → 对应固定天赋的效果合计。 */
const trait = (name: string): TalentTotals => totalsOf(CLASSIC_TALENT_EFFECTS[`T_${name}`]);
/** 基础安排在给定天赋与身心下实际要应用的向量。 */
const vector = (focus: Focus, totals: TalentTotals, wellbeing: number) =>
  planVector(FOCUS_BASE[focus], totals.focus[focus], totals.focusWellbeingRelief, wellbeing, totals.efficiencyFloor);

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

describe("安排向量与低身心效率（03 §3、§2.3；16 §1.3）", () => {
  it("效率分界：19→60%，20/39→80%，40→100%；天赋可以给下限", () => {
    expect(efficiencyFactor(0)).toBe(6);
    expect(efficiencyFactor(19)).toBe(6);
    expect(efficiencyFactor(20)).toBe(8);
    expect(efficiencyFactor(39)).toBe(8);
    expect(efficiencyFactor(40)).toBe(10);
    expect(efficiencyFactor(100)).toBe(10);
    expect(efficiencyFactor(0, 8)).toBe(8);
    expect(efficiencyFactor(25, 8)).toBe(8);
    expect(efficiencyFactor(60, 8)).toBe(10); // 下限不会把正常效率拉低
    expect(efficiencyFactor(0, 10)).toBe(10);
    expect(efficiencyFactor(30, 10)).toBe(10);
  });

  it("五张基础安排的向量", () => {
    expect(vector("STUDY", NONE, 70).requested).toEqual(stats(0, 11, 1, -7));
    expect(vector("CAREER", NONE, 70).requested).toEqual(stats(0, 2, 10, -6));
    expect(vector("CAMPUS", NONE, 70).requested).toEqual(stats(0, 3, 4, 6));
    expect(vector("WORK", NONE, 70).requested).toEqual(stats(12, 1, 3, -7));
    expect(vector("REST", NONE, 70).requested).toEqual(stats(0, 1, 0, 15));
    expect(vector("STUDY", NONE, 70)).toMatchObject({ factor: 10, talentApplied: false, efficiencyApplied: false });
  });

  it("六张特质天赋的加成与 03 §2.3 逐项相同", () => {
    expect(vector("STUDY", trait("FOCUSED"), 70).requested).toEqual(stats(0, 13, 1, -7));
    expect(vector("CAREER", trait("PRACTICAL"), 70).requested).toEqual(stats(0, 2, 12, -6));
    expect(vector("CAMPUS", trait("OUTGOING"), 70).requested).toEqual(stats(0, 3, 6, 6));
    expect(vector("REST", trait("REFLECTIVE"), 70).requested).toEqual(stats(0, 2, 0, 18));
    // RESILIENT：安排的负身心少扣 2，正身心不变
    expect(vector("STUDY", trait("RESILIENT"), 70).requested.wellbeing).toBe(-5);
    expect(vector("CAREER", trait("RESILIENT"), 70).requested.wellbeing).toBe(-4);
    expect(vector("WORK", trait("RESILIENT"), 70).requested.wellbeing).toBe(-5);
    expect(vector("CAMPUS", trait("RESILIENT"), 70).requested.wellbeing).toBe(6);
    expect(vector("REST", trait("RESILIENT"), 70).requested.wellbeing).toBe(15);
    // 特质只作用于自己的那一类安排
    expect(vector("CAREER", trait("FOCUSED"), 70).talentApplied).toBe(false);
    expect(vector("STUDY", trait("FOCUSED"), 70).talentApplied).toBe(true);
    // FRUGAL 不改安排，只改必要开销
    expect(vector("STUDY", trait("FRUGAL"), 70).requested).toEqual(stats(0, 11, 1, -7));
    expect(effectiveUpkeep(trait("FRUGAL"))).toBe(11);
    expect(effectiveUpkeep(trait("FOCUSED"))).toBe(12);
  });

  it("03 §3 例：身心 19、FOCUSED、STUDY → 学业 +8、职业 +1、身心 -7", () => {
    expect(vector("STUDY", trait("FOCUSED"), 19).requested).toEqual(stats(0, 8, 1, -7));
  });

  it("身心 19/20/39/40 的学习收益分别按 60%/80%/80%/100% 半入", () => {
    expect(vector("STUDY", NONE, 19).requested.academics).toBe(7); // 6.6
    expect(vector("STUDY", NONE, 20).requested.academics).toBe(9); // 8.8
    expect(vector("STUDY", NONE, 39).requested.academics).toBe(9);
    expect(vector("STUDY", NONE, 40).requested.academics).toBe(11);
    expect(vector("CAREER", trait("PRACTICAL"), 19).requested).toEqual(stats(0, 1, 7, -6)); // 1.2→1，7.2→7
    expect(vector("CAREER", trait("PRACTICAL"), 39).requested).toEqual(stats(0, 2, 10, -6)); // 1.6→2，9.6→10
    expect(vector("STUDY", NONE, 19)).toMatchObject({ factor: 6, efficiencyApplied: true });
  });

  it("折减不影响兼职资金与休息的身心恢复", () => {
    expect(vector("WORK", NONE, 0).requested).toEqual(stats(12, 1, 2, -7)); // 0.6→1，1.8→2
    expect(vector("REST", NONE, 0).requested).toEqual(stats(0, 1, 0, 15));
    expect(vector("REST", trait("REFLECTIVE"), 10).requested).toEqual(stats(0, 1, 0, 18)); // 学业 2×0.6=1.2→1
    expect(vector("CAMPUS", NONE, 10).requested.wellbeing).toBe(6);
  });

  it("多张天赋：类别加成相加，先加成、再减免负身心、最后算效率", () => {
    const both = totalsOf(
      { focus: { STUDY: { academics: 3, wellbeing: -3 } } }, // 学业额外 +3，身心多扣 3
      { focus: { STUDY: { academics: 2 } } },
      { focusWellbeingRelief: 2 },
      { focusWellbeingRelief: 1 },
    );
    // 11+3+2=16；身心 -7-3=-10，减免 3 → -7
    expect(vector("STUDY", both, 70).requested).toEqual(stats(0, 16, 1, -7));
    // 身心 19：16×0.6=9.6→10，职业 1×0.6→1
    expect(vector("STUDY", both, 19).requested).toEqual(stats(0, 10, 1, -7));
    // 减免不会把负的身心变成正的
    const generous = totalsOf({ focusWellbeingRelief: 3 }, { focusWellbeingRelief: 3 }, { focusWellbeingRelief: 3 });
    expect(vector("CAREER", generous, 70).requested.wellbeing).toBe(0);
    // 负的类别加成也照常生效（带代价的天赋）
    const slow = totalsOf({ focus: { STUDY: { academics: -2 } } });
    expect(vector("STUDY", slow, 70).requested.academics).toBe(9);
    // 资金加成不受效率影响
    const hustler = totalsOf({ focus: { WORK: { money: 2 } } }, { focus: { WORK: { money: 1 } } });
    expect(vector("WORK", hustler, 0).requested.money).toBe(15);
  });

  it("效率下限取几张天赋里最高的，不是相加", () => {
    expect(totalsOf({ efficiencyFloor: 8 }).efficiencyFloor).toBe(8);
    expect(totalsOf({ efficiencyFloor: 8 }, { efficiencyFloor: 10 }).efficiencyFloor).toBe(10);
    expect(totalsOf({ efficiencyFloor: 10 }, { efficiencyFloor: 8 }, {}).efficiencyFloor).toBe(10);
    expect(NONE.efficiencyFloor).toBe(0);
    expect(vector("STUDY", totalsOf({ efficiencyFloor: 8 }), 0).requested.academics).toBe(9); // 8.8
    expect(vector("STUDY", totalsOf({ efficiencyFloor: 10 }), 0).requested.academics).toBe(11);
    expect(vector("STUDY", totalsOf({ efficiencyFloor: 8 }), 0)).toMatchObject({ factor: 8, efficiencyApplied: true });
    expect(vector("STUDY", totalsOf({ efficiencyFloor: 10 }), 0)).toMatchObject({ factor: 10, efficiencyApplied: false });
  });
});

describe("天赋效果的其它作用点（16 §1.3）", () => {
  it("initial：经济档初始值加上天赋之和，再截断到 0–100", () => {
    expect(initialStatsFor("MID", NONE)).toEqual(stats(42, 18, 12, 70));
    expect(initialStatsFor("LOW", totalsOf({ initial: { money: 5 } }, { initial: { money: 10, wellbeing: -10 } }))).toEqual(stats(43, 18, 12, 60));
    expect(initialStatsFor("HIGH", totalsOf({ initial: { money: 15 } }, { initial: { money: 15 } }, { initial: { money: 15, wellbeing: 15 } }))).toEqual(
      stats(100, 18, 12, 85),
    );
    expect(initialStatsFor("LOW", totalsOf({ initial: { career: -15 } })).career).toBe(0);
  });

  it("stipend 与 upkeep：同类相加，结果不低于 0", () => {
    expect(effectiveStipend(classic("LOW"), NONE)).toBe(6);
    expect(effectiveStipend(classic("LOW"), totalsOf({ stipend: 1 }, { stipend: 2 }, { stipend: 3 }))).toBe(12);
    expect(effectiveStipend(classic("LOW"), totalsOf({ stipend: -3 }, { stipend: -3 }, { stipend: -3 }))).toBe(0);
    // 正式玩法：5 + 家境点数，再加天赋
    const withFamily = (family: number) => ({ economy: "MID" as const, points: { family, academics: 5, career: 5, wellbeing: 5 } });
    expect(effectiveStipend(withFamily(0), NONE)).toBe(5);
    expect(effectiveStipend(withFamily(5), NONE)).toBe(10);
    expect(effectiveStipend(withFamily(10), totalsOf({ stipend: 3 }))).toBe(18);
    expect(effectiveStipend(withFamily(0), totalsOf({ stipend: -3 }, { stipend: -3 }))).toBe(0);
    expect(effectiveUpkeep(totalsOf({ upkeep: 2 }, { upkeep: 1 }, { upkeep: -1 }))).toBe(14);
    expect(effectiveUpkeep(totalsOf({ upkeep: -2 }, { upkeep: -2 }, { upkeep: -2 }))).toBe(6);
  });

  it("growth：加到每学期的基础变化上", () => {
    expect(effectiveGrowth(NONE)).toEqual({ ...TERM_GROWTH });
    expect(effectiveGrowth(totalsOf({ growth: { academics: 1 } }, { growth: { wellbeing: 1 } }, { growth: { wellbeing: 1 } }))).toEqual(
      stats(0, 3, 1, -1),
    );
  });

  it("readiness、chance、arcWeight：同类相加", () => {
    const totals = totalsOf(
      { readiness: 6, chance: { PHD: 5 }, arcWeight: { RESEARCH: 3 } },
      { readiness: 8, chance: { PHD: 5, LOCAL_JOB: 5, HOME_JOB: 5 } },
      { readiness: -10, arcWeight: { RESEARCH: 1, FAMILY: 3 } },
    );
    expect(totals.readiness).toBe(4);
    expect(totals.chance).toEqual({ PHD: 10, LOCAL_JOB: 5, HOME_JOB: 5 });
    expect(totals.arcWeight).toMatchObject({ RESEARCH: 4, FAMILY: 3, CREATIVE: 0 });
  });
});

describe("必要开销与短缺（03 §4.2）", () => {
  it("没有短缺时不产生压力", () => {
    expect(upkeep(50, 12)).toMatchObject({ cost: 12, paid: 12, shortfall: 0, stress: 0 });
    expect(upkeep(50, 12).requested).toEqual(stats(-12, 0, 0, 0));
    expect(Object.is(upkeep(50, 12).requested.wellbeing, -0)).toBe(false);
  });

  it("03 §4.2 例：钱 5、身心 20 → 短缺 7、压力 9；开销后钱 0、身心 11；再加基础变化身心 8", () => {
    const result = upkeep(5, 12);
    expect(result).toMatchObject({ cost: 12, paid: 5, shortfall: 7, stress: 9 });
    const afterUpkeep = applyDelta(stats(5, 30, 30, 20), result.requested).after;
    expect(afterUpkeep).toEqual(stats(0, 30, 30, 11));
    expect(applyDelta(afterUpkeep, { ...TERM_GROWTH }).after).toEqual(stats(0, 32, 31, 8));
  });

  it("压力公式 6 + ceil(shortfall/3)", () => {
    expect(upkeep(11, 12).stress).toBe(7); // 短缺 1
    expect(upkeep(9, 12).stress).toBe(7); // 短缺 3
    expect(upkeep(8, 12).stress).toBe(8); // 短缺 4
    expect(upkeep(0, 12).stress).toBe(10); // 短缺 12
    expect(upkeep(0, 11).stress).toBe(10); // 短缺 11 → ceil(11/3)=4
    expect(upkeep(11, 11).stress).toBe(0);
    expect(upkeep(0, 14).stress).toBe(11); // 开销被天赋抬到 14：短缺 14 → 6+5
  });

  it("身心已为 0 时短缺仍可结算；开销为 0 时什么都不扣", () => {
    expect(applyDelta(stats(0, 10, 10, 0), upkeep(0, 12).requested).after).toEqual(stats(0, 10, 10, 0));
    expect(upkeep(0, 0)).toMatchObject({ cost: 0, paid: 0, shortfall: 0, stress: 0 });
    expect(upkeep(0, 0).requested).toEqual(stats(0, 0, 0, 0));
  });
});

/** 03 §9 的基础循环夹具：不施加任何事件效果，只走资助→基础安排→必要开销→基础变化。用纯函数拼，不经过状态机。 */
function baseLoop(economy: Economy, totals: TalentTotals, focuses: Focus[], start: Stats): { stats: Stats; counts: FocusCounts } {
  let current = { ...start };
  const tally = zeroFocusCounts();
  for (const focus of focuses) {
    current = applyDelta(current, stats(effectiveStipend(classic(economy), totals), 0, 0, 0)).after;
    current = applyDelta(current, vector(focus, totals, current.wellbeing).requested).after;
    tally[focus] += 1;
    current = applyDelta(current, upkeep(current.money, effectiveUpkeep(totals)).requested).after;
    current = applyDelta(current, effectiveGrowth(totals)).after;
  }
  return { stats: current, counts: tally };
}

describe("基础循环核对（03 §9）", () => {
  const low = stats(28, 18, 12, 70);
  const mid = stats(42, 18, 12, 70);
  const outgoing = trait("OUTGOING");

  it("LOW：WORK, STUDY, CAREER, REST, WORK, STUDY, CAREER, STUDY → 4/72/47/14，PHD 46%、LOCAL 60%、HOME 71%", () => {
    const result = baseLoop("LOW", outgoing, ["WORK", "STUDY", "CAREER", "REST", "WORK", "STUDY", "CAREER", "STUDY"], low);
    expect(result.stats).toEqual(stats(4, 72, 47, 14));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] })).toEqual({
      PHD: 46, LOCAL_JOB: 60, HOME_JOB: 71,
    });
  });

  it("LOW：…, CAREER, REST → 4/64/46/36，PHD 无资格、LOCAL 58%、HOME 69%", () => {
    const result = baseLoop("LOW", outgoing, ["WORK", "STUDY", "CAREER", "REST", "WORK", "STUDY", "CAREER", "REST"], low);
    expect(result.stats).toEqual(stats(4, 64, 46, 36));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] })).toEqual({
      PHD: null, LOCAL_JOB: 58, HOME_JOB: 69,
    });
  });

  it("MID：STUDY, STUDY, REST, STUDY, STUDY, REST, STUDY, STUDY → 26/100/26/34，PHD 73%", () => {
    const result = baseLoop("MID", outgoing, ["STUDY", "STUDY", "REST", "STUDY", "STUDY", "REST", "STUDY", "STUDY"], mid);
    expect(result.stats).toEqual(stats(26, 100, 26, 34));
    expect(probabilities({ degree: "UG", stats: result.stats, focusCounts: result.counts, flags: [] }).PHD).toBe(73);
  });

  it("MID：STUDY × 8 → 26/100/28/0，PHD 仍是 73%", () => {
    const result = baseLoop("MID", outgoing, Array<Focus>(8).fill("STUDY"), mid);
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

  it("天赋的概率加成：给 n 加 100×加成，再半入并截断；不改变资格（16 §1.3）", () => {
    const input = { degree: "UG" as const, stats: stats(0, 50, 50, 0), focusCounts: counts({ STUDY: 3, CAREER: 2 }), flags: [] as string[] };
    // 03 §7.2 第 1 行：26 / 60 / 67
    expect(probabilities({ ...input, chance: { PHD: 5, LOCAL_JOB: 5, HOME_JOB: 3 } })).toEqual({ PHD: 31, LOCAL_JOB: 65, HOME_JOB: 70 });
    expect(probabilities({ ...input, chance: { PHD: -8 } })).toEqual({ PHD: 18, LOCAL_JOB: 60, HOME_JOB: 67 });
    // 加成后仍受上下限约束
    const strong = { degree: "UG" as const, stats: stats(0, 100, 100, 0), focusCounts: counts({ STUDY: 4, CAREER: 4 }), flags: ["ARC_RESEARCH_3_A"] };
    expect(probabilities({ ...strong, chance: { PHD: 10, LOCAL_JOB: 10, HOME_JOB: 10 } })).toEqual({ PHD: 85, LOCAL_JOB: 95, HOME_JOB: 95 });
    const weak = { degree: "UG" as const, stats: stats(0, 0, 0, 0), focusCounts: counts({ STUDY: 3 }), flags: [] as string[] };
    expect(probabilities({ ...weak, chance: { PHD: 5 } }).PHD).toBe(8);
    // 没有资格的那一路仍然是 null
    expect(probabilities({ ...weak, chance: { LOCAL_JOB: 8 } }).LOCAL_JOB).toBeNull();
    expect(eligibility({ ...weak, chance: { LOCAL_JOB: 8 } }).LOCAL_JOB).toBe(false);
    // 公式分解里单列一项，合计仍等于截断前的原值
    const terms = formulaTerms({ ...input, chance: { PHD: 5 } }, "PHD");
    expect(terms[terms.length - 1]).toEqual({ label: "天赋加成", hundredths: 500 });
    expect(terms.reduce((sum, term) => sum + term.hundredths, 0)).toBe(3100);
    expect(formulaTerms(input, "PHD").some((term) => term.label === "天赋加成")).toBe(false);
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

describe("硕士预算（03 §5.1；资助与开销用天赋生效后的值）", () => {
  const need = (economy: Economy, program: "MS_1Y" | "MS_2Y", totals: TalentTotals = NONE) =>
    mastersBudget(program, 0, effectiveStipend(classic(economy), totals), effectiveUpkeep(totals)).requiredReserve;

  it("没有相关天赋时的最低预留：LOW 20/36，MID 12/20，HIGH 8/12", () => {
    expect([need("LOW", "MS_1Y"), need("LOW", "MS_2Y")]).toEqual([20, 36]);
    expect([need("MID", "MS_1Y"), need("MID", "MS_2Y")]).toEqual([12, 20]);
    expect([need("HIGH", "MS_1Y"), need("HIGH", "MS_2Y")]).toEqual([8, 12]);
  });

  it("T_FRUGAL 用成本 11 重算", () => {
    const frugal = trait("FRUGAL");
    expect(need("LOW", "MS_1Y", frugal)).toBe(18);
    expect(need("LOW", "MS_2Y", frugal)).toBe(32);
    expect(need("MID", "MS_2Y", frugal)).toBe(16);
    expect(need("HIGH", "MS_2Y", frugal)).toBe(12);
  });

  it("资助与开销类天赋都会改变预留", () => {
    expect(need("LOW", "MS_2Y", totalsOf({ stipend: 3 }))).toBe(24); // 12 + (12-9)×4
    expect(need("LOW", "MS_2Y", totalsOf({ stipend: 3 }, { stipend: 2 }, { stipend: 1 }))).toBe(12); // 资助 12 已覆盖开销
    expect(need("MID", "MS_1Y", totalsOf({ upkeep: 2 }))).toBe(16); // 8 + (14-10)×2
  });

  it("资金比所需少 1 不够、刚好够", () => {
    for (const economy of ["LOW", "MID", "HIGH"] as Economy[]) {
      for (const totals of [NONE, trait("FRUGAL"), totalsOf({ upkeep: 2 }), totalsOf({ stipend: 2 })]) {
        for (const program of ["MS_1Y", "MS_2Y"] as const) {
          const stipend = effectiveStipend(classic(economy), totals);
          const cost = effectiveUpkeep(totals);
          const required = mastersBudget(program, 0, stipend, cost).requiredReserve;
          expect(mastersBudget(program, required - 1, stipend, cost).fundingEligible).toBe(false);
          expect(mastersBudget(program, required, stipend, cost).fundingEligible).toBe(true);
        }
      }
    }
  });

  it("账目字段：一年 2 学期费 8，两年 4 学期费 12", () => {
    expect(mastersBudget("MS_1Y", 30, 10, 12)).toMatchObject({ terms: 2, fee: 8, stipendTotal: 20, upkeepTotal: 24 });
    expect(mastersBudget("MS_2Y", 30, 10, 12)).toMatchObject({ terms: 4, fee: 12, stipendTotal: 40, upkeepTotal: 48 });
  });
});

describe("支线权重与分配（06 §3；天赋的支线权重加成见 16 §1.3）", () => {
  it("权重公式：OUTGOING 的友情 +2 来自天赋", () => {
    const weights = arcWeights({
      focusCounts: counts({ STUDY: 2, CAREER: 1, CAMPUS: 1, REST: 1 }),
      stats: stats(10, 60, 49, 39),
      economy: "LOW",
      bonus: trait("OUTGOING").arcWeight,
    });
    expect(weights).toEqual({
      RESEARCH: 1 + 4 + 2,
      INTERNSHIP: 1 + 2 + 1,
      FRIENDSHIP: 1 + 2 + 2,
      FAMILY: 2,
      REORIENTATION: 1 + 2 + 2,
      CREATIVE: 1 + 1 + 1,
    });
    const plain = arcWeights({ focusCounts: counts({}), stats: stats(50, 24, 24, 40), economy: "HIGH", bonus: trait("REFLECTIVE").arcWeight });
    expect(plain).toEqual({ RESEARCH: 1, INTERNSHIP: 1, FRIENDSHIP: 1, FAMILY: 1, REORIENTATION: 1, CREATIVE: 2 });
    const none = arcWeights({ focusCounts: counts({}), stats: stats(50, 24, 24, 40), economy: "HIGH", bonus: NONE.arcWeight });
    expect(none).toEqual({ RESEARCH: 1, INTERNSHIP: 1, FRIENDSHIP: 1, FAMILY: 1, REORIENTATION: 1, CREATIVE: 1 });
  });

  it("任意一条支线都可以被天赋加权", () => {
    const bonus = totalsOf({ arcWeight: { FAMILY: 3 } }, { arcWeight: { REORIENTATION: 3, RESEARCH: 3 } }, { arcWeight: { INTERNSHIP: 2 } }).arcWeight;
    const weights = arcWeights({ focusCounts: counts({}), stats: stats(50, 24, 24, 40), economy: "MID", bonus });
    expect(weights).toEqual({ RESEARCH: 4, INTERNSHIP: 3, FRIENDSHIP: 1, FAMILY: 4, REORIENTATION: 4, CREATIVE: 1 });
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
