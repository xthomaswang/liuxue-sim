// 毕业（或中途离场）之后的五年（docs/24 §4）。只在正式玩法里出现。
// 离校那一刻进入 LIFE；之后每个 LIVE_YEAR 过一年：基础变化、这一年的重心、里程碑、生活小事、年末换轨；
// 第五年结束时在（换轨之后的）轨道上挑一个“五年后”的结局。所有抽签都用 draw01(seed, key)。
// 内容（各轨道与公共的条目）作为参数传入，缺省用 src/content/life 里的，便于单独测试。

import type { LifeCommonContent } from "../content";
import { conditionMet } from "./conditions";
import type { ConditionContext } from "./conditions";
import {
  AGE_MS_START, AGE_UG_GRADUATION, AGE_UG_START, LIFE_MILESTONES_PER_YEAR, LIFE_SECOND_EVENT_PROBABILITY, LIFE_TRACK_ORDER,
  LIFE_YEARS,
} from "./constants";
import { lifeCommon, lifeTrackContent } from "./pools";
import { draw01, pickIndex, pickWeighted } from "./rng";
import { addStats, appendHistory, copyStats, zeroFocusCounts } from "./rules";
import type { TalentTotals } from "./talents";
import type { ActiveRun, Degree, Focus, LifeEvent, LifeState, LifeTrack, LifeTrackContent } from "./types";

export interface LifeContent {
  tracks: Readonly<Record<LifeTrack, LifeTrackContent>>;
  common: LifeCommonContent;
}

/** 随构建打包的毕业后内容。 */
export function defaultLifeContent(): LifeContent {
  return {
    tracks: Object.fromEntries(LIFE_TRACK_ORDER.map((track) => [track, lifeTrackContent(track)])) as Record<LifeTrack, LifeTrackContent>,
    common: lifeCommon(),
  };
}

// ---------- 年龄（§3） ----------

/** 某学段第 term 学期的年龄：本科 18 + ⌊(t−1)/2⌋，硕士 22 + ⌊(t−1)/2⌋。 */
export function termAge(stage: Degree, term: number): number {
  return (stage === "UG" ? AGE_UG_START : AGE_MS_START) + Math.floor((Math.max(1, term) - 1) / 2);
}

/** 毕业的年龄：本科 22，硕士 22 + 年制。 */
export function graduationAge(degree: Degree, mastersYears: number | null): number {
  return degree === "UG" ? AGE_UG_GRADUATION : AGE_UG_GRADUATION + (mastersYears ?? 0);
}

/** 离开学校时在读的那个学期（中途结局所在的学期、毕业的最后一学期）：历史里这个学段最后一条基础成长。 */
export function lastTermOf(run: Pick<ActiveRun, "history">, degree: Degree): number {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const entry = run.history[i];
    if (entry.kind === "GROWTH" && entry.stage === degree) return entry.termIndex;
  }
  return 0;
}

// ---------- 进入 ----------

/** 离校那一刻（结局卡已经写好）进入 LIFE：轨道、年龄、离校时的四属性。 */
export function enterLife(draft: ActiveRun, track: LifeTrack, startAge: number): void {
  const life: LifeState = {
    track,
    tracks: [track],
    year: 0,
    startAge,
    startStats: copyStats(draft.stats),
    flags: [],
    focusCounts: zeroFocusCounts(),
    outcome: null,
  };
  draft.life = life;
  draft.stage = "LIFE";
  draft.termIndex = 0;
  draft.phase = "LIFE";
}

// ---------- 条件上下文（§6） ----------

/** 毕业后的条件上下文：stage/term 是离校时的学段与学期，四属性取此刻，安排次数取在校期间的累计。 */
export function lifeContext(run: ActiveRun, year: number): ConditionContext {
  const ending = run.ending;
  const life = run.life;
  if (!ending || !life) throw new Error("LIFE_NOT_STARTED: 还没有离开学校");
  return {
    stage: ending.degree,
    term: lastTermOf(run, ending.degree),
    stats: run.stats,
    counts: run.focusCounts,
    points: run.profile.points,
    flags: run.flags,
    talents: run.profile.talents,
    history: run.history,
    school: run.school,
    aspiration: run.profile.aspiration,
    economy: run.profile.economy,
    focus: null,
    transitionMode: ending.transitionMode,
    tier: ending.card.tier,
    track: life.track,
    year,
    lifeFlags: life.flags,
    flavor: ending.card.flavor?.id ?? null,
    early: ending.early,
    route: ending.route,
    degree: ending.degree,
  };
}

/** 这一局毕业后已经发生过的事（里程碑与生活小事）。 */
export function lifeEventsSoFar(run: Pick<ActiveRun, "history">): string[] {
  const ids: string[] = [];
  for (const entry of run.history) if (entry.kind === "LIFE_EVENT" && entry.lifeEventId) ids.push(entry.lifeEventId);
  return ids;
}

