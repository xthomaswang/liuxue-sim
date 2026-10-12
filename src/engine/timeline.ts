// 人生轨迹与人生总结（docs/22 第 5 节）：把一局的历史整理成一段段给界面按顺序显示；不改状态、不抽随机数。
// 对还没走完的局也能返回到目前为止的轨迹。

import { EVENT_BY_ID, TEXTS } from "../content";
import { FOCUS_ORDER, OPPORTUNITY_ORDER, STAT_KEYS, STAT_RATINGS } from "./constants";
import { findEarlyEnding, termLabel } from "./early";
import { endingLabel, isGraduationEnding, keyExperience, shortKey, variantKey } from "./ending";
import { DEGREE_NAMES, FOCUS_SUMMARY_NAMES, schoolDisplayName } from "./labels";
import { findHappening, findPlan } from "./pools";
import { talentTotalsOf } from "./reducer";
import { talentsByIds } from "./talents";
import { opportunityViews } from "./views";
import type {
  ActiveRun, Degree, Graduation, HistoryEntry, RunState, Stats, SummaryView, TimelineEntry, TimelineLine,
} from "./types";

const copy = (stats: Stats): Stats => ({ money: stats.money, academics: stats.academics, career: stats.career, wellbeing: stats.wellbeing });
const TIER_WORDS: Readonly<Record<string, string>> = { S: "S 档", A: "A 档", B: "B 档", C: "C 档", D: "D 档", U: "未分档" };

function eventLine(entry: HistoryEntry): TimelineLine {
  const event = entry.eventId ? EVENT_BY_ID[entry.eventId] : undefined;
  const choice = event?.choices.find((item) => item.id === entry.choiceId);
  if (!event || !choice) throw new Error(`TIMELINE_EVENT_UNKNOWN: ${String(entry.eventId)}`);
  // 〈事件标题〉 + 所选选项的名字 + 短结果
  return { kind: "EVENT", text: `〈${event.title}〉${choice.label}。${choice.shortResult}`, delta: copy(entry.appliedDelta) };
}

/** 一个学期里按发生顺序给出的各行：突发小事、安排、主线槽事件、支线事件；期末资金短缺时加一行。 */
function termLines(entries: readonly HistoryEntry[]): TimelineLine[] {
  const lines: TimelineLine[] = [];
  for (const entry of entries) {
    if (entry.kind === "HAPPENING") {
      const happening = entry.happeningId ? findHappening(entry.happeningId) : undefined;
      if (!happening) throw new Error(`TIMELINE_HAPPENING_UNKNOWN: ${String(entry.happeningId)}`);
      lines.push({ kind: "HAPPENING", text: happening.text, delta: copy(entry.appliedDelta) });
    } else if (entry.kind === "FOCUS") {
      const plan = entry.planId ? findPlan(entry.planId) : undefined;
      const name = plan?.name ?? (entry.focus ? TEXTS.focus[entry.focus].name : null);
      if (!name) throw new Error("TIMELINE_PLAN_UNKNOWN");
      lines.push({ kind: "PLAN", text: `这学期的安排：${name}。`, delta: copy(entry.appliedDelta) });
    } else if (entry.kind === "EVENT") {
      lines.push(eventLine(entry));
    } else if (entry.kind === "UPKEEP" && (entry.upkeep?.shortfall ?? 0) > 0) {
      lines.push({
        kind: "SHORTFALL",
        text: `期末的钱没能撑到头，还差 ${entry.upkeep?.shortfall}，只能东拼西凑地熬过去。`,
        delta: copy(entry.appliedDelta),
      });
    }
  }
  return lines;
}

function admissionLines(run: ActiveRun): TimelineLine[] {
  const a = run.admission;
  if (!run.offers || a.readiness === null || a.strategy === null || a.tier === null) return [];
  const lines: TimelineLine[] = [
    {
      kind: "ADMISSION",
      text: `申请准备度 ${a.readiness}，走的是${a.strategy === "REACH" ? "冲刺" : "稳健"}方案，最后抽中的是${TIER_WORDS[a.tier] ?? a.tier}的学校。`,
      delta: null,
    },
    { kind: "ADMISSION", text: `收到三所 offer：${run.offers.map(schoolDisplayName).join("、")}。`, delta: null },
  ];
  if (run.school) lines.push({ kind: "SCHOOL", text: `你选了${schoolDisplayName(run.school)}。`, delta: null });
  return lines;
}

