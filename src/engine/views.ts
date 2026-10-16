// 给界面的只读选择器。不改状态、不抽新的随机数；界面看到的每个数字都从这里来。

import { EVENT_BY_ID, TEXTS } from "../content";
import { baseReadinessFor, finalReadiness, tierOdds, tierWeights } from "./admission";
import {
  LIFE_YEARS, MASTERS_ACADEMICS_MIN, MASTERS_PLANS, MASTERS_PROGRAM_ORDER, OPPORTUNITY_ORDER, PROBABILITY_MIN,
  READINESS_BONUS, STRATEGY_BY_FLAG,
} from "./constants";
import {
  eligibility, formulaTerms, gradVariables, mastersBlockers, mastersBudget, offeredList, probabilityCap,
  rawHundredths, roundedPercent,
} from "./graduation";
import type { GradInput } from "./graduation";
import {
  DEGREE_NAMES, FOCUS_OUTCOME_SENTENCES, OPPORTUNITY_NAMES, ROUTE_NAMES, eventKindLabel, renderTemplate, termTitle,
  tidyCjkSpacing,
} from "./labels";
import { findHappening, findLifeEvent, findPlan, findSummer, lifeTrackContent } from "./pools";
import { expectedEventId, planVectorFor, slateOf, talentTotalsOf, termCountOf } from "./reducer";
import { applyDelta, clamp, efficiencyFactor } from "./rules";
import { effectiveStipend, effectiveUpkeep } from "./talents";
import type {
  ActiveRun, AdmissionPreview, AdmissionResult, ChoiceView, Degree, Delta, EventView, FocusView, Graduation,
  GraduationView, HistoryEntry, LastOutcome, LedgerLine, MastersOption, Opportunity, OpportunityView, RouteOption,
  RunState, SceneIntro, StageInfo, Strategy, TermLedger,
} from "./types";

function active(state: RunState): ActiveRun | null {
  return state.phase === "SETUP" ? null : state;
}

const deltaOf = (entry: HistoryEntry): Delta => ({ requested: { ...entry.requestedDelta }, applied: { ...entry.appliedDelta } });

// ---------- 阶段 ----------

export function stageInfo(state: RunState): StageInfo {
  const run = active(state);
  if (!run) return { stage: "SETUP", title: "开局", step: null, termIndex: 0, termCount: 0 };
  if (run.phase === "ENDING") return { stage: "END", title: "人生回顾", step: null, termIndex: 0, termCount: 0 };
  if (run.phase === "HIGH_SCHOOL_EVENT") {
    return { stage: "HS", title: "高中最后一年", step: `事件 ${run.highSchoolNode ?? 1} / 2`, termIndex: 0, termCount: 0 };
  }
  if (run.phase === "SCHOOL_OFFERS") return { stage: "HS", title: "申请结果", step: null, termIndex: 0, termCount: 0 };
  if (run.phase === "LIFE") {
    // 毕业（或离校）之后：标题是接下来要过的那一年
    const year = (run.life?.year ?? 0) + 1;
    const left = run.ending?.kind === "EARLY" ? "离校" : "毕业";
    return { stage: "LIFE", title: `${left}第 ${year} 年`, step: `第 ${year} / ${LIFE_YEARS} 年`, termIndex: run.life?.year ?? 0, termCount: LIFE_YEARS };
  }
  const termCount = termCountOf(run);
  if (run.phase === "GRAD_PREVIEW" || run.phase === "GRAD_RESULTS") {
    const degree: Degree = run.stage === "MS" ? "MS" : "UG";
    return { stage: run.stage, title: `${DEGREE_NAMES[degree]}毕业机会`, step: null, termIndex: run.termIndex, termCount };
  }
  return {
    stage: run.stage,
    title: termTitle(run.stage, run.termIndex),
    step: `节点 ${run.termIndex} / ${termCount}`,
    termIndex: run.termIndex,
    termCount,
  };
}

