// 状态机与整局流程。期望值来自 docs/06 §5–§6、§9，docs/09 §3、§5。

import { describe, expect, it } from "vitest";
import { ALL_EVENTS, EVENT_BY_ID } from "../../content";
import {
  admissionPreview, admissionResult, currentEvent, focusView, graduationView, lastOutcome, mastersOptions,
  routeOptions, sceneIntro, stageInfo, termLedger,
} from "../index";
import type { Action, ActiveRun, ChoiceId, Focus, RunState, Stats } from "../index";
import { draw01 } from "../rng";
import { totalFocus } from "../rules";
import { act, actWithRevision, asActive, clone, ctx, play, scriptedPolicy, start, tryAct } from "./helpers";
import type { Policy } from "./helpers";

const stats = (money: number, academics: number, career: number, wellbeing: number): Stats => ({ money, academics, career, wellbeing });

// docs/09 §3：一条可复核的低资助硕士入口
const SEED13_FOCUS: Focus[] = ["WORK", "STUDY", "WORK", "STUDY", "WORK", "STUDY", "WORK", "WORK"];
const SEED13_CHOICES: Record<string, ChoiceId> = {
  HS_01: "A", HS_02: "B",
  CORE_01: "B", CORE_02: "B", ARC_CREATIVE_1: "B", CORE_03: "B", ARC_RESEARCH_1: "B", CORE_04: "B",
  ARC_CREATIVE_2: "B", CORE_05: "B", ARC_RESEARCH_2: "A", CORE_06: "A", ARC_CREATIVE_3: "B", CORE_07: "A",
  ARC_RESEARCH_3: "A", CORE_08: "A",
};

function seed13(until: (state: RunState) => boolean): { state: ActiveRun; log: Action[] } {
  const policy = scriptedPolicy({ economy: "LOW", focus: [...SEED13_FOCUS], choices: SEED13_CHOICES });
  const played = play(start(13), policy, until);
  return { state: asActive(played.state), log: played.log };
}

describe("docs/09 §3：seed 13 的低资助整局", () => {
  it("逐步走完本科，期末 53/100/69/0，支线 CREATIVE + RESEARCH，机会与硕士入口与文档一致", () => {
    const { state, log } = seed13((s) => s.phase === "GRAD_RESULTS");
    expect(state.profile.trait).toBe("OUTGOING");
    expect(state.stats).toEqual(stats(53, 100, 69, 0));
    expect(state.arcs).toEqual({ A: "CREATIVE", B: "RESEARCH" });
    expect(state.focusCounts).toEqual({ STUDY: 3, CAREER: 0, CAMPUS: 0, WORK: 5, REST: 0 });
    // 实际走过的事件顺序与文档表格一致
    const events = state.history.filter((entry) => entry.kind === "EVENT").map((entry) => `${entry.eventId}=${entry.choiceId}`);
    expect(events).toEqual([
      "HS_01=A", "HS_02=B", "CORE_01=B", "CORE_02=B", "ARC_CREATIVE_1=B", "CORE_03=B", "ARC_RESEARCH_1=B", "CORE_04=B",
      "ARC_CREATIVE_2=B", "CORE_05=B", "ARC_RESEARCH_2=A", "CORE_06=A", "ARC_CREATIVE_3=B", "CORE_07=A",
      "ARC_RESEARCH_3=A", "CORE_08=A",
    ]);
    const grad = state.graduations.UG;
    expect(grad?.frozenStats).toEqual(stats(53, 100, 69, 0));
    expect(grad?.probabilities).toEqual({ PHD: 83, LOCAL_JOB: null, HOME_JOB: 91 });
    expect(grad?.outcomes).toEqual({ PHD: "OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" });
    const masters = mastersOptions(state);
    expect(masters.map((option) => [option.program, option.eligible, option.requiredReserve])).toEqual([
      ["MS_1Y", true, 20],
      ["MS_2Y", true, 36],
    ]);
    const routes = routeOptions(state);
    expect(routes.map((option) => [option.route, option.available])).toEqual([
      ["PHD", true], ["LOCAL_JOB", false], ["HOME_JOB", false], ["TRANSITION", true],
    ]);
    // 2 高中 + 8 投入 + 14 事件 = 24 次生活决策
    const decisions = log.filter((action) => action.type === "CHOOSE_FOCUS" || action.type === "CHOOSE_EVENT").length;
    expect(decisions).toBe(24);
  });

  it("可以直接接受博士结束（本科直博）", () => {
    const { state } = seed13((s) => s.phase === "GRAD_RESULTS");
    const ended = asActive(act(state, { type: "CHOOSE_ROUTE", route: "PHD" }));
    expect(ended.phase).toBe("ENDING");
    expect(ended.ending).toMatchObject({ route: "PHD", degree: "UG", entryMode: "undergrad_direct", transitionMode: null });
    expect(ended.graduations.UG?.resolution).toBe("PHD");
    expect(ended.mastersYears).toBeNull();
  });

  for (const [program, years, masterEvents, focusTotal] of [
    ["MS_1Y", 1, ["MASTER_01", "MASTER_04"], 10],
    ["MS_2Y", 2, ["MASTER_01", "MASTER_02", "MASTER_03", "MASTER_04"], 12],
  ] as const) {
    it(`放弃博士继续 ${program}：入学费只扣一次，硕士不新增支线，走到 ENDING`, () => {
      const { state } = seed13((s) => s.phase === "GRAD_RESULTS");
      const fee = program === "MS_1Y" ? 8 : 12;
      const entered = asActive(act(state, { type: "ENTER_MASTERS", program }));
      expect(entered.stage).toBe("MS");
      expect(entered.mastersYears).toBe(years);
      expect(entered.termIndex).toBe(1);
      expect(entered.phase).toBe("FOCUS");
      expect(entered.graduations.UG?.resolution).toBe("MASTERS");
      // 53 - 费用 + 第一期资助 6；其余属性、计数、标记、支线原样保留
      expect(entered.stats).toEqual(stats(53 - fee + 6, 100, 69, 0));
      expect(entered.focusCounts).toEqual(state.focusCounts);
      expect(entered.flags).toEqual(state.flags);
      expect(entered.arcs).toEqual(state.arcs);
      expect(entered.school).toEqual(state.school);
      expect(lastOutcome(entered)?.kind).toBe("MASTERS_FEE");
      expect(entered.history.filter((entry) => entry.kind === "MASTERS_FEE")).toHaveLength(1);

      const policy: Policy = {
        economy: "LOW",
        focus: () => "REST",
        event: () => "A",
        graduate: () => ({ type: "CHOOSE_ROUTE", route: "TRANSITION" }),
      };
      const end = asActive(play(entered, policy).state);
      expect(end.phase).toBe("ENDING");
      const msEvents = end.history.filter((entry) => entry.stage === "MS" && entry.kind === "EVENT").map((entry) => entry.eventId);
      expect(msEvents).toEqual(masterEvents);
      expect(end.history.filter((entry) => entry.kind === "MASTERS_FEE")).toHaveLength(1);
      expect(totalFocus(end.focusCounts)).toBe(focusTotal);
      expect(end.arcs).toEqual({ A: "CREATIVE", B: "RESEARCH" });
      expect(end.flags.filter((flag) => flag.startsWith("ARC_"))).toHaveLength(6);
      // 本科快照仍是原来的 8 次计数，不被硕士覆盖
      expect(totalFocus(end.graduations.UG?.frozenFocusCounts ?? state.focusCounts)).toBe(8);
      expect(end.graduations.UG?.frozenStats).toEqual(stats(53, 100, 69, 0));
      expect(totalFocus(end.graduations.MS?.frozenFocusCounts ?? state.focusCounts)).toBe(focusTotal);
      // 硕士检查点用 MS 命名空间
      for (const key of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) {
        expect(end.graduations.MS?.rolls?.[key]).toBe(draw01(13, `grad:MS:${key}`));
        expect(end.graduations.UG?.rolls?.[key]).toBe(draw01(13, `grad:UG:${key}`));
      }
      expect(end.flags.includes("MASTER_04_A") !== end.flags.includes("MASTER_04_B")).toBe(true);
      expect(end.ending?.degree).toBe("MS");
    });
  }

  it("一年与两年硕士共用 MS 命名空间：同 seed 的原始 roll 相同", () => {
    const { state } = seed13((s) => s.phase === "GRAD_RESULTS");
    const policy: Policy = { economy: "LOW", focus: () => "STUDY", event: () => "A" };
    const rolls = (["MS_1Y", "MS_2Y"] as const).map((program) => {
      const end = asActive(play(act(state, { type: "ENTER_MASTERS", program }), policy, (s) => s.phase === "GRAD_RESULTS").state);
      return end.graduations.MS?.rolls;
    });
    expect(rolls[0]).toEqual(rolls[1]);
  });
});

