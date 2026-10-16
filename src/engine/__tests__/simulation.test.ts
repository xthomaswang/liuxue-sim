// 整局自动模拟（docs/22 §3–§5、§7、§10；第四版的学期细节与毕业后的五年见 docs/24 §13）：七种分点方案各跑一批 seed，
// 天赋取十连抽的前三张，之后全程（含毕业后的五年）由引擎自己的 autoAction 决定。
// 硬性检查：每一局都合法地走到结局；reducer 判出的中途结局与按期末状态独立重算的一致；抽样的局
// simulate 结果相同、存档能读回、轨迹与总结能生成。
// 其余都是打印出来给调平衡用的统计，频率不做硬断言（内容随时在加）：
//   SIM_RUNS=4000 npx vitest run src/engine/__tests__/simulation.test.ts --silent=false
// 第四版内容的可达性（每条暑假、日常、里程碑、生活小事、五年后结局、中途结局、去向结局都在模拟里出现过）只打印；
// 内容写完后用 SIM_REACH=1 打开对应的断言（带天赋条件的条目另用固定天赋跑）：
//   SIM_REACH=1 SIM_RUNS=3000 npx vitest run src/engine/__tests__/simulation.test.ts --silent=false
// 试一组新的触发概率或条件（只改这个测试进程内存里的值，不动内容文件）——数字是 chancePermille，对象可以同时换 when：
//   SIM_EARLY_OVERRIDES='{"E_STARTUP":50,"E_STRESS":{"chancePermille":400,"when":{"countMin":{"STUDY":3},"statMax":{"wellbeing":15}}}}' \
//     SIM_RUNS=4000 npx vitest run src/engine/__tests__/simulation.test.ts --silent=false

import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS, CATALOG, DAILY_LINES, EARLY_ENDINGS, ENDING_FLAVORS, HAPPENINGS, LIFE_COMMON, LIFE_TRACKS, SUMMERS,
  TALENTS,
} from "../../content";
import { conditionMet } from "../conditions";
import { AUTO, BUSY_LIFE_HAPPENINGS_MIN, FOCUS_ORDER, LIFE_TRACK_ORDER } from "../constants";
import { dailyPicksFor } from "../daily";
import { checkEarlyEnding } from "../early";
import { termGpas } from "../gpa";
import {
  evaluateRun, focusView, loadSave, mastersOptions, serializeSave, setupView, simulate, startPreview, summaryView,
  timeline,
} from "../index";
import type {
  ActiveRun, EndingCondition, EndingTierId, EngineContext, Focus, Points, ProgressSnapshot, RunState,
} from "../index";
import { scalePoints, simulateObserved, start, termEndContext } from "./helpers";

const REAL: EngineContext = { catalog: CATALOG }; // 真实目录：有真实的州名，去向结局的 schoolStates 条件才有意义
const RUNS = Math.max(60, Number(process.env.SIM_RUNS ?? 300));
const PLAYERS = Math.max(20, Number(process.env.SIM_PLAYERS ?? 60));
const TIMEOUT = 900_000;

const OVERRIDES = JSON.parse(process.env.SIM_EARLY_OVERRIDES ?? "{}") as Record<string, number | { chancePermille?: number; when?: EndingCondition }>;
for (const [id, override] of Object.entries(OVERRIDES)) {
  const ending = EARLY_ENDINGS.find((item) => item.id === id);
  if (!ending) throw new Error(`SIM_EARLY_OVERRIDES: 没有中途结局 ${id}`);
  const patch = typeof override === "number" ? { chancePermille: override } : override;
  if (patch.chancePermille !== undefined) ending.chancePermille = patch.chancePermille;
  if (patch.when !== undefined) ending.when = patch.when;
}

// 同样地，试一组新的自动决定参数（constants.ts 里 AUTO 的键），也只改内存：
//   SIM_AUTO_OVERRIDES='{"PLAN_WORK_BROKE_BONUS":20}' SIM_RUNS=3000 npx vitest run …
const AUTO_OVERRIDES = JSON.parse(process.env.SIM_AUTO_OVERRIDES ?? "{}") as Record<string, number>;
for (const [key, value] of Object.entries(AUTO_OVERRIDES)) {
  if (!(key in AUTO)) throw new Error(`SIM_AUTO_OVERRIDES: AUTO 里没有 ${key}`);
  (AUTO as unknown as Record<string, number>)[key] = value;
}

const P = (family: number, academics: number, career: number, wellbeing: number): Points => ({ family, academics, career, wellbeing });
const ZERO = P(0, 0, 0, 0);
const SCENARIOS = [
  { name: "均衡", points: P(5, 5, 5, 5) },
  { name: "偏学业", points: P(2, 10, 4, 4) },
  { name: "偏职业", points: P(2, 4, 10, 4) },
  { name: "家境拉满", points: P(10, 4, 3, 3) },
  { name: "家境见底", points: P(0, 8, 6, 6) },
  { name: "爱玩", points: P(4, 2, 4, 10) },
  { name: "身心见底", points: P(6, 7, 7, 0) },
] as const;
type Scenario = (typeof SCENARIOS)[number];