/** 高中第一张事件前的开场白、本科第 1 学期选择安排前的入学旁白；其它时候为 null。 */
export function sceneIntro(state: RunState): SceneIntro | null {
  const run = active(state);
  if (!run) return null;
  if (run.phase === "HIGH_SCHOOL_EVENT" && run.highSchoolNode === 1) {
    return { short: TEXTS.narration.highSchoolShort, long: TEXTS.narration.highSchoolLong };
  }
  if (run.phase === "FOCUS" && run.stage === "UG" && run.termIndex === 1 && run.school) {
    return {
      short: tidyCjkSpacing(renderTemplate(TEXTS.narration.enrollmentShort, run.school, "")),
      long: tidyCjkSpacing(renderTemplate(TEXTS.narration.enrollmentLong, run.school, "")),
    };
  }
  return null;
}

// ---------- 事件 ----------

/** HIGH_SCHOOL_EVENT / CORE_EVENT / ARC_EVENT 阶段的当前事件；其它阶段为 null。 */
export function currentEvent(state: RunState): EventView | null {
  const run = active(state);
  if (!run) return null;
  const eventId = expectedEventId(run);
  if (!eventId) return null;
  const event = EVENT_BY_ID[eventId];
  if (!event) throw new Error(`EVENT_DATA_MISSING: ${eventId}`);
  const matchedCallbacks = event.callbacks.filter((callback) => run.flags.includes(callback.ifFlag));
  const inTerm = run.stage !== "HS";
  const cost = inTerm ? effectiveUpkeep(talentTotalsOf(run)) : 0;

  const choices: ChoiceView[] = event.choices.map((choice) => {
    const spend = choice.effects.money < 0 ? -choice.effects.money : 0;
    const available = spend === 0 || run.stats.money >= spend;
    const { after, applied } = applyDelta(run.stats, choice.effects);
    let admission: ChoiceView["admission"] = null;
    if (event.kind === "highschool") {
      const flag = choice.setFlags[0];
      if (event.node === 1) {
        const bonus = READINESS_BONUS[flag] ?? null;
        admission = {
          readinessBonus: bonus,
          readinessAfter: bonus === null ? null : finalReadiness(run.admission.baseReadiness, bonus, run.admission.talentBonus),
          strategy: null,
          odds: null,
        };
      } else {
        const strategy: Strategy | null = STRATEGY_BY_FLAG[flag] ?? null;
        const readiness = readinessSoFar(run);
        admission = {
          readinessBonus: null,
          readinessAfter: readiness,
          strategy,
          odds: strategy ? tierOdds(tierWeights(readiness, strategy)) : null,
        };
      }
    }
    return {
      choice,
      available,
      shortBy: available ? null : { need: spend, have: run.stats.money },
      delta: { requested: { ...choice.effects }, applied },
      projected: inTerm
        ? {
            moneyAfterChoice: after.money,
            upkeep: cost,
            moneyAfterUpkeep: Math.max(0, after.money - cost),
            shortfall: Math.max(0, cost - after.money),
          }
        : null,
      admission,
    };
  });

  return {
    event,
    kindLabel: eventKindLabel(event),
    matchedCallbacks,
    defaultCallback: matchedCallbacks.length > 0 ? matchedCallbacks[matchedCallbacks.length - 1] : null,
    choices,
  };
}

// ---------- 学期安排 ----------

/** 某学期的全部记录；学期之后的暑假（记在刚结束的学期上）不算在学期账目里。 */
function entriesOf(run: ActiveRun, termIndex: number): HistoryEntry[] {
  return run.history.filter((entry) => entry.stage === run.stage && entry.termIndex === termIndex && entry.kind !== "SUMMER");
}

