// 第二版的学期（docs/16 §2–§5、§8）：每学期四张安排、每局不同的主线槽、突发小事、没有学期小结的流程。
// 抽取规则用合成的小池子对照文档伪代码验证；整局行为用真实内容池验证，不写死条数。
// 第三版起正式玩法里一局可能中途结束（docs/22 §4），所以这里的整局检查都只看“实际走到的那几个学期”。

import { describe, expect, it } from "vitest";
import { CORE_EVENTS, CORE_VARIANTS, EVENT_BY_ID, HAPPENINGS, PLANS, RANDOM_EVENTS } from "../../content";
import { FOCUS_BASE } from "../constants";
import { currentEvent, endingView, focusView, lastOutcome, stageInfo, termLedger } from "../index";
import type { ActiveRun, Action, Focus, Happening, PlanCard, RunState, StoryEvent } from "../index";
import { basePlans, findPlan, nodeCandidates } from "../pools";
import { draw01 } from "../rng";
import { mainSlotEvent, rollHappening, termSlate } from "../terms";
import { act, asActive, at, classicPolicy, clone, play, start, startClassic, tryAct } from "./helpers";
import type { Policy } from "./helpers";

const FOCUSES: Focus[] = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
const first: Policy = { plan: (view) => view.options[0].plan.id, event: () => "A" };
const lastOption: Policy = { plan: (view) => view.options[view.options.length - 1].plan.id, event: () => "B" };

/** 走完整局，记录每一步之后的状态。 */
function walk(from: RunState, policy: Policy): ActiveRun[] {
  const states: ActiveRun[] = [];
  let state = from;
  for (let guard = 0; guard < 200 && state.phase !== "ENDING"; guard++) {
    const revision = state.revision;
    state = play(state, policy, (s) => s.revision > revision).state;
    states.push(asActive(state));
  }
  return states;
}

// ---------- 学期安排 ----------

/** docs/16 §2 的伪代码，原样写成参考实现。 */
function referenceSlate(seed: number, stage: "UG" | "MS", term: number, pool: readonly PlanCard[]): { missing: Focus; ids: string[] } {
  let prevMissing: Focus | null = null;
  let prevPick: Record<string, string> = {};
  let result = { missing: "STUDY" as Focus, ids: [] as string[] };
  for (let t = 1; t <= term; t++) {
    const allowed = FOCUSES.filter((focus) => focus !== prevMissing);
    const missing = allowed[Math.floor(draw01(seed, `plan:missing:${stage}:${t}`) * allowed.length)];
    const pick: Record<string, string> = {};
    const ids: string[] = [];
    for (const category of FOCUSES) {
      if (category === missing) continue;
      const all = pool.filter((plan) => plan.focus === category);
      const candidates = prevPick[category] !== undefined && all.length >= 2 ? all.filter((plan) => plan.id !== prevPick[category]) : all;
      const plan = candidates[Math.floor(draw01(seed, `plan:pick:${stage}:${t}:${category}`) * candidates.length)];
      pick[category] = plan.id;
      ids.push(plan.id);
    }
    prevMissing = missing;
    prevPick = pick;
    result = { missing, ids };
  }
  return result;
}

describe("安排池的基本形状", () => {
  it("五个类别各有一张基础安排（向量与 03 §3 相同），只有校园与休息类可以花钱，每类至少一张不花钱", () => {
    expect(new Set(PLANS.map((plan) => plan.id)).size).toBe(PLANS.length);
    for (const focus of FOCUSES) {
      const group = PLANS.filter((plan) => plan.focus === focus);
      expect(group.length, focus).toBeGreaterThanOrEqual(2);
      const base = group.filter((plan) => plan.base);
      expect(base).toHaveLength(1);
      expect(base[0].id).toBe(focus);
      expect(base[0].delta).toEqual(FOCUS_BASE[focus]);
      expect(group.some((plan) => plan.delta.money >= 0)).toBe(true);
      if (focus !== "CAMPUS" && focus !== "REST") expect(group.every((plan) => plan.delta.money >= 0), `${focus} 不应花钱`).toBe(true);
    }
    expect(basePlans().map((plan) => plan.id)).toEqual(FOCUSES);
    expect(findPlan("NOT_A_PLAN")).toBeUndefined();
  });
});

