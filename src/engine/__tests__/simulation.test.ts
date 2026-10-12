// 整局随机模拟（正式玩法 standard）：seed 驱动的自动选择策略把几千局从开局走到结局，检查全程合法，
// 并统计：主线槽与安排序列的重复率、突发小事条数、结局卡各等级与隐藏结局的频率、各经济档占比。
// 第二个用例给出调平衡用的参考表：单张天赋对结局的影响、各安排与突发小事的数值概览。
// 策略只是几种简单的启发式，不代表真实玩家分布。

import { describe, expect, it } from "vitest";
import { ALL_EVENTS, EVENT_BY_ID, HAPPENINGS, PLANS, TALENTS } from "../../content";
import { endingView, focusView, loadSave, serializeSave, setupView } from "../index";
import type {
  Action, ActiveRun, ChoiceId, Economy, EndingTierId, EventView, Focus, FocusView, MastersOption, RouteOption,
  RunState, SetupView,
} from "../index";
import { totalFocus } from "../rules";
import { initialStatsFor, totalsFor } from "../talents";
import { act, asActive, clone, ctx, nextAction, start, testRandom } from "./helpers";
import type { Policy } from "./helpers";

const STYLES = ["RANDOM", "RESEARCH", "CAREER", "BALANCED", "SOCIAL", "WORKER", "SLACKER"] as const;
type Style = (typeof STYLES)[number];
const TIER_ORDER: EndingTierId[] = ["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"];
const HIDDEN_IDS = ["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12"];
const ALLOWED_PHASES = ["SETUP", "HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "GRAD_PREVIEW", "GRAD_RESULTS", "ENDING"];

/** 各策略偏好的类别顺序：本学期名单里缺了第一个就退到下一个。 */
const PREFERENCE: Record<Exclude<Style, "RANDOM" | "BALANCED">, Focus[]> = {
  RESEARCH: ["STUDY", "CAMPUS", "CAREER", "REST", "WORK"],
  CAREER: ["CAREER", "STUDY", "CAMPUS", "WORK", "REST"],
  SOCIAL: ["CAMPUS", "REST", "CAREER", "STUDY", "WORK"],
  WORKER: ["WORK", "STUDY", "CAREER", "CAMPUS", "REST"],
  SLACKER: ["REST", "CAMPUS", "WORK", "CAREER", "STUDY"],
};
const BALANCED_ROTATION: Focus[] = ["STUDY", "WORK", "CAREER", "CAMPUS", "STUDY", "REST", "CAREER", "STUDY"];

function pickPlan(style: Style, seed: number, view: FocusView, state: ActiveRun): string {
  const open = view.options.filter((option) => option.available);
  const step = totalFocus(state.focusCounts);
  const byFocus = (focus: Focus) => open.find((option) => option.focus === focus);
  if (style === "RANDOM") return open[Math.floor(testRandom(seed, `plan:${step}`) * open.length)].plan.id;
  if (style !== "SLACKER") {
    if (state.stats.money < view.upkeep && byFocus("WORK")) return (byFocus("WORK") ?? open[0]).plan.id;
    if (state.stats.wellbeing < 25 && byFocus("REST")) return (byFocus("REST") ?? open[0]).plan.id;
  }
  const order = style === "BALANCED" ? [BALANCED_ROTATION[step % 8], "STUDY", "CAREER", "CAMPUS", "WORK", "REST"] as Focus[] : PREFERENCE[style];
  for (const focus of order) {
    const option = byFocus(focus);
    if (option) return option.plan.id;
  }
  return open[0].plan.id;
}

function pickChoice(style: Style, seed: number, view: EventView, state: ActiveRun): ChoiceId {
  if (style === "RANDOM" || testRandom(seed, `noise:${view.event.id}`) < 0.25) {
    return testRandom(seed, `choice:${view.event.id}`) < 0.5 ? "A" : "B";
  }
  if (style === "SLACKER") {
    // 尽量不积累学业与职业
    const gain = (choice: EventView["choices"][number]) => choice.choice.effects.academics + choice.choice.effects.career;
    return gain(view.choices[0]) <= gain(view.choices[1]) ? "A" : "B";
  }
  const weight = {
    money: state.stats.money < 20 ? 1.8 : 0.3,
    academics: style === "RESEARCH" ? 1.4 : 0.6,
    career: style === "CAREER" || style === "WORKER" ? 1.4 : 0.6,
    wellbeing: state.stats.wellbeing < 30 || style === "SOCIAL" ? 1.8 : 0.4,
  };
  const score = (choice: EventView["choices"][number]) =>
    weight.money * choice.delta.applied.money + weight.academics * choice.delta.applied.academics +
    weight.career * choice.delta.applied.career + weight.wellbeing * choice.delta.applied.wellbeing;
  return score(view.choices[0]) >= score(view.choices[1]) ? "A" : "B";
}

function pickGraduation(seed: number, state: ActiveRun, routes: RouteOption[], masters: MastersOption[]): Action {
  const mode = testRandom(seed, "grad-mode");
  const open = routes.filter((option) => option.available && option.route !== "TRANSITION");
  const programs = masters.filter((option) => option.eligible);
  const enter = (): Action => ({ type: "ENTER_MASTERS", program: programs[Math.floor(testRandom(seed, "program") * programs.length)].program });
  if (mode < 0.5) {
    // 有机会就接受最靠前的；没有机会且能读硕士就读
    if (open.length > 0) return { type: "CHOOSE_ROUTE", route: open[0].route };
    if (programs.length > 0) return enter();
    return { type: "CHOOSE_ROUTE", route: "TRANSITION" };
  }
  if (mode < 0.75) {
    if (programs.length > 0) return enter();
    if (open.length > 0) return { type: "CHOOSE_ROUTE", route: open[open.length - 1].route };
    return { type: "CHOOSE_ROUTE", route: "TRANSITION" };
  }
  // 在所有可行的选择里随机挑一个（包括主动过渡）
  const actions: Action[] = [
    ...open.map((option): Action => ({ type: "CHOOSE_ROUTE", route: option.route })),
    { type: "CHOOSE_ROUTE", route: "TRANSITION" },
    ...programs.map((option): Action => ({ type: "ENTER_MASTERS", program: option.program })),
  ];
  return actions[Math.floor(testRandom(seed, `grad-pick:${state.stage}`) * actions.length)];
}

/** 从十张里随机挑三张（由 seed 决定）。 */
function pickTalents(seed: number, view: SetupView): string[] {
  const ids = view.draw.map((talent) => talent.id);
  const picked: string[] = [];
  for (let i = 0; i < view.pickCount; i++) picked.push(ids.splice(Math.floor(testRandom(seed, `talent:${i}`) * ids.length), 1)[0]);
  return picked;
}

function policyFor(seed: number, style: Style = STYLES[seed % STYLES.length]): Policy {
  return {
    talents: (view) => pickTalents(seed, view),
    plan: (view, state) => pickPlan(style, seed, view, state),
    event: (view, state) => pickChoice(style, seed, view, state),
    graduate: (state, routes, masters) => pickGraduation(seed, state, routes, masters),
    school: (state) => (state.offers ?? [])[Math.floor(testRandom(seed, "school") * 3)].unitid,
  };
}

function assertLegal(state: RunState, label: string): void {
  if (!ALLOWED_PHASES.includes(state.phase)) throw new Error(`${label}：未知阶段 ${state.phase}`);
  if (state.phase === "SETUP") return;
  for (const key of ["money", "academics", "career", "wellbeing"] as const) {
    const value = state.stats[key];
    if (!Number.isInteger(value) || value < 0 || value > 100 || Object.is(value, -0)) {
      throw new Error(`${label}：${key} = ${value} 不是 0–100 的整数`);
    }
  }
  if (state.phase === "FOCUS") {
    const view = focusView(state);
    const open = view?.options.filter((option) => option.available).length ?? 0;
    if (view?.options.length !== 4 || open < 2) throw new Error(`${label}：安排 ${view?.options.length} 张、可选 ${open} 张`);
  }
}

/** 相同序列成对出现的比例：Σ C(n,2) / C(N,2)。 */
function identicalPairShare(sequences: string[]): number {
  const groups = new Map<string, number>();
  for (const sequence of sequences) groups.set(sequence, (groups.get(sequence) ?? 0) + 1);
  let same = 0;
  for (const n of groups.values()) same += (n * (n - 1)) / 2;
  return same / ((sequences.length * (sequences.length - 1)) / 2);
}

const RUNS = 4200;
const pct = (count: number, total: number, digits = 1) => `${((100 * count) / Math.max(1, total)).toFixed(digits)}%`;

describe(`整局随机模拟（standard，${RUNS} 局）`, () => {
  it("全程合法、路径与结局全覆盖，并输出重复率、突发小事与结局卡频率", () => {
    const tiers = new Map<string, Map<Style | "ALL" | Economy, number>>();
    const hidden = new Map<string, number>();
    const statuses = new Map<string, number>();
    const routes = new Map<string, number>();
    const paths = new Map<string, number>();
    const perStyle = new Map<Style, number>();
    const economies: Record<Economy, number> = { LOW: 0, MID: 0, HIGH: 0 };
    const flagsSeen = new Set<string>();
    const arcSlots = new Set<string>();
    const plansSeen = new Set<string>();
    const talentsSeen = new Set<string>();
    const happeningsSeen = new Set<string>();
    const decisions = new Map<string, Set<number>>();
    const mainSequences: string[] = [];
    const slateSequences: string[] = [];
    let happeningsUndergrad = 0;
    let happeningsTotal = 0;
    let termsTotal = 0;
    const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

    for (let seed = 1; seed <= RUNS; seed++) {
      const style = STYLES[seed % STYLES.length];
      const policy = policyFor(seed);
      let state: RunState = start(seed);
      const log: Action[] = [];
      const slates: string[] = [];
      for (let guard = 0; guard < 200; guard++) {
        if (state.phase === "FOCUS" && state.stage === "UG") {
          slates.push(focusView(state)?.options.map((option) => option.plan.id).join(",") ?? "");
        }
        const action = nextAction(state, policy); // 事件或安排没有可选项时这里会抛错
        if (!action) break;
        const next = act(state, action);
        expect(next.revision).toBe(state.revision + 1);
        state = next;
        log.push(action);
        assertLegal(state, `seed ${seed} 第 ${log.length} 步`);
      }
      const run = asActive(state);
      expect(run.phase, `seed ${seed}`).toBe("ENDING");
      const ending = run.ending;
      if (!ending) throw new Error(`seed ${seed} 没有结局记录`);

      // 生活决策数：本科 24、一年硕士 28、两年硕士 32；安排 8/10/12 次
      const path = run.mastersYears === null ? "UG" : run.mastersYears === 1 ? "MS_1Y" : "MS_2Y";
      const life = log.filter((action) => action.type === "CHOOSE_PLAN" || action.type === "CHOOSE_EVENT").length;
      (decisions.get(path) ?? decisions.set(path, new Set()).get(path))?.add(life);
      expect(totalFocus(run.focusCounts)).toBe(path === "UG" ? 8 : path === "MS_1Y" ? 10 : 12);
      expect(run.flags).toHaveLength(path === "UG" ? 16 : path === "MS_1Y" ? 18 : 20);
      expect(new Set(run.flags).size).toBe(run.flags.length);
      for (const event of ALL_EVENTS) expect(run.flags.includes(`${event.id}_A`) && run.flags.includes(`${event.id}_B`)).toBe(false);
      expect(run.flags.filter((flag) => flag.startsWith("ARC_"))).toHaveLength(6);
      expect(run.arcs.A).not.toBe(run.arcs.B);
      expect(run.profile.talents).toHaveLength(3);
      if (path !== "UG") {
        expect(run.flags.includes("MASTER_04_A") !== run.flags.includes("MASTER_04_B")).toBe(true);
        expect(run.graduations.UG?.resolution).toBe("MASTERS");
        expect(run.history.filter((entry) => entry.kind === "MASTERS_FEE")).toHaveLength(1);
        // 进入硕士的前提：本科两种工作都没有取得、学业达到 55
        expect(run.graduations.UG?.outcomes?.LOCAL_JOB).not.toBe("OFFERED");
        expect(run.graduations.UG?.outcomes?.HOME_JOB).not.toBe("OFFERED");
        expect(run.graduations.UG?.frozenStats.academics).toBeGreaterThanOrEqual(55);
      }
      // 最终去向必须是当前检查点 OFFERED 的机会，或过渡期
      const checkpoint = run.graduations[ending.degree];
      if (ending.route !== "TRANSITION") expect(checkpoint?.outcomes?.[ending.route]).toBe("OFFERED");
      else {
        const any = Object.values(checkpoint?.outcomes ?? {}).includes("OFFERED");
        expect(ending.transitionMode).toBe(any ? "SELF_CHOSEN" : "NO_OFFER");
      }
      const view = endingView(run);
      expect(view?.full.review).toHaveLength(path === "UG" ? 7 : 8);
      expect(view?.card).toEqual(ending.card);
      if (seed % 10 === 0) {
        const loaded = loadSave(serializeSave(run, log), ctx);
        expect(loaded.ok, `seed ${seed} 读档`).toBe(true);
        expect(JSON.parse(JSON.stringify(run))).toEqual(run);
      }

      // 一局内随机事件与突发小事都不重复
      const mainEvents = run.history.filter((entry) => entry.kind === "EVENT" && entry.stage === "UG" && EVENT_BY_ID[entry.eventId ?? ""]?.kind !== "arc").map((entry) => entry.eventId ?? "");
      expect(mainEvents).toHaveLength(8);
      expect(new Set(mainEvents).size).toBe(8);
      const happenings = run.history.filter((entry) => entry.kind === "HAPPENING");
      expect(new Set(happenings.map((entry) => entry.happeningId)).size).toBe(happenings.length);
      for (const entry of happenings) happeningsSeen.add(entry.happeningId ?? "");
      happeningsUndergrad += happenings.filter((entry) => entry.stage === "UG").length;
      happeningsTotal += happenings.length;
      termsTotal += run.history.filter((entry) => entry.kind === "STIPEND").length;
      mainSequences.push(mainEvents.join(">"));
      expect(slates).toHaveLength(8);
      slateSequences.push(slates.join("|"));

      for (const flag of run.flags) flagsSeen.add(flag);
      for (const entry of run.history) if (entry.planId) plansSeen.add(entry.planId);
      for (const id of run.profile.talents) talentsSeen.add(id);
      arcSlots.add(`A:${run.arcs.A}`);
      arcSlots.add(`B:${run.arcs.B}`);
      economies[run.profile.economy] += 1;
      bump(routes, ending.route === "PHD" ? `PHD/${ending.entryMode}` : ending.route === "TRANSITION" ? `TRANSITION/${ending.transitionMode}` : ending.route);
      bump(paths, path);
      bump(statuses, ending.card.status);
      perStyle.set(style, (perStyle.get(style) ?? 0) + 1);
      const row = tiers.get(ending.card.tier) ?? new Map<Style | "ALL" | Economy, number>();
      bump(row, style);
      bump(row, "ALL");
      bump(row, run.profile.economy);
      tiers.set(ending.card.tier, row);
      for (const entry of ending.card.hidden) bump(hidden, entry.id);
    }

    // ---------- 覆盖 ----------
    expect([...(decisions.get("UG") ?? [])]).toEqual([24]);
    expect([...(decisions.get("MS_1Y") ?? [])]).toEqual([28]);
    expect([...(decisions.get("MS_2Y") ?? [])]).toEqual([32]);
    for (const key of ["PHD/undergrad_direct", "PHD/masters_entry", "LOCAL_JOB", "HOME_JOB", "TRANSITION/SELF_CHOSEN", "TRANSITION/NO_OFFER"]) {
      expect(routes.get(key) ?? 0, `去向 ${key}`).toBeGreaterThan(0);
    }
    for (const key of ["UG", "MS_1Y", "MS_2Y"]) expect(paths.get(key) ?? 0, `教育路径 ${key}`).toBeGreaterThan(0);
    // 内容全覆盖：每个事件的每个选项、每张安排、每张天赋、每条突发小事都真实出现过
    expect(flagsSeen.size).toBe(ALL_EVENTS.length * 2);
    expect(plansSeen.size).toBe(PLANS.length);
    expect(talentsSeen.size).toBe(TALENTS.length);
    expect(happeningsSeen.size).toBe(HAPPENINGS.length);
    expect(arcSlots.size).toBe(12); // 六条支线在两个槽里都出现过

    // ---------- 每局不一样 ----------
    const sameMain = identicalPairShare(mainSequences);
    const sameSlates = identicalPairShare(slateSequences);
    expect(sameMain).toBeLessThan(0.01);
    expect(sameSlates).toBeLessThan(0.001);
    expect(new Set(mainSequences).size).toBeGreaterThan(RUNS * 0.95);
    // 经济档大致是 30% / 45% / 25%
    expect(Math.abs(economies.LOW / RUNS - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(economies.MID / RUNS - 0.45)).toBeLessThan(0.03);

    // ---------- 报告 ----------
    const lines = [`正式玩法整局模拟（${RUNS} 局，每种策略 ${RUNS / STYLES.length} 局；策略为启发式，不代表真实玩家）`];
    lines.push(`任取两局：主线槽事件序列完全相同的比例 ${(sameMain * 100).toFixed(4)}%（不同序列 ${new Set(mainSequences).size} 种）；` +
      `安排序列完全相同的比例 ${(sameSlates * 100).toFixed(4)}%（不同序列 ${new Set(slateSequences).size} 种）`);
    lines.push(`突发小事：本科阶段每局平均 ${(happeningsUndergrad / RUNS).toFixed(2)} 条；全程每学期出现的比例 ${pct(happeningsTotal, termsTotal)}`);
    lines.push(`经济档占比：LOW ${pct(economies.LOW, RUNS)}  MID ${pct(economies.MID, RUNS)}  HIGH ${pct(economies.HIGH, RUNS)}`);
    lines.push(`${"等级".padEnd(8)}${"全部".padStart(7)} ${STYLES.map((style) => style.padStart(9)).join("")}   |${(["LOW", "MID", "HIGH"] as const).map((economy) => economy.padStart(7)).join("")}`);
    for (const tier of TIER_ORDER) {
      const row = tiers.get(tier);
      lines.push(
        `${tier.padEnd(9)}${pct(row?.get("ALL") ?? 0, RUNS).padStart(7)} ${STYLES.map((style) => pct(row?.get(style) ?? 0, perStyle.get(style) ?? 1).padStart(9)).join("")}   |` +
          (["LOW", "MID", "HIGH"] as const).map((economy) => pct(row?.get(economy) ?? 0, economies[economy]).padStart(7)).join(""),
      );
    }
    lines.push(`隐藏结局：${HIDDEN_IDS.map((id) => `${id} ${pct(hidden.get(id) ?? 0, RUNS)}`).join("  ")}`);
    lines.push(`完结状态：${["HE", "TBC", "OPEN", "TE"].map((id) => `${id} ${pct(statuses.get(id) ?? 0, RUNS)}`).join("  ")}`);
    lines.push(`去向：${[...routes.entries()].sort().map(([key, count]) => `${key} ${pct(count, RUNS)}`).join("  ")}`);
    lines.push(`教育路径：${[...paths.entries()].sort().map(([key, count]) => `${key} ${pct(count, RUNS)}`).join("  ")}`);
    console.log(lines.join("\n"));

    // 十档等级在整局模拟里都真实出现过；传奇档不应成为常见结果
    for (const tier of TIER_ORDER) expect(tiers.get(tier)?.get("ALL") ?? 0, `等级 ${tier}`).toBeGreaterThan(0);
    const share = (tier: EndingTierId) => (tiers.get(tier)?.get("ALL") ?? 0) / RUNS;
    expect(share("EX")).toBeLessThan(0.1);
    expect(share("UR")).toBeLessThan(0.1);
    expect(share("SSR")).toBeLessThan(0.1);
  });
});

// ---------- 调平衡用的参考表 ----------

interface Metrics {
  runs: number;
  academics: number;
  career: number;
  money: number;
  wellbeing: number;
  phd: number;
  local: number;
  home: number;
  anyOffer: number;
  shortfalls: number;
  tiers: Record<string, number>;
}

/**
 * 给定一组天赋（不经过十连抽，直接改档案——只用于对比分析，不代表合法存档），
 * 在同一批 seed 与同一套策略下走到本科毕业并接受最靠前的机会。
 */
function measure(talents: string[], seeds: number[]): Metrics {
  const m: Metrics = { runs: 0, academics: 0, career: 0, money: 0, wellbeing: 0, phd: 0, local: 0, home: 0, anyOffer: 0, shortfalls: 0, tiers: {} };
  for (const seed of seeds) {
    const style = (["RESEARCH", "CAREER", "BALANCED", "SOCIAL", "WORKER", "RANDOM"] as const)[seed % 6];
    const policy: Policy = { ...policyFor(seed, style), graduate: undefined };
    let state: RunState = act(start(seed), { type: "CONFIRM_SETUP", talents: setupView(start(seed)).draw.slice(0, 3).map((talent) => talent.id) });
    const forced = clone(asActive(state));
    const totals = totalsFor(talents);
    forced.profile.talents = [...talents];
    forced.stats = initialStatsFor(forced.profile.economy, totals);
    forced.admission.talentBonus = totals.readiness;
    state = forced;
    for (let guard = 0; guard < 200; guard++) {
      const action = nextAction(state, policy);
      if (!action) break;
      state = act(state, action);
    }
    const run = asActive(state);
    const grad = run.graduations.UG;
    if (!grad?.outcomes || !run.ending) throw new Error("模拟没有走到结局");
    m.runs++;
    m.academics += grad.frozenStats.academics;
    m.career += grad.frozenStats.career;
    m.money += grad.frozenStats.money;
    m.wellbeing += grad.frozenStats.wellbeing;
    m.phd += grad.outcomes.PHD === "OFFERED" ? 1 : 0;
    m.local += grad.outcomes.LOCAL_JOB === "OFFERED" ? 1 : 0;
    m.home += grad.outcomes.HOME_JOB === "OFFERED" ? 1 : 0;
    m.anyOffer += Object.values(grad.outcomes).includes("OFFERED") ? 1 : 0;
    m.shortfalls += run.history.filter((entry) => entry.kind === "UPKEEP" && (entry.upkeep?.shortfall ?? 0) > 0).length;
    m.tiers[run.ending.card.tier] = (m.tiers[run.ending.card.tier] ?? 0) + 1;
  }
  return m;
}

describe("调平衡用的参考表（只输出，不作为验收门槛）", () => {
  it("单张天赋相对“没有天赋”的影响；安排与突发小事的数值概览", () => {
    const seeds = Array.from({ length: 360 }, (_, index) => index + 1);
    const base = measure([], seeds);
    const avg = (m: Metrics, key: "academics" | "career" | "money" | "wellbeing" | "shortfalls") => m[key] / m.runs;
    const rate = (m: Metrics, key: "phd" | "local" | "home" | "anyOffer") => (100 * m[key]) / m.runs;
    const top = (m: Metrics) => (100 * ((m.tiers.EX ?? 0) + (m.tiers.UR ?? 0) + (m.tiers.SSR ?? 0))) / m.runs;
    const low = (m: Metrics) => (100 * ((m.tiers.N ?? 0) + (m.tiers.D ?? 0) + (m.tiers.BE ?? 0))) / m.runs;
    const signed = (value: number, digits = 1) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
    const lines = [
      `单张天赋的影响（${seeds.length} 个 seed × 六种策略轮换，走到本科毕业并接受最靠前的机会；数值为相对“没有天赋”的差）`,
      `基线：学业 ${avg(base, "academics").toFixed(1)} 职业 ${avg(base, "career").toFixed(1)} 资金 ${avg(base, "money").toFixed(1)} 身心 ${avg(base, "wellbeing").toFixed(1)}｜` +
        `博士 ${rate(base, "phd").toFixed(1)}% 留美 ${rate(base, "local").toFixed(1)}% 回国 ${rate(base, "home").toFixed(1)}% 至少一个机会 ${rate(base, "anyOffer").toFixed(1)}%｜` +
        `EX+UR+SSR ${top(base).toFixed(1)}% N+D+BE ${low(base).toFixed(1)}% 每局短缺学期 ${avg(base, "shortfalls").toFixed(2)}`,
      `${"天赋".padEnd(18)}${"稀有".padEnd(5)}${["学业", "职业", "资金", "身心", "博士%", "留美%", "回国%", "有机会%", "顶档%", "低档%", "短缺"].map((h) => h.padStart(7)).join("")}`,
    ];
    const rows: Array<{ id: string; text: string; impact: number }> = [];
    for (const talent of TALENTS) {
      const m = measure([talent.id], seeds);
      const cells = [
        signed(avg(m, "academics") - avg(base, "academics")), signed(avg(m, "career") - avg(base, "career")),
        signed(avg(m, "money") - avg(base, "money")), signed(avg(m, "wellbeing") - avg(base, "wellbeing")),
        signed(rate(m, "phd") - rate(base, "phd")), signed(rate(m, "local") - rate(base, "local")),
        signed(rate(m, "home") - rate(base, "home")), signed(rate(m, "anyOffer") - rate(base, "anyOffer")),
        signed(top(m) - top(base)), signed(low(m) - low(base)), signed(avg(m, "shortfalls") - avg(base, "shortfalls"), 2),
      ];
      rows.push({
        id: talent.id,
        text: `${talent.id.padEnd(20)}${talent.rarity.padEnd(5)}${cells.map((cell) => cell.padStart(8)).join("")}`,
        impact: rate(m, "anyOffer") - rate(base, "anyOffer") + (top(m) - top(base)) - (low(m) - low(base)),
      });
      // 天赋不改变资格规则：每一局仍然走得完
      expect(m.runs).toBe(seeds.length);
    }
    lines.push(...rows.map((row) => row.text));

    lines.push("", "学期安排（池内顺序；净值 = 四项相加，只作粗略比较）");
    for (const plan of PLANS) {
      const d = plan.delta;
      lines.push(`${plan.id.padEnd(16)}${plan.focus.padEnd(8)}资金 ${signed(d.money, 0).padStart(3)} 学业 ${signed(d.academics, 0).padStart(3)} 职业 ${signed(d.career, 0).padStart(3)} 身心 ${signed(d.wellbeing, 0).padStart(3)}  净值 ${signed(d.money + d.academics + d.career + d.wellbeing, 0)}${plan.base ? "  （基础）" : ""}`);
    }

    const sum = { money: 0, academics: 0, career: 0, wellbeing: 0 };
    let positive = 0;
    let negative = 0;
    for (const item of HAPPENINGS) {
      const net = item.effects.money + item.effects.academics + item.effects.career + item.effects.wellbeing;
      if (net > 0) positive++;
      if (net < 0) negative++;
      for (const key of ["money", "academics", "career", "wellbeing"] as const) sum[key] += item.effects[key];
    }
    const n = HAPPENINGS.length;
    lines.push(
      "",
      `突发小事：${n} 条，其中净值为正 ${positive} 条、为负 ${negative} 条；单条平均 资金 ${signed(sum.money / n, 2)} 学业 ${signed(sum.academics / n, 2)} 职业 ${signed(sum.career / n, 2)} 身心 ${signed(sum.wellbeing / n, 2)}；` +
        `本科八学期约出现 4.8 条，合计约 资金 ${signed((4.8 * sum.money) / n, 1)} 学业 ${signed((4.8 * sum.academics) / n, 1)} 职业 ${signed((4.8 * sum.career) / n, 1)} 身心 ${signed((4.8 * sum.wellbeing) / n, 1)}`,
    );
    console.log(lines.join("\n"));
    expect(rows).toHaveLength(TALENTS.length);
  });
});