/** FOCUS 阶段：本学期的资助、突发小事与可选的安排；其它阶段为 null。 */
export function focusView(state: RunState): FocusView | null {
  const run = active(state);
  if (!run || run.phase !== "FOCUS") return null;
  const entries = entriesOf(run, run.termIndex);
  const stipendEntry = entries.find((entry) => entry.kind === "STIPEND");
  if (!stipendEntry) throw new Error("STIPEND_ENTRY_MISSING");
  const happeningEntry = entries.find((entry) => entry.kind === "HAPPENING");
  const happening = happeningEntry?.happeningId ? findHappening(happeningEntry.happeningId) : undefined;
  if (happeningEntry && !happening) throw new Error(`HAPPENING_DATA_MISSING: ${String(happeningEntry.happeningId)}`);

  const totals = talentTotalsOf(run);
  const cost = effectiveUpkeep(totals);
  const factor = efficiencyFactor(run.stats.wellbeing, totals.efficiencyFloor);
  return {
    stipend: deltaOf(stipendEntry),
    upkeep: cost,
    efficiency: { factor, note: TEXTS.efficiency[String(factor) as "10" | "8" | "6"] },
    happening: happeningEntry && happening ? { id: happening.id, text: happening.text, delta: deltaOf(happeningEntry) } : null,
    options: slateOf(run).plans.map((plan) => {
      const vector = planVectorFor(run, plan, totals);
      const spend = vector.requested.money < 0 ? -vector.requested.money : 0;
      const available = spend === 0 || run.stats.money >= spend;
      const { after, applied } = applyDelta(run.stats, vector.requested);
      return {
        plan,
        focus: plan.focus,
        name: plan.name,
        requested: vector.requested,
        applied,
        available,
        shortBy: available ? null : { need: spend, have: run.stats.money },
        talentApplied: vector.talentApplied,
        efficiencyApplied: vector.efficiencyApplied,
        projectedShortfall: Math.max(0, cost - after.money),
      };
    }),
  };
}

// ---------- 上一步结果与学期账目 ----------

/** 上一步操作（revision-1）留下的结果：安排、事件或硕士入学费；没有则 null。 */
export function lastOutcome(state: RunState): LastOutcome | null {
  const run = active(state);
  if (!run) return null;
  const entry = run.history.find(
    (item) =>
      item.revision === run.revision - 1 && (item.kind === "EVENT" || item.kind === "FOCUS" || item.kind === "MASTERS_FEE"),
  );
  if (!entry) return null;
  if (entry.kind === "EVENT") {
    const event = entry.eventId ? EVENT_BY_ID[entry.eventId] : undefined;
    const choice = event?.choices.find((item) => item.id === entry.choiceId);
    if (!event || !choice) throw new Error(`HISTORY_EVENT_UNKNOWN: ${String(entry.eventId)}`);
    return {
      kind: "EVENT",
      heading: event.title,
      choiceLabel: choice.label,
      shortText: choice.shortResult,
      longText: choice.result,
      delta: deltaOf(entry),
    };
  }
  if (entry.kind === "FOCUS") {
    if (!entry.focus) throw new Error("HISTORY_FOCUS_UNKNOWN");
    const plan = entry.planId ? findPlan(entry.planId) : undefined;
    return {
      kind: "FOCUS",
      heading: plan?.name ?? TEXTS.focus[entry.focus].name,
      choiceLabel: null,
      shortText: FOCUS_OUTCOME_SENTENCES[entry.focus],
      longText: null,
      delta: deltaOf(entry),
    };
  }
  return {
    kind: "MASTERS_FEE",
    heading: entry.program ? TEXTS.mastersProgram[entry.program].name : "硕士",
    choiceLabel: null,
    shortText: "你确认了硕士方案，一次性付清了入学费用。",
    longText: null,
    delta: deltaOf(entry),
  };
}