describe("每学期四张安排（16 §2）", () => {
  it("真实安排池：与文档伪代码一致；四张、四个不同类别、固定展示顺序；可复现", () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const [stage, terms] of [["UG", 8], ["MS", 4]] as const) {
        for (let term = 1; term <= terms; term++) {
          const slate = termSlate(seed, stage, term, PLANS);
          const reference = referenceSlate(seed, stage, term, PLANS);
          expect(slate.missing).toBe(reference.missing);
          expect(slate.plans.map((plan) => plan.id)).toEqual(reference.ids);
          expect(slate.plans).toHaveLength(4);
          const categories = slate.plans.map((plan) => plan.focus);
          expect(new Set(categories).size).toBe(4);
          expect(categories).toEqual(FOCUSES.filter((focus) => focus !== slate.missing));
          expect(termSlate(seed, stage, term, PLANS)).toEqual(slate);
          // 至少两张不花钱（学习、求职、打工三类里至少出现两类）
          expect(slate.plans.filter((plan) => plan.delta.money >= 0).length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("同一类别不会连续两学期缺席；相邻学期同一类别不出同一张；五个类别都会缺席过", () => {
    const missingSeen = new Set<Focus>();
    for (let seed = 0; seed < 400; seed++) {
      let previous = termSlate(seed, "UG", 1, PLANS);
      for (let term = 2; term <= 8; term++) {
        const current = termSlate(seed, "UG", term, PLANS);
        expect(current.missing, `seed ${seed} 第 ${term} 学期`).not.toBe(previous.missing);
        for (const plan of current.plans) {
          const before = previous.plans.find((item) => item.focus === plan.focus);
          if (before) expect(plan.id, `seed ${seed} 第 ${term} 学期 ${plan.focus}`).not.toBe(before.id);
        }
        if (current.missing) missingSeen.add(current.missing);
        previous = current;
      }
    }
    expect(missingSeen.size).toBe(5);
  });

  it("本科与硕士各自从第 1 学期起算；学期与 seed 不同，名单就不同", () => {
    let differentStage = 0;
    let differentSeed = 0;
    const key = (slate: { plans: PlanCard[] }) => slate.plans.map((plan) => plan.id).join(",");
    for (let seed = 0; seed < 200; seed++) {
      if (key(termSlate(seed, "UG", 1, PLANS)) !== key(termSlate(seed, "MS", 1, PLANS))) differentStage++;
      if (key(termSlate(seed, "UG", 3, PLANS)) !== key(termSlate(seed + 1, "UG", 3, PLANS))) differentSeed++;
    }
    expect(differentStage).toBeGreaterThan(150);
    expect(differentSeed).toBeGreaterThan(150);
  });

  it("合成池：候选不足两张时不去掉上学期那张；缺某个类别时那一格不出牌", () => {
    const card = (id: string, focus: Focus): PlanCard => ({ id, focus, name: id, delta: { money: 0, academics: 1, career: 0, wellbeing: 0 } });
    const single = FOCUSES.map((focus) => card(focus, focus));
    for (let seed = 0; seed < 100; seed++) {
      for (let term = 1; term <= 8; term++) {
        const slate = termSlate(seed, "UG", term, single);
        expect(slate.plans).toHaveLength(4);
        expect(slate.plans.map((plan) => plan.id)).toEqual(FOCUSES.filter((focus) => focus !== slate.missing));
        expect(slate.missing).toBe(referenceSlate(seed, "UG", term, single).missing);
      }
    }
    // 两张的类别：相邻学期必然交替
    const pair = [...single, card("STUDY_X", "STUDY")];
    for (let seed = 0; seed < 100; seed++) {
      let previous: string | undefined;
      for (let term = 1; term <= 8; term++) {
        const study = termSlate(seed, "UG", term, pair).plans.find((plan) => plan.focus === "STUDY")?.id;
        if (study && previous) expect(study).not.toBe(previous);
        previous = study;
      }
    }
    const noRest = single.filter((plan) => plan.focus !== "REST");
    expect(termSlate(1, "UG", 1, noRest).plans.every((plan) => plan.focus !== "REST")).toBe(true);
    expect(termSlate(1, "UG", 1, [])).toMatchObject({ plans: [] });
  });

  it("名单只由 seed 与学期决定：两种完全不同的玩法看到的每学期安排相同", () => {
    let compared = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const slates = (policy: Policy) =>
        walk(start(seed), policy)
          .filter((state) => state.phase === "FOCUS" && state.stage === "UG")
          .map((state) => `${state.termIndex}:${focusView(state)?.options.map((option) => option.plan.id).join(",")}`);
      const a = slates(first);
      const b = slates(lastOption);
      // 两种玩法可能在不同的学期中途结束；共同走到的学期里看到的名单必须相同
      const common = Math.min(a.length, b.length);
      expect(common).toBeGreaterThanOrEqual(1);
      expect(a.slice(0, common)).toEqual(b.slice(0, common));
      compared += common;
      a.forEach((line, index) => expect(line).toBe(`${index + 1}:${termSlate(seed, "UG", index + 1, PLANS).plans.map((plan) => plan.id).join(",")}`));
    }
    expect(compared).toBeGreaterThan(60);
  });

  it("选安排：只能选本学期名单里的；买不起的不可选并写明差额；历史记录类别与安排", () => {
    let paidSeen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const focus = asActive(play(start(seed), first, at("FOCUS", 2)).state);
      if (focus.phase !== "FOCUS") continue; // 第 1 学期就中途结束了
      const view = focusView(focus);
      const offered = new Set(view?.options.map((option) => option.plan.id));
      expect(view?.options).toHaveLength(4);
      // 池里这学期没给出的安排一律被拒绝，包括缺席类别的基础安排
      for (const plan of PLANS.filter((item) => !offered.has(item.id))) {
        const result = tryAct(focus, { type: "CHOOSE_PLAN", planId: plan.id });
        expect(result.ok ? "OK" : result.error.code, `seed ${seed} ${plan.id}`).toBe("INVALID_ACTION");
        expect(result.state).toBe(focus);
      }
      // 把资金清零：花钱的安排不可选，其余照常；至少两张可选
      const broke = clone(focus);
      broke.stats.money = 0;
      const brokeView = focusView(broke);
      expect(brokeView?.options.filter((option) => option.available).length).toBeGreaterThanOrEqual(2);
      for (const option of brokeView?.options ?? []) {
        const cost = option.requested.money < 0 ? -option.requested.money : 0;
        expect(option.available).toBe(cost === 0);
        expect(option.shortBy).toEqual(cost === 0 ? null : { need: cost, have: 0 });
        const result = tryAct(broke, { type: "CHOOSE_PLAN", planId: option.plan.id });
        if (cost > 0) {
          paidSeen++;
          expect(result.ok ? "OK" : result.error.code).toBe("INSUFFICIENT_FUNDS");
        } else {
          expect(result.ok).toBe(true);
          const after = asActive(result.state);
          expect(after.phase).toBe("CORE_EVENT");
          expect(after.history[after.history.length - 1]).toMatchObject({ kind: "FOCUS", focus: option.focus, planId: option.plan.id });
          expect(after.focusCounts[option.focus]).toBe(focus.focusCounts[option.focus] + 1);
          expect(lastOutcome(after)).toMatchObject({ kind: "FOCUS", heading: option.name });
          // 预计短缺：选它之后按当前资金估算期末会短缺多少
          expect(option.projectedShortfall).toBe(Math.max(0, (brokeView?.upkeep ?? 0) - Math.max(0, option.applied.money)));
        }
      }
    }
    expect(paidSeen).toBeGreaterThan(0); // 真实内容里确实有要花钱的安排被抽到
  });

  it("经典模式每学期固定给五张基础安排", () => {
    const states = walk(startClassic(9, "MID"), classicPolicy({ focus: "CAMPUS", event: "A" })).filter((state) => state.phase === "FOCUS");
    expect(states).toHaveLength(8);
    for (const state of states) {
      expect(focusView(state)?.options.map((option) => option.plan.id)).toEqual(FOCUSES);
    }
  });
});

// ---------- 主线槽 ----------

const stub = (id: string, kind: "core" | "random", stage = 0): StoryEvent =>
  ({ id, kind, ...(kind === "core" ? { stage } : { scope: "UG" }), title: id, summary: id, body: id, callbacks: [], choices: [] }) as unknown as StoryEvent;

describe("主线槽事件（16 §3）", () => {
  it("变体与随机事件池的基本形状", () => {
    for (let term = 1; term <= 8; term++) {
      const candidates = nodeCandidates(term);
      expect(candidates.length, `第 ${term} 学期`).toBeGreaterThanOrEqual(1);
      expect(candidates[0].id).toBe(`CORE_0${term}`); // 按 id 排序，原事件在最前
      expect(candidates.map((event) => event.id)).toEqual([...candidates.map((event) => event.id)].sort());
      expect(candidates.every((event) => event.kind === "core" && event.stage === term)).toBe(true);
    }
    expect(CORE_VARIANTS.length + CORE_EVENTS.length).toBe([1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, term) => sum + nodeCandidates(term).length, 0));
    expect(RANDOM_EVENTS.length).toBeGreaterThanOrEqual(6);
    expect(RANDOM_EVENTS.every((event) => event.kind === "random" && event.callbacks.length === 0)).toBe(true);
    for (const event of [...CORE_VARIANTS, ...RANDOM_EVENTS]) {
      expect(event.choices.map((choice) => choice.setFlags)).toEqual([[`${event.id}_A`], [`${event.id}_B`]]);
      expect(event.choices.some((choice) => choice.effects.money >= 0)).toBe(true);
    }
  });

  it("合成池：与文档伪代码一致——第 1、8 学期只取节点候选；第 2–7 学期 45% 换成没出现过的随机事件", () => {
    const candidates = [stub("CORE_0X", "core", 3), stub("CORE_0X_V2", "core", 3), stub("CORE_0X_V3", "core", 3)];
    const randoms = [stub("RANDOM_01", "random"), stub("RANDOM_02", "random"), stub("RANDOM_03", "random")];
    let randomCount = 0;
    const total = 4000;
    for (let seed = 0; seed < total; seed++) {
      for (const term of [1, 8]) {
        const event = mainSlotEvent(seed, term, candidates, randoms, []);
        expect(event.id).toBe(candidates[Math.floor(draw01(seed, `event:main:${term}`) * 3)].id);
      }
      const used = seed % 2 === 0 ? [] : ["RANDOM_02"];
      const remaining = randoms.filter((event) => !used.includes(event.id));
      const event = mainSlotEvent(seed, 4, candidates, randoms, used);
      const expected =
        draw01(seed, "event:kind:4") < 0.45
          ? remaining[Math.floor(draw01(seed, "event:random:4") * remaining.length)]
          : candidates[Math.floor(draw01(seed, "event:main:4") * 3)];
      expect(event.id).toBe(expected.id);
      expect(used).not.toContain(event.id);
      if (event.kind === "random") randomCount++;
    }
    expect(Math.abs(randomCount / total - 0.45)).toBeLessThan(0.03);
    // 随机事件用完了就回到节点候选
    const exhausted = randoms.map((event) => event.id);
    for (let seed = 0; seed < 200; seed++) expect(mainSlotEvent(seed, 5, candidates, randoms, exhausted).kind).toBe("core");
    for (let seed = 0; seed < 200; seed++) expect(mainSlotEvent(seed, 5, candidates, [], []).kind).toBe("core");
    expect(() => mainSlotEvent(1, 1, [], randoms, [])).toThrow("MAIN_EVENT_CANDIDATES_EMPTY");
  });

  it("整局：第 1/8 学期只出节点候选；第 2–7 学期是该节点候选或随机事件；随机事件一局内不重复", () => {
    let randomSlots = 0;
    let middleSlots = 0;
    const variantsSeen = new Set<string>();
    const randomSeen = new Set<string>();
    const runs = 500;
    for (let seed = 1; seed <= runs; seed++) {
      const end = asActive(play(start(seed), first, at("GRAD_PREVIEW")).state);
      const main = end.history.filter((entry) => entry.kind === "EVENT" && entry.stage === "UG" && EVENT_BY_ID[entry.eventId ?? ""]?.kind !== "arc");
      // 走到毕业的局有八个；中途结束的局是 1…n
      expect(main.map((entry) => entry.termIndex)).toEqual(main.map((_, index) => index + 1));
      if (end.phase === "GRAD_PREVIEW") expect(main).toHaveLength(8);
      const used: string[] = [];
      for (const entry of main) {
        const event = EVENT_BY_ID[entry.eventId ?? ""];
        // 与引擎的抽取规则逐学期一致（已出现过的随机事件只来自之前的学期）
        expect(event.id, `seed ${seed} 第 ${entry.termIndex} 学期`).toBe(
          mainSlotEvent(seed, entry.termIndex, nodeCandidates(entry.termIndex), RANDOM_EVENTS, used).id,
        );
        if (entry.termIndex === 1 || entry.termIndex === 8) expect(event.kind).toBe("core");
        if (event.kind === "core") {
          expect(event.stage).toBe(entry.termIndex);
          variantsSeen.add(event.id);
        } else {
          expect(event.kind).toBe("random");
          expect(used).not.toContain(event.id);
          used.push(event.id);
          randomSeen.add(event.id);
          randomSlots++;
        }
        if (entry.termIndex >= 2 && entry.termIndex <= 7) middleSlots++;
      }
      expect(new Set(used).size).toBe(used.length);
    }
    expect(middleSlots).toBeGreaterThan(runs * 2); // 中途结束的局学期数少一些，留足余量
    expect(Math.abs(randomSlots / middleSlots - 0.45)).toBeLessThan(0.04);
    // 全部节点候选与全部随机事件都真实出现过
    expect(variantsSeen.size).toBe(CORE_EVENTS.length + CORE_VARIANTS.length);
    expect(randomSeen.size).toBe(RANDOM_EVENTS.length);
  });

  it("事件阶段的标签与形状：节点事件写“主线”，随机事件写“随机事件”，phase 仍是 CORE_EVENT", () => {
    const labels = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const state of walk(start(seed), first).filter((item) => item.phase === "CORE_EVENT" && item.stage === "UG")) {
        const view = currentEvent(state);
        if (!view) throw new Error("没有当前事件");
        expect(view.kindLabel).toBe(view.event.kind === "random" ? "随机事件" : "主线");
        expect(view.choices).toHaveLength(2);
        expect(view.choices.some((choice) => choice.available)).toBe(true);
        // 回响只在引用的事件这一局确实出现过时才命中
        for (const callback of view.matchedCallbacks) expect(state.flags).toContain(callback.ifFlag);
        labels.add(view.kindLabel);
        // 发错事件 ID（比如总是发原来的 CORE_0n）会被拒绝
        const original = `CORE_0${state.termIndex}`;
        if (view.event.id !== original) {
          const wrong = tryAct(state, { type: "CHOOSE_EVENT", eventId: original, choiceId: "A" });
          expect(wrong.ok ? "OK" : wrong.error.code).toBe("WRONG_EVENT");
        }
      }
    }
    expect([...labels].sort()).toEqual(["主线", "随机事件"].sort());
  });

  it("主线槽只由 seed 决定：换安排、换选项都不会让后面的事件错位", () => {
    let compared = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const sequence = (policy: Policy) =>
        asActive(play(start(seed), policy, at("GRAD_PREVIEW")).state)
          .history.filter((entry) => entry.kind === "EVENT" && entry.stage === "UG" && EVENT_BY_ID[entry.eventId ?? ""]?.kind !== "arc")
          .map((entry) => entry.eventId);
      const a = sequence(first);
      const b = sequence(lastOption);
      const common = Math.min(a.length, b.length);
      expect(a.slice(0, common)).toEqual(b.slice(0, common));
      compared += common;
    }
    expect(compared).toBeGreaterThan(60);
  });

  it("经典模式的主线槽固定是 CORE_01–08", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const end = asActive(play(startClassic(seed, "MID"), classicPolicy({ focus: "STUDY", event: "A" }), at("GRAD_PREVIEW")).state);
      const main = end.history.filter((entry) => entry.kind === "EVENT" && entry.eventId?.startsWith("CORE_")).map((entry) => entry.eventId);
      expect(main).toEqual(["CORE_01", "CORE_02", "CORE_03", "CORE_04", "CORE_05", "CORE_06", "CORE_07", "CORE_08"]);
      expect(end.history.some((entry) => EVENT_BY_ID[entry.eventId ?? ""]?.kind === "random")).toBe(false);
    }
  });
});

