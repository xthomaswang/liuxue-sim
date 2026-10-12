// 毕业机会（docs/03 §5–§7）：资格、整数概率、一次抽签，以及硕士方案的预算资格。
// 只读对应检查点的冻结快照；学校、档次、准备度、经济档、期待、愿望都不进公式。

import {
  CAREER_COUNT_CAP, FLAG_CREATIVE_WORK, FLAG_INTERNSHIP_PROJECT, FLAG_MASTERS_PROJECT, FLAG_MASTERS_REPORT,
  FLAG_RESEARCH_REPORT, MASTERS_ACADEMICS_MIN, MASTERS_PLANS, OPPORTUNITY_ORDER, PROBABILITY_MAX_JOB,
  PROBABILITY_MAX_PHD_MS, PROBABILITY_MAX_PHD_UG, PROBABILITY_MIN, STIPEND, STUDY_COUNT_CAP, WORK_COUNT_CAP,
} from "./constants";
import { draw01 } from "./rng";
import { clamp, copyStats, upkeepCost } from "./rules";
import type {
  Degree, Economy, FocusCounts, Graduation, MastersProgram, Opportunity, Outcome, Stats, Trait,
} from "./types";

export interface GradInput {
  degree: Degree;
  stats: Stats;
  focusCounts: FocusCounts;
  flags: readonly string[];
}

export interface GradVariables {
  A: number;
  C: number;
  S: number;
  J: number;
  W: number;
  U: number;
  s: number;
  j: number;
  w: number;
  R: 0 | 1;
  I: 0 | 1;
  V: 0 | 1;
  MR: 0 | 1;
  MP: 0 | 1;
  M: 0 | 1;
}

const bit = (value: boolean): 0 | 1 => (value ? 1 : 0);

export function gradVariables(input: GradInput): GradVariables {
  const { stats, focusCounts: c, flags } = input;
  return {
    A: stats.academics,
    C: stats.career,
    S: c.STUDY,
    J: c.CAREER,
    W: c.WORK,
    U: c.CAMPUS,
    s: Math.min(c.STUDY, STUDY_COUNT_CAP),
    j: Math.min(c.CAREER, CAREER_COUNT_CAP),
    w: Math.min(c.WORK, WORK_COUNT_CAP),
    R: bit(flags.includes(FLAG_RESEARCH_REPORT)),
    I: bit(flags.includes(FLAG_INTERNSHIP_PROJECT)),
    V: bit(flags.includes(FLAG_CREATIVE_WORK)),
    MR: bit(flags.includes(FLAG_MASTERS_REPORT)),
    MP: bit(flags.includes(FLAG_MASTERS_PROJECT)),
    M: bit(input.degree === "MS"),
  };
}

export function eligibility(input: GradInput): Record<Opportunity, boolean> {
  const v = gradVariables(input);
  return {
    PHD: v.S >= 3 || v.R === 1 || v.MR === 1,
    LOCAL_JOB: v.J >= 2 || v.I === 1 || v.V === 1 || v.MP === 1,
    HOME_JOB:
      v.J >= 1 || v.W >= 2 || v.S >= 2 || v.U >= 3 || v.R === 1 || v.I === 1 || v.V === 1 || v.MR === 1 || v.MP === 1,
  };
}

export interface FormulaTerm {
  label: string;
  hundredths: number;
}

/** 概率公式的逐项贡献，单位是百分点的百分之一；合计即截断前的 n。基础项总在，其余只列非零项。 */
export function formulaTerms(input: GradInput, opportunity: Opportunity): FormulaTerm[] {
  const v = gradVariables(input);
  const all: FormulaTerm[] =
    opportunity === "PHD"
      ? [
          { label: "基础", hundredths: -2500 },
          { label: `学业积累 ${v.A} × 0.90`, hundredths: 90 * v.A },
          { label: `学习投入 ${v.s} 次 × 2（最多计 4 次）`, hundredths: 200 * v.s },
          { label: "完成研究报告（科研支线）", hundredths: 1200 * v.R },
          { label: "硕士学历", hundredths: 1000 * v.M },
          { label: "硕士研究报告", hundredths: 600 * v.MR },
        ]
      : opportunity === "LOCAL_JOB"
        ? [
            { label: "基础", hundredths: 800 },
            { label: `职业积累 ${v.C} × 0.80`, hundredths: 80 * v.C },
            { label: `学业积累 ${v.A} × 0.15`, hundredths: 15 * v.A },
            { label: `职业准备 ${v.j} 次 × 2（最多计 4 次）`, hundredths: 200 * v.j },
            { label: "完成课程实践项目（实习支线）", hundredths: 800 * v.I },
            { label: "公开作品（创作支线）", hundredths: 500 * v.V },
            { label: "硕士学历", hundredths: 500 * v.M },
            { label: "硕士应用项目", hundredths: 500 * v.MP },
          ]
        : [
            { label: "基础", hundredths: 2000 },
            { label: `职业积累 ${v.C} × 0.65`, hundredths: 65 * v.C },
            { label: `学业积累 ${v.A} × 0.20`, hundredths: 20 * v.A },
            { label: `职业准备 ${v.j} 次 × 2（最多计 4 次）`, hundredths: 200 * v.j },
            { label: `校内兼职 ${v.w} 次 × 1（最多计 3 次）`, hundredths: 100 * v.w },
            { label: "完成课程实践项目（实习支线）", hundredths: 400 * v.I },
            { label: "完成研究报告（科研支线）", hundredths: 300 * v.R },
            { label: "公开作品（创作支线）", hundredths: 300 * v.V },
            { label: "硕士学历", hundredths: 500 * v.M },
            { label: "硕士应用项目", hundredths: 500 * v.MP },
          ];
  return all.filter((term, index) => index === 0 || term.hundredths !== 0);
}

