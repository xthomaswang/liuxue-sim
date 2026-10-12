// 状态机（docs/06 第 1、5、6 节；第二版流程见 docs/16）。applyAction 是唯一的状态转移入口：
// 先校验 revision、phase、事件 ID 与资金，再在一份拷贝上完成全部更新；失败时原状态原样返回。

import { EVENT_BY_ID } from "../content";
import { baseReadinessFor, poolCounts, resolveAdmission, sampleOffers } from "./admission";
import {
  ALL_TIERS, CONTENT_VERSION, CORE_EVENT_IDS, ECONOMY_ORDER, HIGH_SCHOOL_EVENT_IDS, MASTERS_PLANS,
  MASTERS_PROGRAM_ORDER, MIN_POOL_SIZE, OPPORTUNITY_ORDER, POINT_MAX, RULES_VERSION, TALENT_PICK_CLASSIC,
  TALENT_PICK_STANDARD, UG_TERMS,
} from "./constants";
import { checkEarlyEnding } from "./early";
import { computeEndingCard, earlyEndingCard } from "./endingCard";
import { freezeGraduation, mastersBlockers, offeredList, revealGraduation } from "./graduation";
import {
  basePlans, classicTalents, happeningPool, nodeCandidates, planPool, randomEventPool, talentOrder, talentPool,
} from "./pools";
import {
  applyDelta, arcSlotForTerm, arcWeights, copyStats, pickArc, planVector, upkeep, zeroFocusCounts, zeroStats,
} from "./rules";
import type { PlanVector } from "./rules";
import {
  drawPool, drawTalents, economyFromFamily, effectiveGrowth, effectiveStipend, effectiveUpkeep, initialStatsFor,
  normalizeUnlocked, originFor, pointBudget, pointsValid, readinessHeadStart, startStatsFromPoints, totalsFor,
} from "./talents";
import type { TalentTotals } from "./talents";
import { mainSlotEvent, rollHappening, termSlate } from "./terms";
import type { TermSlate } from "./terms";
import type {
  Action, ActionResult, ActiveRun, CatalogCheck, Command, Degree, Economy, EngineContext, EngineErrorCode,
  HistoryEntry, HistoryKind, MastersProgram, OfferTier, PlanCard, RunMode, RunState, RuntimeCatalog, RuntimeSchool,
  SetupRun, SetupView, Stats, StoryEvent, Talent,
} from "./types";

class EngineFailure extends Error {
  code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: EngineErrorCode, message: string): never {
  throw new EngineFailure(code, message);
}

// ---------- 开局 ----------

/** 每个池（S/A/B/C/D/U）至少 3 所才允许开新局。 */
export function checkCatalog(catalog: RuntimeCatalog): CatalogCheck {
  const counts = poolCounts(catalog);
  const small = ALL_TIERS.filter((tier: OfferTier) => counts[tier] < MIN_POOL_SIZE);
  if (small.length === 0) return { ok: true, counts };
  return {
    ok: false,
    code: "CATALOG_POOL_TOO_SMALL",
    counts,
    message: `学校目录不可用：${small.map((tier) => `${tier} 池只有 ${counts[tier]} 所`).join("，")}（每池至少需要 ${MIN_POOL_SIZE} 所）。`,
  };
}

/**
 * 新开一局，停在 SETUP。目录不合格时抛出 CATALOG_POOL_TOO_SMALL。
 * mode 缺省为 standard；classic（只给测试用，docs/16 第 7 节）必须同时给出 classicEconomy。
 * standard 可以带上跨局进度里的两样输入：已解锁的锁定天赋（决定十连抽的池子）与上一局选择继承的天赋。
 * classic 没有十连抽，这两样一律忽略。
 */
