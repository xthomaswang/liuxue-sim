// 第二版开局（docs/16 §1）：出身是抽的、天赋十连抽选三，以及天赋效果在整局里的各个作用点。
// 内容池用真实数据，但不写死条数；抽样规则另用合成的小池子对照文档伪代码验证。

import { describe, expect, it } from "vitest";
import { TALENTS } from "../../content";
import {
  CLASSIC_TALENT_IDS, INITIAL_STATS, STIPEND, TALENT_WEIGHTS, TERM_GROWTH, UPKEEP_DEFAULT,
} from "../constants";
import { probabilities } from "../graduation";
import {
  admissionPreview, admissionResult, createRun, currentEvent, endingView, focusView, graduationView, setupView,
} from "../index";
import type { ActiveRun, Economy, RunState, Talent, TalentEffects, TalentRarity } from "../index";
import { CLASSIC_TALENT_EFFECTS, findPlan, findTalent } from "../pools";
import { draw01 } from "../rng";
import { arcWeights, pickArc, planVector } from "../rules";
import { drawTalents, economyFor, originFor, sumTalentEffects, totalsFor } from "../talents";
import { act, asActive, at, catalog, play, start, startClassic, tryAct } from "./helpers";
import type { Policy } from "./helpers";

const poolIndex = (id: string) => TALENTS.findIndex((talent) => talent.id === id);
const basic: Policy = {
  plan: (view, state) => view.options[(state.termIndex + state.seed) % view.options.length].plan.id,
  event: (view, state) => ((view.event.id.length + state.seed) % 2 === 0 ? "A" : "B"),
};

describe("内容池的基本形状", () => {
  it("天赋池足够十连抽，四种稀有度都有，六张特质天赋的效果与 03 §2.3 相同", () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TALENTS.map((talent) => talent.id)).size).toBe(TALENTS.length);
    for (const rarity of ["N", "R", "SR", "SSR"] as TalentRarity[]) {
      expect(TALENTS.some((talent) => talent.rarity === rarity), rarity).toBe(true);
    }
    for (const id of CLASSIC_TALENT_IDS) {
      const talent = TALENTS.find((entry) => entry.id === id);
      expect(talent, id).toBeDefined();
      expect(talent?.effects).toEqual(CLASSIC_TALENT_EFFECTS[id]);
      expect(findTalent(id)).toBe(talent);
    }
    expect(findTalent("T_NOT_A_TALENT")).toBeUndefined();
  });
});

