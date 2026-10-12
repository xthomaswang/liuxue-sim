// @vitest-environment jsdom
// 用真实按钮从开局点到结局，并在关键节点“刷新”（卸载再挂载）验证存档恢复。

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ENDING_CARDS, EVENT_BY_ID } from "../../content";
import { focusView, mastersOptions, routeOptions } from "../../engine";
import type { Action, RunState } from "../../engine";
import {
  acceptFirstOffer,
  advanceUntil,
  app,
  atUndergradResults,
  click,
  counters,
  findSeed,
  makePolicy,
  mainText,
  mount,
  newTrail,
  phase,
  revision,
  savedState,
  scholarPolicy,
  seededStorage,
  simulate,
  stats,
  steadyPolicy,
  step,
  thrifty,
} from "./harness";

afterEach(() => cleanup());

const planButtons = () => Array.from(app().querySelectorAll<HTMLButtonElement>("button[data-testid^='plan-']"));
const count = (actions: Action[], type: Action["type"]) => actions.filter((action) => action.type === type).length;

/** 每一屏都要满足的约定：没有展开按钮；事件只出摘要，不出长正文。 */
function everyScreen(state: RunState) {
  expect(app().querySelectorAll("[aria-expanded]").length).toBe(0);
  if (state.phase === "HIGH_SCHOOL_EVENT" || state.phase === "CORE_EVENT" || state.phase === "ARC_EVENT") {
    const id = screen.getByTestId("screen-event").getAttribute("data-event-id") ?? "";
    const event = EVENT_BY_ID[id];
    expect(screen.getByTestId("event-summary").textContent).toBe(event.summary);
    // 新写的随机事件与变体本来就只有一段短文（body 与 summary 相同）；有长正文的事件不显示长正文。
    if (event.body !== event.summary) expect(mainText()).not.toContain(event.body);
  }
  if (state.phase === "FOCUS") {
    const view = focusView(state);
    expect(planButtons().length).toBe(view?.options.length);
    if (view?.happening) expect(screen.getByTestId("happening").textContent).toContain(view.happening.text);
    else expect(screen.queryByTestId("happening")).toBeNull();
  }
}