export function createRun(args: {
  seed: number;
  runId: string;
  catalog: RuntimeCatalog;
  mode?: RunMode;
  classicEconomy?: Economy;
  unlockedTalents?: string[];
  inheritedTalent?: string | null;
}): SetupRun {
  const check = checkCatalog(args.catalog);
  if (!check.ok) throw new Error(`CATALOG_POOL_TOO_SMALL: ${check.message}`);
  if (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 0xffffffff) {
    throw new Error("INVALID_SEED: seed 必须是 0 到 4294967295 的整数");
  }
  const mode: RunMode = args.mode ?? "standard";
  if (mode !== "standard" && mode !== "classic") throw new Error("INVALID_MODE: mode 只能是 standard 或 classic");
  if (mode === "classic" && (args.classicEconomy === undefined || !ECONOMY_ORDER.includes(args.classicEconomy))) {
    throw new Error("INVALID_MODE: classic 模式必须指定 classicEconomy");
  }
  if (mode === "standard" && args.classicEconomy !== undefined) {
    throw new Error("INVALID_MODE: standard 模式的家境由分点决定，不能指定经济档");
  }
  // 已解锁的天赋：只保留确实是锁定天赋的 id，去重，按池内顺序。继承的天赋必须在这一局的池子里，否则当作没有。
  const unlockedTalents = mode === "standard" ? normalizeUnlocked(talentPool(), args.unlockedTalents) : [];
  const inherited = mode === "standard" && typeof args.inheritedTalent === "string" ? args.inheritedTalent : null;
  const inheritedTalent =
    inherited !== null && drawPool(talentPool(), unlockedTalents).some((talent) => talent.id === inherited) ? inherited : null;
  const run: SetupRun = {
    schemaVersion: 1,
    rulesVersion: RULES_VERSION,
    contentVersion: CONTENT_VERSION,
    catalogVersion: args.catalog.catalogVersion,
    catalogSha256: args.catalog.catalogSha256,
    tierMappingVersion: args.catalog.tierMappingVersion,
    rankEdition: args.catalog.rankEdition,
    runId: args.runId,
    seed: args.seed,
    revision: 0,
    mode,
    phase: "SETUP",
    unlockedTalents,
    inheritedTalent,
  };
  if (mode === "classic") run.classicEconomy = args.classicEconomy;
  return run;
}

/** 这一局开局时的两样跨局输入（SETUP 之后也原样带着）。 */
export function runInputs(state: RunState): { unlockedTalents: string[]; inheritedTalent: string | null } {
  return { unlockedTalents: state.unlockedTalents ?? [], inheritedTalent: state.inheritedTalent ?? null };
}

/** 本局可以选的天赋：standard 是十连抽的结果（按抽出顺序，继承的排第一），classic 是六张特质天赋。 */
export function drawFor(state: Pick<RunState, "seed" | "mode" | "unlockedTalents" | "inheritedTalent">): Talent[] {
  if (state.mode === "classic") return classicTalents();
  return drawTalents(state.seed, drawPool(talentPool(), state.unlockedTalents ?? []), undefined, state.inheritedTalent ?? null);
}

/** 开局需要的信息：抽出来的家庭期待与愿望、可选的天赋、要选几张、每项点数的上限、基础准备度。 */
export function setupView(state: SetupRun): SetupView {
  return {
    origin: originFor(state.seed),
    draw: drawFor(state),
    pickCount: state.mode === "classic" ? TALENT_PICK_CLASSIC : TALENT_PICK_STANDARD,
    pointMax: state.mode === "classic" ? 0 : POINT_MAX,
    baseReadiness: baseReadinessFor(state.seed),
    inherited: state.inheritedTalent,
  };
}

/** 这次选的天赋是否合法：数量对、互不相同、都来自本局可选的天赋。返回问题描述或 null。 */
export function talentPickProblem(state: SetupRun, picked: unknown): string | null {
  const view = setupView(state);
  if (!Array.isArray(picked) || !picked.every((id) => typeof id === "string")) return "天赋选择无效。";
  if (picked.length !== view.pickCount) return `需要恰好选 ${view.pickCount} 张天赋，实际 ${picked.length} 张。`;
  if (new Set(picked).size !== picked.length) return "选中的天赋不能重复。";
  const offered = new Set(view.draw.map((talent) => talent.id));
  if (!picked.every((id) => offered.has(id as string))) return "只能从这一局抽到的天赋里选。";
  return null;
}

/** 20–80 的整数。 */
export function baseReadiness(seed: number): number {
  return baseReadinessFor(seed);
}

// ---------- 由状态推出的本学期内容 ----------

