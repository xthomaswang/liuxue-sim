// 第三版的自动决定、整局自动模拟、人生轨迹与总结（docs/22 §3、§5）。
// 每一种自动决定都对照按文档伪代码原样写的参考实现；轨迹与总结对照历史记录。

import { describe, expect, it } from "vitest";
import { EARLY_ENDINGS, TEXTS } from "../../content";
import { autoChoice, autoGraduation, autoPlan, planWeight } from "../auto";
import { MS_TERM_LABELS, UG_TERM_LABELS, UPKEEP_DEFAULT } from "../constants";
import {
  autoAction, currentEvent, focusView, loadSave, mastersOptions, replay, routeOptions, serializeSave, setupView,
  simulate, startPreview, summaryView, timeline,
} from "../index";
import type { Action, ActiveRun, ChoiceId, EventView, Focus, FocusView, Opportunity, Points, RunState } from "../index";
import { draw01, pickIndex } from "../rng";
import { totalsFor } from "../talents";
import { statRating } from "../timeline";
import {
  act, asActive, autoInput, classicPolicy, clone, ctx, play, scalePoints, simulateObserved, start, startClassic, tryAct,
} from "./helpers";

const P = (family: number, academics: number, career: number, wellbeing: number): Points => ({ family, academics, career, wellbeing });
const ZERO = P(0, 0, 0, 0);
const STATS = ["money", "academics", "career", "wellbeing"] as const;
type Visit = (before: ActiveRun, action: Action, after: ActiveRun) => void;
/** 自动走完 seeds 这些局，把确认开局之后的每一步交给 visit。 */
function forEachStep(seeds: number[], visit: Visit): void {
  for (const seed of seeds) {
    const { setup, input } = autoInput(seed);
    simulateObserved(setup, input, ctx, (before, action, after) => {
      if (before.phase !== "SETUP") visit(before, action, after);
    });
  }
}
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const upkeepOf = (run: ActiveRun): number => Math.max(0, UPKEEP_DEFAULT + totalsFor(run.profile.talents).upkeep);
const pointsOf = (run: ActiveRun): Points => {
  if (!run.profile.points) throw new Error("正式玩法的局应当有点数");
  return run.profile.points;
};

// ---------- 参考实现：docs/22 §3 的伪代码原样写 ----------

function referenceScores(run: ActiveRun, view: EventView): { a: number; b: number } {
  const p = pointsOf(run);
  const v = { money: 1 + (10 - p.family) / 5, academics: 1 + p.academics / 5, career: 1 + p.career / 5, wellbeing: 1 + (10 - p.wellbeing) / 5 };
  if (run.stage !== "HS" && run.stats.money < upkeepOf(run)) v.money += 3; // 高中事件没有必要开销
  if (run.stats.wellbeing < 30) v.wellbeing += 3;
  const score = (choice: EventView["choices"][number]) => STATS.reduce((sum, key) => sum + v[key] * choice.delta.applied[key], 0);
  return { a: score(view.choices[0]), b: score(view.choices[1]) };
}

function referenceChoice(run: ActiveRun, view: EventView): ChoiceId {
  const open = view.choices.filter((choice) => choice.available);
  if (open.length === 1) return open[0].choice.id;
  const { a, b } = referenceScores(run, view);
  const preferred: ChoiceId = b > a + 1e-9 ? "B" : "A"; // 相同取 A（浮点比较留一点余量）
  const other: ChoiceId = preferred === "A" ? "B" : "A";
  return draw01(run.seed, `auto:event:${view.event.id}`) < 0.7 ? preferred : other;
}

function referenceWeight(focus: Focus, run: ActiveRun): number {
  const p = pointsOf(run);
  if (focus === "STUDY") return 2 + p.academics / 2;
  if (focus === "CAREER") return 2 + p.career / 2;
  if (focus === "CAMPUS") return 2 + p.wellbeing / 2;
  if (focus === "WORK") {
    return 1 + (10 - p.family) / 4 + (run.stats.money < 2 * upkeepOf(run) ? 10 : 0) + (run.stats.money < upkeepOf(run) ? 10 : 0);
  }
  return 1 + (run.stats.wellbeing < 25 ? 8 : run.stats.wellbeing < 45 ? 3 : 0);
}

function referencePlan(run: ActiveRun, view: FocusView): string {
  const open = view.options.filter((option) => option.available);
  const weights = open.map((option) => referenceWeight(option.focus, run));
  const r = draw01(run.seed, `auto:plan:${run.stage}:${run.termIndex}`) * weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let i = 0; i < open.length; i++) {
    cumulative += weights[i];
    if (cumulative > r) return open[i].plan.id;
  }
  return open[open.length - 1].plan.id;
}

const ORDER: Record<string, Opportunity[]> = {
  DISCOVERY: ["PHD", "LOCAL_JOB", "HOME_JOB"],
  INDEPENDENCE: ["LOCAL_JOB", "HOME_JOB", "PHD"],
  BELONGING: ["HOME_JOB", "LOCAL_JOB", "PHD"],
};

function referenceGraduation(run: ActiveRun): Action {
  const degree = run.stage === "MS" ? "MS" : "UG";
  const outcomes = run.graduations[degree]?.outcomes;
  if (!outcomes) throw new Error("毕业结果还没揭晓");
  const order = ORDER[run.profile.aspiration];
  const offered = order.filter((key) => outcomes[key] === "OFFERED");
  // 读硕士的意愿：仅本科、且有可选的硕士方案时才考虑
  const programs = degree === "UG" ? mastersOptions(run).filter((option) => option.eligible).map((option) => option.program) : [];
  if (programs.length > 0) {
    const p = offered.length === 0 ? 0.75 : outcomes[order[0]] !== "OFFERED" ? 0.35 : 0;
    if (draw01(run.seed, "auto:masters") < p) {
      if (programs.length === 1) return { type: "ENTER_MASTERS", program: programs[0] };
      return { type: "ENTER_MASTERS", program: draw01(run.seed, "auto:masters:years") < 0.5 ? "MS_1Y" : "MS_2Y" };
    }
  }
  if (offered.length > 0) {
    return draw01(run.seed, `auto:route:${degree}`) < 0.06 ? { type: "CHOOSE_ROUTE", route: "TRANSITION" } : { type: "CHOOSE_ROUTE", route: offered[0] };
  }
  return { type: "CHOOSE_ROUTE", route: "TRANSITION" };
}