describe("开局与高中（06 §1、13 §1）", () => {
  it("SETUP 只有 seed 与版本；确认后初始化四属性并进入 HS_01", () => {
    const setup = start(42);
    expect(setup.phase).toBe("SETUP");
    expect(setup.revision).toBe(0);
    expect(stageInfo(setup)).toMatchObject({ stage: "SETUP", title: "开局" });
    expect(admissionPreview(setup).baseReadiness).toBe(65);
    const run = asActive(act(setup, { type: "CONFIRM_SETUP", economy: "MID", aspiration: "BELONGING", name: "  阿原  " }));
    expect(run.phase).toBe("HIGH_SCHOOL_EVENT");
    expect(run.revision).toBe(1);
    expect(run.stage).toBe("HS");
    expect(run.highSchoolNode).toBe(1);
    expect(run.profile.name).toBe("阿原");
    expect(run.profile.aspiration).toBe("BELONGING");
    expect(run.stats).toEqual(stats(42, 18, 12, 70));
    expect(run.admission).toMatchObject({ baseReadiness: 65, readiness: null, tier: null });
    expect(run.school).toBeNull();
    expect(run.offers).toBeNull();
    expect(stageInfo(run)).toMatchObject({ stage: "HS", title: "高中最后一年", step: "事件 1 / 2" });
    expect(sceneIntro(run)?.short).toContain("高中最后一年开始了");
    expect(currentEvent(run)?.event.id).toBe("HS_01");
  });

  it("名字截到 12 个码点，可为空，不进入随机", () => {
    const long = asActive(act(start(7), { type: "CONFIRM_SETUP", economy: "LOW", aspiration: "DISCOVERY", name: "一二三四五六七八九十甲乙丙丁" }));
    expect(Array.from(long.profile.name)).toHaveLength(12);
    const empty = asActive(act(start(7), { type: "CONFIRM_SETUP", economy: "LOW", aspiration: "DISCOVERY", name: "" }));
    expect(empty.profile.name).toBe("");
    expect(empty.profile.trait).toBe(long.profile.trait);
    expect(empty.admission.baseReadiness).toBe(long.admission.baseReadiness);
  });

  it("高中只结算两张事件：不发资助、不计投入、不扣费；属性原样带入本科", () => {
    let run = asActive(act(start(42), { type: "CONFIRM_SETUP", economy: "MID", aspiration: "DISCOVERY", name: "" }));
    const first = currentEvent(run);
    expect(first?.choices.map((choice) => choice.admission?.readinessBonus)).toEqual([10, 6]);
    expect(first?.choices.map((choice) => choice.admission?.readinessAfter)).toEqual([75, 71]);
    expect(first?.choices.every((choice) => choice.projected === null)).toBe(true);
    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "HS_01", choiceId: "A" }));
    expect(run.stats).toEqual(stats(42, 26, 12, 66));
    expect(run.highSchoolNode).toBe(2);
    expect(stageInfo(run).step).toBe("事件 2 / 2");
    expect(sceneIntro(run)).toBeNull();
    expect(lastOutcome(run)).toMatchObject({ kind: "EVENT", heading: EVENT_BY_ID.HS_01.title });
    expect(admissionPreview(run)).toMatchObject({ baseReadiness: 65, readinessBonus: 10, readinessSoFar: 75 });

    const second = currentEvent(run);
    expect(second?.defaultCallback?.ifFlag).toBe("HS_01_A");
    expect(second?.matchedCallbacks).toHaveLength(1);
    expect(second?.choices.map((choice) => choice.admission?.strategy)).toEqual(["REACH", "STEADY"]);
    expect(second?.choices[0].admission?.odds).toEqual(admissionPreview(run).odds.REACH);
    expect(second?.choices[1].admission?.odds).toEqual(admissionPreview(run).odds.STEADY);

    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "HS_02", choiceId: "B" }));
    expect(run.phase).toBe("SCHOOL_OFFERS");
    expect(run.stats).toEqual(stats(42, 27, 14, 67));
    expect(totalFocus(run.focusCounts)).toBe(0);
    expect(run.history.map((entry) => entry.kind)).toEqual(["EVENT", "EVENT"]);
    expect(run.flags).toEqual(["HS_01_A", "HS_02_B"]);
    expect(stageInfo(run).title).toBe("申请结果");

    const result = admissionResult(run);
    expect(result).toMatchObject({ baseReadiness: 65, readinessBonus: 10, readiness: 75, strategy: "STEADY" });
    expect(result?.poolRoll).toBe(draw01(42, "admission:pool"));
    expect(result?.tierRoll).toBe(draw01(42, "admission:tier"));
    expect(result?.offers).toHaveLength(3);
    expect(new Set(result?.offers.map((school) => school.unitid)).size).toBe(3);
    expect(result?.offers.every((school) => school.tier === result.tier)).toBe(true);
    expect(result?.chosen).toBeNull();

    // 只能在三所里选
    const outsider = ctx.catalog.schools.find((school) => !result?.offers.some((offer) => offer.unitid === school.unitid));
    const rejected = tryAct(run, { type: "CHOOSE_SCHOOL", unitid: outsider?.unitid ?? "" });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("SCHOOL_NOT_OFFERED");

    const enrolled = asActive(act(run, { type: "CHOOSE_SCHOOL", unitid: result?.offers[1].unitid ?? "" }));
    expect(enrolled.stage).toBe("UG");
    expect(enrolled.termIndex).toBe(1);
    expect(enrolled.highSchoolNode).toBeNull();
    expect(enrolled.phase).toBe("FOCUS");
    expect(enrolled.school?.unitid).toBe(result?.offers[1].unitid);
    // 高中后的属性带入本科，只多了第一期资助
    expect(enrolled.stats).toEqual(stats(52, 27, 14, 67));
    expect(enrolled.history.map((entry) => entry.kind)).toEqual(["EVENT", "EVENT", "STIPEND"]);
    expect(stageInfo(enrolled)).toMatchObject({ stage: "UG", title: "本科 · 一年级秋", step: "节点 1 / 8", termIndex: 1, termCount: 8 });
    const intro = sceneIntro(enrolled);
    expect(intro?.short).toContain(enrolled.school?.nameZh ?? "");
    expect(intro?.long).toContain("Sampleville");
    expect(`${intro?.short}${intro?.long}`).not.toContain("{{");
    expect(admissionResult(enrolled)?.chosen?.unitid).toBe(enrolled.school?.unitid);
  });

  it("同 seed 下换家庭档不改变基础准备度，换高中选择只改变分布不重抽 roll", () => {
    const tiers = new Set<string>();
    for (const economy of ["LOW", "MID", "HIGH"] as const) {
      for (const hs1 of ["A", "B"] as const) {
        for (const hs2 of ["A", "B"] as const) {
          let run = act(start(99), { type: "CONFIRM_SETUP", economy, aspiration: "DISCOVERY", name: "" });
          run = act(run, { type: "CHOOSE_EVENT", eventId: "HS_01", choiceId: hs1 });
          run = act(run, { type: "CHOOSE_EVENT", eventId: "HS_02", choiceId: hs2 });
          const result = admissionResult(run);
          expect(result?.baseReadiness).toBe(admissionPreview(start(99)).baseReadiness);
          expect(result?.poolRoll).toBe(draw01(99, "admission:pool"));
          expect(result?.tierRoll).toBe(draw01(99, "admission:tier"));
          tiers.add(`${hs1}${hs2}:${result?.tier}`);
        }
      }
    }
    expect(tiers.size).toBe(4); // 结果只取决于两次高中选择，与经济档无关
  });
});

