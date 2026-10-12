// 整局随机模拟：seed 驱动的自动选择策略把几千局从开局走到结局，检查全程合法，并统计结局卡各等级与隐藏结局的出现频率。
// 策略只是几种简单的启发式，不代表真实玩家分布；频率表用于判断结局卡阈值是否需要调整。

import { describe, expect, it } from "vitest";
import { ALL_EVENTS } from "../../content";
import { endingView, loadSave, serializeSave } from "../index";
import type {
  Action, ActiveRun, ChoiceId, EndingTierId, EventView, Focus, FocusView, MastersOption, RouteOption, RunState,
} from "../index";
import { totalFocus } from "../rules";
import { act, asActive, ctx, nextAction, start, testRandom } from "./helpers";
import type { Policy } from "./helpers";

const STYLES = ["RANDOM", "RESEARCH", "CAREER", "BALANCED", "SOCIAL", "WORKER", "SLACKER"] as const;
type Style = (typeof STYLES)[number];
const FOCUSES: Focus[] = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
const ECONOMIES = ["LOW", "MID", "HIGH"] as const;
const ASPIRATIONS = ["DISCOVERY", "INDEPENDENCE", "BELONGING"] as const;

function pickFocus(style: Style, seed: number, view: FocusView, state: ActiveRun): Focus {
  const step = totalFocus(state.focusCounts);
  if (style === "RANDOM") return FOCUSES[Math.floor(testRandom(seed, `focus:${step}`) * 5)];
  if (style === "SLACKER") return "REST"; // 八个学期全部休息：验证“什么都不准备”的一局也能走完
  if (state.stats.money < view.upkeep) return "WORK";
  if (state.stats.wellbeing < 25) return "REST";
  switch (style) {
    case "RESEARCH":
      return "STUDY";
    case "CAREER":
      return step % 4 === 3 ? "STUDY" : "CAREER";
    case "BALANCED":
      return (["STUDY", "WORK", "CAREER", "CAMPUS", "STUDY", "REST", "CAREER", "STUDY"] as Focus[])[step % 8];
    case "SOCIAL":
      return (["CAMPUS", "REST", "CAMPUS", "STUDY", "CAMPUS", "REST", "CAREER", "REST"] as Focus[])[step % 8];
    case "WORKER":
      return step % 3 === 2 ? "STUDY" : "WORK";
  }
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

function policyFor(seed: number): { policy: Policy; style: Style } {
  const style = STYLES[seed % STYLES.length];
  return {
    style,
    policy: {
      economy: ECONOMIES[Math.floor(testRandom(seed, "economy") * 3)],
      aspiration: ASPIRATIONS[Math.floor(testRandom(seed, "aspiration") * 3)],
      focus: (view, state) => pickFocus(style, seed, view, state),
      event: (view, state) => pickChoice(style, seed, view, state),
      graduate: (state, routes, masters) => pickGraduation(seed, state, routes, masters),
      school: (state) => (state.offers ?? [])[Math.floor(testRandom(seed, "school") * 3)].unitid,
    },
  };
}

function assertLegal(state: RunState, label: string): void {
  if (state.phase === "SETUP") return;
  for (const key of ["money", "academics", "career", "wellbeing"] as const) {
    const value = state.stats[key];
    if (!Number.isInteger(value) || value < 0 || value > 100 || Object.is(value, -0)) {
      throw new Error(`${label}：${key} = ${value} 不是 0–100 的整数`);
    }
  }
}

const RUNS = 4200;

describe(`整局随机模拟（${RUNS} 局）`, () => {
  it("全程合法、路径与结局全覆盖，并输出结局卡频率表", () => {
    const tiers = new Map<string, Map<Style | "ALL", number>>();
    const hidden = new Map<string, number>();
    const statuses = new Map<string, number>();
    const routes = new Map<string, number>();
    const paths = new Map<string, number>();
    const perStyle = new Map<Style, number>();
    const flagsSeen = new Set<string>();
    const arcSlots = new Set<string>();
    const decisions = new Map<string, Set<number>>();
    const highRuns: Array<{ money: number; offers: number }> = [];
    const homeCareer: number[] = [];
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

    for (let seed = 1; seed <= RUNS; seed++) {
      const { policy, style } = policyFor(seed);
      let state = start(seed);
      const log: Action[] = [];
      for (let guard = 0; guard < 200; guard++) {
        const action = nextAction(state, policy); // 事件没有可选项时这里会抛错
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

      // 生活决策数：本科 24、一年硕士 28、两年硕士 32；投入 8/10/12
      const path = run.mastersYears === null ? "UG" : run.mastersYears === 1 ? "MS_1Y" : "MS_2Y";
      const life = log.filter((action) => action.type === "CHOOSE_FOCUS" || action.type === "CHOOSE_EVENT").length;
      (decisions.get(path) ?? decisions.set(path, new Set()).get(path))?.add(life);
      expect(totalFocus(run.focusCounts)).toBe(path === "UG" ? 8 : path === "MS_1Y" ? 10 : 12);
      expect(run.flags).toHaveLength(path === "UG" ? 16 : path === "MS_1Y" ? 18 : 20);
      expect(new Set(run.flags).size).toBe(run.flags.length);
      for (const event of ALL_EVENTS) expect(run.flags.includes(`${event.id}_A`) && run.flags.includes(`${event.id}_B`)).toBe(false);
      expect(run.flags.filter((flag) => flag.startsWith("ARC_"))).toHaveLength(6);
      expect(run.arcs.A).not.toBe(run.arcs.B);
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

      const offeredCount = Object.values(checkpoint?.outcomes ?? {}).filter((outcome) => outcome === "OFFERED").length;
      if (run.profile.economy === "HIGH") highRuns.push({ money: checkpoint?.frozenStats.money ?? 0, offers: offeredCount });
      if (ending.route === "HOME_JOB") homeCareer.push(checkpoint?.frozenStats.career ?? 0);
      for (const flag of run.flags) flagsSeen.add(flag);
      arcSlots.add(`A:${run.arcs.A}`);
      arcSlots.add(`B:${run.arcs.B}`);
      bump(routes, ending.route === "PHD" ? `PHD/${ending.entryMode}` : ending.route === "TRANSITION" ? `TRANSITION/${ending.transitionMode}` : ending.route);
      bump(paths, path);
      bump(statuses, ending.card.status);
      perStyle.set(style, (perStyle.get(style) ?? 0) + 1);
      const row = tiers.get(ending.card.tier) ?? new Map<Style | "ALL", number>();
      row.set(style, (row.get(style) ?? 0) + 1);
      row.set("ALL", (row.get("ALL") ?? 0) + 1);
      tiers.set(ending.card.tier, row);
      for (const entry of ending.card.hidden) bump(hidden, entry.id);
    }

    // ---------- 覆盖 ----------
    expect([...decisions.get("UG") ?? []]).toEqual([24]);
    expect([...decisions.get("MS_1Y") ?? []]).toEqual([28]);
    expect([...decisions.get("MS_2Y") ?? []]).toEqual([32]);
    for (const key of ["PHD/undergrad_direct", "PHD/masters_entry", "LOCAL_JOB", "HOME_JOB", "TRANSITION/SELF_CHOSEN", "TRANSITION/NO_OFFER"]) {
      expect(routes.get(key) ?? 0, `去向 ${key}`).toBeGreaterThan(0);
    }
    for (const key of ["UG", "MS_1Y", "MS_2Y"]) expect(paths.get(key) ?? 0, `教育路径 ${key}`).toBeGreaterThan(0);
    expect(flagsSeen.size).toBe(64); // 全部 64 个选项都被走到
    expect(arcSlots.size).toBe(12); // 六条支线在两个槽里都出现过

    // ---------- 频率表 ----------
    const pct = (count: number, total: number) => `${((100 * count) / total).toFixed(1)}%`.padStart(6);
    const order: EndingTierId[] = ["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"];
    const lines = [`结局卡频率（${RUNS} 局；策略为启发式，不代表真实玩家）`];
    lines.push(`${"等级".padEnd(8)}${"全部".padStart(7)}  ${STYLES.map((style) => style.padStart(9)).join("")}`);
    for (const tier of order) {
      const row = tiers.get(tier);
      lines.push(
        `${tier.padEnd(9)}${pct(row?.get("ALL") ?? 0, RUNS)}  ${STYLES.map((style) => pct(row?.get(style) ?? 0, perStyle.get(style) ?? 1).padStart(9)).join("")}`,
      );
    }
    lines.push(`隐藏结局：${["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12"].map((id) => `${id} ${pct(hidden.get(id) ?? 0, RUNS).trim()}`).join("  ")}`);
    lines.push(`完结状态：${["HE", "TBC", "OPEN", "TE"].map((id) => `${id} ${pct(statuses.get(id) ?? 0, RUNS).trim()}`).join("  ")}`);
    lines.push(`去向：${[...routes.entries()].sort().map(([key, count]) => `${key} ${pct(count, RUNS).trim()}`).join("  ")}`);
    lines.push(`教育路径：${[...paths.entries()].sort().map(([key, count]) => `${key} ${pct(count, RUNS).trim()}`).join("  ")}`);
    // 调阈值用的参考：HIGH 家庭在不同门槛下够得上 UR 的比例；回国工作结局的职业积累分布
    const high = (money: number, offers: number) => pct(highRuns.filter((item) => item.money >= money && item.offers >= offers).length, highRuns.length).trim();
    lines.push(`UR 参考（HIGH 家庭 ${highRuns.length} 局中满足条件的比例）：资金≥70且机会≥2 ${high(70, 2)}  ≥80且≥2 ${high(80, 2)}  ≥90且≥2 ${high(90, 2)}  ≥70且=3 ${high(70, 3)}  ≥80且=3 ${high(80, 3)}  ≥90且=3 ${high(90, 3)}`);
    const career = (min: number) => pct(homeCareer.filter((value) => value >= min).length, homeCareer.length).trim();
    lines.push(`SR 参考（回国工作 ${homeCareer.length} 局的职业积累）：≥70 ${career(70)}  ≥80 ${career(80)}  ≥90 ${career(90)}  =100 ${career(100)}`);
    console.log(lines.join("\n"));

    // 十档等级在整局模拟里都真实出现过；传奇档不应成为常见结果
    for (const tier of order) expect(tiers.get(tier)?.get("ALL") ?? 0, `等级 ${tier}`).toBeGreaterThan(0);
    const share = (tier: EndingTierId) => (tiers.get(tier)?.get("ALL") ?? 0) / RUNS;
    expect(share("EX")).toBeLessThan(0.15);
    expect(share("UR")).toBeLessThan(0.15);
    expect(share("SSR")).toBeLessThan(0.15);
  });
});