const isEvent = (run: ActiveRun): boolean => run.phase === "HIGH_SCHOOL_EVENT" || run.phase === "CORE_EVENT" || run.phase === "ARC_EVENT";

describe("自动决定：事件选项（22 §3.1）", () => {
  it("每一张事件的选择都与参考实现一致；两项都能选时约七成取更合意的那项", () => {
    let both = 0;
    let preferredTaken = 0;
    let forced = 0;
    let broke = 0;
    let exhausted = 0;
    let highSchool = 0;
    forEachStep(range(1, 700), (before, action) => {
      if (!isEvent(before)) return;
      const view = currentEvent(before);
      if (!view || action.type !== "CHOOSE_EVENT") throw new Error("事件阶段应当给出事件选择");
      expect(action.eventId).toBe(view.event.id);
      expect(action.choiceId, `seed ${before.seed} ${view.event.id}`).toBe(referenceChoice(before, view));
      expect(view.choices.find((choice) => choice.choice.id === action.choiceId)?.available).toBe(true);
      if (before.stage === "HS") highSchool += 1;
      else if (before.stats.money < upkeepOf(before)) broke += 1;
      if (before.stats.wellbeing < 30) exhausted += 1;
      if (view.choices.every((choice) => choice.available)) {
        both += 1;
        const { a, b } = referenceScores(before, view);
        if (action.choiceId === (b > a + 1e-9 ? "B" : "A")) preferredTaken += 1;
      } else {
        forced += 1;
      }
    });
    expect(both).toBeGreaterThan(5000);
    expect(Math.abs(preferredTaken / both - 0.7)).toBeLessThan(0.02);
    // 样本里确实出现了文档里的每一种情形：买不起只能选另一项、手头紧、很累、高中事件
    for (const count of [forced, broke, exhausted, highSchool]) expect(count).toBeGreaterThan(0);
  });

  it("得分相同取 A；在意程度随点数变：家境低更看重钱，身心点低更看重身心", () => {
    const { setup, input } = autoInput(11);
    const run = asActive(act(setup, { type: "CONFIRM_SETUP", ...input }));
    const real = currentEvent(run);
    if (!real) throw new Error("没有事件");
    const fake = (a: Partial<Record<(typeof STATS)[number], number>>, b: Partial<Record<(typeof STATS)[number], number>>): EventView => {
      const view = clone(real);
      for (const [index, delta] of [a, b].entries()) {
        const full = { money: 0, academics: 0, career: 0, wellbeing: 0, ...delta };
        view.choices[index].available = true;
        view.choices[index].delta = { requested: full, applied: full };
      }
      return view;
    };
    const withPoints = (points: Points): ActiveRun => ({ ...run, stats: { ...run.stats, wellbeing: 60 }, profile: { ...run.profile, points } });
    const preferred = (state: ActiveRun, view: EventView): ChoiceId => {
      const picked = autoChoice(state, view);
      const followed = draw01(state.seed, `auto:event:${view.event.id}`) < 0.7;
      return followed ? picked : picked === "A" ? "B" : "A";
    };
    const even = withPoints(P(5, 5, 5, 5));
    expect(preferred(even, fake({ academics: 4 }, { academics: 4 }))).toBe("A");
    expect(preferred(even, fake({ academics: 3 }, { career: 3 }))).toBe("A"); // 学业与职业点数相同，得分相同
    expect(preferred(even, fake({ academics: 3 }, { career: 4 }))).toBe("B");
    // 家境 0：v.money = 3，学业 10：v.academics = 3 → 3 块钱与 3 点学业打平取 A；家境 10 时钱只值 1
    expect(preferred(withPoints(P(0, 10, 5, 5)), fake({ money: 3 }, { academics: 3 }))).toBe("A");
    expect(preferred(withPoints(P(10, 10, 0, 0)), fake({ money: 3 }, { academics: 2 }))).toBe("B");
    expect(preferred(withPoints(P(0, 0, 10, 10)), fake({ money: 3 }, { academics: 4 }))).toBe("A");
    // 身心 < 30 时身心再加 3：身心点 10（v = 1）时 1 点身心不如 1 点学业（v = 2），累了之后（v = 4）反过来
    const fresh = withPoints(P(5, 5, 0, 10));
    const tired = { ...fresh, stats: { ...fresh.stats, wellbeing: 29 } };
    const barely = { ...fresh, stats: { ...fresh.stats, wellbeing: 30 } };
    expect(preferred(fresh, fake({ academics: 1 }, { wellbeing: 1 }))).toBe("A");
    expect(preferred(barely, fake({ academics: 1 }, { wellbeing: 1 }))).toBe("A");
    expect(preferred(tired, fake({ academics: 1 }, { wellbeing: 1 }))).toBe("B");
    expect(preferred(tired, fake({ academics: 2 }, { wellbeing: 1 }))).toBe("A"); // 4 对 4，相同取 A
    // 只有一项能选时就选它，不抽签
    const onlyB = fake({ academics: 9 }, { academics: 1 });
    onlyB.choices[0].available = false;
    expect(autoChoice(even, onlyB)).toBe("B");
  });
});

