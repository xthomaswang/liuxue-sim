// 状态机（docs/06 第 1、5、6 节）。applyAction 是唯一的状态转移入口：
// 先校验 revision、phase、事件 ID 与资金，再在一份拷贝上完成全部更新；失败时原状态原样返回。

import { EVENT_BY_ID } from "../content";
import { baseReadinessFor, poolCounts, resolveAdmission, sampleOffers } from "./admission";
import {
  ALL_TIERS, ASPIRATION_ORDER, CONTENT_VERSION, CORE_EVENT_IDS, ECONOMY_ORDER, EXPECTATION_ORDER, FOCUS_ORDER,
  HIGH_SCHOOL_EVENT_IDS, INITIAL_STATS, MASTERS_PLANS, MASTERS_PROGRAM_ORDER, MIN_POOL_SIZE, OPPORTUNITY_ORDER,
  PLAYER_NAME_MAX, RULES_VERSION, STIPEND, TERM_GROWTH, TRAIT_ORDER, UG_TERMS,
} from "./constants";
import { computeEndingCard } from "./endingCard";
import { freezeGraduation, mastersBlockers, offeredList, revealGraduation } from "./graduation";
import { pickIndex } from "./rng";
import {
  applyDelta, arcSlotForTerm, arcWeights, copyStats, focusVector, pickArc, upkeep, upkeepCost, zeroFocusCounts,
  zeroStats,
} from "./rules";
import type {
  Action, ActionResult, ActiveRun, CatalogCheck, Command, Degree, EngineContext, EngineErrorCode, FamilyCandidate,
  HistoryEntry, HistoryKind, MastersProgram, OfferTier, RunState, RuntimeCatalog, RuntimeSchool, SetupRun, Stats,
  StoryEvent,
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

/** 新开一局，停在 SETUP。目录不合格时抛出 CATALOG_POOL_TOO_SMALL。 */
export function createRun(args: { seed: number; runId: string; catalog: RuntimeCatalog }): SetupRun {
  const check = checkCatalog(args.catalog);
  if (!check.ok) throw new Error(`CATALOG_POOL_TOO_SMALL: ${check.message}`);
  if (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 0xffffffff) {
    throw new Error("INVALID_SEED: seed 必须是 0 到 4294967295 的整数");
  }
  return {
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
    phase: "SETUP",
  };
}

/** 固定顺序 LOW、MID、HIGH 的三张家庭档案；期待与特质各自独立抽取，允许相同。 */
export function familyCandidates(seed: number): FamilyCandidate[] {
  return ECONOMY_ORDER.map((economy) => {
    const expectation = EXPECTATION_ORDER[pickIndex(seed, `family:${economy}:expectation`, EXPECTATION_ORDER.length)];
    const trait = TRAIT_ORDER[pickIndex(seed, `family:${economy}:trait`, TRAIT_ORDER.length)];
    return {
      economy,
      expectation,
      trait,
      initialStats: copyStats(INITIAL_STATS[economy]),
      stipend: STIPEND[economy],
      upkeep: upkeepCost(trait),
    };
  });
}

/** 20–80 的整数。 */
export function baseReadiness(seed: number): number {
  return baseReadinessFor(seed);
}

// ---------- 当前应处理的事件 ----------

export function termCountOf(state: ActiveRun): number {
  if (state.stage === "UG") return UG_TERMS;
  if (state.stage === "MS") return (state.mastersYears ?? 0) * 2;
  return 0;
}

/** 当前 phase 下唯一合法的事件 ID；不在事件阶段返回 null。 */
export function expectedEventId(state: ActiveRun): string | null {
  if (state.phase === "HIGH_SCHOOL_EVENT") {
    return state.highSchoolNode ? HIGH_SCHOOL_EVENT_IDS[state.highSchoolNode - 1] : null;
  }
  if (state.phase === "CORE_EVENT") {
    if (state.stage === "UG") return CORE_EVENT_IDS[state.termIndex - 1] ?? null;
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

function beginTerm(step: Step): void {
  const stipend = STIPEND[step.draft.profile.economy];
  record(step, "STIPEND", { ...zeroStats(), money: stipend });
  step.draft.phase = "FOCUS";
}

function finishTerm(step: Step): void {
  const { draft } = step;
  const result = upkeep(draft.stats.money, draft.profile.trait);
  record(step, "UPKEEP", result.requested, {
    upkeep: { cost: result.cost, paid: result.paid, shortfall: result.shortfall, stress: result.stress },
  });
  record(step, "GROWTH", copyStats(TERM_GROWTH));
  draft.phase = "TERM_REVIEW";
}

function requireActive(state: RunState): ActiveRun {
  if (state.phase === "SETUP") fail("WRONG_PHASE", "还没有选定家庭档案。");
  return state as ActiveRun;
}

// ---------- 各操作 ----------

function confirmSetup(state: RunState, action: Extract<Action, { type: "CONFIRM_SETUP" }>): ActiveRun {
  if (state.phase !== "SETUP") fail("WRONG_PHASE", "开局选择已经确认。");
  if (!ECONOMY_ORDER.includes(action.economy) || !ASPIRATION_ORDER.includes(action.aspiration)) {
    fail("INVALID_ACTION", "家庭档案或个人愿望无效。");
  }
  if (typeof action.name !== "string") fail("INVALID_ACTION", "名字无效。");
  const candidate = familyCandidates(state.seed).find((item) => item.economy === action.economy);
  if (!candidate) fail("INVALID_ACTION", "家庭档案无效。");
  const name = Array.from(action.name.trim()).slice(0, PLAYER_NAME_MAX).join("");
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
    phase: "HIGH_SCHOOL_EVENT",
    stage: "HS",
    termIndex: 0,
    highSchoolNode: 1,
    mastersYears: null,
    profile: {
      name,
      economy: candidate.economy,
      expectation: candidate.expectation,
      trait: candidate.trait,
      aspiration: action.aspiration,
    },
    stats: copyStats(candidate.initialStats),
    focusCounts: zeroFocusCounts(),
    flags: [],
    arcs: { A: null, B: null },
    admission: {
      baseReadiness: baseReadinessFor(state.seed),
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
    const drawn = resolveAdmission(draft.seed, draft.admission.baseReadiness, draft.flags);
    let offers: RuntimeSchool[];
    try {
      offers = sampleOffers(draft.seed, drawn.tier, ctx.catalog);
    } catch (error) {
      fail("CATALOG_POOL_TOO_SMALL", (error as Error).message);
    }
    draft.admission = { baseReadiness: draft.admission.baseReadiness, ...drawn };
    draft.offers = offers.map((school) => ({ ...school, rank: school.rank ? { ...school.rank } : null }));
    draft.phase = "SCHOOL_OFFERS";
    return;
  }

  if (phase === "CORE_EVENT" && draft.stage === "UG") {
    const slot = arcSlotForTerm(draft.termIndex);
    if (slot) {
      if (slot.beat === 1) {
        // 权重读取“本学期投入＋主线事件已结算、支线尚未结算”的状态；B 排除 A。分配后不再重抽。
        const weights = arcWeights({
          focusCounts: draft.focusCounts,
          stats: draft.stats,
          trait: draft.profile.trait,
          economy: draft.profile.economy,
        });
        draft.arcs[slot.slot] = pickArc(draft.seed, slot.slot, weights, slot.slot === "B" ? draft.arcs.A : null);
      }
      draft.phase = "ARC_EVENT";
      return;
    }
  }
  finishTerm(step);
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

function chooseFocus(step: Step, action: Extract<Action, { type: "CHOOSE_FOCUS" }>): void {
  const { draft } = step;
  if (draft.phase !== "FOCUS") fail("WRONG_PHASE", "现在不是选择投入重心的时候。");
  if (!FOCUS_ORDER.includes(action.focus)) fail("INVALID_ACTION", "投入重心无效。");
  const vector = focusVector(action.focus, draft.profile.trait, draft.stats.wellbeing);
  record(step, "FOCUS", vector.requested, { focus: action.focus, efficiency: vector.factor });
  draft.focusCounts[action.focus] += 1;
  draft.phase = "CORE_EVENT";
}

function nextTerm(step: Step): void {
  const { draft } = step;
  if (draft.phase !== "TERM_REVIEW") fail("WRONG_PHASE", "本学期还没有结算。");
  if (draft.stage !== "UG" && draft.stage !== "MS") fail("WRONG_PHASE", "当前不在学期中。");
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
  });
  draft.phase = "GRAD_PREVIEW";
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
    route,
    degree,
    transitionMode,
    entryMode,
    card: computeEndingCard({
      seed: draft.seed,
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
  const { draft } = step;
  if (draft.phase !== "GRAD_RESULTS") fail("WRONG_PHASE", "现在不能选择硕士方案。");
  if (draft.stage !== "UG" || draft.mastersYears !== null) fail("MASTERS_NOT_AVAILABLE", "硕士之后不能再读第二个硕士。");
  if (!MASTERS_PROGRAM_ORDER.includes(action.program)) fail("INVALID_ACTION", "硕士方案无效。");
  const undergrad = draft.graduations.UG;
  if (!undergrad?.outcomes) fail("WRONG_PHASE", "本科毕业机会尚未揭晓。");
  // 重新校验本科结果与该方案预算，但不重新抽签。
  const blockers = mastersBlockers(action.program, undergrad, draft.stats.money, draft.profile.economy, draft.profile.trait);
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
  const step: Step = {
    draft: cloneRun(requireActive(state)),
    revision: state.revision,
    actionId: `r${state.revision}:${command.type}`,
  };
  switch (command.type) {
    case "CHOOSE_EVENT":
      chooseEvent(step, command, ctx);
      break;
    case "CHOOSE_SCHOOL":
      chooseSchool(step, command);
      break;
    case "CHOOSE_FOCUS":
      chooseFocus(step, command);
      break;
    case "NEXT_TERM":
      nextTerm(step);
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
