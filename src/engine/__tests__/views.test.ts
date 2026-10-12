// 只读选择器在各阶段的边界：阶段标题、学期账目、硕士学期、模板变量。

import { describe, expect, it } from "vitest";
import {
  admissionResult, currentEvent, focusView, graduationView, lastOutcome, mastersOptions, routeOptions, sceneIntro,
  stageInfo, termLedger,
} from "../index";
import type { ActiveRun, RunState } from "../index";
import { renderTemplate, tidyCjkSpacing } from "../labels";
import { act, asActive, clone, play, start } from "./helpers";
import type { Policy } from "./helpers";

const policy: Policy = { economy: "HIGH", focus: () => "CAMPUS", event: () => "B" };
const until = (phase: RunState["phase"], termIndex?: number) => (state: RunState) =>
  state.phase === phase && (termIndex === undefined || (state.phase !== "SETUP" && state.termIndex === termIndex));

describe("各阶段只暴露属于自己的视图", () => {
  it("SETUP：没有事件、投入、账目、毕业与结局视图", () => {
    const setup = start(3);
    expect(currentEvent(setup)).toBeNull();
    expect(focusView(setup)).toBeNull();
    expect(lastOutcome(setup)).toBeNull();
    expect(termLedger(setup)).toBeNull();
    expect(sceneIntro(setup)).toBeNull();
    expect(admissionResult(setup)).toBeNull();
    expect(graduationView(setup)).toBeNull();
    expect(routeOptions(setup)).toEqual([]);
    expect(mastersOptions(setup)).toEqual([]);
  });

  it("学期内：FOCUS 才有投入视图，TERM_REVIEW 才有账目，毕业前没有毕业视图与去向", () => {
    const focus = play(start(3), policy, until("FOCUS", 2)).state;
    expect(focusView(focus)).not.toBeNull();
    expect(currentEvent(focus)).toBeNull();
    expect(termLedger(focus)).toBeNull();
    expect(graduationView(focus)).toBeNull();
    expect(routeOptions(focus)).toEqual([]);
    expect(mastersOptions(focus)).toEqual([]);
    expect(sceneIntro(focus)).toBeNull(); // 入学旁白只在本科第 1 学期出现
    const event = play(focus, policy, until("CORE_EVENT")).state;
    expect(focusView(event)).toBeNull();
    expect(currentEvent(event)?.event.id).toBe("CORE_02");
    const review = play(event, policy, until("TERM_REVIEW")).state;
    expect(currentEvent(review)).toBeNull();
    expect(termLedger(review)?.termIndex).toBe(2);
  });

  it("毕业预览阶段还不能选去向；揭晓后才有四个去向与两个硕士方案", () => {
    const preview = play(start(3), policy, until("GRAD_PREVIEW")).state;
    expect(routeOptions(preview)).toEqual([]);
    expect(mastersOptions(preview)).toEqual([]);
    expect(graduationView(preview)?.revealed).toBe(false);
    const results = act(preview, { type: "REVEAL_GRADUATION" });
    expect(routeOptions(results).map((option) => option.route)).toEqual(["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"]);
    expect(routeOptions(results).map((option) => option.name)).toEqual(["博士项目", "留美工作", "回国工作", "过渡期"]);
    expect(routeOptions(results).every((option) => option.note.length > 0)).toBe(true);
    expect(mastersOptions(results).map((option) => option.program)).toEqual(["MS_1Y", "MS_2Y"]);
    expect(mastersOptions(results).map((option) => option.name)).toEqual(["再读一年硕士", "再读两年硕士"]);
    for (const option of mastersOptions(results)) {
      expect(option.eligible).toBe(option.blockers.length === 0);
      expect(option.money).toBe(asActive(results).stats.money);
    }
  });

  it("本科最后一学期的账目标记为最终学期；结局阶段标题为人生回顾", () => {
    const last = play(start(3), policy, until("TERM_REVIEW", 8)).state;
    expect(termLedger(last)).toMatchObject({ termIndex: 8, termCount: 8, isFinalTerm: true, title: "本科 · 毕业前" });
    expect(stageInfo(last)).toMatchObject({ title: "本科 · 毕业前", step: "节点 8 / 8" });
    const end = play(last, policy).state;
    expect(stageInfo(end)).toMatchObject({ stage: "END", title: "人生回顾", step: null });
    expect(routeOptions(end)).toEqual([]);
  });
});