function opportunityLines(graduation: Graduation, run: ActiveRun): TimelineLine[] {
  return opportunityViews(graduation, talentTotalsOf(run).chance).map((item) => {
    let text: string;
    if (item.probability === null) text = `${item.name}：准备尚不足。`;
    else if (item.outcome === null) text = `${item.name}：${item.probability}% 的机会，结果还没出来。`;
    else text = `${item.name}：${item.probability}% 的机会，${item.outcome === "OFFERED" ? "拿到了" : "这次没有拿到"}。`;
    return { kind: "OPPORTUNITY", text, delta: null };
  });
}

function resolutionLine(run: ActiveRun, graduation: Graduation): TimelineLine | null {
  if (graduation.resolution === null) return null;
  if (graduation.resolution === "MASTERS") {
    const fee = run.history.find((entry) => entry.kind === "MASTERS_FEE");
    const name = fee?.program ? TEXTS.mastersProgram[fee.program].name : "再读硕士";
    // 正式玩法里手里有工作机会也可以再读一轮（docs/22 §3.4）
    const hasJob = graduation.outcomes?.LOCAL_JOB === "OFFERED" || graduation.outcomes?.HOME_JOB === "OFFERED";
    const text = hasJob ? `手里的机会先都不接，你决定${name}，下一轮再争。` : `手里没有工作机会，你决定${name}。`;
    return { kind: "MASTERS", text, delta: fee ? copy(fee.appliedDelta) : null };
  }
  if (graduation.resolution === "TRANSITION") {
    const hadOffer = OPPORTUNITY_ORDER.some((key) => graduation.outcomes?.[key] === "OFFERED");
    return {
      kind: "ROUTE",
      text: hadOffer ? "手里有机会，但你决定先都不接，给自己留一段空白。" : "这一轮没有拿到机会，你先进入一段过渡期。",
      delta: null,
    };
  }
  const accepted = { PHD: "你接受了博士录取。", LOCAL_JOB: "你接受了留美工作。", HOME_JOB: "你接受了回国工作。" } as const;
  return { kind: "ROUTE", text: accepted[graduation.resolution], delta: null };
}

/**
 * 整局的轨迹，按时间顺序分段：高三、申请季、每个学期、本科毕业／硕士毕业、去向结局（“后来”）或中途结局。
 * 每段带上这一段结束时的四属性。还没发生的段不出现。
 */