function ledgerLine(entry: HistoryEntry): LedgerLine {
  const delta = deltaOf(entry);
  switch (entry.kind) {
    case "STIPEND":
      return { kind: entry.kind, label: "家庭资助", detail: null, delta };
    case "HAPPENING":
      return { kind: entry.kind, label: "突发小事", detail: entry.happeningId ? (findHappening(entry.happeningId)?.text ?? null) : null, delta };
    case "FOCUS": {
      const plan = entry.planId ? findPlan(entry.planId) : undefined;
      return { kind: entry.kind, label: "安排", detail: plan?.name ?? (entry.focus ? TEXTS.focus[entry.focus].name : null), delta };
    }
    case "EVENT": {
      const event = entry.eventId ? EVENT_BY_ID[entry.eventId] : undefined;
      const choice = event?.choices.find((item) => item.id === entry.choiceId);
      return { kind: entry.kind, label: event?.title ?? "事件", detail: choice?.label ?? null, delta };
    }
    case "UPKEEP": {
      const shortfall = entry.upkeep?.shortfall ?? 0;
      return {
        kind: entry.kind,
        label: "必要开销",
        detail: shortfall > 0 ? `短缺 ${shortfall}，临时压缩安排带来额外消耗` : null,
        delta,
      };
    }
    case "GROWTH":
      return { kind: entry.kind, label: "学期基础变化", detail: null, delta };
    case "MASTERS_FEE":
      return { kind: entry.kind, label: "硕士入学费", detail: null, delta };
    case "SUMMER":
      return { kind: entry.kind, label: "暑假", detail: entry.summerId ? (findSummer(entry.summerId)?.text ?? null) : null, delta };
    case "LIFE_BASE": {
      const texts = entry.track ? lifeTrackContent(entry.track).base.texts : [];
      return { kind: entry.kind, label: "这一年", detail: entry.textIndex !== undefined ? (texts[entry.textIndex] ?? null) : null, delta };
    }
    case "LIFE_PLAN": {
      const plan = entry.track ? lifeTrackContent(entry.track).plans.find((item) => item.focus === entry.focus) : undefined;
      return { kind: entry.kind, label: "这一年的重心", detail: plan?.name ?? null, delta };
    }
    case "LIFE_EVENT":
      return {
        kind: entry.kind,
        label: entry.milestone ? "里程碑" : "生活小事",
        detail: entry.lifeEventId ? (findLifeEvent(entry.lifeEventId)?.text ?? null) : null,
        delta,
      };
  }
}

/**
 * 最近结束的那个学期的账目（第二版没有“学期小结”这一屏，账目显示在下一屏上方）：
 * FOCUS 阶段且本学段已经过了第 1 学期 → 上一学期；GRAD_PREVIEW / GRAD_RESULTS → 最后一学期；其它情况 null。
 */
export function termLedger(state: RunState): TermLedger | null {
  const run = active(state);
  if (!run || (run.stage !== "UG" && run.stage !== "MS")) return null;
  const termCount = termCountOf(run);
  let termIndex: number;
  if (run.phase === "FOCUS" && run.termIndex > 1) termIndex = run.termIndex - 1;
  else if (run.phase === "GRAD_PREVIEW" || run.phase === "GRAD_RESULTS") termIndex = termCount;
  else return null;
  const entries = entriesOf(run, termIndex);
  if (entries.length === 0) throw new Error("TERM_ENTRIES_MISSING");
  const upkeepEntry = entries.find((entry) => entry.kind === "UPKEEP");
  return {
    stage: run.stage,
    termIndex,
    termCount,
    title: termTitle(run.stage, termIndex),
    startStats: { ...entries[0].beforeStats },
    endStats: { ...entries[entries.length - 1].afterStats },
    lines: entries.map(ledgerLine),
    shortfall: upkeepEntry?.upkeep?.shortfall ?? 0,
    stress: upkeepEntry?.upkeep?.stress ?? 0,
    isFinalTerm: termIndex >= termCount,
  };
}

// ---------- 申请 ----------

function hs01Bonus(flags: readonly string[]): number | null {
  const hit = Object.keys(READINESS_BONUS).find((flag) => flags.includes(flag));
  return hit ? READINESS_BONUS[hit] : null;
}

function readinessSoFar(run: ActiveRun): number {
  return finalReadiness(run.admission.baseReadiness, hs01Bonus(run.flags) ?? 0, run.admission.talentBonus);
}

/** 高中阶段可见的申请准备度与两种策略的档次概率预览。SETUP 也可调用（此时天赋加成记为 0）。 */
export function admissionPreview(state: RunState): AdmissionPreview {
  const run = active(state);
  const baseReadiness = run ? run.admission.baseReadiness : baseReadinessFor(state.seed);
  const talentBonus = run ? run.admission.talentBonus : 0;
  const readinessBonus = run ? hs01Bonus(run.flags) : null;
  const soFar = finalReadiness(baseReadiness, readinessBonus ?? 0, talentBonus);
  return {
    baseReadiness,
    talentBonus,
    readinessBonus,
    readinessSoFar: soFar,
    odds: {
      REACH: tierOdds(tierWeights(soFar, "REACH")),
      STEADY: tierOdds(tierWeights(soFar, "STEADY")),
    },
  };
}