describe("硕士学期的视图", () => {
  function mastersStart(program: "MS_1Y" | "MS_2Y"): ActiveRun {
    const results = clone(asActive(play(start(3), policy, until("GRAD_RESULTS")).state));
    const grad = results.graduations.UG;
    if (!grad) throw new Error("缺少本科快照");
    grad.outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "NOT_OFFERED", HOME_JOB: "NOT_OFFERED" };
    grad.frozenStats.academics = 70;
    return asActive(act(results, { type: "ENTER_MASTERS", program }));
  }

  it("一年制：节点 1/2、2/2，事件 MASTER_01 → MASTER_04，第一学期账目含入学费", () => {
    let run = mastersStart("MS_1Y");
    expect(stageInfo(run)).toMatchObject({ stage: "MS", title: "硕士 · 第 1 学期", step: "节点 1 / 2", termCount: 2 });
    expect(sceneIntro(run)).toBeNull();
    expect(lastOutcome(run)).toMatchObject({ kind: "MASTERS_FEE", heading: "再读一年硕士" });
    expect(lastOutcome(run)?.delta.applied.money).toBe(-8);
    expect(focusView(run)?.stipend.requested.money).toBe(14);
    run = asActive(act(run, { type: "CHOOSE_FOCUS", focus: "STUDY" }));
    expect(currentEvent(run)).toMatchObject({ kindLabel: "硕士" });
    expect(currentEvent(run)?.event.id).toBe("MASTER_01");
    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "MASTER_01", choiceId: "A" }));
    expect(run.phase).toBe("TERM_REVIEW");
    expect(termLedger(run)?.lines.map((line) => line.kind)).toEqual(["MASTERS_FEE", "STIPEND", "FOCUS", "EVENT", "UPKEEP", "GROWTH"]);
    expect(termLedger(run)).toMatchObject({ stage: "MS", termIndex: 1, termCount: 2, isFinalTerm: false, title: "硕士 · 第 1 学期" });
    run = asActive(act(run, { type: "NEXT_TERM" }));
    expect(stageInfo(run).step).toBe("节点 2 / 2");
    run = asActive(act(run, { type: "CHOOSE_FOCUS", focus: "CAREER" }));
    const final = currentEvent(run);
    expect(final?.event.id).toBe("MASTER_04");
    // 没经历 02/03：只有 MASTER_01 的回响命中，正文独立成立
    expect(final?.matchedCallbacks.map((callback) => callback.ifFlag)).toEqual(["MASTER_01_A"]);
    run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: "MASTER_04", choiceId: "B" }));
    expect(termLedger(run)?.isFinalTerm).toBe(true);
    expect(termLedger(run)?.lines.map((line) => line.kind)).toEqual(["STIPEND", "FOCUS", "EVENT", "UPKEEP", "GROWTH"]);
    run = asActive(act(run, { type: "NEXT_TERM" }));
    expect(run.phase).toBe("GRAD_PREVIEW");
    expect(stageInfo(run).title).toBe("硕士毕业机会");
    const view = graduationView(run);
    expect(view?.degree).toBe("MS");
    // 硕士检查点：应用项目带来留美与回国工作资格
    expect(view?.opportunities.find((item) => item.id === "LOCAL_JOB")?.requirements.some((requirement) => requirement.text.includes("硕士应用项目") && requirement.met)).toBe(true);
    expect(graduationView(run, "UG")?.resolution).toBe("MASTERS");
  });

  it("两年制：四个学期依次 MASTER_01–04，最后一张事件按数组顺序默认显示最后一条命中的回响", () => {
    let run = mastersStart("MS_2Y");
    const seen: string[] = [];
    for (let term = 1; term <= 4; term++) {
      expect(stageInfo(run)).toMatchObject({ title: `硕士 · 第 ${term} 学期`, step: `节点 ${term} / 4` });
      run = asActive(act(run, { type: "CHOOSE_FOCUS", focus: "REST" }));
      const view = currentEvent(run);
      seen.push(view?.event.id ?? "");
      if (term === 4) {
        expect(view?.matchedCallbacks.map((callback) => callback.ifFlag)).toEqual(["MASTER_01_B", "MASTER_02_B", "MASTER_03_B"]);
        expect(view?.defaultCallback?.ifFlag).toBe("MASTER_03_B");
      }
      run = asActive(act(run, { type: "CHOOSE_EVENT", eventId: view?.event.id ?? "", choiceId: "B" }));
      expect(run.arcs).toEqual(asActive(play(start(3), policy, until("GRAD_RESULTS")).state).arcs);
      if (term < 4) run = asActive(act(run, { type: "NEXT_TERM" }));
    }
    expect(seen).toEqual(["MASTER_01", "MASTER_02", "MASTER_03", "MASTER_04"]);
  });
});