const TIER_ORDER: EndingTierId[] = ["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"];
const ROUTES = ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"] as const;
const ALLOWED_PHASES = ["HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "GRAD_PREVIEW", "GRAD_RESULTS", "LIFE", "ENDING"];
const USER_NAMED = ["E_NITROUS", "E_OVERINDULGE", "E_PLAYBOY", "E_STRESS"];

function assertLegal(state: ActiveRun, label: string): void {
  if (!ALLOWED_PHASES.includes(state.phase)) throw new Error(`${label}：未知阶段 ${state.phase}`);
  for (const key of ["money", "academics", "career", "wellbeing"] as const) {
    const value = state.stats[key];
    if (!Number.isInteger(value) || value < 0 || value > 100 || Object.is(value, -0)) {
      throw new Error(`${label}：${key} = ${value} 不是 0–100 的整数`);
    }
  }
  if (state.phase === "FOCUS") {
    const view = focusView(state);
    const open = view?.options.filter((option) => option.available).length ?? 0;
    if (view?.options.length !== 4 || open < 1) throw new Error(`${label}：安排 ${view?.options.length} 张、可选 ${open} 张`);
  }
}

const bump = (map: Map<string, number>, key: string, by = 1): void => void map.set(key, (map.get(key) ?? 0) + by);

interface Tally {
  runs: number;
  early: Map<string, number>;
  /** 条件满足的学期末数（不管抽没抽中、也不管排在前面的有没有先触发）。 */
  exposure: Map<string, number>;
  /** 至少有一个学期末满足条件的局数。 */
  exposedRuns: Map<string, number>;
  earlyAt: Map<string, number>;
  flavor: Map<string, number>;
  route: Map<string, number>;
  tier: Map<string, number>;
  gradTier: Map<string, number>;
  hidden: Map<string, number>;
  achievement: Map<string, number>;
  masters: number;
  graduated: number;
  /** 走到本科毕业的局；其中三路都没拿到的；其中又有硕士方案可选的。 */
  ugGraduated: number;
  ugNoOffer: number;
  ugNoOfferCanMasters: number;
  /** 本科毕业时有硕士方案可选（不管手里有没有机会）；其中首选那一路没取得的。 */
  ugCanMasters: number;
  /** 本科毕业时三路各自拿到的局数。 */
  ugOffered: Record<"PHD" | "LOCAL_JOB" | "HOME_JOB", number>;
  /** 期末出现资金短缺的学期数。 */
  shortfallTerms: number;
  focus: Record<Focus, number>;
  terms: number;
  newAchievements: number;
  unlocks: number;
  budgetChanged: number;
  // ---- 第四版 ----
  /** 每局的突发小事条数。 */
  happenings: number[];
  /** 全部学期的期末 GPA。 */
  gpas: number[];
  gpa4Runs: number;
  gpaLowRuns: number;
  /** 五年里换过轨道（tracks ≥ 2）、换过三次（≥ 4）的局。 */
  switched: number;
  zigzag: number;
  /** 最后所在的轨道 → 五年后的结局 → 局数。 */
  outcomes: Map<string, Map<string, number>>;
  lifeFlags: Map<string, number>;
  summers: number;
  milestones: number;
  lifeEvents: number;
}

const emptyTally = (): Tally => ({
  runs: 0, early: new Map(), exposure: new Map(), exposedRuns: new Map(), earlyAt: new Map(), flavor: new Map(),
  route: new Map(), tier: new Map(), gradTier: new Map(), hidden: new Map(), achievement: new Map(), masters: 0,
  graduated: 0, ugGraduated: 0, ugNoOffer: 0, ugNoOfferCanMasters: 0, ugCanMasters: 0, ugOffered: { PHD: 0, LOCAL_JOB: 0, HOME_JOB: 0 },
  shortfallTerms: 0, focus: { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 }, terms: 0, newAchievements: 0, unlocks: 0,
  budgetChanged: 0, happenings: [], gpas: [], gpa4Runs: 0, gpaLowRuns: 0, switched: 0, zigzag: 0, outcomes: new Map(),
  lifeFlags: new Map(), summers: 0, milestones: 0, lifeEvents: 0,
});

/** 在全部模拟里出现过的第四版内容（以及中途结局、去向结局、突发小事），按类别。 */
const REACHED = {
  summer: new Set<string>(),
  daily: new Set<string>(),
  milestone: new Set<string>(),
  event: new Set<string>(),
  outcome: new Set<string>(),
  early: new Set<string>(),
  flavor: new Set<string>(),
  happening: new Set<string>(),
};
function reach(run: ActiveRun): void {
  for (const entry of run.history) {
    if (entry.kind === "SUMMER" && entry.summerId) REACHED.summer.add(entry.summerId);
    if (entry.kind === "HAPPENING" && entry.happeningId) REACHED.happening.add(entry.happeningId);
    if (entry.kind === "LIFE_EVENT" && entry.lifeEventId) (entry.milestone ? REACHED.milestone : REACHED.event).add(entry.lifeEventId);
  }
  for (const pick of dailyPicksFor(run)) REACHED.daily.add(pick.line.id);
  if (run.life?.outcome) REACHED.outcome.add(run.life.outcome.id);
  if (run.ending?.early) REACHED.early.add(run.ending.early);
  if (run.ending?.card.flavor) REACHED.flavor.add(run.ending.card.flavor.id);
}
/** 第四版内容的全部条目，按类别。 */
const ALL_CONTENT = {
  summer: SUMMERS.map((item) => item.id),
  daily: DAILY_LINES.map((item) => item.id),
  milestone: [...LIFE_TRACK_ORDER.flatMap((track) => LIFE_TRACKS[track].milestones), ...LIFE_COMMON.milestones].map((item) => item.id),
  event: [...LIFE_TRACK_ORDER.flatMap((track) => LIFE_TRACKS[track].events), ...LIFE_COMMON.events].map((item) => item.id),
  outcome: LIFE_TRACK_ORDER.flatMap((track) => LIFE_TRACKS[track].outcomes).map((item) => item.id),
  early: EARLY_ENDINGS.map((item) => item.id),
  flavor: ENDING_FLAVORS.map((item) => item.id),
  happening: HAPPENINGS.map((item) => item.id),
};

const emptyProgress = (): ProgressSnapshot => ({ runs: 0, tiers: {}, hidden: {}, early: {}, flavors: {}, achievements: [], unlockedTalents: [] });

interface Outcome {
  state: ActiveRun;
  log: ReturnType<typeof simulateObserved>["log"];
  input: { talents: string[]; points: Points };
}

/** 跑一局：天赋取十连抽的前三张，点数按方案（预算不是 20 时按比例调整），其余全部自动。 */
function runOne(
  seed: number,
  scenario: Scenario,
  tally: Tally | null,
  inputs: { unlockedTalents?: string[]; inheritedTalent?: string | null } = {},
): Outcome {
  const label = `${scenario.name} seed ${seed}`;
  const setup = start(seed, REAL, inputs);
  const talents = setupView(setup).draw.slice(0, 3).map((talent) => talent.id);
  const budget = startPreview(setup, talents, ZERO).pointBudget;
  const points = scalePoints(scenario.points, budget);
  const exposed = new Set<string>();
  let revision = 0;
  const { state, log } = simulateObserved(setup, { talents, points }, REAL, (before, _action, after) => {
    assertLegal(after, label);
    revision += 1;
    if (after.revision !== revision) throw new Error(`${label}：revision ${after.revision}，应为 ${revision}`);
    if (tally && after.phase === "GRAD_RESULTS" && after.stage === "UG") {
      tally.ugGraduated += 1;
      const outcomes = after.graduations.UG?.outcomes;
      if (mastersOptions(after).some((option) => option.eligible)) tally.ugCanMasters += 1;
      for (const key of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) if (outcomes?.[key] === "OFFERED") tally.ugOffered[key] += 1;
      if (outcomes && Object.values(outcomes).every((outcome) => outcome !== "OFFERED")) {
        tally.ugNoOffer += 1;
        if (mastersOptions(after).some((option) => option.eligible)) tally.ugNoOfferCanMasters += 1;
      }
    }
    const context = termEndContext(before, after);
    if (!context) return;
    // 接线检查：reducer 判出的中途结局必须与按期末状态独立重算的一致（这一步里刚写下的那个）
    const expected = checkEarlyEnding(seed, context)?.ending.id ?? null;
    const fresh = before.phase !== "SETUP" && before.ending === null;
    const actual = fresh && after.ending?.kind === "EARLY" ? after.ending.early : null;
    if (expected !== actual) throw new Error(`${label} ${context.stage}:${context.term}：中途结局应为 ${expected}，实际 ${actual}`);
    if (!tally) return;
    tally.terms += 1;
    if ((context.history[context.history.length - 2]?.upkeep?.shortfall ?? 0) > 0) tally.shortfallTerms += 1;
    for (const ending of EARLY_ENDINGS) {
      if (!conditionMet(ending.when, context)) continue;
      bump(tally.exposure, ending.id);
      exposed.add(ending.id);
    }
    if (actual) bump(tally.earlyAt, `${context.stage}:${context.term}`);
  });
  const end = state as ActiveRun;
  if (end.phase !== "ENDING" || !end.ending) throw new Error(`${label}：没有走到结局`);
  if (tally) {
    const ending = end.ending;
    tally.runs += 1;
    if (budget !== 20) tally.budgetChanged += 1;
    for (const id of exposed) bump(tally.exposedRuns, id);
    bump(tally.tier, ending.card.tier);
    if (end.graduations.UG?.resolution === "MASTERS") tally.masters += 1;
    for (const focus of FOCUS_ORDER) tally.focus[focus] += end.focusCounts[focus];
    if (ending.kind === "EARLY") {
      bump(tally.early, ending.early ?? "?");
      bump(tally.route, "EARLY");
    } else {
      tally.graduated += 1;
      bump(tally.route, ending.route ?? "?");
      bump(tally.gradTier, ending.card.tier);
      bump(tally.flavor, ending.card.flavor?.id ?? "(无)");
      for (const hidden of ending.card.hidden) bump(tally.hidden, hidden.id);
    }
    const rewards = evaluateRun(end, emptyProgress());
    tally.newAchievements += rewards.achievements.length;
    for (const id of rewards.achievements) bump(tally.achievement, id);
    if (rewards.unlockedTalent) tally.unlocks += 1;
    // 第四版
    tally.happenings.push(end.history.filter((entry) => entry.kind === "HAPPENING").length);
    const gpas = termGpas(end).map((item) => item.gpa);
    tally.gpas.push(...gpas);
    if (gpas.some((gpa) => gpa >= 4)) tally.gpa4Runs += 1;
    if (gpas.some((gpa) => gpa < 2)) tally.gpaLowRuns += 1;
    const life = end.life;
    if (!life?.outcome) throw new Error(`${label}：没有走完毕业后的五年`);
    if (life.tracks.length >= 2) tally.switched += 1;
    if (life.tracks.length >= 4) tally.zigzag += 1;
    const byTrack = tally.outcomes.get(life.outcome.track) ?? new Map<string, number>();
    bump(byTrack, life.outcome.id);
    tally.outcomes.set(life.outcome.track, byTrack);
    for (const flag of life.flags) bump(tally.lifeFlags, flag);
    tally.summers += end.history.filter((entry) => entry.kind === "SUMMER").length;
    tally.milestones += end.history.filter((entry) => entry.kind === "LIFE_EVENT" && entry.milestone).length;
    tally.lifeEvents += end.history.filter((entry) => entry.kind === "LIFE_EVENT" && !entry.milestone).length;
  }
  reach(end);
  return { state: end, log, input: { talents, points } };
}

/** 抽样做的重检查：simulate 与逐步走的结果相同；存档读得回；轨迹与总结能生成；成就判定可复现。 */
function deepChecks(seed: number, scenario: Scenario, outcome: Outcome): void {
  const label = `${scenario.name} seed ${seed}`;
  const direct = simulate(start(seed, REAL), outcome.input, REAL);
  expect(direct.state, label).toEqual(outcome.state);
  expect(direct.log, label).toEqual(outcome.log);
  expect(outcome.log).toHaveLength(outcome.state.revision);
  const loaded = loadSave(serializeSave(outcome.state, outcome.log), REAL);
  if (!loaded.ok) throw new Error(`${label}：存档读不回（${loaded.detail}）`);
  expect(loaded.state, label).toEqual(JSON.parse(JSON.stringify(outcome.state)));
  const segments = timeline(outcome.state);
  expect(segments.length, label).toBeGreaterThanOrEqual(3);
  expect(segments[segments.length - 1].statsAfter, label).toEqual(outcome.state.stats);
  expect(summaryView(outcome.state).card, label).toEqual(outcome.state.ending?.card);
  expect(evaluateRun(outcome.state, emptyProgress()), label).toEqual(evaluateRun(outcome.state, emptyProgress()));
}

let cached: Tally[] | null = null;
function tallies(): Tally[] {
  if (cached) return cached;
  cached = SCENARIOS.map((scenario) => {
    const tally = emptyTally();
    for (let i = 0; i < RUNS; i++) {
      const seed = 1 + i;
      const outcome = runOne(seed, scenario, tally);
      if (i % 20 === 0) deepChecks(seed, scenario, outcome);
    }
    return tally;
  });
  return cached;
}

// ---------- 打印 ----------

const pct = (n: number, d: number, digits = 1): string => (d === 0 ? "—" : `${((100 * n) / d).toFixed(digits)}%`);
const row = (cells: Array<string | number>): string => `| ${cells.join(" | ")} |`;
function table(title: string, header: string[], rows: Array<Array<string | number>>): string {
  return [`\n### ${title}`, row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
}
const names = SCENARIOS.map((scenario) => `${scenario.name} ${Object.values(scenario.points).join("/")}`);

describe(`自动模拟：${SCENARIOS.length} 种分点各 ${RUNS} 局（真实学校目录）`, () => {
  it("每一局都合法地走到结局；中途结局的判定与独立重算一致；抽样的局可重放、可读档", () => {
    const all = tallies();
    for (const tally of all) {
      expect(tally.runs).toBe(RUNS);
      expect([...tally.route.values()].reduce((sum, n) => sum + n, 0)).toBe(RUNS);
      expect(tally.graduated + [...tally.early.values()].reduce((sum, n) => sum + n, 0)).toBe(RUNS);
      // 每局都有“落地”这条成就
      expect(tally.achievement.get("A_FIRST")).toBe(RUNS);
    }
  }, TIMEOUT);

  it("分点确实改变倾向（22 §10）：学业点高博士机会更多，职业点高工作机会更多，家境低打工更多、更常缺钱，身心点高校园生活更多", () => {
    const [even, study, career, rich, poor, social, tired] = tallies();
    // 机会按“走到本科毕业的局里拿到的比例”比，安排与短缺按每学期的平均次数比——这些都不受各方案中途结局多少的影响。
    // 最终去向的占比还取决于抽到的愿望与中途结局，只打印不断言。
    const offered = (tally: Tally, key: "PHD" | "LOCAL_JOB" | "HOME_JOB") => tally.ugOffered[key] / tally.ugGraduated;
    expect(offered(study, "PHD")).toBeGreaterThan(offered(career, "PHD"));
    expect(offered(career, "LOCAL_JOB")).toBeGreaterThan(offered(study, "LOCAL_JOB"));
    const perTerm = (tally: Tally, focus: Focus) => tally.focus[focus] / tally.terms;
    expect(perTerm(poor, "WORK")).toBeGreaterThan(perTerm(rich, "WORK"));
    expect(perTerm(study, "STUDY")).toBeGreaterThan(perTerm(career, "STUDY"));
    expect(perTerm(career, "CAREER")).toBeGreaterThan(perTerm(study, "CAREER"));
    expect(perTerm(social, "CAMPUS")).toBeGreaterThan(perTerm(even, "CAMPUS"));
    expect(perTerm(even, "CAMPUS")).toBeGreaterThan(perTerm(tired, "CAMPUS"));
    expect(poor.shortfallTerms / poor.terms).toBeGreaterThan(rich.shortfallTerms / rich.terms);
  }, TIMEOUT);

  it("统计（只打印，不做硬断言）", () => {
    const all = tallies();
    const out: string[] = [];
    const overrides =
      (Object.keys(OVERRIDES).length > 0 ? `；试用的中途结局参数 ${JSON.stringify(OVERRIDES)}` : "") +
      (Object.keys(AUTO_OVERRIDES).length > 0 ? `；试用的自动决定参数 ${JSON.stringify(AUTO_OVERRIDES)}` : "");
    out.push(`每种分点 ${RUNS} 局（seed 1…${RUNS}，各方案用同一批 seed），内容：中途结局 ${EARLY_ENDINGS.length} 条、去向结局 ${ENDING_FLAVORS.length} 条、成就 ${ACHIEVEMENTS.length} 条、天赋 ${TALENTS.length} 张${overrides}`);

    // 中途结局：按 id × 分点
    const earlyTotal = (tally: Tally) => [...tally.early.values()].reduce((sum, n) => sum + n, 0);
    out.push(table("中途结局出现频率（占全部局）", ["id", "‰", ...names], [
      ...EARLY_ENDINGS.map((ending) => [ending.id, ending.chancePermille, ...all.map((tally) => pct(tally.early.get(ending.id) ?? 0, tally.runs, 2))]),
      ["合计", "", ...all.map((tally) => pct(earlyTotal(tally), tally.runs, 1))],
    ]));
    out.push(table("用户点名的四条", ["id", ...names], USER_NAMED.map((id) => [id, ...all.map((tally) => pct(tally.early.get(id) ?? 0, tally.runs, 2))])));
    const even = all[0];
    const ranked = [...EARLY_ENDINGS].sort((a, b) => (even.early.get(b.id) ?? 0) - (even.early.get(a.id) ?? 0));
    out.push(table(`均衡分点：中途结局从高到低（合计 ${pct(earlyTotal(even), even.runs)}）`, ["id", "名称", "‰", "频率", "条件满足的学期末/局", "曾满足条件的局"], ranked.map((ending) => [
      ending.id, ending.name, ending.chancePermille, pct(even.early.get(ending.id) ?? 0, even.runs, 2),
      ((even.exposure.get(ending.id) ?? 0) / even.runs).toFixed(2), pct(even.exposedRuns.get(ending.id) ?? 0, even.runs),
    ])));
    out.push(table("条件满足的学期末数（每局平均）", ["id", ...names], EARLY_ENDINGS.map((ending) => [
      ending.id, ...all.map((tally) => ((tally.exposure.get(ending.id) ?? 0) / tally.runs).toFixed(2)),
    ])));
    out.push(table("曾满足条件的局（占全部局）", ["id", ...names], EARLY_ENDINGS.map((ending) => [
      ending.id, ...all.map((tally) => pct(tally.exposedRuns.get(ending.id) ?? 0, tally.runs)),
    ])));
    const slots = [...new Set(all.flatMap((tally) => [...tally.earlyAt.keys()]))].sort((a, b) => (a < b ? -1 : 1));
    out.push(table("中途结局发生在哪个学期末（占全部局）", ["学期", ...names], slots.map((slot) => [slot, ...all.map((tally) => pct(tally.earlyAt.get(slot) ?? 0, tally.runs))])));
    const neverEarly = EARLY_ENDINGS.filter((ending) => all.every((tally) => !tally.early.has(ending.id))).map((ending) => ending.id);
    out.push(`\n各种分点都没出现过的中途结局：${neverEarly.length > 0 ? neverEarly.join("、") : "无"}`);

    // 去向结局
    out.push(table("去向结局（占全部局）", ["id", "去向", "权重", ...names], ENDING_FLAVORS.map((flavor) => [
      flavor.id, flavor.route, flavor.weight, ...all.map((tally) => pct(tally.flavor.get(flavor.id) ?? 0, tally.runs, 2)),
    ])));
    out.push(table("去向结局（占同一去向的局）", ["id", "去向", "权重", ...names], ENDING_FLAVORS.map((flavor) => [
      flavor.id, flavor.route, flavor.weight, ...all.map((tally) => pct(tally.flavor.get(flavor.id) ?? 0, tally.route.get(flavor.route) ?? 0)),
    ])));
    const topFlavors = [...ENDING_FLAVORS].sort((a, b) => (even.flavor.get(b.id) ?? 0) - (even.flavor.get(a.id) ?? 0)).slice(0, 10);
    out.push(table("去向结局前十（按均衡分点的频率排；占全部局）", ["id", "名称", "去向", ...names], topFlavors.map((flavor) => [
      flavor.id, flavor.name, flavor.route, ...all.map((tally) => pct(tally.flavor.get(flavor.id) ?? 0, tally.runs, 2)),
    ])));
    const neverFlavor = ENDING_FLAVORS.filter((flavor) => all.every((tally) => !tally.flavor.has(flavor.id))).map((flavor) => flavor.id);
    const noFlavor = all.reduce((sum, tally) => sum + (tally.flavor.get("(无)") ?? 0), 0);
    out.push(`\n各种分点都没出现过的去向结局：${neverFlavor.length > 0 ? neverFlavor.join("、") : "无"}；毕业了却没有去向结局的局：${noFlavor}`);

    // 等级、去向、硕士、安排
    out.push(table("结局卡等级（占全部局，含中途结局的卡面等级）", ["等级", ...names], TIER_ORDER.map((tier) => [tier, ...all.map((tally) => pct(tally.tier.get(tier) ?? 0, tally.runs))])));
    out.push(table("结局卡等级（只看走到毕业的局）", ["等级", ...names], TIER_ORDER.map((tier) => [tier, ...all.map((tally) => pct(tally.gradTier.get(tier) ?? 0, tally.graduated))])));
    out.push(table("去向分布（占全部局）", ["去向", ...names], [
      ...ROUTES.map((route) => [route, ...all.map((tally) => pct(tally.route.get(route) ?? 0, tally.runs))]),
      ["中途结局", ...all.map((tally) => pct(tally.route.get("EARLY") ?? 0, tally.runs))],
      ["读了硕士", ...all.map((tally) => pct(tally.masters, tally.runs, 2))],
    ]));
    out.push(table("去向分布（只看走到毕业的局）", ["去向", ...names], ROUTES.map((route) => [route, ...all.map((tally) => pct(tally.route.get(route) ?? 0, tally.graduated))])));
    out.push(table("本科毕业那一刻（占走到本科毕业的局）", ["情形", ...names], [
      ["走到本科毕业（占全部局）", ...all.map((tally) => pct(tally.ugGraduated, tally.runs))],
      ["三路都没拿到", ...all.map((tally) => pct(tally.ugNoOffer, tally.ugGraduated, 2))],
      ["其中有硕士方案可选", ...all.map((tally) => pct(tally.ugNoOfferCanMasters, tally.ugGraduated, 2))],
      ["有硕士方案可选（学业 ≥55 且预算够）", ...all.map((tally) => pct(tally.ugCanMasters, tally.ugGraduated))],
      ["读了硕士", ...all.map((tally) => pct(tally.masters, tally.ugGraduated, 2))],
      ["博士机会到手", ...all.map((tally) => pct(tally.ugOffered.PHD, tally.ugGraduated))],
      ["留美工作到手", ...all.map((tally) => pct(tally.ugOffered.LOCAL_JOB, tally.ugGraduated))],
      ["回国工作到手", ...all.map((tally) => pct(tally.ugOffered.HOME_JOB, tally.ugGraduated))],
    ]));
    out.push(table("每局各类安排的平均次数", ["类别", ...names], [
      ...FOCUS_ORDER.map((focus) => [focus, ...all.map((tally) => (tally.focus[focus] / tally.runs).toFixed(2))]),
      ["学期数", ...all.map((tally) => (tally.terms / tally.runs).toFixed(2))],
      ["期末资金短缺的学期数", ...all.map((tally) => (tally.shortfallTerms / tally.runs).toFixed(2))],
    ]));
    const hiddenIds = [...new Set(all.flatMap((tally) => [...tally.hidden.keys()]))].sort();
    out.push(table("隐藏结局（占走到毕业的局）", ["id", ...names], hiddenIds.map((id) => [id, ...all.map((tally) => pct(tally.hidden.get(id) ?? 0, tally.graduated))])));

    // 成就
    out.push(table("从空进度开始，一局的收获", ["项目", ...names], [
      ["平均新成就数", ...all.map((tally) => (tally.newAchievements / tally.runs).toFixed(2))],
      ["解锁到天赋的局", ...all.map((tally) => pct(tally.unlocks, tally.runs))],
      ["预算不是 20 的局", ...all.map((tally) => pct(tally.budgetChanged, tally.runs))],
    ]));
    out.push(table("各成就在一局里达成的比例（空进度）", ["id", ...names], ACHIEVEMENTS.map((achievement) => [
      achievement.id, ...all.map((tally) => pct(tally.achievement.get(achievement.id) ?? 0, tally.runs)),
    ])));
    // 调平衡时盯着的几个数（只打印，不断言）
    const broke = (tally: Tally) => pct(tally.early.get("E_BROKE") ?? 0, tally.runs);
    out.unshift(
      `盯着的几个数：均衡分点中途结局合计 ${pct(earlyTotal(even), even.runs)}（单条最高 ${pct(Math.max(0, ...even.early.values()), even.runs, 2)}）；` +
      `读硕士（占全部局）${all.map((tally, i) => `${SCENARIOS[i].name} ${pct(tally.masters, tally.runs)}`).join("、")}；` +
      `“钱烧完了” ${all.map((tally, i) => `${SCENARIOS[i].name} ${broke(tally)}`).join("、")}`,
    );
    // ---- 第四版（docs/24 §13 的验收数）----
    const quantile = (values: number[], q: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    };
    out.push(table("第四版：在校的细节与毕业后的五年", ["项目", ...names], [
      ["中途结局合计", ...all.map((tally) => pct([...tally.early.values()].reduce((sum, n) => sum + n, 0), tally.runs))],
      ["学期 GPA 中位数", ...all.map((tally) => quantile(tally.gpas, 0.5).toFixed(2))],
      ["学期 GPA P10 / P90", ...all.map((tally) => `${quantile(tally.gpas, 0.1).toFixed(2)} / ${quantile(tally.gpas, 0.9).toFixed(2)}`)],
      ["有学期拿到 4.00 的局", ...all.map((tally) => pct(tally.gpa4Runs, tally.runs))],
      ["有学期低于 2.00 的局", ...all.map((tally) => pct(tally.gpaLowRuns, tally.runs))],
      ["五年里换过轨道的局", ...all.map((tally) => pct(tally.switched, tally.runs))],
      ["换过三次轨道的局", ...all.map((tally) => pct(tally.zigzag, tally.runs, 2))],
      ["每局突发小事 P50 / P90", ...all.map((tally) => `${quantile(tally.happenings, 0.5)} / ${quantile(tally.happenings, 0.9)}`)],
      [`突发小事 ≥ ${BUSY_LIFE_HAPPENINGS_MIN} 的局`, ...all.map((tally) => pct(tally.happenings.filter((n) => n >= BUSY_LIFE_HAPPENINGS_MIN).length, tally.runs))],
      ["每局暑假事件", ...all.map((tally) => (tally.summers / tally.runs).toFixed(2))],
      ["每局里程碑 / 生活小事", ...all.map((tally) => `${(tally.milestones / tally.runs).toFixed(2)} / ${(tally.lifeEvents / tally.runs).toFixed(2)}`)],
      ["读了硕士（占全部局）", ...all.map((tally) => pct(tally.masters, tally.runs))],
    ]));
    for (const track of LIFE_TRACK_ORDER) {
      const pooled = new Map<string, number>();
      for (const tally of all) for (const [id, n] of tally.outcomes.get(track) ?? []) bump(pooled, id, n);
      const total = [...pooled.values()].reduce((sum, n) => sum + n, 0);
      const fallback = LIFE_TRACKS[track].outcomes.find((item) => item.fallback)?.id;
      out.push(table(`五年后的结局：最后在“${LIFE_TRACKS[track].name}”（全部分点合计 ${total} 局）`, ["id", "名称", "稀有度", "占这条轨道", ...names], LIFE_TRACKS[track].outcomes.map((item) => [
        item.id + (item.id === fallback ? "（兜底）" : ""), item.name, item.grade, pct(pooled.get(item.id) ?? 0, total),
        ...all.map((tally) => pct(tally.outcomes.get(track)?.get(item.id) ?? 0, [...(tally.outcomes.get(track)?.values() ?? [])].reduce((sum, n) => sum + n, 0))),
      ])));
    }
    const flagIds = [...new Set(all.flatMap((tally) => [...tally.lifeFlags.keys()]))].sort();
    out.push(table("人生标记（有这个标记的局）", ["标记", ...names], flagIds.map((flag) => [flag, ...all.map((tally) => pct(tally.lifeFlags.get(flag) ?? 0, tally.runs))])));
    const unreached = (Object.keys(ALL_CONTENT) as Array<keyof typeof ALL_CONTENT>).map((key) => {
      const missing = ALL_CONTENT[key].filter((id) => !REACHED[key].has(id));
      return [key, `${ALL_CONTENT[key].length - missing.length} / ${ALL_CONTENT[key].length}`, missing.length > 0 ? missing.join("、") : "无"];
    });
    out.push(table("可达性（这些局里出现过的 / 内容条数；没出现过的列在最后，带天赋条件的要用固定天赋另跑）", ["类别", "出现过", "没出现过的"], unreached));
    console.log(out.join("\n"));
    expect(out.length).toBeGreaterThan(10);
  }, TIMEOUT);
});

describe("第四版内容的可达性（docs/24 §13）", () => {
  it.skipIf(process.env.SIM_REACH !== "1")("每一条暑假、日常、里程碑、生活小事、五年后结局、中途结局、去向结局都能在模拟里出现；每条轨道的结局分布不过分集中", () => {
    const all = tallies();
    // 带天赋条件的条目：用固定天赋另跑（锁定的先解锁，再继承它，让它排在十连抽的第一张）
    const referenced = new Set<string>();
    const collect = (when: EndingCondition | undefined) => {
      for (const id of when?.talentsAny ?? []) referenced.add(id);
    };
    for (const item of [...SUMMERS, ...DAILY_LINES, ...HAPPENINGS, ...EARLY_ENDINGS, ...ENDING_FLAVORS]) collect(item.when);
    for (const track of LIFE_TRACK_ORDER) for (const item of [...LIFE_TRACKS[track].milestones, ...LIFE_TRACKS[track].events, ...LIFE_TRACKS[track].outcomes]) collect(item.when);
    for (const item of [...LIFE_COMMON.milestones, ...LIFE_COMMON.events]) collect(item.when);
    for (const talent of referenced) {
      const locked = TALENTS.find((item) => item.id === talent)?.locked ? [talent] : [];
      for (let i = 0; i < Math.max(200, Math.floor(RUNS / 3)); i++) runOne(9_000_000 + i, SCENARIOS[i % SCENARIOS.length], null, { unlockedTalents: locked, inheritedTalent: talent });
    }
    const missing = (Object.keys(ALL_CONTENT) as Array<keyof typeof ALL_CONTENT>).flatMap((key) => ALL_CONTENT[key].filter((id) => !REACHED[key].has(id)).map((id) => `${key}:${id}`));
    expect(missing, "模拟里从没出现过的内容").toEqual([]);
    // 每条轨道里单个结局不超过这条轨道局数的 30%（兜底不超过 35%）
    for (const track of LIFE_TRACK_ORDER) {
      const pooled = new Map<string, number>();
      for (const tally of all) for (const [id, n] of tally.outcomes.get(track) ?? []) bump(pooled, id, n);
      const total = [...pooled.values()].reduce((sum, n) => sum + n, 0);
      if (total < 200) continue; // 这条轨道的局太少，比例没有意义
      for (const item of LIFE_TRACKS[track].outcomes) {
        expect((pooled.get(item.id) ?? 0) / total, `${track} ${item.id}`).toBeLessThanOrEqual(item.fallback ? 0.35 : 0.3);
      }
    }
  }, TIMEOUT);
});

describe(`连续玩 30 局（${PLAYERS} 个玩家，${SCENARIOS.length} 种分点轮着用）`, () => {
  it("跨局进度一局一局累积：成就不重复计、解锁的天赋进入之后的十连抽；打印典型的成就数与解锁数", () => {
    const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const checkpoints = [1, 3, 5, 10, 20, 30];
    const achievementsAt = new Map<number, number[]>(checkpoints.map((n) => [n, []]));
    const unlockedAt = new Map<number, number[]>(checkpoints.map((n) => [n, []]));
    const earlyKinds: number[] = [];
    const flavorKinds: number[] = [];
    const tierKinds: number[] = [];
    const owned = new Map<string, number>();
    const lockedTotal = TALENTS.filter((talent) => talent.locked).length;
    let sawUnlockedInDraw = 0;

    for (let player = 0; player < PLAYERS; player++) {
      const progress = emptyProgress();
      for (let n = 1; n <= 30; n++) {
        const seed = 5_000_000 + player * 100 + n;
        const scenario = SCENARIOS[(player + n) % SCENARIOS.length];
        const { state } = runOne(seed, scenario, null, { unlockedTalents: progress.unlockedTalents });
        const ending = state.ending;
        if (!ending) throw new Error("没有结局");
        if (state.profile.talents.some((id) => progress.unlockedTalents.includes(id))) sawUnlockedInDraw += 1;
        const rewards = evaluateRun(state, progress);
        // 新成就都是之前没有的；解锁的天赋是之前没解锁的锁定天赋
        for (const id of rewards.achievements) expect(progress.achievements).not.toContain(id);
        if (rewards.unlockedTalent) {
          expect(progress.unlockedTalents).not.toContain(rewards.unlockedTalent);
          expect(TALENTS.find((talent) => talent.id === rewards.unlockedTalent)?.locked).toBe(true);
          progress.unlockedTalents.push(rewards.unlockedTalent);
        }
        progress.achievements.push(...rewards.achievements);
        progress.runs += 1;
        progress.tiers[ending.card.tier] = (progress.tiers[ending.card.tier] ?? 0) + 1;
        for (const hidden of ending.card.hidden) progress.hidden[hidden.id] = (progress.hidden[hidden.id] ?? 0) + 1;
        if (ending.early) progress.early[ending.early] = (progress.early[ending.early] ?? 0) + 1;
        if (ending.card.flavor) progress.flavors[ending.card.flavor.id] = (progress.flavors[ending.card.flavor.id] ?? 0) + 1;
        const outcomeId = state.life?.outcome?.id;
        if (outcomeId) progress.outcomes = { ...progress.outcomes, [outcomeId]: (progress.outcomes?.[outcomeId] ?? 0) + 1 };
        if (checkpoints.includes(n)) {
          achievementsAt.get(n)?.push(progress.achievements.length);
          unlockedAt.get(n)?.push(progress.unlockedTalents.length);
        }
      }
      expect(new Set(progress.achievements).size).toBe(progress.achievements.length);
      expect(new Set(progress.unlockedTalents).size).toBe(progress.unlockedTalents.length);
      earlyKinds.push(Object.keys(progress.early).length);
      flavorKinds.push(Object.keys(progress.flavors).length);
      tierKinds.push(Object.keys(progress.tiers).length);
      for (const id of progress.achievements) bump(owned, id);
    }

    const spread = (values: number[]): string => {
      const sorted = [...values].sort((a, b) => a - b);
      const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
      return `${quantile(sorted, 0.1)} / ${quantile(sorted, 0.5)} / ${quantile(sorted, 0.9)}（均值 ${mean.toFixed(1)}）`;
    };
    const out: string[] = [];
    out.push(table(`连续玩 N 局之后（${PLAYERS} 个玩家；P10 / 中位数 / P90）`, ["局数", `成就数（共 ${ACHIEVEMENTS.length}）`, `已解锁的天赋（共 ${lockedTotal}）`], checkpoints.map((n) => [
      n, spread(achievementsAt.get(n) ?? []), spread(unlockedAt.get(n) ?? []),
    ])));
    out.push(`\n30 局之后：见过的中途结局种类 ${spread(earlyKinds)}；去向结局种类 ${spread(flavorKinds)}；主线等级种类 ${spread(tierKinds)}`);
    out.push(`30 局里选中过已解锁天赋的局：平均每个玩家 ${(sawUnlockedInDraw / PLAYERS).toFixed(1)} 局`);
    out.push(table("30 局之后各成就的持有率", ["id", "名称", "档次", "持有率"], ACHIEVEMENTS.map((achievement) => [
      achievement.id, achievement.name, achievement.grade, pct(owned.get(achievement.id) ?? 0, PLAYERS, 0),
    ])));
    console.log(out.join("\n"));
    expect(achievementsAt.get(30)).toHaveLength(PLAYERS);
  }, TIMEOUT);
});

/** 给界面与存档的回归：任何一局走到结局后，状态都是可以原样 JSON 往返的普通数据。 */
describe("自动模拟出来的状态是普通数据", () => {
  it("JSON 往返不丢东西", () => {
    for (const scenario of SCENARIOS) {
      const { state } = runOne(77, scenario, null);
      const copy: RunState = JSON.parse(JSON.stringify(state));
      expect(copy).toEqual(state);
    }
  });
});
