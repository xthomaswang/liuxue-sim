// 第三版（docs/22 第 2–3 节）：玩家只选天赋和分点，之后的每一个决定都由角色按自己的倾向自动做出。
// 这里只“选”操作，结算仍然全部走 applyAction；所以自动模拟出来的一局与手动一步步走出来的一局是同一种东西，
// 存档照样能从 seed 重放校验。所有决定都用 draw01(seed, key)，同样的开局永远得到同样的一生。

import { baseReadinessFor, finalReadiness } from "./admission";
import { AUTO, FOCUS_ORDER, LIFE_AUTO, OFFER_COUNT, POINT_MAX } from "./constants";
import { applyAction, talentPickProblem } from "./reducer";
import { draw01, pickIndex } from "./rng";
import {
  economyFromFamily, effectiveStipend, effectiveUpkeep, pointBudget, pointsUsed, pointsValid, readinessHeadStart,
  startStatsFromPoints, sumTalentEffects,
} from "./talents";
import { findTalent } from "./pools";
import { currentEvent, focusView, mastersOptions, routeOptions } from "./views";
import type {
  Action, ActiveRun, Aspiration, ChoiceId, EngineContext, EventView, Focus, FocusView, MastersOption, Opportunity, Points,
  RouteOption, RunState, SetupRun, StartPreview, Talent,
} from "./types";

// ---------- 分点预览 ----------

/** 分点一屏的实时预览：按选中的天赋与当前点数，开局会是什么样。不认识的天赋 id 忽略不计。 */
export function startPreview(state: SetupRun, talents: readonly string[], points: Points): StartPreview {
  const picked = talents.map((id) => findTalent(id)).filter((talent): talent is Talent => talent !== undefined);
  const totals = sumTalentEffects(picked);
  // 界面在分点过程中会不断调用这里；数值不合规时按“就近的合法值”预览，valid 如实给出 false。
  const raw = (points ?? {}) as Partial<Record<keyof Points, unknown>>;
  const safe: Points = {
    family: clampPoint(raw.family),
    academics: clampPoint(raw.academics),
    career: clampPoint(raw.career),
    wellbeing: clampPoint(raw.wellbeing),
  };
  return {
    pointBudget: pointBudget(totals),
    pointsUsed: pointsUsed(safe),
    valid: pointsValid(points, totals),
    economy: economyFromFamily(safe.family),
    stats: startStatsFromPoints(safe, totals),
    stipend: effectiveStipend({ economy: economyFromFamily(safe.family), points: safe }, totals),
    upkeep: effectiveUpkeep(totals),
    readiness: finalReadiness(baseReadinessFor(state.seed), 0, readinessHeadStart(safe, totals)),
  };
}

function clampPoint(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(POINT_MAX, Math.max(0, Math.round(value))) : 0;
}

// ---------- 自动决定 ----------

function pointsOf(run: ActiveRun): Points {
  if (!run.profile.points) throw new Error("AUTO_NEEDS_POINTS: 经典模式没有分点，不能自动决定");
  return run.profile.points;
}

/**
 * 事件选项（22 §3.1）。在意程度 v = 1 + 点数/5（资金与身心是“越少越在意”），手头紧或很累时再加 3；
 * 得分 = Σ v × 该选项实际会发生的变化；两项都能选时 70% 取得分高的（相同取 A）。
 * 为了让“相同”的判断不受浮点误差影响，这里把 v 统一乘 5 用整数算，排序与文档的公式完全一致。
 */
export function autoChoice(run: ActiveRun, view: EventView): ChoiceId {
  const p = pointsOf(run);
  const upkeepNow = view.choices[0]?.projected?.upkeep; // 高中事件没有必要开销
  const weight5 = {
    money: 5 + (POINT_MAX - p.family) + (upkeepNow !== undefined && run.stats.money < upkeepNow ? 5 * AUTO.BROKE_MONEY_BOOST : 0),
    academics: 5 + p.academics,
    career: 5 + p.career,
    wellbeing: 5 + (POINT_MAX - p.wellbeing) + (run.stats.wellbeing < AUTO.LOW_WELLBEING_BELOW ? 5 * AUTO.LOW_WELLBEING_BOOST : 0),
  };
  const available = view.choices.filter((choice) => choice.available);
  if (available.length === 0) throw new Error(`AUTO_NO_CHOICE: ${view.event.id} 没有可选项`);
  if (available.length === 1) return available[0].choice.id;
  const score = (choice: EventView["choices"][number]): number =>
    weight5.money * choice.delta.applied.money + weight5.academics * choice.delta.applied.academics +
    weight5.career * choice.delta.applied.career + weight5.wellbeing * choice.delta.applied.wellbeing;
  const [a, b] = view.choices;
  const preferred = score(b) > score(a) ? b : a;
  const other = preferred === a ? b : a;
  return draw01(run.seed, `auto:event:${view.event.id}`) < AUTO.PREFERRED_PROBABILITY ? preferred.choice.id : other.choice.id;
}