describe("学期循环（06 §5、03 §4）", () => {
  const policy: Policy = { economy: "MID", focus: () => "STUDY", event: () => "B" };

  it("一个本科学期的阶段顺序、账目与历史记录", () => {
    let run = asActive(play(start(5), policy, (s) => s.phase === "FOCUS").state);
    const view = focusView(run);
    expect(view?.stipend.applied.money).toBe(10);
    expect(view?.upkeep).toBe(run.profile.trait === "FRUGAL" ? 11 : 12);
    expect(view?.efficiency.factor).toBe(10);
    expect(view?.options.map((option) => option.focus)).toEqual(["STUDY", "CAREER", "CAMPUS", "WORK", "REST"]);
    const before = clone(run.stats);

    run = asActive(act(run, { type: "CHOOSE_FOCUS", focus: "WORK" }));
    expect(run.phase).toBe("CORE_EVENT");
    expect(run.focusCounts.WORK).toBe(1);
    expect(run.stats.money).toBe(Math.min(100, before.money + 12));
    expect(lastOutcome(run)).toMatchObject({ kind: "FOCUS", choiceLabel: null });
    expect(currentEvent(run)?.event.id).toBe("CORE_01");
    expect(currentEvent(run)?.kindLabel).toBe("主线");
    expect(currentEvent(run)?.choices[0].projected).not.toBeNull();

    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "B" }));
    expect(run.phase).toBe("TERM_REVIEW"); // S1 没有支线，主线后直接期末结算
    const ledger = termLedger(run);
    expect(ledger?.lines.map((line) => line.kind)).toEqual(["STIPEND", "FOCUS", "EVENT", "UPKEEP", "GROWTH"]);
    expect(ledger).toMatchObject({ stage: "UG", termIndex: 1, termCount: 8, isFinalTerm: false, shortfall: 0, stress: 0 });
    expect(ledger?.endStats).toEqual(run.stats);
    expect(lastOutcome(run)?.kind).toBe("EVENT");
    // 每条历史记录的 applied 都是真实变化，前后相接
    for (let i = 1; i < run.history.length; i++) {
      const entry = run.history[i];
      for (const key of ["money", "academics", "career", "wellbeing"] as const) {
        expect(entry.afterStats[key] - entry.beforeStats[key]).toBe(entry.appliedDelta[key]);
        expect(entry.beforeStats[key]).toBe(run.history[i - 1].afterStats[key]);
      }
    }
    expect(run.history[run.history.length - 1].afterStats).toEqual(run.stats);

    run = asActive(act(run, { type: "NEXT_TERM" }));
    expect(run.phase).toBe("FOCUS");
    expect(run.termIndex).toBe(2);
    expect(lastOutcome(run)).toBeNull();
    run = asActive(act(run, { type: "CHOOSE_FOCUS", focus: "STUDY" }));
    expect(run.arcs).toEqual({ A: null, B: null });
    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "CORE_02", choiceId: "B" }));
    expect(run.phase).toBe("ARC_EVENT"); // S2 主线结算后分配槽 A
    expect(run.arcs.A).not.toBeNull();
    expect(run.arcs.B).toBeNull();
    const arcEvent = currentEvent(run);
    expect(arcEvent?.event.id).toBe(`ARC_${run.arcs.A}_1`);
    expect(arcEvent?.kindLabel).toContain("第 1 幕");
    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: arcEvent?.event.id ?? "", choiceId: "B" }));
    expect(run.phase).toBe("TERM_REVIEW");
    expect(termLedger(run)?.lines.map((line) => line.kind)).toEqual(["STIPEND", "FOCUS", "EVENT", "EVENT", "UPKEEP", "GROWTH"]);
  });

  it("本科八学期：支线槽在规定学期推进，两条支线不同，各三幕；结束时投入 8 次、生活决策 24 次", () => {
    for (let seed = 0; seed < 40; seed++) {
      const { state, log } = play(start(seed), { ...policy, economy: (["LOW", "MID", "HIGH"] as const)[seed % 3] }, (s) => s.phase === "GRAD_PREVIEW");
      const run = asActive(state);
      expect(totalFocus(run.focusCounts)).toBe(8);
      expect(run.arcs.A).not.toBeNull();
      expect(run.arcs.B).not.toBeNull();
      expect(run.arcs.A).not.toBe(run.arcs.B);
      const arcEvents = run.history.filter((entry) => entry.kind === "EVENT" && entry.eventId?.startsWith("ARC_"));
      expect(arcEvents.map((entry) => entry.termIndex)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(arcEvents.map((entry) => entry.eventId)).toEqual([
        `ARC_${run.arcs.A}_1`, `ARC_${run.arcs.B}_1`, `ARC_${run.arcs.A}_2`, `ARC_${run.arcs.B}_2`, `ARC_${run.arcs.A}_3`, `ARC_${run.arcs.B}_3`,
      ]);
      const core = run.history.filter((entry) => entry.kind === "EVENT" && entry.eventId?.startsWith("CORE_")).map((entry) => entry.eventId);
      expect(core).toEqual(["CORE_01", "CORE_02", "CORE_03", "CORE_04", "CORE_05", "CORE_06", "CORE_07", "CORE_08"]);
      expect(run.history.filter((entry) => entry.kind === "STIPEND")).toHaveLength(8);
      expect(run.history.filter((entry) => entry.kind === "UPKEEP")).toHaveLength(8);
      expect(run.history.filter((entry) => entry.kind === "GROWTH")).toHaveLength(8);
      expect(log.filter((action) => action.type === "CHOOSE_FOCUS" || action.type === "CHOOSE_EVENT")).toHaveLength(24);
      expect(run.flags).toHaveLength(16);
      // 毕业快照在最后一学期全部结算后冻结，尚未抽签
      expect(run.graduations.UG?.frozenStats).toEqual(run.stats);
      expect(run.graduations.UG?.rolls).toBeNull();
      expect(graduationView(run)?.revealed).toBe(false);
      expect(graduationView(run)?.opportunities.every((item) => item.outcome === null && item.roll === null)).toBe(true);
      expect(stageInfo(run).title).toBe("本科毕业机会");
    }
  });

  it("支线分配读取“本学期投入＋主线已结算”的状态，B 排除 A，之后不再重抽", () => {
    for (let seed = 100; seed < 130; seed++) {
      const a = asActive(play(start(seed), policy, (s) => s.phase === "ARC_EVENT").state);
      const b = asActive(play(a, policy, (s) => s.phase === "ARC_EVENT" && asActive(s).termIndex === 3).state);
      expect(b.arcs.A).toBe(a.arcs.A);
      expect(b.arcs.B).not.toBe(a.arcs.A);
      const end = asActive(play(b, policy, (s) => s.phase === "GRAD_PREVIEW").state);
      expect(end.arcs).toEqual(b.arcs);
    }
  });

  it("回响匹配集只看事件出现时已有的标记", () => {
    const run = asActive(play(start(3), { ...policy, event: () => "B" }, (s) => s.phase === "CORE_EVENT" && asActive(s).termIndex === 2).state);
    const view = currentEvent(run);
    expect(view?.event.id).toBe("CORE_02");
    expect(run.flags).toContain("CORE_01_B");
    expect(view?.matchedCallbacks.map((callback) => callback.ifFlag)).toEqual(["CORE_01_B"]);
    expect(view?.defaultCallback?.ifFlag).toBe("CORE_01_B");
    const other = asActive(play(start(3), { ...policy, event: () => "A" }, (s) => s.phase === "CORE_EVENT" && asActive(s).termIndex === 2).state);
    expect(currentEvent(other)?.matchedCallbacks).toEqual([]);
    expect(currentEvent(other)?.defaultCallback).toBeNull();
  });
});

