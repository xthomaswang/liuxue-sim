// 结局与人生回顾（docs/07）：全部由可枚举模块确定性查表组合，没有新的抽签。
// 身心与资金状态只读最终检查点的毕业快照；结局卡直接取确认去向时冻结的那一张。

import { EVENT_BY_ID, TEXTS } from "../content";
import type { FamilyRouteGroup, RouteVariantKey, ShortEndingKey } from "../content";
import {
  FOCUS_ORDER, KEY_EXPERIENCE_LABEL_MAX, KEY_EXPERIENCE_TITLE_MAX, MONEY_BUFFERED_FROM, MONEY_LIMITED_FROM,
  WELLBEING_STEADY_FROM, WELLBEING_STRETCHED_FROM,
} from "./constants";
import { FOCUS_SUMMARY_NAMES, schoolDisplayName, termTitle, tidyCjkSpacing, truncateCodePoints } from "./labels";
import { opportunityViews } from "./views";
import type {
  ActiveRun, ChoiceId, EducationPath, EndingRecord, EndingView, FinalRoute, MoneyBand, ReviewEntry, RunState,
  WellbeingBand,
} from "./types";

export function wellbeingBand(wellbeing: number): WellbeingBand {
  if (wellbeing >= WELLBEING_STEADY_FROM) return "STEADY";
  if (wellbeing >= WELLBEING_STRETCHED_FROM) return "STRETCHED";
  return "DRAINED";
}

export function moneyBand(money: number): MoneyBand {
  if (money >= MONEY_BUFFERED_FROM) return "BUFFERED";
  if (money >= MONEY_LIMITED_FROM) return "LIMITED";
  return "NARROW";
}

function variantKey(ending: EndingRecord): RouteVariantKey {
  if (ending.route === "PHD") return ending.degree === "UG" ? "PHD/undergrad_direct" : "PHD/masters_entry";
  if (ending.route === "TRANSITION") {
    return ending.transitionMode === "SELF_CHOSEN" ? "TRANSITION/SELF_CHOSEN" : "TRANSITION/NO_OFFER";
  }
  return ending.route;
}

function shortKey(ending: EndingRecord): ShortEndingKey {
  if (ending.route === "PHD") return "PHD/ANY";
  if (ending.route === "TRANSITION") {
    return ending.transitionMode === "SELF_CHOSEN" ? "TRANSITION/SELF_CHOSEN" : "TRANSITION/NO_OFFER";
  }
  return ending.route;
}

const FAMILY_GROUP: Readonly<Record<FinalRoute, FamilyRouteGroup>> = {
  PHD: "RESEARCH",
  LOCAL_JOB: "WORK",
  HOME_JOB: "WORK",
  TRANSITION: "PAUSE",
};

/** 通过唯一标记反查某个事件实际选了哪一项；缺失或双选属于数据错误。 */
function chosenChoice(run: ActiveRun, eventId: string): ChoiceId {
  const hasA = run.flags.includes(`${eventId}_A`);
  const hasB = run.flags.includes(`${eventId}_B`);
  if (hasA === hasB) throw new Error(`REVIEW_FLAG_INVALID: ${eventId} 需要恰好一个 A/B 标记`);
  return hasA ? "A" : "B";
}

function reviewEventIds(run: ActiveRun): string[] {
  const ids = ["HS_01", "HS_02", "CORE_01", "CORE_04", "CORE_08"];
  for (const slot of ["A", "B"] as const) {
    const arc = run.arcs[slot];
    if (arc) ids.push(`ARC_${arc}_3`);
  }
  if (run.mastersYears !== null) ids.push("MASTER_04");
  return ids;
}

function reviewEntries(run: ActiveRun): ReviewEntry[] {
  const wanted = new Set(reviewEventIds(run));
  const entries: ReviewEntry[] = [];
  // history 本身就是真实时间顺序，同一学期主线先于支线。
  for (const item of run.history) {
    if (item.kind !== "EVENT" || !item.eventId || !wanted.has(item.eventId)) continue;
    const event = EVENT_BY_ID[item.eventId];
    const choiceId = chosenChoice(run, item.eventId);
    if (item.choiceId !== choiceId) throw new Error(`REVIEW_HISTORY_MISMATCH: ${item.eventId}`);
    const choice = event?.choices.find((option) => option.id === choiceId);
    if (!event || !choice) throw new Error(`REVIEW_EVENT_UNKNOWN: ${item.eventId}`);
    entries.push({
      eventId: event.id,
      title: event.title,
      choiceId,
      choiceLabel: choice.label,
      result: choice.result,
      when: termTitle(item.stage, item.termIndex),
    });
    wanted.delete(item.eventId);
  }
  if (wanted.size > 0) throw new Error(`REVIEW_EVENT_NOT_PLAYED: ${[...wanted].join(", ")}`);
  return entries;
}