/** 某一类安排的权重（22 §3.2）。 */
export function planWeight(focus: FocusView["options"][number]["focus"], p: Points, money: number, wellbeing: number, upkeepCost: number): number {
  switch (focus) {
    case "STUDY":
      return 2 + p.academics / 2;
    case "CAREER":
      return 2 + p.career / 2;
    case "CAMPUS":
      return 2 + p.wellbeing / 2;
    case "WORK":
      return (
        1 + (POINT_MAX - p.family) / 4 +
        (money < 2 * upkeepCost ? AUTO.PLAN_WORK_TIGHT_BONUS : 0) +
        (money < upkeepCost ? AUTO.PLAN_WORK_BROKE_BONUS : 0)
      );
    case "REST":
      return 1 + (wellbeing < AUTO.PLAN_REST_EXHAUSTED_BELOW ? AUTO.PLAN_REST_EXHAUSTED_BONUS : wellbeing < AUTO.PLAN_REST_TIRED_BELOW ? AUTO.PLAN_REST_TIRED_BONUS : 0);
  }
}

/** 学期安排（22 §3.2）：去掉买不起的，按类别加权抽一张（展示顺序累计，取第一张累计值严格大于 r 的）。 */
export function autoPlan(run: ActiveRun, view: FocusView): string {
  const p = pointsOf(run);
  const open = view.options.filter((option) => option.available);
  if (open.length === 0) throw new Error("AUTO_NO_PLAN: 这学期没有可选的安排");
  const weights = open.map((option) => planWeight(option.focus, p, run.stats.money, run.stats.wellbeing, view.upkeep));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const r = draw01(run.seed, `auto:plan:${run.stage}:${run.termIndex}`) * total;
  let cumulative = 0;
  for (let i = 0; i < open.length; i++) {
    cumulative += weights[i];
    if (cumulative > r) return open[i].plan.id;
  }
  return open[open.length - 1].plan.id;
}

/** 毕业后每年重心的权重（docs/24 §4.3）：同学期安排，只是钱紧的门槛换成毕业后的。 */
export function lifeFocusWeight(focus: Focus, p: Points, money: number, wellbeing: number): number {
  switch (focus) {
    case "STUDY":
      return 2 + p.academics / 2;
    case "CAREER":
      return 2 + p.career / 2;
    case "CAMPUS":
      return 2 + p.wellbeing / 2;
    case "WORK":
      return (
        1 + (POINT_MAX - p.family) / 4 +
        (money < LIFE_AUTO.WORK_TIGHT_BELOW ? LIFE_AUTO.WORK_TIGHT_BONUS : 0) +
        (money < LIFE_AUTO.WORK_BROKE_BELOW ? LIFE_AUTO.WORK_BROKE_BONUS : 0)
      );
    case "REST":
      return 1 + (wellbeing < AUTO.PLAN_REST_EXHAUSTED_BELOW ? AUTO.PLAN_REST_EXHAUSTED_BONUS : wellbeing < AUTO.PLAN_REST_TIRED_BELOW ? AUTO.PLAN_REST_TIRED_BONUS : 0);
  }
}

/** 毕业后这一年的重心：按 STUDY、CAREER、CAMPUS、WORK、REST 的顺序累计，取第一项累计值严格大于 r 的。 */
export function autoLifeFocus(run: ActiveRun): Focus {
  const p = pointsOf(run);
  const year = (run.life?.year ?? 0) + 1;
  const weights = FOCUS_ORDER.map((focus) => lifeFocusWeight(focus, p, run.stats.money, run.stats.wellbeing));
  const r = draw01(run.seed, `auto:life:${year}`) * weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let i = 0; i < FOCUS_ORDER.length; i++) {
    cumulative += weights[i];
    if (cumulative > r) return FOCUS_ORDER[i];
  }
  return FOCUS_ORDER[FOCUS_ORDER.length - 1];
}

const ROUTE_ORDER: Readonly<Record<Aspiration, readonly Opportunity[]>> = {
  DISCOVERY: ["PHD", "LOCAL_JOB", "HOME_JOB"],
  INDEPENDENCE: ["LOCAL_JOB", "HOME_JOB", "PHD"],
  BELONGING: ["HOME_JOB", "LOCAL_JOB", "PHD"],
};

/**
 * 毕业去向与读不读硕士（22 §3.4）。
 * 先看要不要再读一轮（仅本科、且有可选的硕士方案）：一个机会都没有 → 75%；有机会但首选那一路没取得 → 35%；
 * 首选已经取得 → 不读。不读硕士时，在已取得的机会里按愿望的顺序取第一个（6% 主动留白）；没有机会就是过渡期。
 */
