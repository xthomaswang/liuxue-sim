// 第四版（docs/24）：期中突发小事、暑假、日常、期末 GPA、毕业（离校）后的五年。
// 内容还在写：单元测试一律注入合成的内容池，或者按内容里每一条自己的 when 通用地构造，不依赖具体条目与条数。

import { describe, expect, it } from "vitest";
import { DAILY_LINES, EARLY_ENDINGS, EVENT_BY_ID, LIFE_TRACKS, SUMMERS } from "../../content";
import type { LifeCommonContent } from "../../content";
import { lifeFocusWeight } from "../auto";
import { conditionMet } from "../conditions";
import type { ConditionContext } from "../conditions";
import { FOCUS_ORDER, GPA, LIFE_TRACK_ORDER, LIFE_YEARS } from "../constants";
import { dailyPicksFor, termEndContext as dailyContext } from "../daily";
import { averageGpa, gpaLineText, termGpaHundredths, termGpas } from "../gpa";
import { autoAction, loadSave, replay, serializeSave, simulate, stageInfo, termLedger } from "../index";
import type {
  ActiveRun, DailyLine, Degree, EndingCondition, Focus, GpaBand, HistoryEntry, LifeEvent, LifeOutcome, LifeTrack,
  LifeTrackContent, RunState, SaveEnvelope, Stats, SummerEvent,
} from "../index";
import { lastTermOf, lifeContext, liveYear } from "../life";
import type { LifeContent } from "../life";
import { draw01, pickIndex, pickWeighted } from "../rng";
import { totalsFor } from "../talents";
import { rollHappening } from "../terms";
import { satisfying, violations } from "./conditionCases";
import {
  act, asActive, autoInput, classicPolicy, clone, contextAt, ctx, play, simulateObserved, startClassic, tryAct,
} from "./helpers";

const STATS = ["money", "academics", "career", "wellbeing"] as const;
const S = (money = 0, academics = 0, career = 0, wellbeing = 0): Stats => ({ money, academics, career, wellbeing });
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const clampStat = (value: number) => Math.min(100, Math.max(0, value));
const EARLY_LIFE_TRACK = (id: string | null): LifeTrack | undefined => (id ? EARLY_ENDINGS.find((item) => item.id === id)?.lifeTrack : undefined);

/** 自动走完一局（含毕业后的五年）。 */
function auto(seed: number): { state: ActiveRun; log: ReturnType<typeof simulate>["log"] } {
  const { setup, input } = autoInput(seed);
  const result = simulate(setup, input, ctx);
  return { state: asActive(result.state), log: result.log };
}

/** 自动走到刚离开学校（进入 LIFE、还没过第一年）的那一刻。 */
function atLife(seed: number): ActiveRun {
  const { setup, input } = autoInput(seed);
  let state: RunState = act(setup, { type: "CONFIRM_SETUP", ...input });
  for (let action = autoAction(state, ctx); action && state.phase !== "LIFE"; action = autoAction(state, ctx)) state = act(state, action);
  return asActive(state);
}

// ---------- 条件：第四版新增的键（§6） ----------

describe("条件：第四版新增的键（24 §6）", () => {
  const base: ConditionContext = {
    ...satisfying({}),
    focus: "STUDY",
    track: "LOCAL_JOB",
    year: 3,
    lifeFlags: ["H1B", "DATING"],
    flavor: "F_X",
    early: null,
    route: "LOCAL_JOB",
    degree: "UG",
    economy: "MID",
    talents: ["T_A", "T_B"],
  };
  const cases: Array<[EndingCondition, Partial<ConditionContext>, boolean]> = [
    [{ focusAny: ["STUDY", "REST"] }, {}, true],
    [{ focusAny: ["WORK"] }, {}, false],
    [{ focusAny: ["STUDY"] }, { focus: null }, false], // 开学那一刻还没有本学期的安排
    [{ focusAny: ["STUDY"] }, { focus: undefined }, false],
    [{ tracks: ["LOCAL_JOB", "HOME_JOB"] }, {}, true],
    [{ tracks: ["PHD"] }, {}, false],
    [{ tracks: ["LOCAL_JOB"] }, { track: undefined }, false], // 还没离校
    [{ yearMin: 3, yearMax: 3 }, {}, true],
    [{ yearMin: 4 }, {}, false],
    [{ yearMax: 2 }, {}, false],
    [{ yearMin: 1 }, { year: undefined }, false],
    [{ yearMax: 5 }, { year: undefined }, false],
    [{ lifeFlagsAll: ["H1B", "DATING"] }, {}, true],
    [{ lifeFlagsAll: ["H1B", "MARRIED"] }, {}, false],
    [{ lifeFlagsAll: ["H1B"] }, { lifeFlags: undefined }, false],
    [{ lifeFlagsAny: ["MARRIED", "DATING"] }, {}, true],
    [{ lifeFlagsAny: ["MARRIED", "KID"] }, {}, false],
    [{ lifeFlagsAny: ["DATING"] }, { lifeFlags: undefined }, false],
    [{ lifeFlagsNone: ["MARRIED", "KID"] }, {}, true],
    [{ lifeFlagsNone: ["MARRIED", "H1B"] }, {}, false],
    [{ lifeFlagsNone: ["MARRIED"] }, { lifeFlags: undefined }, true], // 带 None 的：缺信息视为满足
    [{ talentsNone: ["T_C", "T_D"] }, {}, true],
    [{ talentsNone: ["T_C", "T_B"] }, {}, false],
    [{ talentsNone: ["T_C"] }, { talents: [] }, true],
    [{ flavors: ["F_X", "F_Y"] }, {}, true],
    [{ flavors: ["F_Y"] }, {}, false],
    [{ flavors: ["F_X"] }, { flavor: null }, false],
    [{ flavors: ["F_X"] }, { flavor: undefined }, false],
    [{ earlies: ["E_X"] }, {}, false], // 毕业结局没有中途结局
    [{ earlies: ["E_X"] }, { early: "E_X" }, true],
    [{ earlies: ["E_X"] }, { early: undefined }, false],
    [{ routes: ["LOCAL_JOB"] }, {}, true],
    [{ routes: ["PHD"] }, {}, false],
    [{ routes: ["LOCAL_JOB"] }, { route: null }, false], // 中途结局没有去向
    [{ degrees: ["UG"] }, {}, true],
    [{ degrees: ["MS"] }, {}, false],
    [{ degrees: ["UG"] }, { degree: undefined }, false],
    [{ economies: ["MID", "HIGH"] }, {}, true],
    [{ economies: ["LOW"] }, {}, false],
    [{ economies: ["MID"] }, { economy: undefined }, false],
  ];

  it("每个键的正反用例；缺信息时带 None 的视为满足，其余视为不满足", () => {
    for (const [when, patch, expected] of cases) {
      expect(conditionMet(when, { ...base, ...patch }), `${JSON.stringify(when)} / ${JSON.stringify(patch)}`).toBe(expected);
    }
  });

  it("通用构造：按 when 构造的上下文满足；只改一项就不满足（覆盖全部新键）", () => {
    const when: EndingCondition = {
      focusAny: ["CAMPUS"], tracks: ["HOME_JOB"], yearMin: 2, yearMax: 4, lifeFlagsAll: ["MARRIED"], lifeFlagsAny: ["KID", "PET"],
      lifeFlagsNone: ["BREAKUP"], talentsNone: ["T_NOPE"], flavors: ["F_A"], earlies: ["E_A"], routes: ["HOME_JOB"],
      degrees: ["MS"], economies: ["LOW"],
    };
    expect(conditionMet(when, satisfying(when))).toBe(true);
    const items = violations(when);
    expect(items.length).toBeGreaterThan(20);
    for (const item of items) expect(conditionMet(when, item.context), item.label).toBe(false);
  });

  it("不认识的键照样报错", () => {
    expect(() => conditionMet({ yearMinn: 1 } as unknown as EndingCondition, base)).toThrow("UNKNOWN_CONDITION_KEY");
  });

  it("内容里第四版各处的条件只用认识的键（暑假、日常、毕业后的各轨道与公共内容）", () => {
    const conditions: Array<[string, EndingCondition]> = [
      ...SUMMERS.map((item): [string, EndingCondition] => [item.id, item.when]),
      ...DAILY_LINES.map((item): [string, EndingCondition] => [item.id, item.when]),
    ];
    for (const track of LIFE_TRACK_ORDER) {
      const content = LIFE_TRACKS[track];
      for (const item of [...content.milestones, ...content.events, ...content.outcomes]) conditions.push([item.id, item.when]);
    }
    for (const [id, when] of conditions) expect(() => conditionMet(when, satisfying({})), id).not.toThrow();
  });
});