export function termCountOf(state: ActiveRun): number {
  if (state.stage === "UG") return UG_TERMS;
  if (state.stage === "MS") return (state.mastersYears ?? 0) * 2;
  return 0;
}

export function talentTotalsOf(state: ActiveRun): TalentTotals {
  return totalsFor(state.profile.talents);
}

/** 本学期给出的安排：standard 是四张（docs/16 §2），classic 是五张基础安排。 */
export function slateOf(state: ActiveRun): TermSlate {
  if (state.stage !== "UG" && state.stage !== "MS") return { missing: null, plans: [] };
  if (state.mode === "classic") return { missing: null, plans: basePlans() };
  return termSlate(state.seed, state.stage, state.termIndex, planPool());
}

/** 一张安排在当前状态下实际要应用的向量（天赋加成、负身心减免、效率）。 */
export function planVectorFor(state: ActiveRun, plan: PlanCard, totals: TalentTotals = talentTotalsOf(state)): PlanVector {
  return planVector(plan.delta, totals.focus[plan.focus], totals.focusWellbeingRelief, state.stats.wellbeing, totals.efficiencyFloor);
}

function usedRandomEventIds(state: ActiveRun): string[] {
  const ids: string[] = [];
  for (const entry of state.history) {
    if (entry.kind === "EVENT" && entry.eventId && EVENT_BY_ID[entry.eventId]?.kind === "random") ids.push(entry.eventId);
  }
  return ids;
}

function usedHappeningIds(state: ActiveRun): string[] {
  const ids: string[] = [];
  for (const entry of state.history) if (entry.kind === "HAPPENING" && entry.happeningId) ids.push(entry.happeningId);
  return ids;
}

/** 当前 phase 下唯一合法的事件 ID；不在事件阶段返回 null。 */
export function expectedEventId(state: ActiveRun): string | null {
  if (state.phase === "HIGH_SCHOOL_EVENT") {
    return state.highSchoolNode ? HIGH_SCHOOL_EVENT_IDS[state.highSchoolNode - 1] : null;
  }
  if (state.phase === "CORE_EVENT") {
    if (state.stage === "UG") {
      if (state.mode === "classic") return CORE_EVENT_IDS[state.termIndex - 1] ?? null;
      // 主线槽：此刻本学期的主线槽事件还没进历史，“已出现过的随机事件”只包含之前学期的。
      return mainSlotEvent(state.seed, state.termIndex, nodeCandidates(state.termIndex), randomEventPool(), usedRandomEventIds(state)).id;
    }
    if (state.stage === "MS" && state.mastersYears) {
      const program: MastersProgram = state.mastersYears === 1 ? "MS_1Y" : "MS_2Y";
      return MASTERS_PLANS[program].events[state.termIndex - 1] ?? null;
    }
    return null;
  }
  if (state.phase === "ARC_EVENT" && state.stage === "UG") {
    const slot = arcSlotForTerm(state.termIndex);
    if (!slot) return null;
    const arc = state.arcs[slot.slot];
    return arc ? `ARC_${arc}_${slot.beat}` : null;
  }
  return null;
}

// ---------- 内部：在拷贝上记录一次原子变化 ----------

function cloneRun<T extends RunState>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}

interface Step {
  draft: ActiveRun;
  /** 操作被接受时的 revision（操作前的值）。 */
  revision: number;
  actionId: string;
  totals: TalentTotals;
}

function record(step: Step, kind: HistoryKind, requested: Stats, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  const { draft } = step;
  const before = copyStats(draft.stats);
  const { after, applied } = applyDelta(before, requested);
  const entry: HistoryEntry = {
    kind,
    stage: draft.stage,
    termIndex: draft.termIndex,
    revision: step.revision,
    actionId: step.actionId,
    beforeStats: before,
    requestedDelta: copyStats(requested),
    appliedDelta: applied,
    afterStats: copyStats(after),
    ...extra,
  };
  draft.stats = after;
  draft.history.push(entry);
  return entry;
}