/** HS_02 结算之后的申请结果与三校 offer；之前为 null。 */
export function admissionResult(state: RunState): AdmissionResult | null {
  const run = active(state);
  if (!run || !run.offers) return null;
  const a = run.admission;
  if (a.tier === null || a.readiness === null || a.readinessBonus === null || a.strategy === null || a.weights === null || a.poolRoll === null || a.tierRoll === null) {
    return null;
  }
  return {
    baseReadiness: a.baseReadiness,
    talentBonus: a.talentBonus,
    readinessBonus: a.readinessBonus,
    readiness: a.readiness,
    strategy: a.strategy,
    odds: tierOdds(a.weights),
    tier: a.tier,
    poolRoll: a.poolRoll,
    tierRoll: a.tierRoll,
    offers: run.offers,
    chosen: run.school,
  };
}

// ---------- 毕业机会 ----------

function requirementsFor(input: GradInput, opportunity: Opportunity): Array<{ text: string; met: boolean }> {
  const v = gradVariables(input);
  const study = (min: number) => ({ text: `学习投入至少 ${min} 次（当前 ${v.S} 次）`, met: v.S >= min });
  const career = (min: number) => ({ text: `职业准备至少 ${min} 次（当前 ${v.J} 次）`, met: v.J >= min });
  const research = { text: "完成科研支线的研究报告", met: v.R === 1 };
  const internship = { text: "完成实习支线的课程实践项目", met: v.I === 1 };
  const creative = { text: "公开创作支线的作品", met: v.V === 1 };
  const mastersReport = { text: "完成硕士研究报告", met: v.MR === 1 };
  const mastersProject = { text: "完成硕士应用项目", met: v.MP === 1 };
  const isMasters = input.degree === "MS";
  if (opportunity === "PHD") return [study(3), research, ...(isMasters ? [mastersReport] : [])];
  if (opportunity === "LOCAL_JOB") return [career(2), internship, creative, ...(isMasters ? [mastersProject] : [])];
  return [
    career(1),
    { text: `校内兼职至少 2 次（当前 ${v.W} 次）`, met: v.W >= 2 },
    study(2),
    { text: `校园生活至少 3 次（当前 ${v.U} 次）`, met: v.U >= 3 },
    research,
    internship,
    creative,
    ...(isMasters ? [mastersReport, mastersProject] : []),
  ];
}

/** chance 是本局天赋给各路机会的概率加成（百分点），在公式分解里单列一项。 */
export function opportunityViews(graduation: Graduation, chance: Partial<Record<Opportunity, number>> = {}): OpportunityView[] {
  const input: GradInput = {
    degree: graduation.degree,
    stats: graduation.frozenStats,
    focusCounts: graduation.frozenFocusCounts,
    flags: graduation.frozenFlags,
    chance,
  };
  const eligible = eligibility(input);
  return OPPORTUNITY_ORDER.map((id) => {
    const probability = graduation.probabilities[id];
    const raw = roundedPercent(rawHundredths(input, id));
    const cap = probabilityCap(graduation.degree, id);
    return {
      id,
      name: OPPORTUNITY_NAMES[id],
      eligible: eligible[id],
      probability,
      outcome: graduation.outcomes ? graduation.outcomes[id] : null,
      roll: graduation.rolls ? graduation.rolls[id] : null,
      requirements: requirementsFor(input, id),
      breakdown: formulaTerms(input, id),
      clampedTo: probability === null ? null : raw < PROBABILITY_MIN ? "MIN" : raw > cap ? "MAX" : null,
    };
  });
}