describe("出身：抽出来，不能选（16 §1.1）", () => {
  it("经济档按 origin:economy 的分界，期待与愿望按各自的 key", () => {
    const expectations = ["ACADEMIC", "STABILITY", "AUTONOMY"];
    const aspirations = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
    for (let seed = 0; seed < 2000; seed++) {
      const r = draw01(seed, "origin:economy");
      const origin = originFor(seed);
      expect(origin.economy).toBe(r < 0.3 ? "LOW" : r < 0.75 ? "MID" : "HIGH");
      expect(economyFor(seed)).toBe(origin.economy);
      expect(origin.expectation).toBe(expectations[Math.floor(draw01(seed, "origin:expectation") * 3)]);
      expect(origin.aspiration).toBe(aspirations[Math.floor(draw01(seed, "origin:aspiration") * 3)]);
    }
  });

  it("大量 seed 上三档比例约为 30% / 45% / 25%", () => {
    const counts: Record<Economy, number> = { LOW: 0, MID: 0, HIGH: 0 };
    const total = 30000;
    for (let seed = 0; seed < total; seed++) counts[economyFor(seed)] += 1;
    expect(counts.LOW / total).toBeCloseTo(0.3, 1);
    expect(counts.MID / total).toBeCloseTo(0.45, 1);
    expect(counts.HIGH / total).toBeCloseTo(0.25, 1);
    expect(Math.abs(counts.LOW / total - 0.3)).toBeLessThan(0.012);
    expect(Math.abs(counts.MID / total - 0.45)).toBeLessThan(0.012);
  });

  it("开局视图给出出身、经济档的基础数值与基础准备度；同 seed 可复现", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const setup = start(seed);
      expect(setup).toMatchObject({ phase: "SETUP", mode: "standard", revision: 0 });
      expect("classicEconomy" in setup).toBe(false);
      const view = setupView(setup);
      const origin = originFor(seed);
      expect(view.origin).toEqual({
        ...origin,
        initialStats: INITIAL_STATS[origin.economy],
        stipend: STIPEND[origin.economy],
        upkeep: UPKEEP_DEFAULT,
      });
      expect(view.pickCount).toBe(3);
      expect(view.baseReadiness).toBe(admissionPreview(setup).baseReadiness);
      expect(setupView(start(seed))).toEqual(view);
    }
  });

  it("经典模式的经济档由调用方给定，期待与愿望仍按出身的 key 抽", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const standard = setupView(start(seed)).origin;
      for (const economy of ["LOW", "MID", "HIGH"] as Economy[]) {
        const classic = setupView(startClassic(seed, economy)).origin;
        expect(classic.economy).toBe(economy);
        expect(classic.expectation).toBe(standard.expectation);
        expect(classic.aspiration).toBe(standard.aspiration);
      }
    }
  });

  it("createRun：classic 必须给经济档，standard 不能给；mode 缺省为 standard", () => {
    expect(createRun({ seed: 1, runId: "a", catalog }).mode).toBe("standard");
    expect(() => createRun({ seed: 1, runId: "a", catalog, mode: "classic" })).toThrow("INVALID_MODE");
    expect(() => createRun({ seed: 1, runId: "a", catalog, classicEconomy: "LOW" })).toThrow("INVALID_MODE");
    expect(() => createRun({ seed: 1, runId: "a", catalog, mode: "easy" as never })).toThrow("INVALID_MODE");
    expect(createRun({ seed: 1, runId: "a", catalog, mode: "classic", classicEconomy: "HIGH" })).toMatchObject({ mode: "classic", classicEconomy: "HIGH" });
  });
});

/** docs/16 §1.2 的伪代码，原样写成参考实现。 */
function referenceDraw(seed: number, pool: readonly Talent[], count = 10): string[] {
  const remaining = [...pool];
  const out: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const total = remaining.reduce((sum, talent) => sum + TALENT_WEIGHTS[talent.rarity], 0);
    const r = draw01(seed, `talent:draw:${i}`) * total;
    let cumulative = 0;
    let index = remaining.length - 1;
    for (let k = 0; k < remaining.length; k++) {
      cumulative += TALENT_WEIGHTS[remaining[k].rarity];
      if (cumulative > r) {
        index = k;
        break;
      }
    }
    out.push(remaining[index].id);
    remaining.splice(index, 1);
  }
  return out;
}

const fake = (id: string, rarity: TalentRarity, effects: TalentEffects = {}): Talent => ({ id, name: id, rarity, text: id, effects });

