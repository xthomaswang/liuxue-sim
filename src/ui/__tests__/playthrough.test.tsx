// @vitest-environment jsdom
// 用真实按钮从开局点到结局，并在关键节点“刷新”（卸载再挂载）验证存档恢复。

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ENDING_CARDS, EVENT_BY_ID } from "../../content";
import {
  advanceUntil,
  app,
  click,
  counters,
  mount,
  newTrail,
  phase,
  revision,
  seed13Policy,
  seededStorage,
  stats,
  step,
} from "./harness";
import type { Policy } from "./harness";

afterEach(() => cleanup());

const steadyPolicy: Policy = {
  economy: "MID",
  aspiration: "BELONGING",
  focus: (index) => (["STUDY", "CAREER", "CAMPUS", "REST"] as const)[index % 4],
};

describe("完整一局：本科直接结束", () => {
  it("从开局点到结局，每个阶段该有的要素都在", async () => {
    await mount(seededStorage(20261011));
    const trail = newTrail();

    // 开局
    expect(phase()).toBe("SETUP");
    expect(screen.getByTestId("sample-banner")).toBeTruthy();
    for (const economy of ["LOW", "MID", "HIGH"]) expect(screen.getByTestId(`family-card-${economy}`)).toBeTruthy();
    expect(screen.getByTestId("base-readiness").textContent).toMatch(/^申请准备度 \d+$/);
    expect((screen.getByTestId("start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("stat-money")).toBeNull();
    await step(steadyPolicy, trail);

    // 高中两张事件
    expect(phase()).toBe("HIGH_SCHOOL_EVENT");
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_01");
    expect(screen.getByTestId("scene-intro")).toBeTruthy();
    expect(screen.getByTestId("choice-A").textContent).toContain("本次申请准备 +10");
    expect(screen.getByTestId("choice-B").textContent).toContain("本次申请准备 +6");
    await step(steadyPolicy, trail);
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_02");
    expect(screen.getByTestId("last-outcome").textContent).toContain(EVENT_BY_ID.HS_01.choices[0].shortResult);
    expect(screen.getByTestId("choice-A").textContent).toMatch(/冲刺方案的各档概率/);
    expect(screen.getByTestId("choice-A").textContent).toContain("未分档");
    await step(steadyPolicy, trail);

    // 申请结果与三校
    expect(phase()).toBe("SCHOOL_OFFERS");
    expect(screen.getByTestId("tier-drawn").textContent).toMatch(/抽中的档次：/);
    const offerIds = [0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"));
    expect(new Set(offerIds).size).toBe(3);
    expect(screen.queryByTestId("offer-3")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await step(steadyPolicy, trail);

    // 本科第 1 学期
    expect(phase()).toBe("FOCUS");
    expect(screen.getByTestId("scene-intro")).toBeTruthy();
    expect(screen.getByTestId("term-account").textContent).toMatch(/本学期资助 \+10/);
    expect(screen.getByTestId("term-account").textContent).toMatch(/期末必要开销 1[12]/);
    for (const focus of ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"]) expect(screen.getByTestId(`focus-${focus}`)).toBeTruthy();
    await step(steadyPolicy, trail);
    expect(phase()).toBe("CORE_EVENT");
    expect(screen.getByTestId("last-outcome")).toBeTruthy();
    expect(screen.getByTestId("choice-A").textContent).toMatch(/预计本学期结算后资金 \d+（必要开销 1[12]）/);
    await step(steadyPolicy, trail);
    expect(phase()).toBe("TERM_REVIEW");
    expect(screen.getByTestId("term-ledger").querySelectorAll("li").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId("next-term").textContent).toBe("继续");

    // 走完本科
    await advanceUntil(steadyPolicy, trail, () => phase() === "GRAD_PREVIEW");
    expect(trail.focusCount).toBe(8);
    expect(trail.events.filter((id) => id.startsWith("CORE_")).length).toBe(8);
    expect(trail.events.filter((id) => id.startsWith("ARC_")).length).toBe(6);
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) {
      const card = screen.getByTestId(`opportunity-${id}`);
      expect(card.textContent).toMatch(/概率 \d+%|准备尚不足/);
      expect(screen.queryByTestId(`outcome-${id}`)).toBeNull();
    }
    await step(steadyPolicy, trail);

    // 结果与去向
    expect(phase()).toBe("GRAD_RESULTS");
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) {
      expect(screen.getByTestId(`outcome-${id}`).textContent).toMatch(/取得机会|这次没有取得|准备尚不足/);
    }
    expect((screen.getByTestId("route-TRANSITION") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("masters-section")).toBeTruthy();
    expect(screen.getByTestId("masters-MS_1Y")).toBeTruthy();
    expect(screen.getByTestId("masters-MS_2Y")).toBeTruthy();
    await click("route-TRANSITION");

    // 结局
    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("本科毕业");
    expect(screen.getByTestId("ending-short").textContent?.length).toBeGreaterThan(20);
    const card = screen.getByTestId("ending-card");
    const tier = ENDING_CARDS.tiers.find((item) => item.id === card.getAttribute("data-tier"));
    expect(tier).toBeTruthy();
    expect(screen.getByTestId("card-tier").textContent).toBe(tier?.label);
    expect(screen.getByTestId("card-combo").textContent).toContain(tier?.label ?? "?");
    expect(card.textContent).toContain(ENDING_CARDS.disclaimer);
    for (const id of ["PHD", "LOCAL_JOB", "HOME_JOB"]) expect(screen.getAllByTestId(`outcome-${id}`).length).toBe(1);
    expect(screen.getByTestId("play-again")).toBeTruthy();
    expect(screen.getByTestId("replay-seed")).toBeTruthy();

    // 完整回顾默认折叠；本科终局七条回顾
    expect(screen.queryByTestId("review-CORE_01")).toBeNull();
    await click("look-back");
    for (const id of ["HS_01", "HS_02", "CORE_01", "CORE_04", "CORE_08"]) expect(screen.getByTestId(`review-${id}`)).toBeTruthy();
    expect(screen.getByTestId("full-review").querySelectorAll("[data-testid^='review-']").length).toBe(7);
    expect(screen.queryByTestId("undergrad-opportunities")).toBeNull();

    // 结局后重开不需要确认
    await click("play-again");
    expect(phase()).toBe("SETUP");
  });
});

describe("完整一局：seed=13 的硕士路线（docs/09 第 3 节）", () => {
  async function toUndergradResults() {
    const trail = newTrail();
    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    return trail;
  }

  it("本科结束时的属性与机会与文档一致，一年硕士能走到结局", async () => {
    await mount(seededStorage(13));
    const trail = await toUndergradResults();

    expect(trail.events).toEqual([
      "HS_01_A", "HS_02_B", "CORE_01_B", "CORE_02_B", "ARC_CREATIVE_1_B", "CORE_03_B", "ARC_RESEARCH_1_B",
      "CORE_04_B", "ARC_CREATIVE_2_B", "CORE_05_B", "ARC_RESEARCH_2_A", "CORE_06_A", "ARC_CREATIVE_3_B",
      "CORE_07_A", "ARC_RESEARCH_3_A", "CORE_08_A",
    ]);
    expect(stats()).toEqual({ money: 53, academics: 100, career: 69, wellbeing: 0 });
    expect(screen.getByTestId("opportunity-PHD").textContent).toContain("概率 83%");
    expect(screen.getByTestId("outcome-PHD").textContent).toBe("取得机会");
    expect(screen.getByTestId("opportunity-LOCAL_JOB").textContent).toContain("准备尚不足");
    expect(screen.getByTestId("opportunity-HOME_JOB").textContent).toContain("概率 91%");
    expect(screen.getByTestId("outcome-HOME_JOB").textContent).toBe("这次没有取得");
    // 博士已取得、两种工作未取得：博士与两个硕士方案都可选，没取得的工作不可选。
    expect((screen.getByTestId("route-PHD") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("route-HOME_JOB") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("route-LOCAL_JOB") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("masters-MS_1Y") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("masters-MS_2Y") as HTMLButtonElement).disabled).toBe(false);

    await click("masters-MS_1Y");
    expect(phase()).toBe("FOCUS");
    // 入学费 8 只扣一次，随后发放硕士第 1 学期资助 6。
    expect(stats().money).toBe(53 - 8 + 6);
    expect(screen.getByTestId("last-outcome")).toBeTruthy();

    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    expect(trail.focusCount).toBe(10);
    expect(trail.events.slice(16)).toEqual(["MASTER_01_A", "MASTER_04_A"]);
    // 硕士检查点不再出现续读硕士。
    expect(screen.queryByTestId("masters-section")).toBeNull();
    await click("route-TRANSITION");

    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("一年制硕士毕业");
    await click("toggle-full-review");
    expect(screen.getByTestId("review-MASTER_04")).toBeTruthy();
    expect(screen.getByTestId("full-review").querySelectorAll("[data-testid^='review-']").length).toBe(8);
    expect(screen.getByTestId("undergrad-opportunities").textContent).toContain("已在进入硕士时放弃");
  });

  it("两年硕士（最长路线）能走到结局，并统计默认路径的点击次数", async () => {
    await mount(seededStorage(13));
    counters.clicks = 0;
    const trail = await toUndergradResults();
    await click("masters-MS_2Y");
    expect(stats().money).toBe(53 - 12 + 6);
    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    expect(trail.focusCount).toBe(12);
    expect(trail.events.slice(16)).toEqual(["MASTER_01_A", "MASTER_02_A", "MASTER_03_A", "MASTER_04_A"]);
    await click("route-TRANSITION");
    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("两年制硕士毕业");
    // 3（家庭、愿望、开始）+ 2 高中 + 1 选校 + 本科 8×(投入+主线+继续) + 6 支线 + 揭晓 + 选硕士
    // + 硕士 4×(投入+事件+继续) + 揭晓 + 去向 = 52
    console.info(`最长路线（两年硕士）默认路径点击次数：${counters.clicks}`);
    expect(counters.clicks).toBe(52);
  });

  it("接受本科博士直接结束，标签是本科直博", async () => {
    await mount(seededStorage(13));
    await toUndergradResults();
    await click("route-PHD");
    expect(phase()).toBe("ENDING");
    expect(screen.getByTestId("ending-label").textContent).toBe("本科直博 · 即将入学");
  });
});

describe("刷新恢复", () => {
  it("在高中、选校、支线、本科结果、进入硕士后、结局分别卸载再挂载，状态与抽取结果不变", async () => {
    const storage = seededStorage(13);
    let view = await mount(storage);
    const trail = newTrail();

    const fingerprint = () => ({
      phase: phase(),
      revision: revision(),
      runId: app().getAttribute("data-run-id"),
      stats: screen.queryByTestId("stat-money") ? stats() : null,
      screen: app().querySelector("main")?.textContent,
    });
    const refresh = async () => {
      const before = fingerprint();
      view.unmount();
      view = await mount(storage);
      expect(fingerprint()).toEqual(before);
    };

    // 高中：选完 HS_01 之后
    await step(seed13Policy, trail);
    await step(seed13Policy, trail);
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("HS_02");
    await refresh();

    // 选校：三所 offer 不重抽
    await step(seed13Policy, trail);
    expect(phase()).toBe("SCHOOL_OFFERS");
    const offers = [0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"));
    await refresh();
    expect([0, 1, 2].map((index) => screen.getByTestId(`offer-${index}`).getAttribute("data-unitid"))).toEqual(offers);

    // 进入本科第 1 学期：资助只发一次
    await step(seed13Policy, trail);
    const moneyAfterStipend = stats().money;
    await refresh();
    expect(stats().money).toBe(moneyAfterStipend);

    // 支线事件中
    await advanceUntil(seed13Policy, trail, () => phase() === "ARC_EVENT");
    expect(screen.getByTestId("screen-event").getAttribute("data-event-id")).toBe("ARC_CREATIVE_1");
    await refresh();

    // 本科结果揭晓后：机会结果不重抽
    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    const outcomes = ["PHD", "LOCAL_JOB", "HOME_JOB"].map((id) => screen.getByTestId(`outcome-${id}`).textContent);
    await refresh();
    expect(["PHD", "LOCAL_JOB", "HOME_JOB"].map((id) => screen.getByTestId(`outcome-${id}`).textContent)).toEqual(outcomes);

    // 扣过硕士入学费之后：不重复扣费，也不重复发资助
    await click("masters-MS_1Y");
    expect(stats().money).toBe(51);
    await refresh();
    expect(stats().money).toBe(51);

    // 硕士结果揭晓后
    await advanceUntil(seed13Policy, trail, () => phase() === "GRAD_RESULTS");
    await refresh();

    // 结局：卡片不重算
    await click("route-TRANSITION");
    const combo = screen.getByTestId("card-combo").textContent;
    await refresh();
    expect(screen.getByTestId("card-combo").textContent).toBe(combo);
  });
});