describe("入学旁白里的校名与城市", () => {
  function enrolled(nameZh: string | null, name: string, city: string): RunState {
    const offers = clone(asActive(play(start(3), policy, until("SCHOOL_OFFERS")).state));
    const first = (offers.offers ?? [])[0];
    first.nameZh = nameZh;
    first.name = name;
    first.city = city;
    return act(offers, { type: "CHOOSE_SCHOOL", unitid: first.unitid });
  }

  it("中文校名前后不留多余空格，英文城市两侧的空格保留", () => {
    const intro = sceneIntro(enrolled("本特利大学", "Bentley University", "Waltham"));
    expect(intro?.short).toBe("你拖着行李来到本特利大学。高中时的准备把你带到了这里。接下来这段生活，最后会去向哪里，仍要在选择中寻找。");
    expect(intro?.long.startsWith("到达 Waltham 后，你终于在地图上找到本特利大学。行李箱的轮子卡了一下")).toBe(true);
  });

  it("英文校名两侧的空格保留；城市缺失时写“这座城市”且不留空格", () => {
    const intro = sceneIntro(enrolled(null, "Bentley University", ""));
    expect(intro?.short.startsWith("你拖着行李来到 Bentley University。")).toBe(true);
    expect(intro?.long.startsWith("到达这座城市后，你终于在地图上找到 Bentley University。")).toBe(true);
  });

  it("整理只去掉中日韩文字（或全角标点）与中日韩文字之间的空白", () => {
    expect(tidyCjkSpacing("来到 本特利大学。")).toBe("来到本特利大学。");
    expect(tidyCjkSpacing("从来到 本特利大学 到本科毕业")).toBe("从来到本特利大学到本科毕业");
    expect(tidyCjkSpacing("三所 offer 中选择了 CMU。")).toBe("三所 offer 中选择了 CMU。");
    expect(tidyCjkSpacing("准备度为 65，你")).toBe("准备度为 65，你");
    expect(tidyCjkSpacing("来到 UC 伯克利")).toBe("来到 UC 伯克利");
    expect(tidyCjkSpacing("结束。 下一句")).toBe("结束。下一句");
    expect(tidyCjkSpacing("University of Redlands, Los Angeles")).toBe("University of Redlands, Los Angeles");
  });
});

describe("模板变量（06 §2）", () => {
  const school = { unitid: "1", name: "Example University", nameZh: null, city: "", state: "ZZ", tier: "B", group: "NU", tierBasis: "APPROXIMATE", rank: null } as const;

  it("只允许三个变量；城市缺失时显示“这座城市”，名字为空显示“你”", () => {
    expect(renderTemplate("到达 {{school.city}} 的 {{school.name}}，{{player.name}}。", school, "")).toBe("到达 这座城市 的 Example University，你。");
    expect(renderTemplate("{{school.name}}", { ...school, nameZh: "示例大学", city: "Springfield" }, "阿原")).toBe("示例大学");
    expect(renderTemplate("{{ player.name }}", school, "阿原")).toBe("阿原");
    expect(renderTemplate("没有变量", null, "")).toBe("没有变量");
  });

  it("未知变量与选校前使用学校变量都是内容错误", () => {
    expect(() => renderTemplate("{{school.rank}}", school, "")).toThrow("UNKNOWN_TEMPLATE_VARIABLE");
    expect(() => renderTemplate("{{school.name}}", null, "")).toThrow("TEMPLATE_WITHOUT_SCHOOL");
  });

  it("校名按纯文本替换，不解析其中的标记", () => {
    const tricky = { ...school, nameZh: "<b>{{player.name}}</b>" };
    expect(renderTemplate("{{school.name}}", tricky, "X")).toBe("<b>{{player.name}}</b>");
  });
});