describe("十连抽：按权重的无放回抽样（16 §1.2）", () => {
  it("权重为 100 / 45 / 15 / 4", () => {
    expect(TALENT_WEIGHTS).toEqual({ N: 100, R: 45, SR: 15, SSR: 4 });
  });

  it("合成池：结果与文档伪代码一致，互不相同，可复现", () => {
    const pool = [
      fake("A", "N"), fake("B", "SSR"), fake("C", "R"), fake("D", "N"), fake("E", "SR"), fake("F", "N"), fake("G", "R"),
      fake("H", "N"), fake("I", "SR"), fake("J", "N"), fake("K", "R"), fake("L", "SSR"), fake("M", "N"), fake("O", "N"),
    ];
    for (let seed = 0; seed < 500; seed++) {
      const drawn = drawTalents(seed, pool).map((talent) => talent.id);
      expect(drawn).toEqual(referenceDraw(seed, pool));
      expect(drawn).toHaveLength(10);
      expect(new Set(drawn).size).toBe(10);
      expect(drawTalents(seed, pool).map((talent) => talent.id)).toEqual(drawn);
    }
    // 不改入参
    expect(pool).toHaveLength(14);
  });

  it("合成池：池内顺序决定累计区间；单张池、空池与不足十张的池", () => {
    const two = [fake("N1", "N"), fake("S1", "SSR")];
    for (let seed = 0; seed < 300; seed++) {
      // 第一抽：r = u × 104；r < 100 取 N1，否则取 S1
      const first = drawTalents(seed, two, 1)[0].id;
      expect(first).toBe(draw01(seed, "talent:draw:0") * 104 < 100 ? "N1" : "S1");
      expect(drawTalents(seed, two).map((talent) => talent.id).sort()).toEqual(["N1", "S1"]);
    }
    expect(drawTalents(5, [])).toEqual([]);
    expect(drawTalents(5, [fake("ONLY", "SR")]).map((talent) => talent.id)).toEqual(["ONLY"]);
  });

  it("真实天赋池：十张互不相同、都来自池子、与参考实现一致、按抽出顺序给出", () => {
    for (let seed = 0; seed < 400; seed++) {
      const view = setupView(start(seed));
      const ids = view.draw.map((talent) => talent.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      expect(ids.every((id) => poolIndex(id) >= 0)).toBe(true);
      expect(ids).toEqual(referenceDraw(seed, TALENTS));
    }
  });

  it("真实天赋池：第一抽各稀有度的频率与权重大致相符；稀有天赋更少被抽到", () => {
    const totalWeight = TALENTS.reduce((sum, talent) => sum + TALENT_WEIGHTS[talent.rarity], 0);
    const expected = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    for (const talent of TALENTS) expected[talent.rarity] += TALENT_WEIGHTS[talent.rarity] / totalWeight;
    const first = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    const inTen = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    const runs = 20000;
    for (let seed = 0; seed < runs; seed++) {
      const drawn = drawTalents(seed, TALENTS);
      first[drawn[0].rarity] += 1;
      for (const talent of drawn) inTen[talent.rarity] += 1;
    }
    for (const rarity of ["N", "R", "SR", "SSR"] as TalentRarity[]) {
      expect(Math.abs(first[rarity] / runs - expected[rarity]), `第一抽 ${rarity}`).toBeLessThan(0.012);
    }
    // 十张里每张天赋被抽到的平均次数：N > R > SR > SSR
    const perCard = (rarity: TalentRarity) => inTen[rarity] / runs / TALENTS.filter((talent) => talent.rarity === rarity).length;
    expect(perCard("N")).toBeGreaterThan(perCard("R"));
    expect(perCard("R")).toBeGreaterThan(perCard("SR"));
    expect(perCard("SR")).toBeGreaterThan(perCard("SSR"));
    expect(perCard("SSR")).toBeGreaterThan(0);
  });

  it("换选择不会改变抽到的十张：开局视图只由 seed 决定", () => {
    const view = setupView(start(77));
    const picked = act(start(77), { type: "CONFIRM_SETUP", talents: view.draw.slice(4, 7).map((talent) => talent.id) });
    expect(picked.phase).toBe("HIGH_SCHOOL_EVENT");
    expect(setupView(start(77))).toEqual(view);
  });
});

describe("选三张（16 §1.2）", () => {
  const setup = start(21);
  const view = setupView(setup);
  const ids = view.draw.map((talent) => talent.id);
  const outsider = TALENTS.find((talent) => !ids.includes(talent.id))?.id ?? "";

  it("必须恰好三张、互不相同、都来自这十张", () => {
    expect(outsider).not.toBe("");
    const bad: unknown[] = [
      [],
      ids.slice(0, 2),
      ids.slice(0, 4),
      [ids[0], ids[0], ids[1]],
      [ids[0], ids[1], outsider],
      [ids[0], ids[1], "T_NOT_A_TALENT"],
      [ids[0], ids[1], 3],
      "abc",
      null,
    ];
    for (const talents of bad) {
      const result = tryAct(setup, { type: "CONFIRM_SETUP", talents: talents as string[] });
      expect(result.ok ? "OK" : result.error.code, JSON.stringify(talents)).toBe("INVALID_ACTION");
      expect(result.state).toBe(setup);
    }
    // 第一版的开局参数已经不存在
    const legacy = tryAct(setup, { type: "CONFIRM_SETUP", economy: "MID", aspiration: "DISCOVERY", name: "" } as never);
    expect(legacy.ok ? "OK" : legacy.error.code).toBe("INVALID_ACTION");
  });

  it("确认后：天赋按池内顺序存放，出身来自 seed，确认后不可更换", () => {
    const chosen = [ids[7], ids[2], ids[5]];
    const run = asActive(act(setup, { type: "CONFIRM_SETUP", talents: chosen }));
    expect(run.profile.talents).toEqual([...chosen].sort((a, b) => poolIndex(a) - poolIndex(b)));
    expect(run.profile).toMatchObject(originFor(21));
    expect(run).toMatchObject({ phase: "HIGH_SCHOOL_EVENT", stage: "HS", highSchoolNode: 1, mode: "standard", revision: 1 });
    // 选的顺序不同，结果相同
    const other = asActive(act(setup, { type: "CONFIRM_SETUP", talents: [ids[5], ids[7], ids[2]] }));
    expect(other).toEqual(run);
    const again = tryAct(run, { type: "CONFIRM_SETUP", talents: ids.slice(0, 3) });
    expect(again.ok ? "OK" : again.error.code).toBe("WRONG_PHASE");
  });

  it("初始四属性 = 经济档初始值 + 三张天赋的 initial 之和（截断）；准备度加成 = readiness 之和", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const s = start(seed);
      const v = setupView(s);
      const chosen = [v.draw[seed % 10], v.draw[(seed + 3) % 10], v.draw[(seed + 6) % 10]].map((talent) => talent.id);
      const run = asActive(act(s, { type: "CONFIRM_SETUP", talents: chosen }));
      const totals = sumTalentEffects(chosen.map((id) => TALENTS[poolIndex(id)]));
      for (const key of ["money", "academics", "career", "wellbeing"] as const) {
        expect(run.stats[key]).toBe(Math.min(100, Math.max(0, INITIAL_STATS[v.origin.economy][key] + totals.initial[key])));
      }
      expect(run.admission.talentBonus).toBe(totals.readiness);
      expect(run.admission.baseReadiness).toBe(v.baseReadiness);
      expect(admissionPreview(run)).toMatchObject({
        baseReadiness: v.baseReadiness,
        talentBonus: totals.readiness,
        readinessBonus: null,
        readinessSoFar: Math.min(100, Math.max(0, v.baseReadiness + totals.readiness)),
      });
      expect(run.history).toEqual([]);
    }
  });
});