// ---------- 突发小事 ----------

describe("突发小事（16 §4）", () => {
  const item = (id: string, scope: Happening["scope"], money = 1): Happening => ({ id, scope, text: id, effects: { money, academics: 0, career: 0, wellbeing: 0 } });

  it("内容池的基本形状", () => {
    expect(HAPPENINGS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(HAPPENINGS.map((entry) => entry.id)).size).toBe(HAPPENINGS.length);
    expect(HAPPENINGS.some((entry) => entry.scope === "ANY")).toBe(true);
    for (const entry of HAPPENINGS) {
      expect(["ANY", "UG", "MS"]).toContain(entry.scope);
      expect(entry.text.length).toBeGreaterThan(0);
      expect(Object.values(entry.effects).some((value) => value !== 0)).toBe(true);
    }
  });

  it("合成池：60% 的概率出现；按学段过滤；一局内不重复；池空了就没有", () => {
    const pool = [item("A1", "ANY"), item("U1", "UG"), item("M1", "MS"), item("A2", "ANY")];
    let hits = 0;
    const total = 5000;
    for (let seed = 0; seed < total; seed++) {
      const roll = draw01(seed, "happening:roll:UG:3");
      const got = rollHappening(seed, "UG", 3, pool, []);
      const ug = pool.filter((entry) => entry.scope !== "MS");
      expect(got?.id ?? null).toBe(roll < 0.6 ? ug[Math.floor(draw01(seed, "happening:pick:UG:3") * ug.length)].id : null);
      if (got) hits++;
      expect(rollHappening(seed, "MS", 1, pool, [])?.scope ?? "ANY").not.toBe("UG");
      expect(rollHappening(seed, "UG", 3, pool, ["A1", "U1"])?.id ?? "A2").toBe("A2");
      expect(rollHappening(seed, "UG", 3, pool, ["A1", "U1", "A2"])).toBeNull();
      expect(rollHappening(seed, "UG", 3, [], [])).toBeNull();
    }
    expect(Math.abs(hits / total - 0.6)).toBeLessThan(0.025);
  });

  it("整局：出现在学期开头、资助之后；一局内不重复；学段相符；安排界面显示本学期那一条", () => {
    let count = 0;
    let terms = 0;
    const runs = 200;
    const masters: Policy = {
      ...first,
      graduate: (_state, routes, options) => {
        const program = options.find((option) => option.eligible);
        if (program) return { type: "ENTER_MASTERS", program: program.program };
        const open = routes.find((option) => option.available && option.route !== "TRANSITION");
        return { type: "CHOOSE_ROUTE", route: open ? open.route : "TRANSITION" };
      },
    };
    for (let seed = 1; seed <= runs; seed++) {
      const states = walk(start(seed), masters);
      const end = states[states.length - 1];
      const happenings = end.history.filter((entry) => entry.kind === "HAPPENING");
      const ids = happenings.map((entry) => entry.happeningId);
      expect(new Set(ids).size).toBe(ids.length);
      const used: string[] = [];
      for (const [index, entry] of end.history.entries()) {
        if (entry.kind === "STIPEND") {
          terms++;
          const stage = entry.stage === "MS" ? "MS" : "UG";
          // 资助之后紧跟着的那一条要么是这学期的突发小事，要么没有；与抽取规则一致
          const expected = rollHappening(seed, stage, entry.termIndex, HAPPENINGS, used);
          const next = end.history[index + 1];
          if (expected) {
            expect(next).toMatchObject({ kind: "HAPPENING", happeningId: expected.id, stage: entry.stage, termIndex: entry.termIndex, revision: entry.revision });
            expect(next.requestedDelta).toEqual(expected.effects);
            expect(["ANY", stage]).toContain(expected.scope);
            used.push(expected.id);
            count++;
          } else {
            expect(next?.kind === "HAPPENING" && next.termIndex === entry.termIndex && next.stage === entry.stage).toBe(false);
          }
        }
      }
      for (const state of states.filter((item2) => item2.phase === "FOCUS")) {
        const entry = state.history.find((h) => h.kind === "HAPPENING" && h.stage === state.stage && h.termIndex === state.termIndex);
        const view = focusView(state);
        if (entry) {
          const content = HAPPENINGS.find((h) => h.id === entry.happeningId);
          expect(view?.happening).toEqual({ id: entry.happeningId, text: content?.text, delta: { requested: entry.requestedDelta, applied: entry.appliedDelta } });
        } else {
          expect(view?.happening).toBeNull();
        }
      }
    }
    expect(Math.abs(count / terms - 0.6)).toBeLessThan(0.05);
  });

  it("资金不够扣时扣到 0，不产生债务；不设置标记，不影响资格", () => {
    const negatives = HAPPENINGS.filter((entry) => entry.effects.money < 0).map((entry) => entry.id);
    expect(negatives.length).toBeGreaterThan(0);
    let checked = 0;
    for (let seed = 1; seed <= 400 && checked < 12; seed++) {
      // 找一个下一学期开头会遇到“扣钱”小事的时刻：在上一学期最后一张事件之前把资金清零
      const states = walk(start(seed), first);
      const target = states.find((state) => {
        if (state.phase !== "FOCUS" || state.termIndex < 2 || state.stage !== "UG") return false;
        const entry = state.history.find((h) => h.kind === "HAPPENING" && h.stage === "UG" && h.termIndex === state.termIndex);
        return entry !== undefined && negatives.includes(entry.happeningId ?? "");
      });
      if (!target) continue;
      const beforeLastEvent = states.find((state) => state.revision === target.revision - 1);
      if (!beforeLastEvent) continue;
      const broke = clone(beforeLastEvent);
      broke.stats.money = 0;
      const view = currentEvent(broke);
      const choice = view?.choices.find((option) => option.available && option.choice.effects.money <= 0);
      if (!view || !choice) continue;
      const after = asActive(act(broke, { type: "CHOOSE_EVENT", eventId: view.event.id, choiceId: choice.choice.id }));
      if (after.phase === "ENDING") continue; // 资金清零后这学期触发了中途结局，换下一个 seed
      expect(after).toMatchObject({ phase: "FOCUS", termIndex: target.termIndex });
      const stipend = after.history.find((h) => h.kind === "STIPEND" && h.termIndex === after.termIndex && h.stage === "UG");
      const happening = after.history.find((h) => h.kind === "HAPPENING" && h.termIndex === after.termIndex && h.stage === "UG");
      if (!stipend || !happening) throw new Error("缺少资助或突发小事记录");
      const available = stipend.afterStats.money;
      expect(happening.afterStats.money).toBe(Math.max(0, available + happening.requestedDelta.money));
      expect(happening.appliedDelta.money).toBe(happening.afterStats.money - available);
      expect(after.stats.money).toBeGreaterThanOrEqual(0);
      expect(after.flags).toEqual([...broke.flags, ...choice.choice.setFlags]); // 小事不设置标记
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it("经典模式没有突发小事", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const states = walk(startClassic(seed, "LOW"), classicPolicy({ focus: "WORK", event: "B" }));
      expect(states[states.length - 1].history.some((entry) => entry.kind === "HAPPENING")).toBe(false);
      expect(states.filter((state) => state.phase === "FOCUS").every((state) => focusView(state)?.happening === null)).toBe(true);
    }
  });
});

// ---------- 流程与回顾 ----------

describe("学期流程：没有学期小结（16 §5）", () => {
  it("每一步之后的阶段都在阶段表里；最后一张事件之后直接到下一学期、毕业预览，或在这里中途结束", () => {
    const allowed = ["HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "GRAD_PREVIEW", "GRAD_RESULTS", "ENDING"];
    let graduated = 0;
    let endedEarly = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const log: Action[] = [];
      const end = asActive(play(start(seed), first, undefined, log).state);
      expect(end.phase).toBe("ENDING");
      expect(log.some((action) => (action.type as string) === "NEXT_TERM" || (action.type as string) === "CHOOSE_FOCUS")).toBe(false);
      const states = walk(start(seed), first);
      let previous: ActiveRun | null = null;
      for (const state of states) {
        expect(allowed).toContain(state.phase);
        if (previous && (previous.phase === "CORE_EVENT" || previous.phase === "ARC_EVENT") && previous.stage === "UG") {
          const hasArc = previous.termIndex >= 2 && previous.termIndex <= 7;
          const kinds = state.history.filter((entry) => entry.revision === previous?.revision).map((entry) => entry.kind);
          if (previous.phase === "CORE_EVENT" && hasArc) {
            expect(state).toMatchObject({ phase: "ARC_EVENT", termIndex: previous.termIndex });
          } else if (state.phase === "ENDING") {
            // 期末结算之后、进入下一学期或毕业之前触发了中途结局：没有资助，没有毕业快照
            expect(state.ending).toMatchObject({ kind: "EARLY", route: null, degree: "UG" });
            expect(state.termIndex).toBe(previous.termIndex);
            expect(kinds).toEqual(["EVENT", "UPKEEP", "GROWTH"]);
            expect(state.graduations.UG).toBeNull();
          } else if (previous.termIndex < 8) {
            expect(state).toMatchObject({ phase: "FOCUS", termIndex: previous.termIndex + 1 });
            // 同一次操作里：事件 → 必要开销 → 基础成长 → 资助 →（突发小事）
            expect(kinds.slice(0, 4)).toEqual(["EVENT", "UPKEEP", "GROWTH", "STIPEND"]);
            expect(kinds.slice(4)).toEqual(kinds.length === 5 ? ["HAPPENING"] : []);
          } else {
            expect(state).toMatchObject({ phase: "GRAD_PREVIEW", termIndex: 8 });
            expect(kinds).toEqual(["EVENT", "UPKEEP", "GROWTH"]);
            expect(state.graduations.UG?.frozenStats).toEqual(state.stats);
          }
        }
        previous = state;
      }
      if (end.ending?.kind === "GRADUATION") {
        graduated++;
        // 走到毕业的局：24 次生活决策，没有额外的“继续”
        expect(log.filter((action) => action.type === "CHOOSE_PLAN" || action.type === "CHOOSE_EVENT")).toHaveLength(24);
        expect(log.filter((action) => action.type !== "CHOOSE_PLAN" && action.type !== "CHOOSE_EVENT").map((action) => action.type)).toEqual([
          "CONFIRM_SETUP", "CHOOSE_SCHOOL", "REVEAL_GRADUATION", "CHOOSE_ROUTE",
        ]);
      } else {
        endedEarly++;
        // 中途结束的局：最后一步是某个学期的最后一张事件，之后没有毕业相关的操作
        expect(log[log.length - 1].type).toBe("CHOOSE_EVENT");
        expect(log.some((action) => action.type === "REVEAL_GRADUATION" || action.type === "CHOOSE_ROUTE")).toBe(false);
      }
    }
    expect(graduated).toBeGreaterThan(0);
    expect(graduated + endedEarly).toBe(60);
  });

  it("阶段标题里没有“学期小结”；账目跟在下一屏：FOCUS 给上一学期，毕业预览给最后一学期", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const state of walk(start(seed), first)) {
        expect(stageInfo(state).title).not.toContain("小结");
        const ledger = termLedger(state);
        if (state.phase === "FOCUS" && state.termIndex > 1) {
          expect(ledger).toMatchObject({ stage: state.stage, termIndex: state.termIndex - 1, isFinalTerm: false });
          const kinds = ledger?.lines.map((line) => line.kind) ?? [];
          expect(kinds[0]).toBe("STIPEND");
          expect(kinds.slice(-2)).toEqual(["UPKEEP", "GROWTH"]);
          expect(kinds.filter((kind) => kind === "FOCUS")).toHaveLength(1);
          expect(kinds.filter((kind) => kind === "HAPPENING").length).toBeLessThanOrEqual(1);
          // 账目的终值是上学期基础成长之后的四属性，不含本学期的资助与突发小事
          const growth = state.history.find((entry) => entry.kind === "GROWTH" && entry.stage === state.stage && entry.termIndex === state.termIndex - 1);
          expect(ledger?.endStats).toEqual(growth?.afterStats);
          const happeningLine = ledger?.lines.find((line) => line.kind === "HAPPENING");
          if (happeningLine) expect(HAPPENINGS.some((entry) => entry.text === happeningLine.detail)).toBe(true);
          expect(ledger?.lines.find((line) => line.kind === "FOCUS")?.detail).toBe(
            findPlan(state.history.find((entry) => entry.kind === "FOCUS" && entry.stage === state.stage && entry.termIndex === state.termIndex - 1)?.planId ?? "")?.name,
          );
        } else if (state.phase === "GRAD_PREVIEW" || state.phase === "GRAD_RESULTS") {
          expect(ledger).toMatchObject({ termIndex: 8, isFinalTerm: true });
          expect(ledger?.endStats).toEqual(state.graduations.UG?.frozenStats);
        } else {
          expect(ledger).toBeNull();
        }
      }
    }
  });
});