describe("原子性与拒绝（06 §5、09 §5）", () => {
  const policy: Policy = { economy: "MID", focus: () => "STUDY", event: () => "B" };

  it("重复或过期的 revision 被拒绝，状态对象原样返回", () => {
    const run = play(start(8), policy, (s) => s.phase === "FOCUS").state;
    const ok = tryAct(run, { type: "CHOOSE_FOCUS", focus: "STUDY" });
    expect(ok.ok).toBe(true);
    // 连点：第二次仍带着旧 revision
    const again = actWithRevision(ok.state, { type: "CHOOSE_FOCUS", focus: "STUDY" }, run.revision);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("STALE_REVISION");
    expect(again.state).toBe(ok.state);
    const future = actWithRevision(ok.state, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "A" }, ok.state.revision + 1);
    expect(future.ok).toBe(false);
  });

  it("失败不产生半截修改，也不原地改入参", () => {
    const run = play(start(8), policy, (s) => s.phase === "CORE_EVENT").state;
    const snapshot = JSON.stringify(run);
    for (const action of [
      { type: "CHOOSE_FOCUS", focus: "REST" },
      { type: "NEXT_TERM" },
      { type: "REVEAL_GRADUATION" },
      { type: "CHOOSE_ROUTE", route: "TRANSITION" },
      { type: "ENTER_MASTERS", program: "MS_1Y" },
      { type: "CHOOSE_SCHOOL", unitid: "900001" },
      { type: "CONFIRM_SETUP", economy: "LOW", aspiration: "DISCOVERY", name: "" },
      { type: "CHOOSE_EVENT", eventId: "CORE_02", choiceId: "A" },
      { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "C" },
    ] as unknown as Action[]) {
      const result = tryAct(run, action);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(run);
    }
    expect(JSON.stringify(run)).toBe(snapshot);
    const good = tryAct(run, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "A" });
    expect(good.ok).toBe(true);
    expect(JSON.stringify(run)).toBe(snapshot); // 成功也不改入参
    expect(good.state.revision).toBe(run.revision + 1);
  });

  it("错误代码：错误阶段、错误事件、无效操作", () => {
    const run = play(start(8), policy, (s) => s.phase === "CORE_EVENT").state;
    const code = (action: Action) => {
      const result = tryAct(run, action);
      return result.ok ? "OK" : result.error.code;
    };
    expect(code({ type: "CHOOSE_FOCUS", focus: "REST" })).toBe("WRONG_PHASE");
    expect(code({ type: "NEXT_TERM" })).toBe("WRONG_PHASE");
    expect(code({ type: "CHOOSE_EVENT", eventId: "CORE_02", choiceId: "A" })).toBe("WRONG_EVENT");
    expect(code({ type: "CHOOSE_EVENT", eventId: "HS_01", choiceId: "A" })).toBe("WRONG_EVENT");
    expect(code({ type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "C" as ChoiceId })).toBe("INVALID_ACTION");
    expect(code({ type: "BOGUS" } as unknown as Action)).toBe("INVALID_ACTION");
    const setup = start(8);
    const early = tryAct(setup, { type: "CHOOSE_FOCUS", focus: "REST" });
    expect(early.ok ? "OK" : early.error.code).toBe("WRONG_PHASE");
    const badSetup = tryAct(setup, { type: "CONFIRM_SETUP", economy: "RICH", aspiration: "DISCOVERY", name: "" } as unknown as Action);
    expect(badSetup.ok ? "OK" : badSetup.error.code).toBe("INVALID_ACTION");
  });

  it("资金不足的选项被拒绝并说明差额；同一事件总有不花钱的选项", () => {
    const run = asActive(play(start(8), policy, (s) => s.phase === "CORE_EVENT").state);
    const broke = clone(run);
    broke.stats.money = 2; // CORE_01_A 花费 3
    const view = currentEvent(broke);
    expect(view?.choices[0]).toMatchObject({ available: false, shortBy: { need: 3, have: 2 } });
    expect(view?.choices[1]).toMatchObject({ available: true, shortBy: null });
    const rejected = tryAct(broke, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "A" });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(broke.stats.money).toBe(2);
    expect(tryAct(broke, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "B" }).ok).toBe(true);
    const exact = clone(run);
    exact.stats.money = 3;
    expect(tryAct(exact, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "A" }).ok).toBe(true);
  });

  it("界面显示的变化是截断后的真实变化：学业 99 时不会声称 +11", () => {
    const run = asActive(play(start(8), policy, (s) => s.phase === "FOCUS").state);
    const high = clone(run);
    high.stats.academics = 99;
    const study = focusView(high)?.options.find((option) => option.focus === "STUDY");
    expect(study?.requested.academics).toBeGreaterThanOrEqual(11);
    expect(study?.applied.academics).toBe(1);
    const after = asActive(act(high, { type: "CHOOSE_FOCUS", focus: "STUDY" }));
    expect(after.stats.academics).toBe(100);
    expect(lastOutcome(after)?.delta.applied.academics).toBe(1);
    expect(lastOutcome(after)?.delta.requested.academics).toBeGreaterThanOrEqual(11);
  });

  it("低身心：投入界面预览折减后的实际效果", () => {
    const run = asActive(play(start(8), policy, (s) => s.phase === "FOCUS").state);
    const tired = clone(run);
    tired.stats.wellbeing = 19;
    tired.stats.academics = 30;
    const view = focusView(tired);
    expect(view?.efficiency.factor).toBe(6);
    expect(view?.efficiency.note).toContain("60%");
    const expected = tired.profile.trait === "FOCUSED" ? 8 : 7;
    expect(view?.options[0].requested.academics).toBe(expected);
    expect(view?.options[0].efficiencyApplied).toBe(true);
    const after = asActive(act(tired, { type: "CHOOSE_FOCUS", focus: "STUDY" }));
    expect(after.stats.academics).toBe(30 + expected);
    expect(after.history[after.history.length - 1]).toMatchObject({ kind: "FOCUS", focus: "STUDY", efficiency: 6 });
  });

  it("资金短缺：记录短缺与压力，不提前结束，下期照常到账", () => {
    const run = asActive(play(start(8), policy, (s) => s.phase === "CORE_EVENT").state);
    const broke = clone(run);
    broke.stats.money = 5;
    broke.stats.wellbeing = 20;
    const cost = broke.profile.trait === "FRUGAL" ? 11 : 12;
    const view = currentEvent(broke)?.choices[1]; // CORE_01_B 不花钱，身心 +2
    expect(view?.projected).toEqual({ moneyAfterChoice: 5, upkeep: cost, moneyAfterUpkeep: 0, shortfall: cost - 5 });
    const settled = asActive(act(broke, { type: "CHOOSE_EVENT", eventId: "CORE_01", choiceId: "B" }));
    const ledger = termLedger(settled);
    const stress = 6 + Math.ceil((cost - 5) / 3);
    expect(ledger).toMatchObject({ shortfall: cost - 5, stress });
    expect(settled.stats.money).toBe(0);
    expect(settled.stats.wellbeing).toBe(Math.max(0, 22 - stress - 3));
    const upkeepEntry = settled.history.find((entry) => entry.kind === "UPKEEP");
    expect(upkeepEntry?.upkeep).toEqual({ cost, paid: 5, shortfall: cost - 5, stress });
    expect(upkeepEntry?.appliedDelta.money).toBe(-5);
    const next = asActive(act(settled, { type: "NEXT_TERM" }));
    expect(next.stats.money).toBe(10);
  });

  it("全零属性下每个事件、每种投入、期末结算都合法且有可选项", () => {
    const base = asActive(play(start(8), policy, (s) => s.phase === "CORE_EVENT").state);
    for (const event of ALL_EVENTS) {
      const zero = clone(base);
      zero.stats = stats(0, 0, 0, 0);
      zero.flags = [];
      // 构造“当前事件就是它”的合法阶段
      if (event.kind === "highschool") {
        zero.stage = "HS";
        zero.termIndex = 0;
        zero.phase = "HIGH_SCHOOL_EVENT";
        zero.highSchoolNode = event.node;
        zero.school = null;
        zero.offers = null;
        if (event.node === 2) zero.flags = ["HS_01_A"];
      } else if (event.kind === "core") {
        zero.stage = "UG";
        zero.termIndex = event.stage;
        zero.phase = "CORE_EVENT";
        zero.arcs = { A: "RESEARCH", B: "FAMILY" };
      } else if (event.kind === "arc") {
        zero.stage = "UG";
        zero.phase = "ARC_EVENT";
        const others = (["RESEARCH", "FAMILY", "CREATIVE"] as const).filter((arc) => arc !== event.arc);
        if (event.beat === 1) {
          zero.termIndex = 2;
          zero.arcs = { A: event.arc, B: null };
        } else {
          zero.termIndex = event.beat * 2;
          zero.arcs = { A: event.arc, B: others[0] };
        }
      } else {
        zero.stage = "MS";
        zero.mastersYears = 2;
        zero.termIndex = event.node;
        zero.phase = "CORE_EVENT";
      }
      const view = currentEvent(zero);
      expect(view?.event.id).toBe(event.id);
      const available = view?.choices.filter((choice) => choice.available) ?? [];
      expect(available.length).toBeGreaterThanOrEqual(1);
      for (const choice of available) {
        const result = tryAct(zero, { type: "CHOOSE_EVENT", eventId: event.id, choiceId: choice.choice.id });
        expect(result.ok).toBe(true);
        const after = asActive(result.state);
        for (const key of ["money", "academics", "career", "wellbeing"] as const) {
          expect(Number.isInteger(after.stats[key])).toBe(true);
          expect(after.stats[key]).toBeGreaterThanOrEqual(0);
          expect(after.stats[key]).toBeLessThanOrEqual(100);
        }
      }
    }
    for (const focus of ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"] as Focus[]) {
      const zero = clone(asActive(play(start(8), policy, (s) => s.phase === "FOCUS").state));
      zero.stats = stats(0, 0, 0, 0);
      expect(focusView(zero)?.options).toHaveLength(5);
      const after = asActive(play(act(zero, { type: "CHOOSE_FOCUS", focus }), policy, (s) => s.phase === "TERM_REVIEW").state);
      for (const key of ["money", "academics", "career", "wellbeing"] as const) {
        expect(after.stats[key]).toBeGreaterThanOrEqual(0);
        expect(after.stats[key]).toBeLessThanOrEqual(100);
      }
      expect(tryAct(after, { type: "NEXT_TERM" }).ok).toBe(true);
    }
  });
});