export function autoGraduation(run: ActiveRun, routes: readonly RouteOption[], masters: readonly MastersOption[]): Action {
  const order = ROUTE_ORDER[run.profile.aspiration];
  const offered = order.filter((route) => routes.some((option) => option.route === route && option.available));
  const programs = masters.filter((option) => option.eligible);
  if (run.stage === "UG" && programs.length > 0) {
    const willingness =
      offered.length === 0 ? AUTO.MASTERS_PROBABILITY : offered[0] !== order[0] ? AUTO.MASTERS_RETRY_PROBABILITY : 0;
    if (draw01(run.seed, "auto:masters") < willingness) {
      if (programs.length === 1) return { type: "ENTER_MASTERS", program: programs[0].program };
      return {
        type: "ENTER_MASTERS",
        program: draw01(run.seed, "auto:masters:years") < AUTO.MASTERS_ONE_YEAR_PROBABILITY ? "MS_1Y" : "MS_2Y",
      };
    }
  }
  if (offered.length > 0) {
    const degree = run.stage === "MS" ? "MS" : "UG";
    return draw01(run.seed, `auto:route:${degree}`) < AUTO.SELF_TRANSITION_PROBABILITY
      ? { type: "CHOOSE_ROUTE", route: "TRANSITION" }
      : { type: "CHOOSE_ROUTE", route: offered[0] };
  }
  return { type: "CHOOSE_ROUTE", route: "TRANSITION" };
}

/**
 * 当前状态下角色自己会做的那一步；结局之后返回 null。
 * 开局（选天赋与分点）必须由玩家给出，经典模式没有分点也就没有倾向——这两种情况直接抛错。
 */
export function autoAction(state: RunState, _ctx: EngineContext): Action | null {
  if (state.phase === "SETUP") throw new Error("AUTO_NEEDS_SETUP: 开局的天赋与分点必须由玩家给出");
  if (state.mode !== "standard") throw new Error("AUTO_NEEDS_POINTS: 经典模式没有分点，不能自动决定");
  switch (state.phase) {
    case "HIGH_SCHOOL_EVENT":
    case "CORE_EVENT":
    case "ARC_EVENT": {
      const view = currentEvent(state);
      if (!view) throw new Error(`AUTO_NO_EVENT: ${state.phase} 没有当前事件`);
      return { type: "CHOOSE_EVENT", eventId: view.event.id, choiceId: autoChoice(state, view) };
    }
    case "SCHOOL_OFFERS": {
      const offers = state.offers ?? [];
      if (offers.length !== OFFER_COUNT) throw new Error("AUTO_NO_OFFERS: 没有可选的学校");
      return { type: "CHOOSE_SCHOOL", unitid: offers[pickIndex(state.seed, "auto:school", OFFER_COUNT)].unitid };
    }
    case "FOCUS": {
      const view = focusView(state);
      if (!view) throw new Error("AUTO_NO_PLAN: 没有安排视图");
      return { type: "CHOOSE_PLAN", planId: autoPlan(state, view) };
    }
    case "GRAD_PREVIEW":
      return { type: "REVEAL_GRADUATION" };
    case "GRAD_RESULTS":
      return autoGraduation(state, routeOptions(state), mastersOptions(state));
    case "LIFE":
      return { type: "LIVE_YEAR", focus: autoLifeFocus(state) };
    case "ENDING":
      return null;
  }
}

/**
 * 确认开局之后把整局自动走完：返回最终状态与完整的操作记录（可交给 serializeSave / replay）。
 * 天赋或点数不合法时抛错。
 */
export function simulate(
  state: SetupRun,
  input: { talents: string[]; points: Points },
  ctx: EngineContext,
): { state: RunState; log: Action[] } {
  if (state.mode !== "standard") throw new Error("AUTO_NEEDS_POINTS: 经典模式没有分点，不能自动模拟");
  const problem = talentPickProblem(state, input.talents);
  if (problem) throw new Error(`SIMULATE_REJECTED: ${problem}`);
  const log: Action[] = [];
  let current: RunState = state;
  let action: Action | null = { type: "CONFIRM_SETUP", talents: [...input.talents], points: { ...input.points } };
  // 最长的一局（两年硕士加毕业后五年）不到 60 步；上限只是防止内容或规则出错时空转。
  for (let guard = 0; action !== null && guard < 300; guard++) {
    const result = applyAction(current, { ...action, revision: current.revision }, ctx);
    if (!result.ok) throw new Error(`SIMULATE_REJECTED: ${action.type} 被拒绝（${result.error.code}）${result.error.message}`);
    log.push(action);
    current = result.state;
    action = autoAction(current, ctx);
  }
  if (current.phase !== "ENDING") throw new Error("SIMULATE_STUCK: 自动模拟没有走到结局");
  return { state: current, log };
}