/** 学期开始：发资助；standard 模式再看有没有突发小事；进入选安排。 */
function beginTerm(step: Step): void {
  const { draft } = step;
  if (draft.stage !== "UG" && draft.stage !== "MS") fail("WRONG_PHASE", "当前不在学期中。");
  record(step, "STIPEND", { ...zeroStats(), money: effectiveStipend(draft.profile, step.totals) });
  if (draft.mode === "standard") {
    const happening = rollHappening(draft.seed, draft.stage, draft.termIndex, happeningPool(), usedHappeningIds(draft));
    if (happening) record(step, "HAPPENING", happening.effects, { happeningId: happening.id });
  }
  draft.phase = "FOCUS";
}

/**
 * 学期最后一张事件之后，在同一次操作里：必要开销与短缺 → 基础成长 →
 * 还有学期就直接进入下一学期（发资助、突发小事、选安排），否则冻结毕业快照。没有“学期小结”这一步。
 */
function endTerm(step: Step): void {
  const { draft, totals } = step;
  if (draft.stage !== "UG" && draft.stage !== "MS") fail("WRONG_PHASE", "当前不在学期中。");
  const result = upkeep(draft.stats.money, effectiveUpkeep(totals));
  record(step, "UPKEEP", result.requested, {
    upkeep: { cost: result.cost, paid: result.paid, shortfall: result.shortfall, stress: result.stress },
  });
  record(step, "GROWTH", effectiveGrowth(totals));
  if (draft.mode === "standard") {
    // 中途结局（docs/22 §4）：期末结算之后、进入下一学期或毕业之前检查；经典模式没有。
    const hit = checkEarlyEnding(draft.seed, {
      stage: draft.stage,
      term: draft.termIndex,
      stats: draft.stats,
      counts: draft.focusCounts,
      points: draft.profile.points,
      flags: draft.flags,
      talents: draft.profile.talents,
      history: draft.history,
      school: draft.school,
      aspiration: draft.profile.aspiration,
    });
    if (hit) {
      draft.ending = {
        kind: "EARLY",
        route: null,
        early: hit.ending.id,
        degree: draft.stage,
        transitionMode: null,
        entryMode: null,
        card: earlyEndingCard(hit),
      };
      draft.phase = "ENDING";
      return;
    }
  }
  if (draft.termIndex < termCountOf(draft)) {
    draft.termIndex += 1;
    beginTerm(step);
    return;
  }
  const degree: Degree = draft.stage;
  draft.graduations[degree] = freezeGraduation({
    degree,
    stats: draft.stats,
    focusCounts: draft.focusCounts,
    flags: draft.flags,
    chance: totals.chance,
  });
  draft.phase = "GRAD_PREVIEW";
}

function requireActive(state: RunState): ActiveRun {
  if (state.phase === "SETUP") fail("WRONG_PHASE", "还没有选定天赋。");
  return state as ActiveRun;
}

// ---------- 各操作 ----------