describe("自动决定：学期安排（22 §3.2）", () => {
  it("权重表：学习 2+a/2、求职 2+c/2、校园 2+w/2、打工 1+(10−f)/4（手头紧 +10、连这学期的开销都不够再 +10）、休息 1（累 +3、很累 +8）", () => {
    const p = P(2, 8, 6, 4);
    expect(planWeight("STUDY", p, 50, 60, 12)).toBe(6);
    expect(planWeight("CAREER", p, 50, 60, 12)).toBe(5);
    expect(planWeight("CAMPUS", p, 50, 60, 12)).toBe(4);
    expect(planWeight("CAMPUS", P(5, 5, 5, 0), 50, 60, 12)).toBe(2);
    expect(planWeight("CAMPUS", P(5, 5, 0, 10), 50, 60, 12)).toBe(7);
    expect(planWeight("WORK", p, 50, 60, 12)).toBe(3);
    expect(planWeight("WORK", p, 24, 60, 12)).toBe(3); // 资金恰好等于 2 × 开销：不算紧
    expect(planWeight("WORK", p, 23, 60, 12)).toBe(13);
    expect(planWeight("WORK", p, 12, 60, 12)).toBe(13); // 资金恰好等于开销：紧，但还没到付不起
    expect(planWeight("WORK", p, 11, 60, 12)).toBe(23);
    expect(planWeight("WORK", p, 0, 60, 12)).toBe(23);
    expect(planWeight("WORK", P(0, 8, 6, 6), 0, 60, 12)).toBe(23.5);
    expect(planWeight("WORK", P(10, 0, 0, 10), 50, 60, 12)).toBe(1);
    expect(planWeight("WORK", P(10, 0, 0, 10), 5, 60, 12)).toBe(21);
    expect(planWeight("WORK", p, 0, 60, 0)).toBe(3); // 没有必要开销（天赋减到 0）就谈不上紧
    expect(planWeight("REST", p, 50, 45, 12)).toBe(1);
    expect(planWeight("REST", p, 50, 44, 12)).toBe(4);
    expect(planWeight("REST", p, 50, 25, 12)).toBe(4);
    expect(planWeight("REST", p, 50, 24, 12)).toBe(9);
  });

  it("每个学期选的安排都与参考实现一致；买不起的不会被选", () => {
    let terms = 0;
    let withUnaffordable = 0;
    const picked: Record<Focus, number> = { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 };
    forEachStep(range(1, 700), (before, action) => {
      if (before.phase !== "FOCUS") return;
      const view = focusView(before);
      if (!view || action.type !== "CHOOSE_PLAN") throw new Error("安排阶段应当选安排");
      terms += 1;
      expect(action.planId, `seed ${before.seed} ${before.stage}:${before.termIndex}`).toBe(referencePlan(before, view));
      const option = view.options.find((item) => item.plan.id === action.planId);
      expect(option?.available).toBe(true);
      if (option) picked[option.focus] += 1;
      // 要花钱的安排很少，资助又每学期到账，自然出现“买不起”的学期很少见：把同一个学期的资金改成 0 再问一次
      const penniless: ActiveRun = { ...before, stats: { ...before.stats, money: 0 } };
      const tight = focusView(penniless);
      if (!tight || tight.options.every((item) => item.available)) return;
      withUnaffordable += 1;
      const forced = autoPlan(penniless, tight);
      expect(forced).toBe(referencePlan(penniless, tight));
      expect(tight.options.find((item) => item.plan.id === forced)?.available).toBe(true);
    });
    expect(terms).toBeGreaterThan(3000);
    expect(withUnaffordable).toBeGreaterThan(100);
    for (const focus of Object.keys(picked) as Focus[]) expect(picked[focus], focus).toBeGreaterThan(0);
  });

  it("点数改变倾向：同一批 seed，学业点高选学习更多，身心点高选校园生活更多，家境低打工更多", () => {
    const count = (points: Points): Record<Focus, number> => {
      const total: Record<Focus, number> = { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 };
      let terms = 0;
      for (const seed of range(1, 300)) {
        const setup = start(seed);
        const talents = setupView(setup).draw.slice(0, 3).map((talent) => talent.id);
        const input = { talents, points: scalePoints(points, startPreview(setup, talents, ZERO).pointBudget) };
        const end = asActive(simulate(setup, input, ctx).state);
        terms += end.history.filter((entry) => entry.kind === "GROWTH").length;
        for (const focus of Object.keys(total) as Focus[]) total[focus] += end.focusCounts[focus];
      }
      for (const focus of Object.keys(total) as Focus[]) total[focus] /= terms;
      return total;
    };
    const study = count(P(4, 10, 2, 4));
    const career = count(P(4, 2, 10, 4));
    const social = count(P(5, 3, 2, 10));
    const drained = count(P(5, 8, 7, 0));
    const poor = count(P(0, 7, 7, 6));
    const rich = count(P(10, 4, 3, 3));
    expect(study.STUDY).toBeGreaterThan(career.STUDY);
    expect(career.CAREER).toBeGreaterThan(study.CAREER);
    expect(social.CAMPUS).toBeGreaterThan(1.5 * drained.CAMPUS);
    expect(poor.WORK).toBeGreaterThan(1.5 * rich.WORK);
  });
});