/** 指定学历的毕业快照视图；缺省取当前学段。快照尚未冻结则为 null。 */
export function graduationView(state: RunState, degree?: Degree): GraduationView | null {
  const run = active(state);
  if (!run) return null;
  const which: Degree | null = degree ?? (run.stage === "UG" || run.stage === "MS" ? run.stage : null);
  if (!which) return null;
  const graduation = run.graduations[which];
  if (!graduation) return null;
  return {
    degree: which,
    revealed: graduation.outcomes !== null,
    frozenStats: { ...graduation.frozenStats },
    frozenFocusCounts: { ...graduation.frozenFocusCounts },
    opportunities: opportunityViews(graduation, talentTotalsOf(run).chance),
    resolution: graduation.resolution,
  };
}

function resultsCheckpoint(run: ActiveRun): Graduation | null {
  if (run.phase !== "GRAD_RESULTS" || (run.stage !== "UG" && run.stage !== "MS")) return null;
  const graduation = run.graduations[run.stage];
  return graduation?.outcomes ? graduation : null;
}

/** GRAD_RESULTS 阶段的四个去向（PHD/LOCAL_JOB/HOME_JOB/TRANSITION）；其它阶段为空数组。 */
export function routeOptions(state: RunState): RouteOption[] {
  const run = active(state);
  const graduation = run ? resultsCheckpoint(run) : null;
  if (!graduation?.outcomes) return [];
  const accepted: Record<Opportunity, string> = {
    PHD: "接受录取，本局以博士入学结束。",
    LOCAL_JOB: "接受这次留美工作机会，本局结束。",
    HOME_JOB: "接受这次回国工作机会，本局结束。",
  };
  const options: RouteOption[] = OPPORTUNITY_ORDER.map((route) => {
    const outcome = graduation.outcomes?.[route];
    return {
      route,
      name: ROUTE_NAMES[route],
      available: outcome === "OFFERED",
      note: outcome === "OFFERED" ? accepted[route] : outcome === "INELIGIBLE" ? "准备尚不足，这一轮没有申请资格。" : "这次没有取得。",
    };
  });
  options.push({
    route: "TRANSITION",
    name: ROUTE_NAMES.TRANSITION,
    available: true,
    note:
      offeredList(graduation).length > 0
        ? "手里的机会暂时都不接受，先给自己留一段空白。"
        : "这一轮没有取得机会，先进入一段过渡期。",
  });
  return options;
}

/**
 * 本科 GRAD_RESULTS 阶段的两个硕士方案（含不可选原因）；其它情况为空数组。预算用天赋生效后的资助与开销。
 * HAS_JOB_OFFER 这条阻碍只在经典模式出现。
 */
export function mastersOptions(state: RunState): MastersOption[] {
  const run = active(state);
  const graduation = run ? resultsCheckpoint(run) : null;
  if (!run || !graduation || run.stage !== "UG" || run.mastersYears !== null) return [];
  const money = run.stats.money;
  const totals = talentTotalsOf(run);
  const stipend = effectiveStipend(run.profile, totals);
  const cost = effectiveUpkeep(totals);
  return MASTERS_PROGRAM_ORDER.map((program) => {
    const budget = mastersBudget(program, money, stipend, cost);
    // 正式玩法不再要求“两种工作都没有取得”（docs/22 §3.4）；经典模式仍按第一版的规则。
    const codes = mastersBlockers(program, graduation, money, stipend, cost, run.mode === "classic");
    const blockers: MastersOption["blockers"] = codes.map((code) => {
      if (code === "HAS_JOB_OFFER") return { code, text: "已取得工作机会，首版不开放硕士（即使不打算接受这份工作）。" };
      if (code === "ACADEMICS_BELOW_55") {
        return { code, text: `学业积累 ${graduation.frozenStats.academics}，未达到 ${MASTERS_ACADEMICS_MIN}。` };
      }
      const need = Math.max(budget.requiredReserve, budget.fee);
      return { code, text: `需要预留 ${need}，当前 ${money}，还差 ${clamp(need - money, 0, 1000)}。` };
    });
    return {
      program,
      name: TEXTS.mastersProgram[program].name,
      terms: MASTERS_PLANS[program].terms,
      fee: budget.fee,
      stipendTotal: budget.stipendTotal,
      upkeepTotal: budget.upkeepTotal,
      requiredReserve: budget.requiredReserve,
      money,
      eligible: codes.length === 0,
      blockers,
    };
  });
}