function confirmSetup(state: RunState, action: Extract<Action, { type: "CONFIRM_SETUP" }>): ActiveRun {
  if (state.phase !== "SETUP") fail("WRONG_PHASE", "开局选择已经确认。");
  const problem = talentPickProblem(state, action.talents);
  if (problem) fail("INVALID_ACTION", problem);

  const talents = [...action.talents].sort((a, b) => talentOrder(a) - talentOrder(b));
  const totals = totalsFor(talents);
  const origin = originFor(state.seed);
  let profile: ActiveRun["profile"];
  let stats: Stats;
  if (state.mode === "classic") {
    // 经典模式：没有分点，经济档由调用方给定，开局数值按经济档查表。
    if (action.points !== undefined) fail("INVALID_ACTION", "经典模式没有分点。");
    const economy = state.classicEconomy;
    if (!economy) fail("INVALID_ACTION", "经典模式缺少经济档。");
    profile = { economy, expectation: origin.expectation, aspiration: origin.aspiration, talents, points: null };
    stats = initialStatsFor(economy, totals);
  } else {
    // 正式玩法：四项点数每项 0–10、总和等于可分配的总点数（20 加上天赋的 points）。
    const points = action.points;
    if (!pointsValid(points, totals)) {
      fail("INVALID_ACTION", `点数无效：每项应为 0–${POINT_MAX} 的整数，总和应恰好为 ${pointBudget(totals)}。`);
    }
    const kept = { family: points.family, academics: points.academics, career: points.career, wellbeing: points.wellbeing };
    profile = {
      economy: economyFromFamily(kept.family),
      expectation: origin.expectation,
      aspiration: origin.aspiration,
      talents,
      points: kept,
    };
    stats = startStatsFromPoints(kept, totals);
  }
  return {
    schemaVersion: state.schemaVersion,
    rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion,
    catalogVersion: state.catalogVersion,
    catalogSha256: state.catalogSha256,
    tierMappingVersion: state.tierMappingVersion,
    rankEdition: state.rankEdition,
    runId: state.runId,
    seed: state.seed,
    revision: state.revision,
    mode: state.mode,
    phase: "HIGH_SCHOOL_EVENT",
    stage: "HS",
    termIndex: 0,
    highSchoolNode: 1,
    mastersYears: null,
    profile,
    stats,
    focusCounts: zeroFocusCounts(),
    flags: [],
    arcs: { A: null, B: null },
    admission: {
      baseReadiness: baseReadinessFor(state.seed),
      // 开局即确定的准备度加成：学业点数（正式玩法）加上天赋的 readiness。
      talentBonus: readinessHeadStart(profile.points, totals),
      readinessBonus: null,
      readiness: null,
      strategy: null,
      weights: null,
      poolRoll: null,
      tierRoll: null,
      tier: null,
    },
    offers: null,
    school: null,
    history: [],
    graduations: { UG: null, MS: null },
    ending: null,
    unlockedTalents: [...state.unlockedTalents],
    inheritedTalent: state.inheritedTalent,
  };
}

function chooseEvent(step: Step, action: Extract<Action, { type: "CHOOSE_EVENT" }>, ctx: EngineContext): void {
  const { draft } = step;
  const expected = expectedEventId(draft);
  if (!expected) fail("WRONG_PHASE", "当前没有等待选择的事件。");
  if (action.eventId !== expected) fail("WRONG_EVENT", `当前事件是 ${expected}，不是 ${String(action.eventId)}。`);
  const event: StoryEvent | undefined = EVENT_BY_ID[expected];
  if (!event) fail("INVALID_ACTION", `事件数据缺失：${expected}。`);
  const choice = event.choices.find((item) => item.id === action.choiceId);
  if (!choice) fail("INVALID_ACTION", "选项无效。");
  if (event.choices.some((item) => item.setFlags.some((flag) => draft.flags.includes(flag)))) {
    fail("INVALID_ACTION", "这个事件已经结算过。");
  }
  // 负资金选项按当前资金判断；不预扣期末费用。整项原子执行。
  if (choice.effects.money < 0 && draft.stats.money < -choice.effects.money) {
    fail("INSUFFICIENT_FUNDS", `需要 ${-choice.effects.money}，当前 ${draft.stats.money}。`);
  }

  const phase = draft.phase;
  record(step, "EVENT", choice.effects, { eventId: event.id, choiceId: choice.id });
  draft.flags.push(...choice.setFlags);

  if (phase === "HIGH_SCHOOL_EVENT") {
    if (draft.highSchoolNode === 1) {
      draft.highSchoolNode = 2;
      return;
    }
    // HS_02 落定：同一原子操作里生成申请结果与三校 offer，只生成一次。
    if (ctx.catalog.catalogSha256 !== draft.catalogSha256) {
      fail("INVALID_ACTION", "学校目录版本与本局开局时不一致，无法生成申请结果。");
    }
    const drawn = resolveAdmission(draft.seed, draft.admission.baseReadiness, draft.flags, draft.admission.talentBonus);
    let offers: RuntimeSchool[];
    try {
      offers = sampleOffers(draft.seed, drawn.tier, ctx.catalog);
    } catch (error) {
      fail("CATALOG_POOL_TOO_SMALL", (error as Error).message);
    }
    draft.admission = { baseReadiness: draft.admission.baseReadiness, talentBonus: draft.admission.talentBonus, ...drawn };
    draft.offers = offers.map((school) => ({ ...school, rank: school.rank ? { ...school.rank } : null }));
    draft.phase = "SCHOOL_OFFERS";
    return;
  }

  if (phase === "CORE_EVENT" && draft.stage === "UG") {
    const slot = arcSlotForTerm(draft.termIndex);
    if (slot) {
      if (slot.beat === 1) {
        // 权重读取“本学期安排＋主线槽事件已结算、支线尚未结算”的状态；B 排除 A。分配后不再重抽。
        const weights = arcWeights({
          focusCounts: draft.focusCounts,
          stats: draft.stats,
          economy: draft.profile.economy,
          bonus: step.totals.arcWeight,
        });
        draft.arcs[slot.slot] = pickArc(draft.seed, slot.slot, weights, slot.slot === "B" ? draft.arcs.A : null);
      }
      draft.phase = "ARC_EVENT";
      return;
    }
  }
  endTerm(step);
}