describe("结局回顾取实际出现的主线槽事件（16 §8）", () => {
  it("本科第 1、4、8 学期主线槽里实际出现的那张；条数不变；带上本局的三张天赋", () => {
    let nonOriginal = 0;
    let graduated = 0;
    // 中途结局的多少取决于内容；一直找到凑够 30 局走到毕业的为止
    for (let seed = 1; graduated < 30 && seed <= 5000; seed++) {
      const end = asActive(play(start(seed), first).state);
      const view = endingView(end);
      if (end.ending?.kind !== "GRADUATION") {
        expect(view).toBeNull(); // 中途结局没有 docs/07 的回顾
        continue;
      }
      if (!view) throw new Error("没有结局视图");
      graduated++;
      const mainOf = (term: number) =>
        end.history.find((entry) => entry.kind === "EVENT" && entry.stage === "UG" && entry.termIndex === term && EVENT_BY_ID[entry.eventId ?? ""]?.kind !== "arc")?.eventId;
      const expected = ["HS_01", "HS_02", mainOf(1), mainOf(4), `ARC_${end.arcs.A}_3`, `ARC_${end.arcs.B}_3`, mainOf(8)];
      expect(view.full.review.map((entry) => entry.eventId)).toEqual(expected);
      expect(view.full.review).toHaveLength(7);
      for (const entry of view.full.review) {
        const event = EVENT_BY_ID[entry.eventId];
        expect(entry.title).toBe(event.title);
        expect(end.flags).toContain(`${entry.eventId}_${entry.choiceId}`);
        expect(entry.choiceLabel).toBe(event.choices.find((choice) => choice.id === entry.choiceId)?.label);
      }
      if (expected.some((id) => id && (id.includes("_V") || id.startsWith("RANDOM")))) nonOriginal++;
      expect(view.talents).toHaveLength(3);
      expect(view.talents.map((talent) => talent.id)).toEqual(end.profile.talents);
      expect(view.short.keyExperience.startsWith("你记得「")).toBe(true);
    }
    expect(graduated).toBe(30);
    expect(nonOriginal).toBeGreaterThan(graduated / 2); // 多数局的回顾里出现了变体或随机事件
  });
});