describe("自动决定：选校与毕业去向（22 §3.3、§3.4）", () => {
  it("选校取 offers[pickIndex(seed, \"auto:school\", 3)]；三个位置都会被选到", () => {
    const slots = [0, 0, 0];
    forEachStep(range(1, 300), (before, action, after) => {
      if (before.phase !== "SCHOOL_OFFERS") return;
      const index = pickIndex(before.seed, "auto:school", 3);
      expect(action).toEqual({ type: "CHOOSE_SCHOOL", unitid: (before.offers ?? [])[index].unitid });
      expect(after.school?.unitid).toBe((before.offers ?? [])[index].unitid);
      slots[index] += 1;
    });
    for (const count of slots) expect(count).toBeGreaterThan(50);
  });

  it("毕业结果先揭晓；每一局的去向都与参考实现一致；首选到手就不读硕士，不读硕士时 6% 主动留白", () => {
    const routes = new Set<string>();
    const tally = { firstOffered: 0, firstMissing: 0, retry: 0, withOfferNoMasters: 0, selfChosen: 0, taken: 0 };
    forEachStep(range(1, 1500), (before, action) => {
      if (before.phase === "GRAD_PREVIEW") expect(action).toEqual({ type: "REVEAL_GRADUATION" });
      if (before.phase !== "GRAD_RESULTS") return;
      expect(action, `seed ${before.seed}`).toEqual(referenceGraduation(before));
      expect(autoGraduation(before, routeOptions(before), mastersOptions(before))).toEqual(action);
      const outcomes = before.graduations[before.stage === "MS" ? "MS" : "UG"]?.outcomes;
      const order = ORDER[before.profile.aspiration];
      const offered = order.filter((key) => outcomes?.[key] === "OFFERED");
      if (offered.length === 0) return;
      const canMasters = mastersOptions(before).some((option) => option.eligible);
      if (offered[0] === order[0]) {
        tally.firstOffered += 1;
        expect(action.type, `seed ${before.seed}：首选已经到手`).toBe("CHOOSE_ROUTE");
      } else if (canMasters) {
        tally.firstMissing += 1;
        if (action.type === "ENTER_MASTERS") tally.retry += 1;
      }
      if (action.type !== "CHOOSE_ROUTE") return;
      routes.add(action.route);
      tally.withOfferNoMasters += 1;
      if (action.route === "TRANSITION") tally.selfChosen += 1;
      else if (action.route === offered[0]) tally.taken += 1;
    });
    expect(tally.firstOffered).toBeGreaterThan(200);
    expect(tally.firstMissing).toBeGreaterThan(100);
    expect(Math.abs(tally.retry / tally.firstMissing - 0.35)).toBeLessThan(0.08);
    expect(tally.selfChosen + tally.taken).toBe(tally.withOfferNoMasters);
    expect(Math.abs(tally.selfChosen / tally.withOfferNoMasters - 0.06)).toBeLessThan(0.025);
    expect([...routes].sort()).toEqual(["HOME_JOB", "LOCAL_JOB", "PHD", "TRANSITION"]);
  });

  it("读硕士的意愿：一个机会都没有 75%，有机会但首选没取得 35%，首选到手 0；同一个 key；两个方案都可选时一年、两年各半", () => {
    // 把真实的本科毕业状态改成三种情形（各配三种资金：两个方案都读得起、只读得起一个、都读不起），直接问自动决定。
    type Situation = "NONE" | "FIRST_MISSING" | "FIRST_OFFERED";
    const tally: Record<Situation, { masters: number; other: number; ineligible: number }> = {
      NONE: { masters: 0, other: 0, ineligible: 0 }, FIRST_MISSING: { masters: 0, other: 0, ineligible: 0 }, FIRST_OFFERED: { masters: 0, other: 0, ineligible: 0 },
    };
    const years = { both: 0, oneYear: 0, single: 0 };
    let made = 0;
    for (let seed = 1; made < 500 && seed < 6000; seed++) {
      const { setup, input } = autoInput(seed);
      const results = play(act(setup, { type: "CONFIRM_SETUP", ...input }), AUTO_POLICY, (state) => state.phase === "GRAD_RESULTS" || state.phase === "ENDING").state;
      if (results.phase !== "GRAD_RESULTS") continue;
      made += 1;
      const order = ORDER[asActive(results).profile.aspiration];
      for (const situation of ["NONE", "FIRST_MISSING", "FIRST_OFFERED"] as Situation[]) {
        const edited = clone(asActive(results));
        const checkpoint = edited.graduations.UG;
        if (!checkpoint) throw new Error("缺少本科毕业快照");
        const second = seed % 2 === 0 ? "OFFERED" : "NOT_OFFERED";
        checkpoint.outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" };
        if (situation === "FIRST_MISSING") {
          checkpoint.outcomes[order[1]] = "OFFERED";
          checkpoint.outcomes[order[2]] = second;
        } else if (situation === "FIRST_OFFERED") {
          checkpoint.outcomes[order[0]] = "OFFERED";
          checkpoint.outcomes[order[1]] = second;
        }
        checkpoint.frozenStats.academics = Math.max(checkpoint.frozenStats.academics, 60);
        const eligibleAt = (money: number) => mastersOptions({ ...edited, stats: { ...edited.stats, money } }).filter((option) => option.eligible).length;
        const variant = seed % 3;
        let money = variant === 0 ? 100 : 0;
        if (variant === 1) for (money = 0; money <= 100 && eligibleAt(money) !== 1; money++);
        const state: ActiveRun = { ...edited, stats: { ...edited.stats, money: Math.min(100, money) } };
        const programs = mastersOptions(state).filter((option) => option.eligible);
        const action = autoAction(state, ctx);
        const label = `seed ${seed} ${situation}`;
        expect(action, label).toEqual(referenceGraduation(state));
        if (!action) throw new Error("应当给出一步操作");
        expect(act(state, action).revision, label).toBe(state.revision + 1); // 给出的操作引擎确实接受（手里有工作机会也能读硕士）
        const roll = draw01(seed, "auto:masters");
        const threshold = situation === "NONE" ? 0.75 : situation === "FIRST_MISSING" ? 0.35 : 0;
        if (programs.length === 0) {
          tally[situation].ineligible += 1;
          expect(action.type, label).toBe("CHOOSE_ROUTE");
        } else if (action.type === "ENTER_MASTERS") {
          tally[situation].masters += 1;
          expect(roll, label).toBeLessThan(threshold);
          if (programs.length === 2) {
            years.both += 1;
            if (action.program === "MS_1Y") years.oneYear += 1;
            expect(action.program).toBe(draw01(seed, "auto:masters:years") < 0.5 ? "MS_1Y" : "MS_2Y");
          } else {
            years.single += 1;
            expect(action.program).toBe(programs[0].program);
          }
        } else {
          tally[situation].other += 1;
          expect(roll, label).toBeGreaterThanOrEqual(threshold);
        }
        // 不读硕士时：没有机会就是过渡期；有机会就是首个到手的那一路，或者主动留白
        if (action.type === "CHOOSE_ROUTE") {
          const offered = order.filter((key) => checkpoint.outcomes?.[key] === "OFFERED");
          if (offered.length === 0) expect(action.route, label).toBe("TRANSITION");
          else expect([offered[0], "TRANSITION"], label).toContain(action.route);
        }
      }
    }
    expect(made).toBe(500);
    const share = (situation: Situation) => tally[situation].masters / (tally[situation].masters + tally[situation].other);
    expect(Math.abs(share("NONE") - 0.75)).toBeLessThan(0.06);
    expect(Math.abs(share("FIRST_MISSING") - 0.35)).toBeLessThan(0.06);
    expect(tally.FIRST_OFFERED.masters).toBe(0);
    expect(tally.FIRST_OFFERED.other).toBeGreaterThan(200);
    for (const situation of ["NONE", "FIRST_MISSING", "FIRST_OFFERED"] as Situation[]) expect(tally[situation].ineligible).toBeGreaterThan(50);
    expect(years.single).toBeGreaterThan(20);
    expect(Math.abs(years.oneYear / years.both - 0.5)).toBeLessThan(0.1);
  });

  it("硕士资格：正式玩法只看学业与预算，手里有工作机会也能读；经典模式仍然不开放", () => {
    const jobs = { PHD: "NOT_OFFERED", LOCAL_JOB: "OFFERED", HOME_JOB: "OFFERED" } as const;
    const withJobs = (base: ActiveRun, academics: number, money: number): ActiveRun => {
      const run = clone(base);
      const checkpoint = run.graduations.UG;
      if (!checkpoint) throw new Error("缺少本科毕业快照");
      checkpoint.outcomes = { ...jobs };
      checkpoint.frozenStats.academics = academics;
      run.stats.money = money;
      return run;
    };
    const { setup, input } = autoInput(findSeed((state) => state.phase === "GRAD_RESULTS" && state.stage === "UG"));
    const standard = asActive(play(act(setup, { type: "CONFIRM_SETUP", ...input }), AUTO_POLICY, (state) => state.phase === "GRAD_RESULTS").state);
    const open = withJobs(standard, 55, 100);
    expect(mastersOptions(open).map((option) => [option.eligible, option.blockers])).toEqual([[true, []], [true, []]]);
    for (const program of ["MS_1Y", "MS_2Y"] as const) {
      const entered = asActive(act(open, { type: "ENTER_MASTERS", program }));
      expect(entered).toMatchObject({ stage: "MS", termIndex: 1, phase: "FOCUS" });
      expect(entered.graduations.UG?.resolution).toBe("MASTERS");
    }
    // 其余两条照旧：学业不到 55、预算不够
    expect(mastersOptions(withJobs(standard, 54, 100)).map((option) => option.blockers.map((blocker) => blocker.code))).toEqual([["ACADEMICS_BELOW_55"], ["ACADEMICS_BELOW_55"]]);
    expect(mastersOptions(withJobs(standard, 80, 0)).map((option) => option.blockers.map((blocker) => blocker.code))).toEqual([["FUNDS_SHORT"], ["FUNDS_SHORT"]]);
    for (const blocked of [withJobs(standard, 54, 100), withJobs(standard, 80, 0)]) {
      const result = tryAct(blocked, { type: "ENTER_MASTERS", program: "MS_1Y" });
      expect(result.ok ? "OK" : result.error.code).toBe("MASTERS_NOT_AVAILABLE");
    }
    // 经典模式：同样的结果，硕士不开放
    const classic = asActive(play(startClassic(21, "MID"), classicPolicy({ focus: "STUDY", event: "A" }), (state) => state.phase === "GRAD_RESULTS").state);
    const closed = withJobs(classic, 80, 100);
    for (const option of mastersOptions(closed)) {
      expect(option.eligible).toBe(false);
      expect(option.blockers.map((blocker) => blocker.code)).toEqual(["HAS_JOB_OFFER"]);
    }
    const refused = tryAct(closed, { type: "ENTER_MASTERS", program: "MS_1Y" });
    expect(refused.ok ? "OK" : refused.error.code).toBe("MASTERS_NOT_AVAILABLE");
  });

  it("硕士毕业时不会再读一轮：没有机会就是过渡期", () => {
    let seen = 0;
    for (let seed = 1; seen < 12 && seed < 3000; seed++) {
      const { setup, input } = autoInput(seed);
      const ms = play(act(setup, { type: "CONFIRM_SETUP", ...input }), MASTERS_POLICY, (state) => state.phase === "ENDING" || (state.phase === "GRAD_RESULTS" && state.stage === "MS")).state;
      if (ms.phase !== "GRAD_RESULTS") continue;
      seen += 1;
      const missed = clone(asActive(ms));
      const checkpoint = missed.graduations.MS;
      if (!checkpoint) throw new Error("缺少硕士毕业快照");
      checkpoint.outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" };
      expect(mastersOptions(missed)).toEqual([]);
      expect(autoAction(missed, ctx)).toEqual({ type: "CHOOSE_ROUTE", route: "TRANSITION" });
      const action = autoAction(ms, ctx);
      expect(action).toEqual(referenceGraduation(asActive(ms)));
      expect(action?.type).toBe("CHOOSE_ROUTE");
      for (const program of ["MS_1Y", "MS_2Y"] as const) {
        const second = tryAct(ms, { type: "ENTER_MASTERS", program });
        expect(second.ok ? "OK" : second.error.code).toBe("MASTERS_NOT_AVAILABLE");
      }
    }
    expect(seen).toBe(12);
  });
});