/** 关键经历：优先已完成的 MASTER_04，否则实际最后发生的支线第 3 幕，否则 CORE_08。 */
function keyExperience(run: ActiveRun): string {
  const candidates: string[] = [];
  if (run.mastersYears !== null) candidates.push("MASTER_04");
  if (run.arcs.B) candidates.push(`ARC_${run.arcs.B}_3`); // 槽 B 第三幕在 S7，晚于槽 A 的 S6
  if (run.arcs.A) candidates.push(`ARC_${run.arcs.A}_3`);
  candidates.push("CORE_08");
  const eventId = candidates.find((id) => run.flags.includes(`${id}_A`) || run.flags.includes(`${id}_B`));
  if (!eventId) throw new Error("KEY_EXPERIENCE_MISSING");
  const event = EVENT_BY_ID[eventId];
  const choice = event?.choices.find((option) => option.id === chosenChoice(run, eventId));
  if (!event || !choice) throw new Error(`KEY_EXPERIENCE_UNKNOWN: ${eventId}`);
  const title = truncateCodePoints(event.title, KEY_EXPERIENCE_TITLE_MAX);
  const label = truncateCodePoints(choice.label, KEY_EXPERIENCE_LABEL_MAX);
  return `你记得「${title}」里的决定：${label}。`;
}

/** ENDING 阶段的完整结局视图（docs/07 + docs/14）；其它阶段为 null。 */
export function endingView(state: RunState): EndingView | null {
  if (state.phase !== "ENDING") return null;
  const run = state;
  const ending = run.ending;
  const school = run.school;
  if (!ending || !school) throw new Error("ENDING_STATE_INCOMPLETE");
  const checkpoint = run.graduations[ending.degree];
  if (!checkpoint) throw new Error("ENDING_CHECKPOINT_MISSING");
  const a = run.admission;
  if (a.readiness === null || a.strategy === null) throw new Error("ENDING_ADMISSION_MISSING");

  const educationPath: EducationPath = run.mastersYears === null ? "UG" : run.mastersYears === 1 ? "MS_1Y" : "MS_2Y";
  const yearsLabel = run.mastersYears === 1 ? "一年制硕士" : "两年制硕士";
  let label: string;
  let labelExtra: string | null = null;
  if (ending.route === "PHD") {
    if (ending.degree === "UG") label = "本科直博 · 即将入学";
    else {
      label = "硕士后申博 · 即将入学";
      labelExtra = yearsLabel;
    }
  } else {
    label = ending.degree === "UG" ? "本科毕业" : `${yearsLabel}毕业`;
  }

  const wb = wellbeingBand(checkpoint.frozenStats.wellbeing);
  const money = moneyBand(checkpoint.frozenStats.money);
  const variant = variantKey(ending);
  const schoolName = schoolDisplayName(school);
  const strategyName = a.strategy === "REACH" ? "冲刺" : "稳健";

  const arcRecaps: string[] = [];
  for (const slot of ["A", "B"] as const) {
    const arc = run.arcs[slot];
    if (!arc) continue;
    const flag = `ARC_${arc}_3_${chosenChoice(run, `ARC_${arc}_3`)}`;
    const sentence = TEXTS.arcRecap[flag];
    if (!sentence) throw new Error(`ARC_RECAP_MISSING: ${flag}`);
    arcRecaps.push(sentence);
  }

  return {
    seed: run.seed,
    route: ending.route,
    degree: ending.degree,
    educationPath,
    transitionMode: ending.transitionMode,
    entryMode: ending.entryMode,
    title: TEXTS.ending.route[variant].title,
    label,
    labelExtra,
    short: {
      text: TEXTS.ending.short[shortKey(ending)],
      keyExperience: keyExperience(run),
      status: `${TEXTS.ending.stateShort[wb]}${TEXTS.ending.stateShort[money]}`,
    },
    opportunities: opportunityViews(checkpoint),
    full: {
      body: TEXTS.ending.route[variant].body,
      bridge: tidyCjkSpacing(TEXTS.ending.bridge[educationPath].split("{schoolName}").join(schoolName)),
      wellbeing: { band: wb, text: TEXTS.ending.wellbeingState[wb] },
      money: { band: money, text: TEXTS.ending.moneyState[money] },
      aspiration: TEXTS.ending.aspirationResponse[run.profile.aspiration][ending.route],
      family: TEXTS.ending.familyResponse[run.profile.expectation][FAMILY_GROUP[ending.route]],
      applicationSummary: tidyCjkSpacing(
        `当时的申请准备度为 ${a.readiness}，你选择了${strategyName}方案，最后在三所 offer 中选择了 ${schoolName}。`,
      ),
      review: reviewEntries(run),
      arcRecaps,
      focusSummary: FOCUS_ORDER.map((focus) => ({
        focus,
        name: FOCUS_SUMMARY_NAMES[focus],
        count: checkpoint.frozenFocusCounts[focus],
      })),
      epilogue: TEXTS.ending.epilogue[variant],
      undergradOpportunities:
        run.mastersYears !== null && run.graduations.UG ? opportunityViews(run.graduations.UG) : null,
    },
    card: ending.card,
  };
}