// ---------- 突发小事、暑假（§2.1–2.2） ----------

describe("开学与期中的突发小事（24 §2.1）", () => {
  it("合成池：期中 45%，用自己的 key；条件按当时的上下文判断；带条件的条目没给上下文就不算候选", () => {
    const pool = [
      { id: "A1", scope: "ANY" as const, text: "a", effects: S(1) },
      { id: "C1", scope: "ANY" as const, text: "c", effects: S(0, 1), when: { focusAny: ["STUDY"] } as EndingCondition },
    ];
    let mid = 0;
    const total = 6000;
    const study = { ...satisfying({}), focus: "STUDY" as Focus };
    const rest = { ...satisfying({}), focus: "REST" as Focus };
    for (let seed = 0; seed < total; seed++) {
      const roll = draw01(seed, "happening:mid:roll:UG:3");
      const pick = (items: typeof pool) => items[Math.floor(draw01(seed, "happening:mid:pick:UG:3") * items.length)].id;
      expect(rollHappening(seed, "UG", 3, pool, [], { mid: true, context: study })?.id ?? null).toBe(roll < 0.45 ? pick(pool) : null);
      expect(rollHappening(seed, "UG", 3, pool, [], { mid: true, context: rest })?.id ?? null).toBe(roll < 0.45 ? "A1" : null);
      expect(rollHappening(seed, "UG", 3, pool, [], { mid: true })?.id ?? null).toBe(roll < 0.45 ? "A1" : null);
      if (roll < 0.45) mid += 1;
    }
    expect(Math.abs(mid / total - 0.45)).toBeLessThan(0.02);
  });

  it("经典模式没有期中小事、暑假、毕业后的五年", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const end = asActive(play(startClassic(seed, "MID"), classicPolicy({ focus: "STUDY", event: "A" })).state);
      expect(end.history.some((entry) => entry.kind === "HAPPENING" || entry.kind === "SUMMER" || entry.stage === "LIFE")).toBe(false);
      expect(end.life).toBeUndefined();
      expect(end).toMatchObject({ phase: "ENDING", stage: "UG" });
      expect(termGpas(end)).toEqual([]);
      expect(dailyPicksFor(end)).toEqual([]);
    }
  });
});

/** docs/24 §2.2 的暑假抽取，按发生那一刻的上下文原样写。 */
function referenceSummer(run: ActiveRun, index: number, slot: "DEPARTURE" | "UG" | "MS", keyStage: string, term: number, used: string[]): SummerEvent[] {
  // index：暑假之前最后一条历史（期末的基础成长；出国前是 HS_02 那张事件）
  const conditionStage: Degree = slot === "MS" ? "MS" : "UG";
  const focus = slot === "DEPARTURE" ? null : (run.history.find((entry) => entry.kind === "FOCUS" && entry.stage === keyStage && entry.termIndex === term)?.focus ?? null);
  const picks: SummerEvent[] = [];
  let cursor = index;
  for (let k = 0; k < 2; k++) {
    if (k > 0 && !(draw01(run.seed, `summer:roll:${keyStage}:${term}:1`) < (slot === "DEPARTURE" ? 0.6 : 0.4))) break;
    const context = contextAt(run, cursor, conditionStage, term, focus);
    const candidates = SUMMERS.filter((item) => item.slot === slot && !used.includes(item.id) && conditionMet(item.when, context));
    const total = candidates.reduce((sum, item) => sum + item.weight, 0);
    const r = draw01(run.seed, `summer:pick:${keyStage}:${term}:${k}`) * total;
    let cumulative = 0;
    const picked = candidates.find((item) => (cumulative += item.weight) > r) ?? candidates[candidates.length - 1];
    if (!picked) break;
    picks.push(picked);
    used.push(picked.id);
    cursor += 1;
  }
  return picks;
}