// ---------- 过一年（§4.2） ----------

/**
 * 在草稿上过一年。meta 是这次 LIVE_YEAR 被接受时的 revision 与操作 id。
 * 内容缺少这一类重心的那张、或最后一年挑不出结局（每条轨道应恰有一条无条件的兜底）属于内容错误，直接抛错。
 */
export function liveYear(
  draft: ActiveRun,
  focus: Focus,
  totals: Pick<TalentTotals, "lifeGrowth">,
  meta: { revision: number; actionId: string },
  content: LifeContent = defaultLifeContent(),
): void {
  const life = draft.life;
  if (!life) throw new Error("LIFE_NOT_STARTED: 还没有离开学校");
  const year = life.year + 1;
  draft.termIndex = year;
  const track = life.track;
  const own = content.tracks[track];
  if (!own) throw new Error(`LIFE_TRACK_MISSING: ${track}`);
  const common = content.common;
  const seed = draft.seed;

  // 1. 基础：这条轨道上还没用过的那几句里挑一句（用完了就全部重来）
  const used = new Set(draft.history.filter((entry) => entry.kind === "LIFE_BASE" && entry.track === track).map((entry) => entry.textIndex));
  const all = own.base.texts.map((_, index) => index);
  const fresh = all.filter((index) => !used.has(index));
  const candidates = fresh.length > 0 ? fresh : all;
  const textIndex = candidates.length > 0 ? candidates[pickIndex(seed, `life:base:${year}`, candidates.length)] : undefined;
  appendHistory(draft, "LIFE_BASE", addStats(own.base.delta, totals.lifeGrowth), meta, {
    track,
    ...(textIndex === undefined ? {} : { textIndex }),
  });

  // 2. 这一年的重心
  const plan = own.plans.find((item) => item.focus === focus);
  if (!plan) throw new Error(`LIFE_PLAN_MISSING: ${track} 没有 ${focus} 这一类重心`);
  appendHistory(draft, "LIFE_PLAN", plan.delta, meta, { focus, track });
  life.focusCounts[focus] += 1;

  let nextTrack: LifeTrack | null = null;
  const happen = (item: LifeEvent, milestone: boolean): void => {
    appendHistory(draft, "LIFE_EVENT", item.delta, meta, { track, lifeEventId: item.id, milestone });
    for (const flag of item.setFlags ?? []) if (!life.flags.includes(flag)) life.flags.push(flag);
    if (item.setTrack) nextTrack = item.setTrack;
  };

  // 3. 里程碑：本轨道的在前、公共的在后，按顺序逐条看；每年最多三件
  let milestones = 0;
  for (const item of [...own.milestones, ...common.milestones]) {
    if (milestones >= LIFE_MILESTONES_PER_YEAR) break;
    if (!item.repeatable && lifeEventsSoFar(draft).includes(item.id)) continue;
    if (!conditionMet(item.when, lifeContext(draft, year))) continue;
    if (!(draw01(seed, `life:ms:${item.id}:${year}`) < (item.chancePermille ?? 0) / 1000)) continue;
    happen(item, true);
    milestones += 1;
  }

  // 4. 生活小事：一件，一半的概率再多一件；每抽一件都按最新的状态重算候选
  const count = 1 + (draw01(seed, `life:ev:roll:${year}`) < LIFE_SECOND_EVENT_PROBABILITY ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const seen = lifeEventsSoFar(draft);
    const context = lifeContext(draft, year);
    const pool = [...own.events, ...common.events].filter((item) => !seen.includes(item.id) && conditionMet(item.when, context));
    const picked = pickWeighted(seed, `life:ev:pick:${year}:${k}`, pool, (item) => item.weight ?? 1);
    if (picked) happen(picked, false);
  }

  // 5. 年末：换轨从下一年起生效
  life.year = year;
  const switched = nextTrack as LifeTrack | null;
  if (switched !== null && switched !== track) {
    life.track = switched;
    life.tracks.push(switched);
  }

  // 6. 第五年结束：在换轨之后的轨道上挑“五年后”的结局
  if (year >= LIFE_YEARS) {
    const final = content.tracks[life.track];
    if (!final) throw new Error(`LIFE_TRACK_MISSING: ${life.track}`);
    const context = lifeContext(draft, year);
    const outcome = pickWeighted(seed, "life:outcome", final.outcomes.filter((item) => conditionMet(item.when, context)), (item) => item.weight);
    if (!outcome) throw new Error(`LIFE_OUTCOME_MISSING: ${life.track} 没有可用的五年后结局（每条轨道应有一条无条件的兜底）`);
    life.outcome = { id: outcome.id, track: life.track };
    draft.phase = "ENDING";
  }
}