/** 找一个十连抽里含有指定天赋的 seed，并选它加另外两张。 */
function runWith(talentId: string): { run: RunState; talents: string[] } {
  for (let seed = 1; seed < 20000; seed++) {
    const setup = start(seed);
    const ids = setupView(setup).draw.map((talent) => talent.id);
    if (!ids.includes(talentId)) continue;
    const others = ids.filter((id) => id !== talentId).slice(0, 2);
    return { run: act(setup, { type: "CONFIRM_SETUP", talents: [talentId, ...others] }), talents: [talentId, ...others] };
  }
  throw new Error(`找不到抽到 ${talentId} 的 seed`);
}

/** 走完整局，逐条核对每一次属性变化都按“本局天赋效果的合计”结算。 */
function verifyWholeRun(from: RunState, label: string): ActiveRun {
  const totals = totalsFor(asActive(from).profile.talents);
  let state = from;
  const policy: Policy = {
    ...basic,
    graduate: (_state, routes, masters) => {
      const program = masters.find((option) => option.eligible);
      if (program) return { type: "ENTER_MASTERS", program: program.program };
      const open = routes.find((option) => option.available && option.route !== "TRANSITION");
      return { type: "CHOOSE_ROUTE", route: open ? open.route : "TRANSITION" };
    },
  };
  for (let guard = 0; guard < 200 && state.phase !== "ENDING"; guard++) {
    const before = asActive(state);
    // 选安排的那一屏：预览与实际结算一致
    if (before.phase === "FOCUS") {
      const view = focusView(before);
      expect(view?.upkeep, `${label} 必要开销`).toBe(Math.max(0, UPKEEP_DEFAULT + totals.upkeep));
      for (const option of view?.options ?? []) {
        const expected = planVector(option.plan.delta, totals.focus[option.plan.focus], totals.focusWellbeingRelief, before.stats.wellbeing, totals.efficiencyFloor);
        expect(option.requested, `${label} ${option.plan.id} 预览`).toEqual(expected.requested);
        expect(option.talentApplied).toBe(expected.talentApplied);
      }
    }
    if (before.phase === "ARC_EVENT" && (before.termIndex === 2 || before.termIndex === 3)) {
      // 支线刚分配：权重里包含天赋的支线加成
      const slot = before.termIndex === 2 ? "A" : "B";
      const weights = arcWeights({ focusCounts: before.focusCounts, stats: before.stats, economy: before.profile.economy, bonus: totals.arcWeight });
      expect(before.arcs[slot], `${label} 支线 ${slot}`).toBe(pickArc(before.seed, slot, weights, slot === "B" ? before.arcs.A : null));
    }
    state = play(state, policy, (s) => s.revision > before.revision).state;
    const after = asActive(state);
    for (const entry of after.history.slice(before.history.length)) {
      if (entry.kind === "STIPEND") {
        expect(entry.requestedDelta.money, `${label} 资助`).toBe(Math.max(0, STIPEND[after.profile.economy] + totals.stipend));
      } else if (entry.kind === "UPKEEP") {
        expect(entry.upkeep?.cost, `${label} 必要开销`).toBe(Math.max(0, UPKEEP_DEFAULT + totals.upkeep));
      } else if (entry.kind === "GROWTH") {
        for (const key of ["money", "academics", "career", "wellbeing"] as const) {
          expect(entry.requestedDelta[key], `${label} 基础成长 ${key}`).toBe(TERM_GROWTH[key] + totals.growth[key]);
        }
      } else if (entry.kind === "FOCUS") {
        const plan = findPlan(entry.planId ?? "");
        if (!plan) throw new Error(`${label} 未知安排 ${String(entry.planId)}`);
        const expected = planVector(plan.delta, totals.focus[plan.focus], totals.focusWellbeingRelief, entry.beforeStats.wellbeing, totals.efficiencyFloor);
        expect(entry.requestedDelta, `${label} 安排 ${plan.id}`).toEqual(expected.requested);
        expect(entry.efficiency).toBe(expected.factor);
        expect(entry.focus).toBe(plan.focus);
      }
    }
    // 申请：准备度 = 基础 + HS_01 加成 + 天赋加成
    if (before.phase === "HIGH_SCHOOL_EVENT" && after.phase === "SCHOOL_OFFERS") {
      const result = admissionResult(after);
      expect(result?.talentBonus).toBe(totals.readiness);
      expect(result?.readiness).toBe(Math.min(100, Math.max(0, (result?.baseReadiness ?? 0) + (result?.readinessBonus ?? 0) + totals.readiness)));
    }
    // 毕业：概率 = 公式 + 天赋加成；分解里单列“天赋加成”
    if (after.phase === "GRAD_PREVIEW" && before.phase !== "GRAD_PREVIEW") {
      const degree = after.stage === "MS" ? "MS" : "UG";
      const grad = after.graduations[degree];
      if (!grad) throw new Error("缺少毕业快照");
      expect(grad.probabilities, `${label} ${degree} 概率`).toEqual(
        probabilities({ degree, stats: grad.frozenStats, focusCounts: grad.frozenFocusCounts, flags: grad.frozenFlags, chance: totals.chance }),
      );
      const plain = probabilities({ degree, stats: grad.frozenStats, focusCounts: grad.frozenFocusCounts, flags: grad.frozenFlags });
      for (const item of graduationView(after)?.opportunities ?? []) {
        const bonus = totals.chance[item.id];
        expect(item.breakdown.find((term) => term.label === "天赋加成")?.hundredths ?? 0).toBe(100 * bonus);
        expect(item.eligible).toBe(plain[item.id] !== null); // 加成不改变资格
        const raw = Math.floor((item.breakdown.reduce((sum, term) => sum + term.hundredths, 0) + 50) / 100);
        if (item.probability !== null) expect(item.probability).toBe(Math.min(degree === "UG" && item.id === "PHD" ? 85 : 95, Math.max(8, raw)));
      }
    }
  }
  const end = asActive(state);
  expect(end.phase, label).toBe("ENDING");
  expect(endingView(end)?.talents.map((talent) => talent.id)).toEqual(end.profile.talents);
  return end;
}