describe("暑假（24 §2.2）", () => {
  it("出国前、大一下／大二下／大三下之后、两年制硕一下之后；记在刚结束的学期；与按当时状态重算的一致；不检查中途结局", () => {
    let summers = 0;
    let departures = 0;
    for (const seed of range(1, 300)) {
      const { state: run } = auto(seed);
      const used: string[] = [];
      for (const [index, entry] of run.history.entries()) {
        const next = run.history[index + 1];
        const departure = entry.kind === "EVENT" && entry.eventId === "HS_02";
        const termEnd = entry.kind === "GROWTH" && (entry.stage === "UG" || entry.stage === "MS");
        if (!departure && !termEnd) continue;
        let slot: "DEPARTURE" | "UG" | "MS" | null = null;
        if (departure) slot = "DEPARTURE";
        else if (entry.stage === "UG" && [2, 4, 6].includes(entry.termIndex)) slot = "UG";
        else if (entry.stage === "MS" && run.mastersYears === 2 && entry.termIndex === 2) slot = "MS";
        // 中途结局所在的那个学期之后没有暑假
        const leftHere = run.ending?.kind === "EARLY" && termEnd && entry.stage === run.ending.degree && entry.termIndex === lastTermOf(run, run.ending.degree);
        const actual = run.history.slice(index + 1).filter((item, i, rest) => item.kind === "SUMMER" && rest.slice(0, i).every((before) => before.kind === "SUMMER"));
        if (!slot || leftHere) {
          expect(next?.kind === "SUMMER", `seed ${seed} ${entry.stage}:${entry.termIndex}`).toBe(false);
          continue;
        }
        const keyStage = slot === "DEPARTURE" ? "HS" : entry.stage;
        const term = slot === "DEPARTURE" ? 0 : entry.termIndex;
        const expected = referenceSummer(run, index, slot, keyStage, term, used);
        expect(actual.map((item) => item.summerId), `seed ${seed} ${slot} ${term}`).toEqual(expected.map((item) => item.id));
        for (const [i, item] of actual.entries()) {
          expect(item).toMatchObject({ stage: keyStage, termIndex: term, requestedDelta: expected[i].effects });
        }
        summers += actual.length;
        if (slot === "DEPARTURE") departures += actual.length;
        // 暑假之后紧接着是下一学期的资助（出国前之后是大一上的资助）
        if (actual.length > 0) expect(run.history[index + 1 + actual.length]).toMatchObject({ kind: "STIPEND" });
      }
    }
    if (SUMMERS.some((item) => item.slot === "DEPARTURE" && Object.keys(item.when).length === 0)) expect(departures).toBeGreaterThan(250);
    expect(summers).toBeGreaterThan(0);
  });

  it("合成的权重：按数组顺序累加，取第一项累计值严格大于 r 的", () => {
    const items = [{ id: "a", w: 1 }, { id: "b", w: 3 }, { id: "c", w: 0 }];
    let a = 0;
    for (let seed = 0; seed < 8000; seed++) {
      const picked = pickWeighted(seed, "k", items, (item) => item.w);
      expect(picked?.id).toBe(draw01(seed, "k") * 4 < 1 ? "a" : "b");
      if (picked?.id === "a") a += 1;
    }
    expect(Math.abs(a / 8000 - 0.25)).toBeLessThan(0.015);
    expect(pickWeighted(1, "k", [], () => 1)).toBeNull();
  });
});

// ---------- 日常（§2.3） ----------

describe("日常（24 §2.3）", () => {
  const line = (id: string, slot: DailyLine["slot"], weight = 1, when: EndingCondition = {}): DailyLine => ({ id, slot, text: id, when, weight });

  it("只给结算完的学期；寒假只在下学期开头（70%）；每学期两条（任何学期的加上这个季节的）；一局之内不重复；可复现", () => {
    const pool = [
      line("W1", "WINTER"), line("W2", "WINTER"), line("F1", "FALL"), line("SP1", "SPRING"),
      ...range(1, 40).map((i) => line(`T${i}`, "TERM", 1 + (i % 3))),
    ];
    let winters = 0;
    let evenTerms = 0;
    for (const seed of range(1, 120)) {
      const { state: run } = auto(seed);
      const picks = dailyPicksFor(run, pool);
      expect(dailyPicksFor(run, pool)).toEqual(picks);
      const ids = picks.map((pick) => pick.line.id);
      expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
      const settled = run.history.filter((entry) => entry.kind === "GROWTH" && (entry.stage === "UG" || entry.stage === "MS"));
      let wintersLeft = pool.filter((item) => item.slot === "WINTER").length;
      for (const growth of settled) {
        const mine = picks.filter((pick) => pick.stage === growth.stage && pick.term === growth.termIndex);
        const season = growth.termIndex % 2 === 1 ? "FALL" : "SPRING";
        const winter = mine.filter((pick) => pick.slot === "WINTER");
        if (growth.termIndex % 2 === 0) {
          evenTerms += 1;
          // 70% 的学期有一条寒假；两条寒假都用过之后就没有了
          expect(winter.length > 0).toBe(draw01(run.seed, `daily:roll:${growth.stage}:${growth.termIndex}:winter`) < 0.7 && wintersLeft > 0);
          wintersLeft -= winter.length;
          winters += winter.length;
        } else {
          expect(winter).toEqual([]);
        }
        for (const pick of winter) expect(pick.line.slot).toBe("WINTER");
        const body = mine.filter((pick) => pick.slot !== "WINTER");
        expect(body.map((pick) => pick.slot)).toEqual([0, 1]); // 池子够大，每学期都有两条
        for (const pick of body) expect(["TERM", season]).toContain(pick.line.slot);
      }
      // 没结算完的学期没有日常
      expect(picks.length).toBeLessThanOrEqual(settled.length * 3);
    }
    expect(winters).toBeGreaterThan(0);
  });

  it("条件看学期末：本学期的安排、期末四属性；池子用完了就没有", () => {
    const pool = [line("STUDY_ONLY", "TERM", 10, { focusAny: ["STUDY"] }), line("RICH", "TERM", 10, { statMin: { money: 101 } }), line("ANY", "TERM", 1)];
    for (const seed of range(1, 80)) {
      const { state: run } = auto(seed);
      const picks = dailyPicksFor(run, pool);
      expect(picks.some((pick) => pick.line.id === "RICH")).toBe(false);
      const study = picks.find((pick) => pick.line.id === "STUDY_ONLY");
      if (study) expect(run.history.find((entry) => entry.kind === "FOCUS" && entry.stage === study.stage && entry.termIndex === study.term)?.focus).toBe("STUDY");
      expect(picks.length).toBeLessThanOrEqual(2); // 两条（不重复）用完就没了
    }
  });

  it("学期末的上下文：期末四属性、本学期的安排、到那时为止的安排次数与标记", () => {
    const { state: run } = auto(5);
    run.history.forEach((entry, index) => {
      if (entry.kind !== "GROWTH" || (entry.stage !== "UG" && entry.stage !== "MS")) return;
      const context = dailyContext(run, index);
      expect(context).toMatchObject({ stage: entry.stage, term: entry.termIndex, stats: entry.afterStats, economy: run.profile.economy });
      expect(context.focus).toBe(run.history.find((item) => item.kind === "FOCUS" && item.stage === entry.stage && item.termIndex === entry.termIndex)?.focus);
      const plans = run.history.slice(0, index + 1).filter((item) => item.kind === "FOCUS");
      expect(Object.values(context.counts).reduce((sum, n) => sum + n, 0)).toBe(plans.length);
      for (const flag of context.flags) {
        expect(run.history.slice(0, index + 1).some((item) => item.kind === "EVENT" && EVENT_BY_ID[item.eventId ?? ""]?.choices.find((choice) => choice.id === item.choiceId)?.setFlags.includes(flag))).toBe(true);
      }
    });
  });
});