export function timeline(state: RunState): TimelineEntry[] {
  if (state.phase === "SETUP") return [];
  const run = state;
  const segments: TimelineEntry[] = [];
  const hs = run.history.filter((entry) => entry.stage === "HS");
  if (hs.length > 0) {
    segments.push({ id: "HS", label: "高三", lines: hs.filter((entry) => entry.kind === "EVENT").map(eventLine), statsAfter: copy(hs[hs.length - 1].afterStats) });
    const admission = admissionLines(run);
    if (admission.length > 0) segments.push({ id: "ADMISSION", label: "申请季", lines: admission, statsAfter: copy(hs[hs.length - 1].afterStats) });
  }

  for (const degree of ["UG", "MS"] as Degree[]) {
    const stageEntries = run.history.filter((entry) => entry.stage === degree);
    const terms = [...new Set(stageEntries.map((entry) => entry.termIndex))].sort((x, y) => x - y);
    for (const term of terms) {
      // 硕士入学费记在硕一上，但它属于“本科毕业”那一段的去向行，不在学期里重复。
      const entries = stageEntries.filter((entry) => entry.termIndex === term && entry.kind !== "MASTERS_FEE");
      if (entries.length === 0) continue;
      segments.push({
        id: `${degree}:${term}`,
        label: termLabel(degree, term),
        lines: termLines(entries),
        statsAfter: copy(entries[entries.length - 1].afterStats),
      });
    }
    const graduation = run.graduations[degree];
    if (graduation) {
      const lines = opportunityLines(graduation, run);
      const resolution = resolutionLine(run, graduation);
      if (resolution) lines.push(resolution);
      const fee = graduation.resolution === "MASTERS" ? run.history.find((entry) => entry.kind === "MASTERS_FEE") : undefined;
      segments.push({
        id: `GRAD:${degree}`,
        label: `${DEGREE_NAMES[degree]}毕业`,
        lines,
        statsAfter: copy(fee ? fee.afterStats : graduation.frozenStats),
      });
    }
  }

  // 去向结局：毕业并确定去向之后，再给这段人生起一个更具体的名字。
  const flavor = run.ending?.kind === "GRADUATION" ? run.ending.card.flavor : null;
  if (flavor) {
    segments.push({
      id: "FLAVOR",
      label: "后来",
      lines: [{ kind: "FLAVOR", text: `后来，人们叫你：${flavor.name}。`, delta: null }],
      statsAfter: copy(run.stats),
    });
  }

  const early = run.ending?.kind === "EARLY" ? findEarlyEnding(run.ending.early) : undefined;
  if (run.ending?.kind === "EARLY") {
    if (!early) throw new Error(`TIMELINE_EARLY_UNKNOWN: ${String(run.ending.early)}`);
    segments.push({
      id: "EARLY",
      label: "中途结局",
      lines: [{ kind: "EARLY_END", text: `这一局在这里停下——${early.name}。${early.text}`, delta: null }],
      statsAfter: copy(run.stats),
    });
  }
  return segments;
}

/** 属性评价（22 §5.2）：0–19 见底、20–39 吃紧、40–59 普通、60–79 不错、80–94 出色、95–100 拉满。 */
export function statRating(value: number): string {
  return (STAT_RATINGS.find((band) => value >= band.from) ?? STAT_RATINGS[STAT_RATINGS.length - 1]).label;
}

/** 人生总结。只有走到结局（ENDING）的局才有；其它阶段调用会抛错。 */
export function summaryView(state: RunState): SummaryView {
  if (state.phase !== "ENDING" || !state.ending) throw new Error("SUMMARY_NOT_READY: 这一局还没有走到结局");
  const run = state;
  const ending = state.ending;
  const shared = {
    seed: run.seed,
    school: run.school,
    stats: STAT_KEYS.map((key) => ({ key, name: TEXTS.stat[key].name, value: run.stats[key], rating: statRating(run.stats[key]) })),
    focusSummary: FOCUS_ORDER.map((focus) => ({ focus, name: FOCUS_SUMMARY_NAMES[focus], count: run.focusCounts[focus] })),
    talents: talentsByIds(run.profile.talents),
    points: run.profile.points ? { ...run.profile.points } : null,
    card: ending.card,
  };

  if (isGraduationEnding(ending)) {
    const checkpoint = run.graduations[ending.degree];
    if (!checkpoint) throw new Error("SUMMARY_CHECKPOINT_MISSING");
    const variant = variantKey(ending);
    const { label, labelExtra } = endingLabel(run, ending);
    return {
      ...shared,
      kind: "GRADUATION",
      title: TEXTS.ending.route[variant].title,
      label: labelExtra ? `${label} · ${labelExtra}` : label,
      text: TEXTS.ending.short[shortKey(ending)],
      keyExperience: keyExperience(run),
      epilogue: TEXTS.ending.epilogue[variant],
      opportunities: opportunityViews(checkpoint, talentTotalsOf(run).chance),
    };
  }

  const early = findEarlyEnding(ending.early);
  if (!early) throw new Error(`SUMMARY_EARLY_UNKNOWN: ${String(ending.early)}`);
  return {
    ...shared,
    kind: "EARLY",
    title: early.title,
    label: `${termLabel(ending.degree, run.termIndex)} · 中途`,
    text: early.text,
    keyExperience: null,
    epilogue: early.epilogue,
    opportunities: [],
  };
}