export function rawHundredths(input: GradInput, opportunity: Opportunity): number {
  return formulaTerms(input, opportunity).reduce((sum, term) => sum + term.hundredths, 0);
}

export function probabilityCap(degree: Degree, opportunity: Opportunity): number {
  if (opportunity !== "PHD") return PROBABILITY_MAX_JOB;
  return degree === "UG" ? PROBABILITY_MAX_PHD_UG : PROBABILITY_MAX_PHD_MS;
}

/** 半入后的整数百分比（未截断）。 */
export function roundedPercent(hundredths: number): number {
  return Math.floor((hundredths + 50) / 100);
}

export function probabilityFromRaw(hundredths: number, degree: Degree, opportunity: Opportunity): number {
  return clamp(roundedPercent(hundredths), PROBABILITY_MIN, probabilityCap(degree, opportunity));
}

/** 三路机会的整数概率；无资格为 null。 */
export function probabilities(input: GradInput): Record<Opportunity, number | null> {
  const eligible = eligibility(input);
  const result = {} as Record<Opportunity, number | null>;
  for (const opportunity of OPPORTUNITY_ORDER) {
    result[opportunity] = eligible[opportunity]
      ? probabilityFromRaw(rawHundredths(input, opportunity), input.degree, opportunity)
      : null;
  }
  return result;
}

/** 冻结本学历的毕业快照并算出资格与概率；尚未抽签。 */
export function freezeGraduation(input: GradInput): Graduation {
  return {
    degree: input.degree,
    frozenStats: copyStats(input.stats),
    frozenFocusCounts: { ...input.focusCounts },
    frozenFlags: [...input.flags],
    probabilities: probabilities(input),
    rolls: null,
    outcomes: null,
    resolution: null,
  };
}

/** 有资格且 roll < p/100 才 OFFERED（等号不成功）；无资格也读取自己的 key，但记 INELIGIBLE。 */
export function outcomeFor(probability: number | null, roll: number): Outcome {
  if (probability === null) return "INELIGIBLE";
  return roll < probability / 100 ? "OFFERED" : "NOT_OFFERED";
}

export function revealGraduation(seed: number, graduation: Graduation): Graduation {
  const rolls = {} as Record<Opportunity, number>;
  const outcomes = {} as Record<Opportunity, Outcome>;
  for (const opportunity of OPPORTUNITY_ORDER) {
    rolls[opportunity] = draw01(seed, `grad:${graduation.degree}:${opportunity}`);
    outcomes[opportunity] = outcomeFor(graduation.probabilities[opportunity], rolls[opportunity]);
  }
  return { ...graduation, rolls, outcomes };
}

export function offeredList(graduation: Graduation): Opportunity[] {
  if (!graduation.outcomes) return [];
  return OPPORTUNITY_ORDER.filter((opportunity) => graduation.outcomes?.[opportunity] === "OFFERED");
}

// ---------- 硕士方案（03 §5.1） ----------

export interface MastersBudget {
  program: MastersProgram;
  terms: number;
  fee: number;
  stipendTotal: number;
  upkeepTotal: number;
  requiredReserve: number;
  fundingEligible: boolean;
}

export function mastersBudget(program: MastersProgram, money: number, economy: Economy, trait: Trait): MastersBudget {
  const plan = MASTERS_PLANS[program];
  const cost = upkeepCost(trait);
  const stipend = STIPEND[economy];
  return {
    program,
    terms: plan.terms,
    fee: plan.fee,
    stipendTotal: stipend * plan.terms,
    upkeepTotal: cost * plan.terms,
    requiredReserve: plan.fee + Math.max(0, (cost - stipend) * plan.terms),
    fundingEligible: money >= plan.fee && money - plan.fee + stipend * plan.terms >= cost * plan.terms,
  };
}

export type MastersBlocker = "HAS_JOB_OFFER" | "ACADEMICS_BELOW_55" | "FUNDS_SHORT";

/** 本科检查点能否进入某个硕士方案；返回全部不满足的条件。 */
export function mastersBlockers(
  program: MastersProgram,
  undergrad: Graduation,
  money: number,
  economy: Economy,
  trait: Trait,
): MastersBlocker[] {
  const blockers: MastersBlocker[] = [];
  const outcomes = undergrad.outcomes;
  if (outcomes && (outcomes.LOCAL_JOB === "OFFERED" || outcomes.HOME_JOB === "OFFERED")) blockers.push("HAS_JOB_OFFER");
  if (undergrad.frozenStats.academics < MASTERS_ACADEMICS_MIN) blockers.push("ACADEMICS_BELOW_55");
  if (!mastersBudget(program, money, economy, trait).fundingEligible) blockers.push("FUNDS_SHORT");
  return blockers;
}
