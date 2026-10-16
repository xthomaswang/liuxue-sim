// 人生轨迹与人生总结（docs/22 第 5 节；第四版的分段、年龄与行序见 docs/24 第 7、8 节）：
// 把一局的历史整理成一段段给界面按顺序显示；不改状态。日常与期末 GPA 只在这里现挑现算（同样只用 draw01）。
// 对还没走完的局也能返回到目前为止的轨迹；日常与 GPA 只给结算完的学期。

import { EVENT_BY_ID, TEXTS } from "../content";
import {
  AGE_DEPARTURE, AGE_HIGH_SCHOOL, DEPARTURE_SUMMER_LABEL, FOCUS_ORDER, LIFE_YEARS, MS_SUMMER_LABEL, OPPORTUNITY_ORDER,
  STAT_KEYS, STAT_RATINGS, UG_SUMMER_LABELS,
} from "./constants";
import { dailyPicksFor } from "./daily";
import type { DailyPick } from "./daily";
import { findEarlyEnding, termLabel } from "./early";
import { endingLabel, isGraduationEnding, keyExperience, shortKey, variantKey } from "./ending";
import { averageGpa, formatGpa, gpaLineText, termGpas } from "./gpa";
import type { TermGpa } from "./gpa";
import { DEGREE_NAMES, FOCUS_SUMMARY_NAMES, schoolDisplayName } from "./labels";
import { graduationAge, lastTermOf, termAge } from "./life";
import { findHappening, findLifeEvent, findLifeOutcome, findPlan, findSummer, lifeTrackContent } from "./pools";
import { talentTotalsOf } from "./reducer";
import { talentsByIds } from "./talents";
import { opportunityViews } from "./views";
import type {
  ActiveRun, Degree, Graduation, HistoryEntry, LifeSummary, LifeTrack, RunState, Stats, SummaryView, TimelineEntry,
  TimelineLine,
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

function happeningLine(entry: HistoryEntry): TimelineLine {
  const happening = entry.happeningId ? findHappening(entry.happeningId) : undefined;
  if (!happening) throw new Error(`TIMELINE_HAPPENING_UNKNOWN: ${String(entry.happeningId)}`);
  return { kind: "HAPPENING", text: happening.text, delta: copy(entry.appliedDelta) };
}

function planLine(entry: HistoryEntry): TimelineLine {
  const plan = entry.planId ? findPlan(entry.planId) : undefined;
  const name = plan?.name ?? (entry.focus ? TEXTS.focus[entry.focus].name : null);
  if (!name) throw new Error("TIMELINE_PLAN_UNKNOWN");
  return { kind: "PLAN", text: `这学期的安排：${name}。`, delta: copy(entry.appliedDelta) };
}

const dailyLine = (pick: DailyPick): TimelineLine => ({ kind: "DAILY", text: pick.line.text, delta: null });

/**
 * 一个学期里的各行（docs/24 §7.2）：寒假 → 开学小事 → 这学期的安排 → 日常 → 主线事件 → 期中小事 → 日常 →
 * 支线事件 → 资金短缺 → 期末 GPA。没有的行跳过；日常与 GPA 只在学期结算完之后才有。
 */
function termLines(entries: readonly HistoryEntry[], daily: readonly DailyPick[], gpa: TermGpa | null, seed: number): TimelineLine[] {
  const planIndex = entries.findIndex((entry) => entry.kind === "FOCUS");
  const isArc = (entry: HistoryEntry) => entry.kind === "EVENT" && EVENT_BY_ID[entry.eventId ?? ""]?.kind === "arc";
  const opening = entries.filter((entry, index) => entry.kind === "HAPPENING" && (planIndex < 0 || index < planIndex));
  const middle = entries.filter((entry, index) => entry.kind === "HAPPENING" && planIndex >= 0 && index > planIndex);
  const main = entries.filter((entry) => entry.kind === "EVENT" && !isArc(entry));
  const arcs = entries.filter(isArc);
  const daySlot = (slot: DailyPick["slot"]) => daily.filter((pick) => pick.slot === slot).map(dailyLine);

  const lines: TimelineLine[] = [...daySlot("WINTER"), ...opening.map(happeningLine)];
  if (planIndex >= 0) lines.push(planLine(entries[planIndex]));
  lines.push(...daySlot(0), ...main.map(eventLine), ...middle.map(happeningLine), ...daySlot(1), ...arcs.map(eventLine));
  for (const entry of entries) {
    if (entry.kind === "UPKEEP" && (entry.upkeep?.shortfall ?? 0) > 0) {
      lines.push({
        kind: "SHORTFALL",
        text: `期末的钱没能撑到头，还差 ${entry.upkeep?.shortfall}，只能东拼西凑地熬过去。`,
        delta: copy(entry.appliedDelta),
      });
    }
  }
  if (gpa) lines.push({ kind: "GPA", text: gpaLineText(seed, gpa), delta: null });
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

/** 毕业后的轨道名，如“留美工作”。 */
export function lifeTrackName(track: LifeTrack): string {
  return lifeTrackContent(track).name;
}

/** 毕业后第 year 年的各行（docs/24 §7.3）：基础 → 这一年的重心 → 里程碑 → 生活小事。 */
function lifeYearLines(entries: readonly HistoryEntry[]): TimelineLine[] {
  const lines: TimelineLine[] = [];
  for (const entry of entries) {
    if (entry.kind === "LIFE_BASE") {
      const texts = entry.track ? lifeTrackContent(entry.track).base.texts : [];
      const text = entry.textIndex !== undefined ? texts[entry.textIndex] : undefined;
      if (text === undefined) throw new Error(`TIMELINE_LIFE_BASE_UNKNOWN: ${String(entry.track)} ${String(entry.textIndex)}`);
      lines.push({ kind: "LIFE_BASE", text, delta: copy(entry.appliedDelta) });
    } else if (entry.kind === "LIFE_PLAN") {
      const plan = entry.track ? lifeTrackContent(entry.track).plans.find((item) => item.focus === entry.focus) : undefined;
      if (!plan) throw new Error(`TIMELINE_LIFE_PLAN_UNKNOWN: ${String(entry.track)} ${String(entry.focus)}`);
      lines.push({ kind: "LIFE_PLAN", text: `这一年的重心：${plan.name}。`, delta: copy(entry.appliedDelta) });
    } else if (entry.kind === "LIFE_EVENT") {
      const item = entry.lifeEventId ? findLifeEvent(entry.lifeEventId) : undefined;
      if (!item) throw new Error(`TIMELINE_LIFE_EVENT_UNKNOWN: ${String(entry.lifeEventId)}`);
      lines.push({ kind: entry.milestone ? "MILESTONE" : "LIFE_EVENT", text: item.text, delta: copy(entry.appliedDelta) });
    }
  }
  return lines;
}

/**
 * 整局的轨迹，按时间顺序分段（docs/24 §7.1）：高三、申请季、出国前的夏天、每个学期与暑假、本科毕业／硕士毕业、
 * 中途结局、毕业（离校）后的每一年、五年后。经典模式没有暑假、日常、GPA 与毕业后的五年，去向结局那一段照旧叫“后来”。
 * 每段带年龄、分组与这一段结束时的四属性。还没发生的段不出现。
 */
export function timeline(state: RunState): TimelineEntry[] {
  if (state.phase === "SETUP") return [];
  const run = state;
  const segments: TimelineEntry[] = [];
  const daily = dailyPicksFor(run);
  const gpas = termGpas(run);
  const summersOf = (stage: string, term: number) => run.history.filter((entry) => entry.kind === "SUMMER" && entry.stage === stage && entry.termIndex === term);
  const summerSegment = (id: string, label: string, age: number, entries: readonly HistoryEntry[]): TimelineEntry => ({
    id,
    label,
    age,
    group: "SUMMER",
    lines: entries.map((entry) => {
      const summer = entry.summerId ? findSummer(entry.summerId) : undefined;
      if (!summer) throw new Error(`TIMELINE_SUMMER_UNKNOWN: ${String(entry.summerId)}`);
      return { kind: "SUMMER", text: summer.text, delta: copy(entry.appliedDelta) };
    }),
    statsAfter: copy(entries[entries.length - 1].afterStats),
  });

  const hsEvents = run.history.filter((entry) => entry.stage === "HS" && entry.kind === "EVENT");
  if (hsEvents.length > 0) {
    const hsAfter = copy(hsEvents[hsEvents.length - 1].afterStats);
    segments.push({ id: "HS", label: "高三", age: AGE_HIGH_SCHOOL, group: "SCHOOL", lines: hsEvents.map(eventLine), statsAfter: hsAfter });
    const admission = admissionLines(run);
    if (admission.length > 0) segments.push({ id: "ADMISSION", label: "申请季", age: AGE_HIGH_SCHOOL, group: "SCHOOL", lines: admission, statsAfter: hsAfter });
  }
  const departure = summersOf("HS", 0);
  if (departure.length > 0) segments.push(summerSegment("SUMMER:HS:0", DEPARTURE_SUMMER_LABEL, AGE_DEPARTURE, departure));

  for (const degree of ["UG", "MS"] as Degree[]) {
    const stageEntries = run.history.filter((entry) => entry.stage === degree);
    const terms = [...new Set(stageEntries.map((entry) => entry.termIndex))].sort((x, y) => x - y);
    for (const term of terms) {
      // 硕士入学费记在硕一上，但它属于“本科毕业”那一段的去向行；暑假单独成段。
      const entries = stageEntries.filter((entry) => entry.termIndex === term && entry.kind !== "MASTERS_FEE" && entry.kind !== "SUMMER");
      if (entries.length > 0) {
        const settled = entries.some((entry) => entry.kind === "GROWTH");
        const termDaily = settled ? daily.filter((pick) => pick.stage === degree && pick.term === term) : [];
        const gpa = settled ? (gpas.find((item) => item.stage === degree && item.term === term) ?? null) : null;
        segments.push({
          id: `${degree}:${term}`,
          label: termLabel(degree, term),
          age: termAge(degree, term),
          group: "SCHOOL",
          lines: termLines(entries, termDaily, gpa, run.seed),
          statsAfter: copy(entries[entries.length - 1].afterStats),
        });
      }
      const summer = summersOf(degree, term);
      if (summer.length > 0) {
        const label = degree === "UG" ? (UG_SUMMER_LABELS[term] ?? `${termLabel(degree, term)}之后的暑假`) : MS_SUMMER_LABEL;
        const age = degree === "UG" ? 18 + term / 2 : termAge("MS", term) + 1;
        segments.push(summerSegment(`SUMMER:${degree}:${term}`, label, age, summer));
      }
    }
    const graduation = run.graduations[degree];
    if (graduation) {
      const lines: TimelineLine[] = [];
      const average = averageGpa(gpas.filter((item) => item.stage === degree));
      if (average !== null) lines.push({ kind: "GPA", text: `${DEGREE_NAMES[degree]}平均 GPA ${formatGpa(average)}。`, delta: null });
      lines.push(...opportunityLines(graduation, run));
      const resolution = resolutionLine(run, graduation);
      if (resolution) lines.push(resolution);
      const fee = graduation.resolution === "MASTERS" ? run.history.find((entry) => entry.kind === "MASTERS_FEE") : undefined;
      segments.push({
        id: `GRAD:${degree}`,
        label: `${DEGREE_NAMES[degree]}毕业`,
        age: graduationAge(degree, run.mastersYears),
        group: "SCHOOL",
        lines,
        statsAfter: copy(fee ? fee.afterStats : graduation.frozenStats),
      });
    }
  }

  const ending = run.ending;
  if (ending?.kind === "EARLY") {
    const early = findEarlyEnding(ending.early);
    if (!early) throw new Error(`TIMELINE_EARLY_UNKNOWN: ${String(ending.early)}`);
    segments.push({
      id: "EARLY",
      label: "中途结局",
      age: termAge(ending.degree, lastTermOf(run, ending.degree)),
      group: "SCHOOL",
      lines: [{ kind: "EARLY_END", text: `留学在这里提前结束——${early.name}。${early.text}`, delta: null }],
      statsAfter: copy(run.life?.startStats ?? run.stats),
    });
  }

  const life = run.life;
  if (life) {
    const left = ending?.kind === "EARLY" ? "离校" : "毕业";
    const flavor = ending?.kind === "GRADUATION" ? ending.card.flavor : null;
    const years = [...new Set(run.history.filter((entry) => entry.stage === "LIFE").map((entry) => entry.termIndex))].sort((x, y) => x - y);
    const trackOf = (year: number): LifeTrack | undefined =>
      run.history.find((entry) => entry.kind === "LIFE_BASE" && entry.termIndex === year)?.track;
    for (const year of years) {
      const entries = run.history.filter((entry) => entry.stage === "LIFE" && entry.termIndex === year);
      const lines: TimelineLine[] = [];
      if (year === 1 && flavor) lines.push({ kind: "FLAVOR", text: `毕业后，你成了：${flavor.name}。${flavor.text}`, delta: null });
      lines.push(...lifeYearLines(entries));
      // 这一年里换了轨道：从明年起生效（最后一年换的，五年后的结局按新轨道挑）
      const current = trackOf(year);
      const next = year < life.year ? trackOf(year + 1) : life.track;
      if (current && next && next !== current) lines.push({ kind: "ROUTE", text: `从明年起：${lifeTrackName(next)}。`, delta: null });
      segments.push({
        id: `LIFE:${year}`,
        label: `${left}第 ${year} 年`,
        age: life.startAge + year,
        group: "LIFE",
        lines,
        statsAfter: copy(entries[entries.length - 1].afterStats),
      });
    }
    if (life.outcome) {
      const found = findLifeOutcome(life.outcome.id);
      if (!found) throw new Error(`TIMELINE_OUTCOME_UNKNOWN: ${life.outcome.id}`);
      segments.push({
        id: "OUTCOME",
        label: "五年后",
        age: life.startAge + LIFE_YEARS,
        group: "END",
        lines: [{ kind: "OUTCOME", text: `五年后，你成了：${found.outcome.name}。${found.outcome.text}`, delta: null }],
        statsAfter: copy(run.stats),
      });
    }
  } else if (ending?.kind === "GRADUATION" && ending.card.flavor) {
    // 没有毕业后五年的局（经典模式）：去向结局那一段照旧叫“后来”。
    segments.push({
      id: "FLAVOR",
      label: "后来",
      age: null,
      group: "END",
      lines: [{ kind: "FLAVOR", text: `后来，人们叫你：${ending.card.flavor.name}。`, delta: null }],
      statsAfter: copy(run.stats),
    });
  }
  return segments;
}

/** 属性评价（22 §5.2）：0–19 见底、20–39 吃紧、40–59 普通、60–79 不错、80–94 出色、95–100 拉满。 */
export function statRating(value: number): string {
  return (STAT_RATINGS.find((band) => value >= band.from) ?? STAT_RATINGS[STAT_RATINGS.length - 1]).label;
}

const statRows = (stats: Stats) => STAT_KEYS.map((key) => ({ key, name: TEXTS.stat[key].name, value: stats[key], rating: statRating(stats[key]) }));

/** 毕业（或离校）之后的五年那一块（docs/24 §8）；还没过完五年、或经典模式为 null。 */
function lifeSummary(run: ActiveRun): LifeSummary | null {
  const life = run.life;
  if (!life?.outcome) return null;
  const found = findLifeOutcome(life.outcome.id);
  if (!found) throw new Error(`SUMMARY_OUTCOME_UNKNOWN: ${life.outcome.id}`);
  const { outcome } = found;
  return {
    outcome: { id: outcome.id, name: outcome.name, roast: outcome.roast, text: outcome.text, grade: outcome.grade },
    age: life.startAge + LIFE_YEARS,
    track: life.track,
    trackName: lifeTrackName(life.track),
    trackNames: life.tracks.map(lifeTrackName),
    startStats: statRows(life.startStats),
  };
}

/** 人生总结。只有走到结局（ENDING）的局才有；其它阶段调用会抛错。有毕业后五年时 stats 是五年后的四属性。 */
export function summaryView(state: RunState): SummaryView {
  if (state.phase !== "ENDING" || !state.ending) throw new Error("SUMMARY_NOT_READY: 这一局还没有走到结局");
  const run = state;
  const ending = state.ending;
  const shared = {
    seed: run.seed,
    school: run.school,
    stats: statRows(run.stats),
    focusSummary: FOCUS_ORDER.map((focus) => ({ focus, name: FOCUS_SUMMARY_NAMES[focus], count: run.focusCounts[focus] })),
    talents: talentsByIds(run.profile.talents),
    points: run.profile.points ? { ...run.profile.points } : null,
    card: ending.card,
    gpa: averageGpa(termGpas(run)),
    life: lifeSummary(run),
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
    label: `${termLabel(ending.degree, lastTermOf(run, ending.degree))} · 中途`,
    text: early.text,
    keyExperience: null,
    epilogue: early.epilogue,
    opportunities: [],
  };
}