function chooseSchool(step: Step, action: Extract<Action, { type: "CHOOSE_SCHOOL" }>): void {
  const { draft } = step;
  if (draft.phase !== "SCHOOL_OFFERS" || !draft.offers) fail("WRONG_PHASE", "现在不是选择学校的时候。");
  const school = draft.offers.find((item) => item.unitid === action.unitid);
  if (!school) fail("SCHOOL_NOT_OFFERED", "只能在收到的三所 offer 里选择。");
  draft.school = { ...school, rank: school.rank ? { ...school.rank } : null };
  draft.stage = "UG";
  draft.termIndex = 1;
  draft.highSchoolNode = null;
  beginTerm(step);
}

function choosePlan(step: Step, action: Extract<Action, { type: "CHOOSE_PLAN" }>): void {
  const { draft } = step;
  if (draft.phase !== "FOCUS") fail("WRONG_PHASE", "现在不是选择学期安排的时候。");
  const plan = slateOf(draft).plans.find((item) => item.id === action.planId);
  if (!plan) fail("INVALID_ACTION", "只能在这学期给出的安排里选择。");
  const vector = planVectorFor(draft, plan, step.totals);
  if (vector.requested.money < 0 && draft.stats.money < -vector.requested.money) {
    fail("INSUFFICIENT_FUNDS", `需要 ${-vector.requested.money}，当前 ${draft.stats.money}。`);
  }
  record(step, "FOCUS", vector.requested, { focus: plan.focus, planId: plan.id, efficiency: vector.factor });
  draft.focusCounts[plan.focus] += 1;
  draft.phase = "CORE_EVENT";
}

function currentGraduation(draft: ActiveRun): { degree: Degree; graduation: NonNullable<ActiveRun["graduations"]["UG"]> } {
  if (draft.stage !== "UG" && draft.stage !== "MS") fail("WRONG_PHASE", "当前没有毕业检查点。");
  const graduation = draft.graduations[draft.stage];
  if (!graduation) fail("WRONG_PHASE", "毕业快照尚未冻结。");
  return { degree: draft.stage, graduation };
}

function revealGrad(step: Step): void {
  const { draft } = step;
  if (draft.phase !== "GRAD_PREVIEW") fail("WRONG_PHASE", "现在不能查看毕业机会。");
  const { degree, graduation } = currentGraduation(draft);
  if (graduation.outcomes) fail("WRONG_PHASE", "这次毕业机会已经揭晓。");
  draft.graduations[degree] = revealGraduation(draft.seed, graduation);
  draft.phase = "GRAD_RESULTS";
}

function chooseRoute(step: Step, action: Extract<Action, { type: "CHOOSE_ROUTE" }>): void {
  const { draft } = step;
  if (draft.phase !== "GRAD_RESULTS") fail("WRONG_PHASE", "现在不能选择去向。");
  const { degree, graduation } = currentGraduation(draft);
  if (!graduation.outcomes) fail("WRONG_PHASE", "毕业机会尚未揭晓。");
  const route = action.route;
  if (route !== "TRANSITION") {
    if (!OPPORTUNITY_ORDER.includes(route)) fail("INVALID_ACTION", "去向无效。");
    if (graduation.outcomes[route] !== "OFFERED") fail("ROUTE_NOT_OFFERED", "这个去向在本次毕业时没有取得机会。");
  }
  const transitionMode = route === "TRANSITION" ? (offeredList(graduation).length > 0 ? "SELF_CHOSEN" : "NO_OFFER") : null;
  const entryMode = route === "PHD" ? (degree === "UG" ? "undergrad_direct" : "masters_entry") : null;
  graduation.resolution = route;
  draft.ending = {
    kind: "GRADUATION",
    route,
    early: null,
    degree,
    transitionMode,
    entryMode,
    card: computeEndingCard({
      seed: draft.seed,
      school: draft.school,
      profile: draft.profile,
      arcs: draft.arcs,
      history: draft.history,
      graduations: draft.graduations,
      degree,
      route,
      transitionMode,
    }),
  };
  draft.phase = "ENDING";
}