describe("完整一局：本科直接结束", () => {
  it("从开局点到结局，每一屏都是“描述 + 选项”，该有的要素都在", async () => {
    const storage = seededStorage(20261011);
    await mount(storage);
    const trail = newTrail();
    const go = () => step(storage, steadyPolicy, trail, everyScreen);

    // 开局：出身是抽的，十张天赋选三张
    expect(phase()).toBe("SETUP");
    expect(screen.getByTestId("sample-banner")).toBeTruthy();
    expect(screen.getByTestId("origin-card").textContent).toContain("抽出来的，不能选");
    expect(screen.getByTestId("base-readiness").textContent).toMatch(/^申请准备度 \d+$/);
    expect(app().querySelectorAll("button[data-testid^='talent-']").length).toBe(10);
    expect((screen.getByTestId("start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("stat-money")).toBeNull();
    await go();

    // 高中两张事件
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_01");
    expect(screen.queryByTestId("scene-intro")).toBeNull();
    expect(screen.getByTestId("choice-A").textContent).toContain("申请准备 +10");
    expect(screen.getByTestId("choice-B").textContent).toContain("申请准备 +6");
    await go();
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_02");
    const hs01 = EVENT_BY_ID.HS_01.choices[0];
    expect(screen.getByTestId("last-outcome").textContent).toContain(hs01.shortResult);
    expect(mainText()).not.toContain(hs01.result);
    expect(screen.getByTestId("choice-A").textContent).toContain("未分档");
    await go();

    // 申请结果与三校
    expect(phase()).toBe("SCHOOL_OFFERS");
    expect(screen.getByTestId("tier-drawn").textContent).toMatch(/^申请准备度 \d+ = 基础 \d+ \+ 天赋 -?\d+ \+ 高中准备 \d+ · .+方案 · 抽中 /);
    const offerIds = [0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"));
    expect(new Set(offerIds).size).toBe(3);
    expect(screen.queryByTestId("offer-3")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await go();

    // 本科第 1 学期：入学短旁白、资助、四个安排
    expect(phase()).toBe("FOCUS");
    expect(screen.getByTestId("scene-intro")).toBeTruthy();
    expect(screen.getByTestId("term-account").textContent).toMatch(/资助 \+\d+.* · 期末必要开销 \d+/);
    expect(screen.queryByTestId("term-settlement")).toBeNull();
    expect(planButtons().length).toBe(4);
    expect(new Set(planButtons().map((button) => button.getAttribute("data-focus"))).size).toBe(4);
    await go();
    expect(phase()).toBe("CORE_EVENT");
    expect(screen.getByTestId("last-outcome")).toBeTruthy();
    await go();

    // 没有学期小结这一步：直接进入下一学期，上学期的结算是一行小字
    await advanceUntil(storage, steadyPolicy, trail, () => phase() === "FOCUS", everyScreen);
    expect(screen.getByTestId("term-settlement").textContent).toMatch(/^上学期结算/);
    expect(screen.queryByTestId("scene-intro")).toBeNull();
    expect(screen.queryByTestId("next-term")).toBeNull();

    // 走完本科
    await advanceUntil(storage, steadyPolicy, trail, () => phase() === "GRAD_PREVIEW", everyScreen);
    expect(count(trail.actions, "CHOOSE_PLAN")).toBe(8);
    expect(count(trail.actions, "CHOOSE_EVENT")).toBe(2 + 8 + 6);
    expect(screen.getByTestId("term-settlement").textContent).toMatch(/^最后一学期结算/);
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) {
      expect(screen.getByTestId(`opportunity-${id}`).textContent).toMatch(/概率 \d+%|准备尚不足/);
      expect(screen.queryByTestId(`outcome-${id}`)).toBeNull();
    }
    await go();

    // 结果与去向
    expect(phase()).toBe("GRAD_RESULTS");
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) {
      const outcome = screen.getByTestId(`outcome-${id}`).textContent;
      expect(outcome).toMatch(/^(取得机会|这次没有取得|准备尚不足)$/);
      // 去向按钮只在取得机会时出现。
      expect(screen.queryByTestId(`route-${id}`) !== null).toBe(outcome === "取得机会");
    }
    expect(screen.queryByTestId("term-settlement")).toBeNull();
    expect((screen.getByTestId("route-TRANSITION") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("masters-section")).toBeTruthy();
    expect(screen.getByTestId("masters-MS_1Y")).toBeTruthy();
    expect(screen.getByTestId("masters-MS_2Y")).toBeTruthy();
    await go();

    // 结局
    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("本科毕业");
    expect(screen.getByTestId("ending-short").textContent?.length).toBeGreaterThan(20);
    expect(screen.getByTestId("ending-epilogue").textContent).toMatch(/^五年后/);
    const card = screen.getByTestId("ending-card");
    const tier = ENDING_CARDS.tiers.find((item) => item.id === card.getAttribute("data-tier"));
    expect(tier).toBeTruthy();
    expect(screen.getByTestId("card-tier").textContent).toBe(tier?.label);
    expect(screen.getByTestId("card-combo").textContent).toContain(tier?.label ?? "?");
    expect(card.textContent).toContain(ENDING_CARDS.disclaimer);
    expect(screen.getByTestId("card-facts").querySelectorAll("li").length).toBeGreaterThan(0);
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) expect(screen.getAllByTestId(`outcome-${id}`).length).toBe(1);
    expect(screen.getByTestId("ending-talents").querySelectorAll(".rarity").length).toBe(3);

    // 唯一的展开：回看这次经历，只列标题与当时的选择
    const expanders = Array.from(app().querySelectorAll("[aria-expanded]"));
    expect(expanders.map((node) => node.getAttribute("data-testid"))).toEqual(["look-back"]);
    expect(screen.queryByTestId("full-review")).toBeNull();
    await click("look-back");
    const review = screen.getByTestId("full-review");
    expect(review.querySelectorAll("[data-testid^='review-']").length).toBe(7);
    expect(screen.getByTestId("review-HS_01").textContent).toContain("你选择了：");
    for (const action of trail.actions) {
      if (action.type !== "CHOOSE_EVENT") continue;
      const chosen = EVENT_BY_ID[action.eventId].choices.find((choice) => choice.id === action.choiceId);
      expect(review.textContent).not.toContain(chosen?.result ?? "?");
    }

    // 结局后重开不需要确认
    await click("play-again");
    expect(phase()).toBe("SETUP");
  });

  it("手里有机会时接受它：博士显示本科直博，工作显示本科毕业", async () => {
    const policy = makePolicy({ planOrder: ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"], choice: thrifty, atResults: acceptFirstOffer });
    const seed = findSeed((candidate) => {
      const state = simulate(candidate, policy, atUndergradResults);
      return routeOptions(state).some((option) => option.available && option.route !== "TRANSITION");
    });
    const storage = seededStorage(seed);
    await mount(storage);
    const trail = newTrail();
    await advanceUntil(storage, policy, trail, () => phase() === "ENDING");
    const last = trail.actions[trail.actions.length - 1];
    expect(last.type).toBe("CHOOSE_ROUTE");
    const route = last.type === "CHOOSE_ROUTE" ? last.route : "TRANSITION";
    expect(route).not.toBe("TRANSITION");
    expect(screen.getByTestId("ending-label").textContent).toBe(route === "PHD" ? "本科直博 · 即将入学" : "本科毕业");
  });
});

describe("完整一局：硕士路线", () => {
  // 偏学习、省钱的打法下，本科结束时两个硕士方案都可选的第一个种子。
  const mastersSeed = () =>
    findSeed((candidate) => {
      const options = mastersOptions(simulate(candidate, scholarPolicy, atUndergradResults));
      return options.length === 2 && options.every((option) => option.eligible);
    });

  it("两年硕士（最长路线）能走到结局；统计默认路径的点击次数与要读的字数", async () => {
    const seed = mastersSeed();
    const storage = seededStorage(seed);
    await mount(storage);
    counters.clicks = 0;
    const trail = newTrail();
    await advanceUntil(storage, scholarPolicy, trail, () => phase() === "GRAD_RESULTS", everyScreen);
    expect((screen.getByTestId("masters-MS_1Y") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("masters-MS_2Y") as HTMLButtonElement).disabled).toBe(false);
    // 两种工作都没取得才会开放硕士：去向里只列能选的，所以没有这两个按钮。
    expect(screen.queryByTestId("route-LOCAL_JOB")).toBeNull();
    expect(screen.queryByTestId("route-HOME_JOB")).toBeNull();
    expect(screen.getByTestId("route-TRANSITION")).toBeTruthy();

    await step(storage, scholarPolicy, trail, everyScreen);
    expect(trail.actions[trail.actions.length - 1]).toEqual({ type: "ENTER_MASTERS", program: "MS_2Y" });
    expect(phase()).toBe("FOCUS");
    expect(screen.getByTestId("stage-title").textContent).toContain("硕士");
    expect(screen.getByTestId("last-outcome").textContent).toContain("资金 -12");

    await advanceUntil(storage, scholarPolicy, trail, () => phase() === "GRAD_RESULTS", everyScreen);
    expect(count(trail.actions, "CHOOSE_PLAN")).toBe(12);
    expect(trail.actions.filter((action) => action.type === "CHOOSE_EVENT").slice(-4).map((action) => (action.type === "CHOOSE_EVENT" ? action.eventId : ""))).toEqual([
      "MASTER_01",
      "MASTER_02",
      "MASTER_03",
      "MASTER_04",
    ]);
    // 硕士检查点不再出现续读硕士。
    expect(screen.queryByTestId("masters-section")).toBeNull();
    await step(storage, scholarPolicy, trail, everyScreen);

    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("两年制硕士毕业");
    trail.screenChars.push(mainText().length);
    await click("look-back");
    expect(screen.getByTestId("review-MASTER_04")).toBeTruthy();
    expect(screen.getByTestId("full-review").querySelectorAll("[data-testid^='review-']").length).toBe(8);

    // 4（三张天赋 + 开始）+ 2 高中 + 1 选校 + 本科 8×(安排 + 主线) + 6 支线 + 揭晓 + 选硕士
    // + 硕士 4×(安排 + 事件) + 揭晓 + 去向 = 41；最后那次“回看”不计入通关路径。
    const pathClicks = counters.clicks - 1;
    const chars = trail.screenChars.reduce((sum, value) => sum + value, 0);
    console.info(`最长路线（两年硕士，seed ${seed}）：${pathClicks} 次点击，${trail.screenChars.length} 屏，默认界面共 ${chars} 字`);
    expect(pathClicks).toBe(41);
  });

  it("一年硕士：入学费只扣一次，走 MASTER_01 → MASTER_04", async () => {
    const seed = mastersSeed();
    const oneYear = makePolicy({
      planOrder: ["STUDY", "REST", "WORK", "CAMPUS", "CAREER"],
      choice: thrifty,
      atResults: (state) =>
        state.phase !== "SETUP" && state.stage === "UG"
          ? { type: "ENTER_MASTERS", program: "MS_1Y" }
          : { type: "CHOOSE_ROUTE", route: "TRANSITION" },
    });
    const storage = seededStorage(seed);
    await mount(storage);
    const trail = newTrail();
    await advanceUntil(storage, oneYear, trail, () => phase() === "ENDING");
    expect(count(trail.actions, "CHOOSE_PLAN")).toBe(10);
    expect(trail.actions.filter((action) => action.type === "CHOOSE_EVENT").slice(-2).map((action) => (action.type === "CHOOSE_EVENT" ? action.eventId : ""))).toEqual([
      "MASTER_01",
      "MASTER_04",
    ]);
    expect(screen.getByTestId("ending-label").textContent).toBe("一年制硕士毕业");
    const state = savedState(storage);
    expect(state.phase !== "SETUP" && state.history.filter((entry) => entry.kind === "MASTERS_FEE").length).toBe(1);
  });

  it("刷新恢复：在高中、选校、支线、本科结果、进入硕士后、硕士结果、结局分别卸载再挂载，状态与抽取结果不变", async () => {
    const storage = seededStorage(mastersSeed());
    let view = await mount(storage);
    const trail = newTrail();

    const fingerprint = () => ({
      phase: phase(),
      revision: revision(),
      runId: app().getAttribute("data-run-id"),
      stats: screen.queryByTestId("stat-money") ? stats() : null,
      screen: mainText(),
    });
    const refresh = async () => {
      const before = fingerprint();
      const saved = storage.dump();
      view.unmount();
      view = await mount(storage);
      expect(fingerprint()).toEqual(before);
      // 读档不产生新的结算，也不改写存档。
      expect(storage.dump()).toEqual(saved);
    };
    const until = (target: () => boolean) => advanceUntil(storage, scholarPolicy, trail, target);

    // 开局：出身与十张天赋不因刷新而重抽
    await refresh();

    // 高中：选完 HS_01 之后
    await step(storage, scholarPolicy, trail);
    await step(storage, scholarPolicy, trail);
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_02");
    await refresh();

    // 选校：三所 offer 不重抽
    await until(() => phase() === "SCHOOL_OFFERS");
    const offers = [0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"));
    await refresh();
    expect([0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"))).toEqual(offers);

    // 进入本科第 1 学期：资助与突发小事只结算一次
    await until(() => phase() === "FOCUS");
    await refresh();

    // 支线事件中
    await until(() => phase() === "ARC_EVENT");
    await refresh();

    // 本科结果揭晓后：机会结果不重抽
    await until(() => phase() === "GRAD_RESULTS");
    const outcomes = ["PHD", "LOCAL_JOB", "HOME_JOB"].map((id) => screen.getByTestId(`outcome-${id}`).textContent);
    await refresh();
    expect(["PHD", "LOCAL_JOB", "HOME_JOB"].map((id) => screen.getByTestId(`outcome-${id}`).textContent)).toEqual(outcomes);

    // 扣过硕士入学费之后：不重复扣费，也不重复发资助
    await step(storage, scholarPolicy, trail);
    expect(screen.getByTestId("stage-title").textContent).toContain("硕士");
    await refresh();

    // 硕士结果揭晓后
    await until(() => phase() === "GRAD_RESULTS");
    await refresh();

    // 结局：卡片不重算
    await step(storage, scholarPolicy, trail);
    expect(phase()).toBe("ENDING");
    const combo = screen.getByTestId("card-combo").textContent;
    await refresh();
    expect(screen.getByTestId("card-combo").textContent).toBe(combo);
  });
});