/** 自动走的局里，第一个在某一步之后满足条件的 seed。 */
function findSeed(test: (state: ActiveRun) => boolean): number {
  for (let seed = 1; seed < 3000; seed++) {
    let hit = false;
    const { setup, input } = autoInput(seed);
    simulateObserved(setup, input, ctx, (_before, _action, after) => {
      if (test(after)) hit = true;
    });
    if (hit) return seed;
  }
  throw new Error("找不到满足条件的 seed");
}

/** 用引擎自己的自动决定推进（给 play 用）。 */
const AUTO_POLICY = {
  event: (view: EventView, state: ActiveRun) => autoChoice(state, view),
  plan: (view: FocusView, state: ActiveRun) => autoPlan(state, view),
  school: (state: ActiveRun) => (state.offers ?? [])[pickIndex(state.seed, "auto:school", 3)].unitid,
};
/** 本科毕业时只要能读硕士就读（用来得到硕士阶段的状态）。 */
const MASTERS_POLICY = {
  ...AUTO_POLICY,
  graduate: (state: ActiveRun): Action => {
    const program = mastersOptions(state).find((option) => option.eligible);
    return program ? { type: "ENTER_MASTERS", program: program.program } : referenceGraduation(state);
  },
};

describe("autoAction 与 simulate（22 §3、§10）", () => {
  it("开局必须由玩家给出；经典模式没有分点不能自动决定；结局之后返回 null；不改状态", () => {
    expect(() => autoAction(start(3), ctx)).toThrow("AUTO_NEEDS_SETUP");
    const classic = act(startClassic(3, "MID"), { type: "CONFIRM_SETUP", talents: ["T_OUTGOING"] });
    expect(() => autoAction(classic, ctx)).toThrow("AUTO_NEEDS_POINTS");
    expect(() => simulate(startClassic(3, "MID"), { talents: ["T_OUTGOING"], points: P(5, 5, 5, 5) }, ctx)).toThrow("AUTO_NEEDS_POINTS");
    const { setup, input } = autoInput(3);
    const end = simulate(setup, input, ctx).state;
    expect(autoAction(end, ctx)).toBeNull();
    forEachStep([3, 4], (before) => {
      const snapshot = JSON.stringify(before);
      autoAction(before, ctx);
      expect(JSON.stringify(before)).toBe(snapshot);
    });
  });

  it("simulate 就是确认开局后一步步执行 autoAction；每一步都被引擎接受", () => {
    for (const seed of range(1, 150)) {
      const { setup, input } = autoInput(seed);
      const result = simulate(setup, input, ctx);
      const steps: Action[] = [];
      let state: RunState = setup;
      let action: Action | null = { type: "CONFIRM_SETUP", ...input };
      while (action) {
        state = act(state, action);
        steps.push(action);
        action = autoAction(state, ctx);
      }
      expect(result.state).toEqual(state);
      expect(result.log).toEqual(steps);
      expect(result.state.phase).toBe("ENDING");
      expect(result.log).toHaveLength(result.state.revision);
      expect(result.log[0]).toEqual({ type: "CONFIRM_SETUP", ...input });
      expect(JSON.stringify(setup)).toBe(JSON.stringify(start(seed))); // 不改传进来的开局状态
    }
  });

  it("同样的 seed、天赋与点数永远得到同样的一生；换点数会变；存档能读回、能重放", () => {
    let changed = 0;
    for (const seed of range(200, 120)) {
      const { setup, input } = autoInput(seed);
      const first = simulate(setup, input, ctx);
      expect(simulate(start(seed), clone(input), ctx)).toEqual(first);
      expect(replay({ seed, runId: setup.runId, log: first.log }, ctx)).toEqual(first.state);
      const loaded = loadSave(serializeSave(first.state, first.log), ctx);
      if (!loaded.ok) throw new Error(`seed ${seed} 读档失败：${loaded.detail}`);
      expect(loaded.state).toEqual(JSON.parse(JSON.stringify(first.state)));
      const budget = startPreview(setup, input.talents, ZERO).pointBudget;
      const other = simulate(setup, { talents: input.talents, points: scalePoints(P(10 - input.points.family, 5, 5, 5), budget) }, ctx);
      if (JSON.stringify(other.log.slice(1)) !== JSON.stringify(first.log.slice(1))) changed += 1;
    }
    expect(changed).toBeGreaterThan(100);
  });

  it("中途读档再接着自动走，与一口气走完相同", () => {
    for (const seed of [5, 17, 29, 41]) {
      const { setup, input } = autoInput(seed);
      const full = simulate(setup, input, ctx);
      const cut = Math.floor(full.log.length / 2);
      const loaded = loadSave(serializeSave(replay({ seed, runId: setup.runId, log: full.log.slice(0, cut) }, ctx), full.log.slice(0, cut)), ctx);
      if (!loaded.ok) throw new Error("读档失败");
      let state = loaded.state;
      for (let action = autoAction(state, ctx); action; action = autoAction(state, ctx)) state = act(state, action);
      expect(state).toEqual(full.state);
    }
  });

  it("天赋或点数不合法时直接抛错", () => {
    const { setup, input } = autoInput(8);
    const draw = setupView(setup).draw.map((talent) => talent.id);
    const bad: Array<{ talents: string[]; points: Points }> = [
      { talents: input.talents.slice(0, 2), points: input.points },
      { talents: [draw[0], draw[0], draw[1]], points: input.points },
      { talents: [draw[0], draw[1], "T_NOT_A_TALENT"], points: input.points },
      { talents: input.talents, points: { ...input.points, family: input.points.family + 1 } },
      { talents: input.talents, points: P(11, 3, 3, 3) },
      { talents: input.talents, points: P(5.5, 4.5, 5, 5) },
      { talents: input.talents, points: undefined as unknown as Points },
    ];
    for (const item of bad) expect(() => simulate(setup, item, ctx), JSON.stringify(item)).toThrow("SIMULATE_REJECTED");
  });

  it("任意合法的开局都能自动走到某个结局（含全 0 / 全 10 的边界分法）", () => {
    const shapes = [P(10, 10, 0, 0), P(0, 0, 10, 10), P(10, 0, 10, 0), P(0, 10, 0, 10), P(10, 0, 0, 10), P(0, 10, 10, 0)];
    const kinds = new Set<string>();
    for (const seed of range(1, 60)) {
      const setup = start(seed);
      const talents = setupView(setup).draw.slice(0, 3).map((talent) => talent.id);
      const budget = startPreview(setup, talents, ZERO).pointBudget;
      for (const shape of shapes) {
        const end = asActive(simulate(setup, { talents, points: scalePoints(shape, budget) }, ctx).state);
        expect(end.phase).toBe("ENDING");
        kinds.add(end.ending?.kind ?? "?");
      }
    }
    expect([...kinds].sort()).toEqual(["EARLY", "GRADUATION"]);
  });
});