// ---------- 期末 GPA（§2.4） ----------

describe("期末 GPA（24 §2.4）", () => {
  // 文档的形状，常数取 constants.ts 里调过的值（§2.4 允许为了验收微调常数）
  const reference = (seed: number, stage: Degree, term: number, academics: number, wellbeing: number, focus: Focus | null, talent: number): number => {
    let gpa = GPA.BASE / 100 + (GPA.PER_ACADEMIC / 100) * academics + (focus ? GPA.FOCUS[focus] : 0) / 100 + talent / 100;
    if (wellbeing < 15) gpa += GPA.WELLBEING_CRASH / 100;
    else if (wellbeing < 30) gpa += GPA.WELLBEING_LOW / 100;
    gpa += (draw01(seed, `gpa:${stage}:${term}`) - 0.5) * (GPA.NOISE / 100);
    return Math.min(4, Math.max(0.8, Math.round(gpa * 100) / 100));
  };

  it("公式与文档的形状一致（容许浮点误差导致的 ±0.01）；结果在 0.80–4.00、两位小数", () => {
    let checked = 0;
    for (let seed = 0; seed < 400; seed++) {
      for (const academics of [0, 17, 50, 83, 100]) {
        for (const wellbeing of [0, 14, 15, 29, 30, 100]) {
          for (const focus of [...FOCUS_ORDER, null]) {
            const talent = (seed % 7) * 10 - 20;
            const value = termGpaHundredths(seed, "UG", 1 + (seed % 8), { academics, wellbeing }, focus, talent) / 100;
            const expected = reference(seed, "UG", 1 + (seed % 8), academics, wellbeing, focus, talent);
            expect(Math.abs(value - expected)).toBeLessThanOrEqual(0.0100001);
            expect(value).toBeGreaterThanOrEqual(0.8);
            expect(value).toBeLessThanOrEqual(4);
            expect(Math.round(value * 100)).toBeCloseTo(value * 100, 6);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50000);
    expect(GPA.MIN).toBe(80);
    expect(GPA.MAX).toBe(400);
    // 形状：学业越高越高、学习加分、打工扣分、身心太低扣分
    expect(GPA.PER_ACADEMIC).toBeGreaterThan(0);
    expect(GPA.FOCUS.STUDY).toBeGreaterThan(0);
    expect(GPA.FOCUS.WORK).toBeLessThan(0);
    expect(GPA.WELLBEING_CRASH).toBeLessThan(GPA.WELLBEING_LOW);
    expect(GPA.WELLBEING_LOW).toBeLessThan(0);
  });

  it("每个结算完的学期一个 GPA，用期末（基础成长之后）的学业与身心、本学期的安排与三张天赋", () => {
    for (const seed of range(1, 60)) {
      const { state: run } = auto(seed);
      const gpas = termGpas(run);
      const settled = run.history.filter((entry) => entry.kind === "GROWTH" && (entry.stage === "UG" || entry.stage === "MS"));
      expect(gpas.map((item) => `${item.stage}:${item.term}`)).toEqual(settled.map((entry) => `${entry.stage}:${entry.termIndex}`));
      const talent = totalsFor(run.profile.talents).gpa;
      for (const [i, item] of gpas.entries()) {
        const growth = settled[i];
        const focus = run.history.find((entry) => entry.kind === "FOCUS" && entry.stage === growth.stage && entry.termIndex === growth.termIndex)?.focus ?? null;
        expect(Math.round(item.gpa * 100)).toBe(termGpaHundredths(run.seed, item.stage, item.term, growth.afterStats, focus, talent));
      }
      const average = averageGpa(gpas);
      expect(average).toBe(Math.round(gpas.reduce((sum, item) => sum + Math.round(item.gpa * 100), 0) / gpas.length) / 100);
    }
    expect(averageGpa([])).toBeNull();
  });

  it("这一行的说法：按 min 从高到低取第一档 gpa ≥ min，挑一句，{gpa} 换成两位小数", () => {
    const bands: GpaBand[] = [
      { min: 3.7, texts: ["高 {gpa}。", "很高 {gpa}！"] },
      { min: 2, texts: ["中 {gpa}。"] },
      { min: 0, texts: ["低 {gpa}，{gpa}。"] },
    ];
    for (let seed = 0; seed < 300; seed++) {
      const high = gpaLineText(seed, { stage: "UG", term: 3, gpa: 3.7 }, bands);
      expect(high).toBe(bands[0].texts[pickIndex(seed, "gpa:text:UG:3", 2)].split("{gpa}").join("3.70"));
      expect(gpaLineText(seed, { stage: "MS", term: 1, gpa: 3.69 }, bands)).toBe("中 3.69。");
      expect(gpaLineText(seed, { stage: "MS", term: 1, gpa: 1.99 }, bands)).toBe("低 1.99，1.99。");
    }
    expect(gpaLineText(1, { stage: "UG", term: 1, gpa: 3 }, [])).toBe("期末 GPA 3.00。");
  });
});

// ---------- 毕业后的五年（§4） ----------

const plan = (focus: Focus, delta: Stats) => ({ focus, name: `重心${focus}`, delta });
const outcomeOf = (id: string, when: EndingCondition = {}, weight = 1, fallback = false): LifeOutcome => ({
  id, name: id, roast: "。", text: "。", hint: "。", grade: "N", when, weight, ...(fallback ? { fallback: true } : {}),
});
function track(id: LifeTrack, extra: Partial<LifeTrackContent> = {}): LifeTrackContent {
  return {
    track: id,
    name: `轨道${id}`,
    base: { delta: S(2, 1, 1, -2), texts: ["第一句。", "第二句。", "第三句。"] },
    plans: FOCUS_ORDER.map((focus, i) => plan(focus, S(i - 1, 2 - i, i % 2, 3 - i))),
    milestones: [],
    events: [],
    outcomes: [outcomeOf(`LO_${id}_FALLBACK`, {}, 2, true)],
    ...extra,
  };
}
const milestone = (id: string, chancePermille: number, extra: Partial<LifeEvent> = {}): LifeEvent => ({ id, text: id, delta: S(1, 0, 0, 1), when: {}, chancePermille, ...extra });
const event = (id: string, weight: number, extra: Partial<LifeEvent> = {}): LifeEvent => ({ id, text: id, delta: S(0, 1, 1, 0), when: {}, weight, ...extra });
function contentWith(tracks: Partial<Record<LifeTrack, LifeTrackContent>>, common: Partial<LifeCommonContent> = {}): LifeContent {
  return {
    tracks: Object.fromEntries(LIFE_TRACK_ORDER.map((id) => [id, tracks[id] ?? track(id)])) as Record<LifeTrack, LifeTrackContent>,
    common: { track: "COMMON", milestones: [], events: [], ...common },
  };
}

/** docs/24 §4.2 的一年，照伪代码原样写（只依赖条件求值与 lifeContext 这个上下文构造）。 */
function referenceYear(run: ActiveRun, focus: Focus, lifeGrowth: Stats, content: LifeContent): ActiveRun {
  const draft = clone(run);
  const life = draft.life;
  if (!life) throw new Error("没有离校");
  const year = life.year + 1;
  draft.termIndex = year;
  const T = life.track;
  const C = content.tracks[T];
  const K = content.common;
  const add = (kind: HistoryEntry["kind"], delta: Stats, extra: Partial<HistoryEntry>) => {
    const before = { ...draft.stats };
    const after = Object.fromEntries(STATS.map((key) => [key, clampStat(before[key] + delta[key])])) as unknown as Stats;
    const applied = Object.fromEntries(STATS.map((key) => [key, after[key] - before[key]])) as unknown as Stats;
    draft.history.push({ kind, stage: "LIFE", termIndex: year, revision: run.revision, actionId: "test", beforeStats: before, requestedDelta: { ...delta }, appliedDelta: applied, afterStats: { ...after }, ...extra });
    draft.stats = after;
  };
  const seen = (id: string) => draft.history.some((entry) => entry.kind === "LIFE_EVENT" && entry.lifeEventId === id);
  // 1
  const used = draft.history.filter((entry) => entry.kind === "LIFE_BASE" && entry.track === T).map((entry) => entry.textIndex);
  let candidates = C.base.texts.map((_, i) => i).filter((i) => !used.includes(i));
  if (candidates.length === 0) candidates = C.base.texts.map((_, i) => i);
  const textIndex = candidates[Math.floor(draw01(draft.seed, `life:base:${year}`) * candidates.length)];
  add("LIFE_BASE", Object.fromEntries(STATS.map((key) => [key, C.base.delta[key] + lifeGrowth[key]])) as unknown as Stats, { track: T, textIndex });
  // 2
  const chosen = C.plans.find((item) => item.focus === focus);
  if (!chosen) throw new Error("缺重心");
  add("LIFE_PLAN", chosen.delta, { focus, track: T });
  life.focusCounts[focus] += 1;
  // 3
  let next: LifeTrack | null = null;
  const happen = (item: LifeEvent, isMilestone: boolean) => {
    add("LIFE_EVENT", item.delta, { track: T, lifeEventId: item.id, milestone: isMilestone });
    for (const flag of item.setFlags ?? []) if (!life.flags.includes(flag)) life.flags.push(flag);
    if (item.setTrack) next = item.setTrack;
  };
  let count = 0;
  for (const item of [...C.milestones, ...K.milestones]) {
    if (count >= 3) break;
    if (!item.repeatable && seen(item.id)) continue;
    if (!conditionMet(item.when, lifeContext(draft, year))) continue;
    if (!(draw01(draft.seed, `life:ms:${item.id}:${year}`) < (item.chancePermille ?? 0) / 1000)) continue;
    happen(item, true);
    count += 1;
  }
  // 4
  const n = 1 + (draw01(draft.seed, `life:ev:roll:${year}`) < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const pool = [...C.events, ...K.events].filter((item) => !seen(item.id) && conditionMet(item.when, lifeContext(draft, year)));
    if (pool.length === 0) continue;
    const total = pool.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    const r = draw01(draft.seed, `life:ev:pick:${year}:${k}`) * total;
    let cumulative = 0;
    happen(pool.find((item) => (cumulative += item.weight ?? 1) > r) ?? pool[pool.length - 1], false);
  }
  // 5
  life.year = year;
  const switched = next as LifeTrack | null;
  if (switched && switched !== T) {
    life.track = switched;
    life.tracks.push(switched);
  }
  // 6
  if (year === 5) {
    const outcomes = content.tracks[life.track].outcomes.filter((item) => conditionMet(item.when, lifeContext(draft, year)));
    const total = outcomes.reduce((sum, item) => sum + item.weight, 0);
    const r = draw01(draft.seed, "life:outcome") * total;
    let cumulative = 0;
    const picked = outcomes.find((item) => (cumulative += item.weight) > r) ?? outcomes[outcomes.length - 1];
    life.outcome = { id: picked.id, track: life.track };
    draft.phase = "ENDING";
  }
  return draft;
}

describe("毕业（离校）后的五年：每一年（24 §4.2）", () => {
  const LIFE_BASE_STATE = atLife(7);
  const START: LifeTrack = LIFE_BASE_STATE.life?.track ?? "LOCAL_JOB";
  const OTHER: LifeTrack = LIFE_TRACK_ORDER.find((id) => id !== START) ?? "PHD";
  const growth = S(1, 0, 2, -1);

  // 一套会用到每一条规则的合成内容：条件、可重复的抽签、每年最多三件、换轨、按权重抽小事、按条件挑结局
  const content = contentWith(
    {
      [START]: track(START, {
        milestones: [
          milestone("LM_LOTTERY", 400, { repeatable: true, setFlags: ["H1B"] }),
          milestone("LM_SECOND_YEAR", 900, { when: { yearMin: 2, yearMax: 3 } }),
          milestone("LM_AFTER_H1B", 700, { when: { lifeFlagsAll: ["H1B"] }, setFlags: ["GREEN_CARD"] }),
          milestone("LM_NO_FLAG", 600, { when: { lifeFlagsNone: ["H1B"] }, setFlags: ["H1B_OUT"] }),
          milestone("LM_SWITCH", 250, { when: { yearMin: 2 }, setTrack: OTHER, setFlags: ["RETURNED"] }),
        ],
        events: [event("LE_A", 5), event("LE_B", 1, { when: { yearMin: 3 } }), event("LE_C", 3, { setFlags: ["DATING"] }), event("LE_D", 2, { when: { lifeFlagsAny: ["DATING"] } })],
        outcomes: [outcomeOf("LO_X_FALLBACK", {}, 3, true), outcomeOf("LO_X_CARD", { lifeFlagsAll: ["GREEN_CARD"] }, 5), outcomeOf("LO_X_LATE", { yearMin: 6 }, 9)],
      }),
      [OTHER]: track(OTHER, {
        milestones: [milestone("LM_OTHER_CIVIL", 500, { setFlags: ["CIVIL_SERVANT"] }), milestone("LM_OTHER_BACK", 150, { setTrack: START })],
        events: [event("LE_OTHER_1", 2), event("LE_OTHER_2", 2, { when: { tracks: [OTHER] } })],
        outcomes: [outcomeOf("LO_OTHER_FALLBACK", {}, 3, true), outcomeOf("LO_OTHER_CIVIL", { lifeFlagsAll: ["CIVIL_SERVANT"] }, 6)],
      }),
    },
    {
      milestones: [milestone("LM_COMMON_DATE", 500, { setFlags: ["DATING"] }), milestone("LM_COMMON_RARE", 30), milestone("LM_COMMON_ALWAYS", 1000)],
      events: [event("LE_COMMON_1", 1), event("LE_COMMON_2", 4), event("LE_COMMON_3", 2, { when: { talentsNone: ["T_NOPE"] } })],
    },
  );

  it("合成内容：五年里每一年的记录、标记、换轨与五年后的结局都与伪代码一致", () => {
    let switches = 0;
    let capped = 0;
    let repeated = 0;
    for (const seed of range(1, 600)) {
      let engine = clone(LIFE_BASE_STATE);
      engine.seed = seed;
      let reference = clone(engine);
      for (let year = 1; year <= LIFE_YEARS; year++) {
        const focus = FOCUS_ORDER[(seed + year) % 5];
        const next = clone(engine);
        liveYear(next, focus, { lifeGrowth: growth }, { revision: engine.revision, actionId: "test" }, content);
        reference = referenceYear(reference, focus, growth, content);
        expect(next, `seed ${seed} 第 ${year} 年`).toEqual(reference);
        const thisYear = next.history.filter((entry) => entry.stage === "LIFE" && entry.termIndex === year);
        const milestones = thisYear.filter((entry) => entry.milestone);
        expect(milestones.length).toBeLessThanOrEqual(3);
        if (milestones.length === 3) capped += 1;
        engine = next;
      }
      const life = engine.life;
      if (!life?.outcome) throw new Error("第五年之后应当有结局");
      expect(engine.phase).toBe("ENDING");
      expect(life.year).toBe(5);
      expect(life.tracks[life.tracks.length - 1]).toBe(life.track);
      if (life.tracks.length > 1) switches += 1;
      if (engine.history.filter((entry) => entry.lifeEventId === "LM_LOTTERY").length > 1) repeated += 1;
      // 不可重复的里程碑与生活小事一局最多一次
      const ids = engine.history.filter((entry) => entry.kind === "LIFE_EVENT" && entry.lifeEventId !== "LM_LOTTERY").map((entry) => entry.lifeEventId);
      expect(new Set(ids).size).toBe(ids.length);
      // 结局在最后的轨道上，条件满足
      expect(content.tracks[life.track].outcomes.some((item) => item.id === life.outcome?.id)).toBe(true);
    }
    // 规则真的被走到了：换轨、每年三件的上限、可重复的抽签
    expect(switches).toBeGreaterThan(50);
    expect(capped).toBeGreaterThan(50);
    expect(repeated).toBeGreaterThan(50);
  });

  it("基础那一句：这条轨道上没用过的里挑，用完了再全部重来；天赋的 lifeGrowth 加在基础变化上", () => {
    const small = contentWith({ [START]: track(START, { base: { delta: S(1, 1, 1, 1), texts: ["甲。", "乙。"] } }) });
    for (const seed of range(1, 100)) {
      let run = clone(LIFE_BASE_STATE);
      run.seed = seed;
      for (let year = 1; year <= 5; year++) {
        const next = clone(run);
        liveYear(next, "REST", { lifeGrowth: S(3, -1, 0, 2) }, { revision: 0, actionId: "t" }, small);
        run = next;
      }
      const bases = run.history.filter((entry) => entry.kind === "LIFE_BASE");
      expect(bases).toHaveLength(5);
      expect(new Set(bases.slice(0, 2).map((entry) => entry.textIndex)).size).toBe(2); // 前两年两句都用上
      // 用完了之后每年都在全部的句子里挑
      for (const entry of bases.slice(2)) expect(entry.textIndex).toBe(pickIndex(seed, `life:base:${entry.termIndex}`, 2));
      for (const entry of bases) expect(entry.requestedDelta).toEqual(S(4, 0, 1, 3));
    }
  });

  it("第五年挑不出结局（内容缺兜底）、内容缺这一类重心属于内容错误，直接报错", () => {
    const run = clone(LIFE_BASE_STATE);
    const start = run.life?.track ?? "LOCAL_JOB";
    const broken = contentWith({ [start]: track(start, { outcomes: [outcomeOf("LO_ONLY_LATE", { yearMin: 6 })] }) });
    let state = clone(run);
    for (let year = 1; year <= 4; year++) liveYear(state, "REST", { lifeGrowth: S() }, { revision: 0, actionId: "t" }, broken);
    expect(() => liveYear(state, "REST", { lifeGrowth: S() }, { revision: 0, actionId: "t" }, broken)).toThrow("LIFE_OUTCOME_MISSING");
    state = clone(run);
    const noPlan = contentWith({ [start]: track(start, { plans: [] }) });
    expect(() => liveYear(state, "WORK", { lifeGrowth: S() }, { revision: 0, actionId: "t" }, noPlan)).toThrow("LIFE_PLAN_MISSING");
  });

  it("毕业后的上下文（§6）：离校时的学段与学期、此刻的四属性、在校期间的安排次数、轨道、年份、人生标记、当年的结局", () => {
    for (const seed of [3, 7, 11, 19, 23, 29]) {
      const run = atLife(seed);
      const ending = run.ending;
      if (!ending || !run.life) throw new Error("没有离校");
      run.life.flags = ["H1B"];
      const context = lifeContext(run, 2);
      expect(context).toMatchObject({
        stage: ending.degree, term: lastTermOf(run, ending.degree), stats: run.stats, counts: run.focusCounts, track: run.life.track,
        year: 2, lifeFlags: ["H1B"], flavor: ending.card.flavor?.id ?? null, early: ending.early, route: ending.route, degree: ending.degree,
        transitionMode: ending.transitionMode, tier: ending.card.tier, economy: run.profile.economy, focus: null,
      });
    }
  });
});

describe("毕业后的五年：整局（24 §4、§13）", () => {
  it("毕业或中途结局之后都进入 LIFE；五个 LIVE_YEAR 之后 ENDING；年龄、轨道与结局都对得上", () => {
    const kinds = new Set<string>();
    for (const seed of range(1, 250)) {
      const { state: run, log } = auto(seed);
      const ending = run.ending;
      const life = run.life;
      if (!ending || !life?.outcome) throw new Error(`seed ${seed} 没有走完五年`);
      kinds.add(ending.kind);
      expect(run).toMatchObject({ phase: "ENDING", stage: "LIFE", termIndex: 5 });
      expect(log.slice(-5).map((action) => action.type)).toEqual(["LIVE_YEAR", "LIVE_YEAR", "LIVE_YEAR", "LIVE_YEAR", "LIVE_YEAR"]);
      expect(log.filter((action) => action.type === "LIVE_YEAR")).toHaveLength(5);
      const first = ending.kind === "EARLY" ? (EARLY_LIFE_TRACK(ending.early) ?? "DROPOUT") : ending.route;
      expect(life.tracks[0]).toBe(first);
      expect(life.year).toBe(5);
      expect(Object.values(life.focusCounts).reduce((sum, n) => sum + n, 0)).toBe(5);
      const left = lastTermOf(run, ending.degree);
      const age = ending.kind === "EARLY" ? (ending.degree === "UG" ? 18 : 22) + Math.floor((left - 1) / 2) : ending.degree === "UG" ? 22 : 22 + (run.mastersYears ?? 0);
      expect(life.startAge).toBe(age);
      // 每年：基础、重心、0–3 件里程碑、0–2 件生活小事
      for (let year = 1; year <= 5; year++) {
        const entries = run.history.filter((entry) => entry.stage === "LIFE" && entry.termIndex === year);
        expect(entries.slice(0, 2).map((entry) => entry.kind)).toEqual(["LIFE_BASE", "LIFE_PLAN"]);
        const events = entries.slice(2);
        expect(events.every((entry) => entry.kind === "LIFE_EVENT")).toBe(true);
        expect(events.filter((entry) => entry.milestone).length).toBeLessThanOrEqual(3);
        expect(events.filter((entry) => !entry.milestone).length).toBeLessThanOrEqual(2);
        const focus = entries[1].focus;
        expect((log.filter((action) => action.type === "LIVE_YEAR")[year - 1] as { focus: Focus }).focus).toBe(focus);
      }
      // 离校之后的记录都在 LIFE 学段；结局卡与离校那一刻一样
      const exit = run.history.findIndex((entry) => entry.stage === "LIFE");
      expect(run.history.slice(exit).every((entry) => entry.stage === "LIFE")).toBe(true);
      expect(life.startStats).toEqual(run.history[exit].beforeStats);
      // 五年后的结局在最后的轨道上，条件满足
      const outcome = LIFE_TRACKS[life.track].outcomes.find((item) => item.id === life.outcome?.id);
      expect(outcome, `seed ${seed}`).toBeDefined();
      expect(life.outcome.track).toBe(life.track);
    }
    expect([...kinds].sort()).toEqual(["EARLY", "GRADUATION"]);
  });

  it("LIVE_YEAR 只在 LIFE 阶段合法；重心必须是五类之一；结局之后不再接受", () => {
    const { setup, input } = autoInput(4);
    const early = act(setup, { type: "CONFIRM_SETUP", ...input });
    const wrong = tryAct(early, { type: "LIVE_YEAR", focus: "REST" });
    expect(wrong.ok ? "OK" : wrong.error.code).toBe("WRONG_PHASE");
    const life = atLife(4);
    const bad = tryAct(life, { type: "LIVE_YEAR", focus: "SLEEP" as Focus });
    expect(bad.ok ? "OK" : bad.error.code).toBe("INVALID_ACTION");
    expect(bad.state).toBe(life);
    for (const action of [{ type: "CHOOSE_PLAN", planId: "REST" }, { type: "REVEAL_GRADUATION" }, { type: "CHOOSE_ROUTE", route: "TRANSITION" }] as const) {
      const result = tryAct(life, action);
      expect(result.ok ? "OK" : result.error.code).toBe("WRONG_PHASE");
    }
    const { state: end } = auto(4);
    const after = tryAct(end, { type: "LIVE_YEAR", focus: "REST" });
    expect(after.ok ? "OK" : after.error.code).toBe("WRONG_PHASE");
    // 阶段标题
    expect(stageInfo(life)).toMatchObject({ stage: "LIFE", termIndex: 0, termCount: 5, step: "第 1 / 5 年" });
    expect(termLedger(life)).toBeNull();
  });

  it("每年的重心与文档的权重一致（24 §4.3）", () => {
    const weight = (focus: Focus, p: { family: number; academics: number; career: number; wellbeing: number }, money: number, wellbeing: number) => {
      if (focus === "STUDY") return 2 + p.academics / 2;
      if (focus === "CAREER") return 2 + p.career / 2;
      if (focus === "CAMPUS") return 2 + p.wellbeing / 2;
      if (focus === "WORK") return 1 + (10 - p.family) / 4 + (money < 20 ? 10 : 0) + (money < 10 ? 10 : 0);
      return 1 + (wellbeing < 25 ? 8 : wellbeing < 45 ? 3 : 0);
    };
    let checked = 0;
    for (const seed of range(1, 150)) {
      const { setup, input } = autoInput(seed);
      simulateObserved(setup, input, ctx, (before, action) => {
        if (before.phase !== "LIFE" || action.type !== "LIVE_YEAR") return;
        const p = before.profile.points;
        if (!p) throw new Error("没有点数");
        const weights = FOCUS_ORDER.map((focus) => weight(focus, p, before.stats.money, before.stats.wellbeing));
        for (const [i, focus] of FOCUS_ORDER.entries()) expect(lifeFocusWeight(focus, p, before.stats.money, before.stats.wellbeing)).toBe(weights[i]);
        const year = (before.life?.year ?? 0) + 1;
        const r = draw01(before.seed, `auto:life:${year}`) * weights.reduce((sum, w) => sum + w, 0);
        let cumulative = 0;
        const expected = FOCUS_ORDER.find((_, i) => (cumulative += weights[i]) > r) ?? "REST";
        expect(action.focus).toBe(expected);
        checked += 1;
      });
    }
    expect(checked).toBe(150 * 5);
  });
});

// ---------- 存档、重放、确定性 ----------

describe("毕业后的五年：存档与重放（24 §13）", () => {
  it("同样的输入得到同样的一生（含五年）；每一步的存档都能读回；从 seed 重放得到同一局", () => {
    for (const seed of range(40, 30)) {
      const { setup, input } = autoInput(seed);
      const first = simulate(setup, input, ctx);
      expect(simulate(setup, input, ctx)).toEqual(first);
      expect(replay({ seed, runId: setup.runId, log: first.log }, ctx)).toEqual(first.state);
      const states: Array<{ state: RunState; log: typeof first.log }> = [];
      for (let i = 0; i <= first.log.length; i++) {
        const state = replay({ seed, runId: setup.runId, log: first.log.slice(0, i) }, ctx);
        if (state.phase === "LIFE" || state.phase === "ENDING") states.push({ state, log: first.log.slice(0, i) });
      }
      expect(states).toHaveLength(6); // 刚离校 + 五年
      for (const { state, log } of states) {
        const loaded = loadSave(serializeSave(state, log), ctx);
        expect(loaded.ok, `seed ${seed} revision ${state.revision}`).toBe(true);
      }
    }
  });

  it("改了毕业后的记录会被发现", () => {
    const { state, log } = auto(12);
    const text = serializeSave(state, log);
    const tamper = (edit: (envelope: SaveEnvelope) => void): string => {
      const envelope = JSON.parse(text) as SaveEnvelope;
      edit(envelope);
      return JSON.stringify(envelope);
    };
    const lifeOf = (envelope: SaveEnvelope) => {
      const life = asActive(envelope.state).life;
      if (!life) throw new Error("没有离校");
      return life;
    };
    const otherTrack = (current: LifeTrack): LifeTrack => LIFE_TRACK_ORDER.find((item) => item !== current) ?? "PHD";
    for (const edit of [
      (e: SaveEnvelope) => { lifeOf(e).track = otherTrack(lifeOf(e).track); },
      (e: SaveEnvelope) => { lifeOf(e).tracks = [otherTrack(lifeOf(e).tracks[0]), ...lifeOf(e).tracks.slice(1)]; },
      (e: SaveEnvelope) => { lifeOf(e).year = 4; },
      (e: SaveEnvelope) => { lifeOf(e).flags = [...lifeOf(e).flags, "GREEN_CARD", "GREEN_CARD"]; },
      (e: SaveEnvelope) => { lifeOf(e).outcome = { id: "LO_NOT_AN_OUTCOME", track: lifeOf(e).track }; },
      (e: SaveEnvelope) => { lifeOf(e).outcome = null; },
      (e: SaveEnvelope) => { lifeOf(e).startStats.money = 101; },
      (e: SaveEnvelope) => { lifeOf(e).focusCounts.REST += 1; },
      (e: SaveEnvelope) => { lifeOf(e).startAge = 99; }, // 结构上合法，但重放的结果对不上
      (e: SaveEnvelope) => { asActive(e.state).stats.money = (asActive(e.state).stats.money + 7) % 100; },
      (e: SaveEnvelope) => { (asActive(e.state) as { phase: string }).phase = "LIFE"; },
      (e: SaveEnvelope) => { delete asActive(e.state).life; },
    ]) {
      const result = loadSave(tamper(edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("CORRUPT");
    }
  });
});

// ---------- 内容的通用检查（不依赖具体条目） ----------

describe("毕业后的内容（只检查引擎依赖的结构）", () => {
  it("每条轨道：五类重心各一张；恰好一条无条件的兜底结局；条目 id 不重复", () => {
    const ids = new Set<string>();
    for (const id of LIFE_TRACK_ORDER) {
      const content = LIFE_TRACKS[id];
      expect(content.track).toBe(id);
      expect(content.plans.map((item) => item.focus)).toEqual([...FOCUS_ORDER]);
      expect(content.base.texts.length, id).toBeGreaterThan(0);
      const fallbacks = content.outcomes.filter((item) => item.fallback);
      expect(fallbacks, id).toHaveLength(1);
      expect(Object.keys(fallbacks[0].when)).toEqual([]);
      for (const item of [...content.milestones, ...content.events, ...content.outcomes]) {
        expect(ids.has(item.id), item.id).toBe(false);
        ids.add(item.id);
      }
    }
  });
});