describe("毕业、硕士与去向（03 §5、§8；06 §6）", () => {
  const policy: Policy = { economy: "MID", focus: () => "STUDY", event: () => "B" };

  /** 取一局真实走到 GRAD_PREVIEW 的本科状态，再把毕业快照改成需要的样子（只为构造边界，不经过事件）。 */
  function undergradAt(options: {
    seed?: number;
    stats: Stats;
    economy?: "LOW" | "MID" | "HIGH";
    trait?: ActiveRun["profile"]["trait"];
    outcomes: Record<"PHD" | "LOCAL_JOB" | "HOME_JOB", "OFFERED" | "NOT_OFFERED" | "INELIGIBLE">;
  }): ActiveRun {
    const base = clone(asActive(play(start(options.seed ?? 21), { ...policy, economy: options.economy ?? "MID" }, (s) => s.phase === "GRAD_RESULTS").state));
    if (options.trait) base.profile.trait = options.trait;
    base.stats = { ...options.stats };
    const grad = base.graduations.UG;
    if (!grad) throw new Error("缺少本科快照");
    grad.frozenStats = { ...options.stats };
    grad.outcomes = { ...options.outcomes };
    grad.probabilities = {
      PHD: options.outcomes.PHD === "INELIGIBLE" ? null : 50,
      LOCAL_JOB: options.outcomes.LOCAL_JOB === "INELIGIBLE" ? null : 50,
      HOME_JOB: options.outcomes.HOME_JOB === "INELIGIBLE" ? null : 50,
    };
    return base;
  }
  const none = { PHD: "NOT_OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" } as const;

  it("揭晓只发生一次；揭晓后不可再抽", () => {
    const preview = play(start(21), policy, (s) => s.phase === "GRAD_PREVIEW").state;
    const revealed = asActive(act(preview, { type: "REVEAL_GRADUATION" }));
    expect(revealed.phase).toBe("GRAD_RESULTS");
    expect(graduationView(revealed)?.revealed).toBe(true);
    const again = tryAct(revealed, { type: "REVEAL_GRADUATION" });
    expect(again.ok ? "OK" : again.error.code).toBe("WRONG_PHASE");
    for (const key of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) {
      expect(revealed.graduations.UG?.rolls?.[key]).toBe(draw01(21, `grad:UG:${key}`));
    }
  });

  it("只能接受当前检查点 OFFERED 的机会；TRANSITION 始终可选", () => {
    const run = undergradAt({ stats: stats(30, 60, 40, 30), outcomes: { PHD: "OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" } });
    const local = tryAct(run, { type: "CHOOSE_ROUTE", route: "LOCAL_JOB" });
    expect(local.ok ? "OK" : local.error.code).toBe("ROUTE_NOT_OFFERED");
    const home = tryAct(run, { type: "CHOOSE_ROUTE", route: "HOME_JOB" });
    expect(home.ok ? "OK" : home.error.code).toBe("ROUTE_NOT_OFFERED");
    expect(tryAct(run, { type: "CHOOSE_ROUTE", route: "PHD" }).ok).toBe(true);
    const transition = asActive(act(run, { type: "CHOOSE_ROUTE", route: "TRANSITION" }));
    expect(transition.ending).toMatchObject({ route: "TRANSITION", transitionMode: "SELF_CHOSEN" });
    const empty = undergradAt({ stats: stats(0, 40, 40, 0), outcomes: none });
    const noOffer = asActive(act(empty, { type: "CHOOSE_ROUTE", route: "TRANSITION" }));
    expect(noOffer.ending).toMatchObject({ route: "TRANSITION", transitionMode: "NO_OFFER", entryMode: null });
    expect(noOffer.phase).toBe("ENDING");
    // 终局后任何操作都被拒绝
    expect(tryAct(noOffer, { type: "CHOOSE_ROUTE", route: "TRANSITION" }).ok).toBe(false);
    expect(tryAct(noOffer, { type: "NEXT_TERM" }).ok).toBe(false);
  });

  it("可读硕士但放弃，过渡期仍是 NO_OFFER", () => {
    const run = undergradAt({ stats: stats(60, 80, 40, 30), outcomes: none });
    expect(mastersOptions(run).every((option) => option.eligible)).toBe(true);
    const ended = asActive(act(run, { type: "CHOOSE_ROUTE", route: "TRANSITION" }));
    expect(ended.ending?.transitionMode).toBe("NO_OFFER");
  });

  it("任一工作 OFFERED 时硕士不开放（不能先拒绝工作再当作没找到工作）", () => {
    for (const outcomes of [
      { PHD: "OFFERED", LOCAL_JOB: "OFFERED", HOME_JOB: "NOT_OFFERED" },
      { PHD: "NOT_OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "OFFERED" },
    ] as const) {
      const run = undergradAt({ stats: stats(90, 90, 60, 50), outcomes });
      const options = mastersOptions(run);
      expect(options).toHaveLength(2);
      expect(options.every((option) => !option.eligible && option.blockers.some((blocker) => blocker.code === "HAS_JOB_OFFER"))).toBe(true);
      for (const program of ["MS_1Y", "MS_2Y"] as const) {
        const result = tryAct(run, { type: "ENTER_MASTERS", program });
        expect(result.ok ? "OK" : result.error.code).toBe("MASTERS_NOT_AVAILABLE");
      }
    }
  });

  it("无工作但有博士且预算够：博士与硕士都可选", () => {
    const run = undergradAt({ stats: stats(40, 70, 40, 30), outcomes: { PHD: "OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" } });
    expect(mastersOptions(run).every((option) => option.eligible)).toBe(true);
    expect(routeOptions(run).find((option) => option.route === "PHD")?.available).toBe(true);
    expect(tryAct(run, { type: "CHOOSE_ROUTE", route: "PHD" }).ok).toBe(true);
    expect(tryAct(run, { type: "ENTER_MASTERS", program: "MS_2Y" }).ok).toBe(true);
  });

  it("学业 54 不可、55 可", () => {
    const low = undergradAt({ stats: stats(60, 54, 40, 30), outcomes: none });
    expect(mastersOptions(low).every((option) => !option.eligible)).toBe(true);
    expect(mastersOptions(low)[0].blockers.map((blocker) => blocker.code)).toEqual(["ACADEMICS_BELOW_55"]);
    expect(mastersOptions(low)[0].blockers[0].text).toContain("54");
    expect(tryAct(low, { type: "ENTER_MASTERS", program: "MS_1Y" }).ok).toBe(false);
    const ok = undergradAt({ stats: stats(60, 55, 40, 30), outcomes: none });
    expect(mastersOptions(ok).every((option) => option.eligible)).toBe(true);
    expect(tryAct(ok, { type: "ENTER_MASTERS", program: "MS_1Y" }).ok).toBe(true);
  });

  it("预算：比所需少 1 不可、刚好够可；FRUGAL 成本不同；不可选时写明差额", () => {
    const cases: Array<["LOW" | "MID" | "HIGH", ActiveRun["profile"]["trait"], number, number]> = [
      ["LOW", "FOCUSED", 20, 36],
      ["MID", "FOCUSED", 12, 20],
      ["HIGH", "FOCUSED", 8, 12],
      ["LOW", "FRUGAL", 18, 32],
      ["MID", "FRUGAL", 10, 16],
    ];
    for (const [economy, trait, oneYear, twoYears] of cases) {
      for (const [program, need] of [["MS_1Y", oneYear], ["MS_2Y", twoYears]] as const) {
        const short = undergradAt({ economy, trait, stats: stats(need - 1, 70, 40, 30), outcomes: none });
        const option = mastersOptions(short).find((item) => item.program === program);
        expect(option?.requiredReserve).toBe(need);
        expect(option?.eligible).toBe(false);
        expect(option?.blockers.map((blocker) => blocker.code)).toEqual(["FUNDS_SHORT"]);
        expect(option?.blockers[0].text).toContain(`需要预留 ${need}`);
        expect(option?.blockers[0].text).toContain("还差 1");
        expect(tryAct(short, { type: "ENTER_MASTERS", program }).ok).toBe(false);
        const enough = undergradAt({ economy, trait, stats: stats(need, 70, 40, 30), outcomes: none });
        expect(mastersOptions(enough).find((item) => item.program === program)?.eligible).toBe(true);
        expect(tryAct(enough, { type: "ENTER_MASTERS", program }).ok).toBe(true);
      }
    }
  });

  it("硕士后不出现二硕；本科旧 offer 不复活；没有机会仍能进入过渡期", () => {
    const run = undergradAt({ stats: stats(60, 80, 40, 60), outcomes: { PHD: "OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" } });
    const entered = act(run, { type: "ENTER_MASTERS", program: "MS_1Y" });
    const results = asActive(play(entered, { ...policy, focus: () => "REST" }, (s) => s.phase === "GRAD_RESULTS").state);
    expect(results.stage).toBe("MS");
    expect(stageInfo(results).title).toBe("硕士毕业机会");
    expect(mastersOptions(results)).toEqual([]);
    for (const program of ["MS_1Y", "MS_2Y"] as const) {
      const second = tryAct(results, { type: "ENTER_MASTERS", program });
      expect(second.ok ? "OK" : second.error.code).toBe("MASTERS_NOT_AVAILABLE");
    }
    // 把硕士检查点改成三路全无：本科的 PHD OFFERED 不能拿来用
    const stripped = clone(results);
    const ms = stripped.graduations.MS;
    if (!ms) throw new Error("缺少硕士快照");
    ms.outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" };
    expect(stripped.graduations.UG?.outcomes?.PHD).toBe("OFFERED");
    const revived = tryAct(stripped, { type: "CHOOSE_ROUTE", route: "PHD" });
    expect(revived.ok ? "OK" : revived.error.code).toBe("ROUTE_NOT_OFFERED");
    expect(routeOptions(stripped).filter((option) => option.available).map((option) => option.route)).toEqual(["TRANSITION"]);
    const ended = asActive(act(stripped, { type: "CHOOSE_ROUTE", route: "TRANSITION" }));
    expect(ended.ending).toMatchObject({ route: "TRANSITION", degree: "MS", transitionMode: "NO_OFFER" });
    expect(graduationView(ended, "UG")?.resolution).toBe("MASTERS");
    expect(graduationView(ended, "MS")?.resolution).toBe("TRANSITION");
  });

  it("硕士后入博记为 masters_entry", () => {
    const run = undergradAt({ stats: stats(60, 90, 40, 60), outcomes: none });
    const results = clone(asActive(play(act(run, { type: "ENTER_MASTERS", program: "MS_2Y" }), policy, (s) => s.phase === "GRAD_RESULTS").state));
    const ms = results.graduations.MS;
    if (!ms) throw new Error("缺少硕士快照");
    ms.outcomes = { PHD: "OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" };
    const ended = asActive(act(results, { type: "CHOOSE_ROUTE", route: "PHD" }));
    expect(ended.ending).toMatchObject({ route: "PHD", degree: "MS", entryMode: "masters_entry" });
  });

  it("毕业视图：资格路径、公式分解合计等于截断前的原值、上下限标注", () => {
    for (let seed = 0; seed < 30; seed++) {
      const run = asActive(play(start(seed), { ...policy, focus: (_view, state) => (["STUDY", "CAREER", "WORK", "REST"] as Focus[])[(seed + state.termIndex) % 4] }, (s) => s.phase === "GRAD_RESULTS").state);
      const view = graduationView(run);
      expect(view?.opportunities.map((item) => item.id)).toEqual(["PHD", "LOCAL_JOB", "HOME_JOB"]);
      expect(view?.opportunities.map((item) => item.name)).toEqual(["博士项目", "留美工作", "回国工作"]);
      for (const item of view?.opportunities ?? []) {
        expect(item.eligible).toBe(item.requirements.some((requirement) => requirement.met));
        expect(item.probability === null).toBe(!item.eligible);
        expect(item.breakdown[0].label).toBe("基础");
        const raw = Math.floor((item.breakdown.reduce((sum, term) => sum + term.hundredths, 0) + 50) / 100);
        const cap = item.id === "PHD" ? 85 : 95;
        if (item.probability !== null) {
          expect(item.probability).toBe(Math.min(cap, Math.max(8, raw)));
          expect(item.clampedTo).toBe(raw < 8 ? "MIN" : raw > cap ? "MAX" : null);
          expect(item.outcome).toBe((item.roll ?? 1) < item.probability / 100 ? "OFFERED" : "NOT_OFFERED");
        } else {
          expect(item.outcome).toBe("INELIGIBLE");
          expect(item.clampedTo).toBeNull();
        }
      }
    }
  });
});