// ---------- 轨迹与总结 ----------

const BAD_TEXT = /undefined|null|NaN|\[object|\{|\}|TODO/;

function checkTexts(lines: string[], label: string): void {
  for (const text of lines) {
    expect(typeof text, label).toBe("string");
    expect(text.trim().length, `${label}：空文本`).toBeGreaterThan(0);
    expect(text, label).not.toMatch(BAD_TEXT);
  }
}

describe("人生轨迹（22 §5.1）", () => {
  it("开局阶段没有轨迹", () => {
    expect(timeline(start(1))).toEqual([]);
  });

  it("整局的分段、标签、每段结束时的属性都与历史记录一致；所有文字都是成品", () => {
    const kinds = new Set<string>();
    const lineKinds = new Set<string>();
    for (const seed of range(1, 250)) {
      const { setup, input } = autoInput(seed);
      const run = asActive(simulate(setup, input, ctx).state);
      const ending = run.ending;
      if (!ending) throw new Error("没有结局");
      kinds.add(ending.kind);
      const segments = timeline(run);
      const label = `seed ${seed}`;
      const ids = segments.map((segment) => segment.id);
      expect(new Set(ids).size, label).toBe(ids.length);
      checkTexts(segments.flatMap((segment) => [segment.label, ...segment.lines.map((line) => line.text)]), label);
      for (const line of segments.flatMap((segment) => segment.lines)) lineKinds.add(line.kind);

      // 期望的分段顺序：高三、申请季、各学期、毕业（硕士同理），最后是“后来”或“中途结局”
      const expected: string[] = ["HS", "ADMISSION"];
      for (const degree of ["UG", "MS"] as const) {
        const terms = [...new Set(run.history.filter((entry) => entry.stage === degree && entry.kind !== "MASTERS_FEE").map((entry) => entry.termIndex))].sort((a, b) => a - b);
        for (const term of terms) expected.push(`${degree}:${term}`);
        if (run.graduations[degree]) expected.push(`GRAD:${degree}`);
      }
      expected.push(ending.kind === "EARLY" ? "EARLY" : "FLAVOR");
      expect(ids, label).toEqual(expected);

      const byId = new Map(segments.map((segment) => [segment.id, segment]));
      const hs = run.history.filter((entry) => entry.stage === "HS");
      expect(byId.get("HS")).toMatchObject({ label: "高三", statsAfter: hs[hs.length - 1].afterStats });
      expect(byId.get("HS")?.lines.map((line) => line.kind)).toEqual(["EVENT", "EVENT"]);
      expect(byId.get("ADMISSION")).toMatchObject({ label: "申请季", statsAfter: hs[hs.length - 1].afterStats });
      expect(byId.get("ADMISSION")?.lines.map((line) => line.kind)).toEqual(["ADMISSION", "ADMISSION", "SCHOOL"]);
      expect(byId.get("ADMISSION")?.lines[2].text).toContain(run.school?.nameZh ?? run.school?.name ?? "");

      for (const degree of ["UG", "MS"] as const) {
        const labels = degree === "UG" ? UG_TERM_LABELS : MS_TERM_LABELS;
        for (const segment of segments.filter((item) => item.id.startsWith(`${degree}:`))) {
          const term = Number(segment.id.split(":")[1]);
          const entries = run.history.filter((entry) => entry.stage === degree && entry.termIndex === term && entry.kind !== "MASTERS_FEE");
          expect(segment.label, label).toBe(labels[term - 1]);
          expect(segment.statsAfter, `${label} ${segment.id}`).toEqual(entries[entries.length - 1].afterStats);
          // 行的顺序就是发生的顺序：突发小事、安排、事件；期末短缺时最后加一行
          const want = entries.flatMap((entry) => {
            if (entry.kind === "HAPPENING") return [{ kind: "HAPPENING", delta: entry.appliedDelta }];
            if (entry.kind === "FOCUS") return [{ kind: "PLAN", delta: entry.appliedDelta }];
            if (entry.kind === "EVENT") return [{ kind: "EVENT", delta: entry.appliedDelta }];
            if (entry.kind === "UPKEEP" && (entry.upkeep?.shortfall ?? 0) > 0) return [{ kind: "SHORTFALL", delta: entry.appliedDelta }];
            return [];
          });
          expect(segment.lines.map((line) => ({ kind: line.kind, delta: line.delta })), `${label} ${segment.id}`).toEqual(want);
          expect(segment.lines.filter((line) => line.kind === "PLAN")).toHaveLength(1);
        }
        const graduation = run.graduations[degree];
        const grad = byId.get(`GRAD:${degree}`);
        if (!graduation || !grad) continue;
        expect(grad.label).toBe(degree === "UG" ? "本科毕业" : "硕士毕业");
        expect(grad.lines.slice(0, 3).map((line) => line.kind)).toEqual(["OPPORTUNITY", "OPPORTUNITY", "OPPORTUNITY"]);
        expect(grad.lines).toHaveLength(4);
        if (graduation.resolution === "MASTERS") {
          const fee = run.history.find((entry) => entry.kind === "MASTERS_FEE");
          expect(grad.lines[3]).toMatchObject({ kind: "MASTERS", delta: fee?.appliedDelta });
          expect(grad.statsAfter).toEqual(fee?.afterStats);
        } else {
          expect(grad.lines[3]).toMatchObject({ kind: "ROUTE", delta: null });
          expect(grad.statsAfter).toEqual(graduation.frozenStats);
        }
      }

      const last = segments[segments.length - 1];
      expect(last.statsAfter, label).toEqual(run.stats);
      if (ending.kind === "EARLY") {
        const early = EARLY_ENDINGS.find((item) => item.id === ending.early);
        expect(last).toMatchObject({ id: "EARLY", label: "中途结局" });
        expect(last.lines).toHaveLength(1);
        expect(last.lines[0]).toMatchObject({ kind: "EARLY_END", delta: null });
        expect(last.lines[0].text).toContain(early?.name ?? "?");
        expect(ids).not.toContain("FLAVOR");
      } else {
        expect(last).toMatchObject({ id: "FLAVOR", label: "后来" });
        expect(last.lines).toEqual([{ kind: "FLAVOR", text: `后来，人们叫你：${ending.card.flavor?.name}。`, delta: null }]);
      }
    }
    expect([...kinds].sort()).toEqual(["EARLY", "GRADUATION"]);
    for (const kind of ["EVENT", "PLAN", "HAPPENING", "SHORTFALL", "ADMISSION", "SCHOOL", "OPPORTUNITY", "ROUTE", "MASTERS", "EARLY_END", "FLAVOR"]) {
      expect(lineKinds, kind).toContain(kind);
    }
  });

  it("没走完的局也能给出到目前为止的轨迹：每一步之后的分段都是最终轨迹的前缀，已经写下的行不会变", () => {
    for (const seed of range(300, 40)) {
      const { setup, input } = autoInput(seed);
      const trail: ActiveRun[] = [];
      const { state } = simulateObserved(setup, input, ctx, (_before, _action, after) => trail.push(after));
      const final = timeline(state);
      for (const step of trail) {
        const partial = timeline(step);
        const label = `seed ${seed} revision ${step.revision}`;
        if (step.history.length === 0) {
          expect(partial, label).toEqual([]); // 刚确认开局，什么都还没发生
          continue;
        }
        expect(partial.map((segment) => segment.id), label).toEqual(final.slice(0, partial.length).map((segment) => segment.id));
        checkTexts(partial.flatMap((segment) => segment.lines.map((line) => line.text)), label);
        // 最后一段可能还在进行中；之前的各段已经定稿
        for (let i = 0; i < partial.length - 1; i++) {
          if (partial[i].id.startsWith("GRAD:")) continue; // 毕业段在揭晓、确定去向时逐步补全
          expect(partial[i], `${label} ${partial[i].id}`).toEqual(final[i]);
        }
        const open = partial[partial.length - 1];
        const done = final[partial.length - 1];
        if (!open.id.startsWith("GRAD:")) expect(done.lines.slice(0, open.lines.length), label).toEqual(open.lines);
      }
    }
  });

  it("读了硕士的局：硕士入学费记在“本科毕业”一段的去向行上，硕士学期用硕一上…的叫法", () => {
    let seen = 0;
    const phrasing = new Set<boolean>();
    for (let seed = 1; (seen < 15 || phrasing.size < 2) && seed < 3000; seed++) {
      const { setup, input } = autoInput(seed);
      const end = asActive(play(act(setup, { type: "CONFIRM_SETUP", ...input }), MASTERS_POLICY).state);
      if (end.graduations.UG?.resolution !== "MASTERS") continue;
      seen += 1;
      const segments = timeline(end);
      const grad = segments.find((segment) => segment.id === "GRAD:UG");
      const fee = end.history.find((entry) => entry.kind === "MASTERS_FEE");
      expect(grad?.lines[3]).toMatchObject({ kind: "MASTERS", delta: fee?.appliedDelta });
      expect(grad?.lines[3].text).toContain(TEXTS.mastersProgram[fee?.program ?? "MS_1Y"].name);
      const outcomes = end.graduations.UG?.outcomes;
      const hasJob = outcomes?.LOCAL_JOB === "OFFERED" || outcomes?.HOME_JOB === "OFFERED";
      phrasing.add(hasJob);
      expect(grad?.lines[3].text.startsWith(hasJob ? "手里的机会先都不接" : "手里没有工作机会")).toBe(true);
      const first = segments.find((segment) => segment.id === "MS:1");
      expect(first?.label).toBe("硕一上");
      expect(first?.lines.some((line) => line.kind === "MASTERS")).toBe(false);
      checkTexts(segments.flatMap((segment) => [segment.label, ...segment.lines.map((line) => line.text)]), `seed ${seed}`);
      expect(segments[segments.length - 1].statsAfter).toEqual(end.stats);
    }
    expect(seen).toBeGreaterThanOrEqual(15);
    expect(phrasing.size).toBe(2); // 手里有工作机会与没有工作机会两种说法都出现过
  });
});

describe("人生总结（22 §5.3）", () => {
  it("属性评价的分档", () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 94, 95, 100].map(statRating)).toEqual(
      ["见底", "见底", "吃紧", "吃紧", "普通", "普通", "不错", "不错", "出色", "出色", "拉满", "拉满"],
    );
  });

  it("还没走到结局时没有总结", () => {
    expect(() => summaryView(start(1))).toThrow("SUMMARY_NOT_READY");
    forEachStep([9], (before) => {
      expect(() => summaryView(before)).toThrow("SUMMARY_NOT_READY");
    });
  });

  it("毕业结局与中途结局各自的内容；四属性、安排次数、天赋与点数都取自这一局", () => {
    const seen = { GRADUATION: 0, EARLY: 0 };
    for (const seed of range(1, 300)) {
      const { setup, input } = autoInput(seed);
      const run = asActive(simulate(setup, input, ctx).state);
      const ending = run.ending;
      if (!ending) throw new Error("没有结局");
      const summary = summaryView(run);
      const label = `seed ${seed}`;
      seen[summary.kind] += 1;
      expect(summary.kind).toBe(ending.kind);
      expect(summary).toMatchObject({ seed, school: run.school, points: input.points, card: ending.card });
      expect(summary.stats.map((item) => [item.key, item.value, item.rating])).toEqual(STATS.map((key) => [key, run.stats[key], statRating(run.stats[key])]));
      expect(summary.focusSummary.map((item) => item.count).reduce((sum, n) => sum + n, 0)).toBe(Object.values(run.focusCounts).reduce((sum, n) => sum + n, 0));
      for (const item of summary.focusSummary) expect(item.count).toBe(run.focusCounts[item.focus]);
      expect(summary.talents.map((talent) => talent.id)).toEqual(run.profile.talents);
      checkTexts([summary.title, summary.label, summary.text, summary.epilogue, ...summary.stats.map((item) => item.name), ...summary.focusSummary.map((item) => item.name)], label);
      if (ending.kind === "EARLY") {
        const early = EARLY_ENDINGS.find((item) => item.id === ending.early);
        if (!early) throw new Error(`未知的中途结局 ${String(ending.early)}`);
        const labels = ending.degree === "UG" ? UG_TERM_LABELS : MS_TERM_LABELS;
        expect(summary).toMatchObject({
          title: early.title, text: early.text, epilogue: early.epilogue, keyExperience: null, opportunities: [],
          label: `${labels[run.termIndex - 1]} · 中途`,
        });
        expect(summary.card).toMatchObject({ early: early.id, name: early.name, tier: early.tier, flavor: null });
      } else {
        expect(summary.opportunities.map((item) => item.id)).toEqual(["PHD", "LOCAL_JOB", "HOME_JOB"]);
        expect(summary.opportunities.map((item) => item.outcome)).toEqual(
          (["PHD", "LOCAL_JOB", "HOME_JOB"] as const).map((key) => run.graduations[ending.degree]?.outcomes?.[key]),
        );
        expect(typeof summary.keyExperience).toBe("string");
        checkTexts([summary.keyExperience ?? ""], label);
        expect(summary.card.flavor).not.toBeNull();
        checkTexts([summary.card.flavor?.name ?? "", summary.card.flavor?.roast ?? "", summary.card.flavor?.text ?? ""], label);
      }
    }
    expect(seen.GRADUATION).toBeGreaterThan(50);
    expect(seen.EARLY).toBeGreaterThan(20);
  });

  it("经典模式走到结局也有总结（没有点数）", () => {
    const end = play(startClassic(13, "LOW"), classicPolicy({ focus: "STUDY", event: "A" })).state;
    const summary = summaryView(end);
    expect(summary).toMatchObject({ kind: "GRADUATION", points: null });
    expect(summary.card.early).toBeNull();
    expect(timeline(end).length).toBeGreaterThan(5);
  });
});