describe("天赋效果在整局里的作用点（16 §1.3）", () => {
  it("池里每一张天赋：选中它的一局里，资助、开销、安排、准备度、支线、基础成长、毕业概率都按合计结算", () => {
    const seenKeys = new Set<string>();
    for (const talent of TALENTS) {
      const { run, talents } = runWith(talent.id);
      expect(asActive(run).profile.talents).toContain(talent.id);
      expect(talents).toHaveLength(3);
      verifyWholeRun(run, talent.id);
      for (const key of Object.keys(talent.effects)) seenKeys.add(key);
    }
    // 真实内容覆盖了文档列出的全部效果键
    expect([...seenKeys].sort()).toEqual(
      ["arcWeight", "chance", "efficiencyFloor", "focus", "focusWellbeingRelief", "growth", "initial", "readiness", "stipend", "upkeep"].sort(),
    );
  });

  it("效率下限：选了有下限的天赋后，再累也不低于下限", () => {
    const withFloor = TALENTS.filter((talent) => talent.effects.efficiencyFloor !== undefined);
    expect(withFloor.length).toBeGreaterThan(0);
    for (const talent of withFloor) {
      const { run } = runWith(talent.id);
      const focus = asActive(play(run, basic, at("FOCUS")).state);
      const tired = { ...focus, stats: { ...focus.stats, wellbeing: 0 } };
      const floor = totalsFor(tired.profile.talents).efficiencyFloor;
      expect(floor).toBeGreaterThanOrEqual(talent.effects.efficiencyFloor ?? 0);
      expect(focusView(tired)?.efficiency.factor).toBe(floor);
      const after = asActive(act(tired, { type: "CHOOSE_PLAN", planId: focusView(tired)?.options[0].plan.id ?? "" }));
      expect(after.history[after.history.length - 1].efficiency).toBe(floor);
    }
  });

  it("开销类天赋改变事件预览里的预计结算与硕士预算", () => {
    const pricey = TALENTS.find((talent) => (talent.effects.upkeep ?? 0) > 0);
    const thrifty = TALENTS.find((talent) => (talent.effects.upkeep ?? 0) < 0);
    for (const talent of [pricey, thrifty]) {
      if (!talent) throw new Error("内容池里应当既有加开销也有减开销的天赋");
      const { run } = runWith(talent.id);
      const cost = Math.max(0, UPKEEP_DEFAULT + totalsFor(asActive(run).profile.talents).upkeep);
      const event = asActive(play(run, basic, at("CORE_EVENT")).state);
      expect(currentEvent(event)?.choices.every((choice) => choice.projected?.upkeep === cost)).toBe(true);
    }
  });
});