function enterMasters(step: Step, action: Extract<Action, { type: "ENTER_MASTERS" }>): void {
  const { draft, totals } = step;
  if (draft.phase !== "GRAD_RESULTS") fail("WRONG_PHASE", "现在不能选择硕士方案。");
  if (draft.stage !== "UG" || draft.mastersYears !== null) fail("MASTERS_NOT_AVAILABLE", "硕士之后不能再读第二个硕士。");
  if (!MASTERS_PROGRAM_ORDER.includes(action.program)) fail("INVALID_ACTION", "硕士方案无效。");
  const undergrad = draft.graduations.UG;
  if (!undergrad?.outcomes) fail("WRONG_PHASE", "本科毕业机会尚未揭晓。");
  // 重新校验本科结果与该方案预算（用天赋生效后的资助与开销），但不重新抽签。
  const blockers = mastersBlockers(
    action.program,
    undergrad,
    draft.stats.money,
    effectiveStipend(draft.profile, totals),
    effectiveUpkeep(totals),
    draft.mode === "classic",
  );
  if (blockers.length > 0) fail("MASTERS_NOT_AVAILABLE", `不满足硕士方案条件：${blockers.join(", ")}。`);
  const plan = MASTERS_PLANS[action.program];
  undergrad.resolution = "MASTERS";
  draft.stage = "MS";
  draft.mastersYears = plan.years;
  draft.termIndex = 1;
  record(step, "MASTERS_FEE", { ...zeroStats(), money: -plan.fee }, { program: action.program });
  beginTerm(step);
}

function transition(state: RunState, command: Command, ctx: EngineContext): RunState {
  if (command === null || typeof command !== "object" || typeof command.type !== "string") {
    fail("INVALID_ACTION", "操作无效。");
  }
  if (command.type === "CONFIRM_SETUP") return confirmSetup(state, command);
  const draft = cloneRun(requireActive(state));
  const step: Step = {
    draft,
    revision: state.revision,
    actionId: `r${state.revision}:${command.type}`,
    totals: talentTotalsOf(draft),
  };
  switch (command.type) {
    case "CHOOSE_EVENT":
      chooseEvent(step, command, ctx);
      break;
    case "CHOOSE_SCHOOL":
      chooseSchool(step, command);
      break;
    case "CHOOSE_PLAN":
      choosePlan(step, command);
      break;
    case "REVEAL_GRADUATION":
      revealGrad(step);
      break;
    case "CHOOSE_ROUTE":
      chooseRoute(step, command);
      break;
    case "ENTER_MASTERS":
      enterMasters(step, command);
      break;
    default:
      fail("INVALID_ACTION", "未知操作。");
  }
  return step.draft;
}

/** 唯一的状态转移入口。失败时返回原状态与错误，不抛异常。 */
export function applyAction(state: RunState, command: Command, ctx: EngineContext): ActionResult {
  try {
    if (command === null || typeof command !== "object") fail("INVALID_ACTION", "操作无效。");
    if (command.revision !== state.revision) {
      fail("STALE_REVISION", `操作基于 revision ${String(command.revision)}，当前是 ${state.revision}；重复或过期的操作不会结算。`);
    }
    const next = transition(state, command, ctx);
    next.revision = state.revision + 1;
    return { ok: true, state: next };
  } catch (error) {
    if (error instanceof EngineFailure) {
      return { ok: false, error: { code: error.code, message: error.message }, state };
    }
    throw error;
  }
}
