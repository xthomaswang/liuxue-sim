// @vitest-environment jsdom
// 第四版界面（docs/24 §7–§8）的呈现：用按契约手写的轨迹与总结数据渲染，不依赖整局模拟。

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndingCard, Stats, SummaryView, TimelineEntry, TimelineLine } from "../../engine";
import { SummaryContent } from "../screens/SummaryScreen";
import { TimelineView, autoDelay } from "../screens/TimelineScreen";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const STATS: Stats = { money: 40, academics: 50, career: 30, wellbeing: 60 };
const line = (kind: TimelineLine["kind"], text: string, delta: Stats | null = null): TimelineLine => ({ kind, text, delta });
const entry = (
  id: string,
  label: string,
  age: number | null,
  group: TimelineEntry["group"],
  lines: TimelineLine[],
): TimelineEntry => ({ id, label, age, group, lines, statsAfter: STATS });

const GRADUATED: TimelineEntry[] = [
  entry("HS", "高三", 17, "SCHOOL", [line("EVENT", "〈书桌上的两种准备〉集中学业。")]),
  entry("SUMMER:HS:0", "出国前的夏天", 18, "SUMMER", [line("SUMMER", "去驾校学了车。", { ...STATS, money: -2, academics: 0, career: 0, wellbeing: 3 })]),
  entry("UG:1", "大一上", 18, "SCHOOL", [
    line("DAILY", "食堂的菜你都吃过一轮了。"),
    line("GPA", "期末 GPA 3.42。"),
  ]),
  entry("GRAD:UG", "本科毕业", 22, "SCHOOL", [line("ROUTE", "你接受了留美工作。")]),
  entry("LIFE:1", "毕业第 1 年", 23, "LIFE", [
    line("LIFE_BASE", "工资到账，房租也到账。"),
    line("LIFE_PLAN", "这一年的重心：拼命加班。"),
    line("MILESTONE", "拿到了第一个正式头衔。"),
    line("LIFE_EVENT", "楼下新开了一家拉面店。"),
  ]),
  entry("LIFE:2", "毕业第 2 年", 24, "LIFE", [line("LIFE_EVENT", "从明年起：回国工作。")]),
  entry("OUTCOME", "五年后", 27, "END", [line("OUTCOME", "五年后，你成了：海归中层。")]),
];

function renderTimeline(entries: TimelineEntry[], shown: number) {
  const onReveal = vi.fn();
  const onSummary = vi.fn();
  const view = render(<TimelineView entries={entries} shown={shown} onReveal={onReveal} onSummary={onSummary} />);
  return { onReveal, onSummary, view };
}

describe("人生轨迹（第四版）", () => {
  it("每段标签下写年龄；没有年龄的段不写；按分组着色", () => {
    const entries = [...GRADUATED.slice(0, 3), entry("X", "后来", null, "SCHOOL", [line("FLAVOR", "后来，人们叫你：OPT 打工人。")])];
    renderTimeline(entries, entries.length);
    expect(screen.getByTestId("timeline-entry-HS").querySelector(".tl-age")?.textContent).toBe("17 岁");
    expect(screen.getByTestId("timeline-entry-SUMMER:HS:0").querySelector(".tl-age")?.textContent).toBe("18 岁");
    expect(screen.getByTestId("timeline-entry-X").querySelector(".tl-age")).toBeNull();
    expect(screen.getByTestId("timeline-entry-SUMMER:HS:0").className).toContain("group-summer");
    expect(screen.getByTestId("timeline-entry-HS").className).toContain("group-school");
  });

  it("新的行有自己的样式：日常、GPA、里程碑、五年后", () => {
    renderTimeline(GRADUATED, GRADUATED.length);
    const kinds = (id: string) =>
      Array.from(screen.getByTestId(`timeline-entry-${id}`).querySelectorAll(".tl-line")).map((node) => node.className);
    expect(kinds("UG:1")).toEqual(["tl-line kind-daily", "tl-line kind-gpa"]);
    expect(kinds("LIFE:1")).toEqual([
      "tl-line kind-life_base",
      "tl-line kind-life_plan",
      "tl-line kind-milestone",
      "tl-line kind-life_event",
    ]);
    expect(kinds("OUTCOME")).toEqual(["tl-line kind-outcome"]);
    expect(screen.getByTestId("timeline-entry-OUTCOME").className).toContain("group-end");
    expect(screen.getByTestId("timeline-entry-LIFE:2").className).toContain("group-life");
  });

  it("毕业以后、五年过去两条分隔只在对应的段出现时才出现，且排在那一段前面", () => {
    const { view } = renderTimeline(GRADUATED, 4);
    expect(screen.queryByTestId("timeline-divider-life")).toBeNull();
    expect(screen.queryByTestId("timeline-divider-outcome")).toBeNull();

    view.rerender(<TimelineView entries={GRADUATED} shown={5} onReveal={vi.fn()} onSummary={vi.fn()} />);
    const divider = screen.getByTestId("timeline-divider-life");
    expect(divider.textContent).toBe("毕业以后");
    expect(divider.nextElementSibling?.getAttribute("data-testid")).toBe("timeline-entry-LIFE:1");
    expect(screen.getAllByTestId("timeline-divider-life").length).toBe(1);

    view.rerender(<TimelineView entries={GRADUATED} shown={GRADUATED.length} onReveal={vi.fn()} onSummary={vi.fn()} />);
    expect(screen.getAllByTestId("timeline-divider-life").length).toBe(1);
    const outcome = screen.getByTestId("timeline-divider-outcome");
    expect(outcome.textContent).toBe("五年过去");
    expect(outcome.nextElementSibling?.getAttribute("data-testid")).toBe("timeline-entry-OUTCOME");
    // 分隔不算轨迹的段。
    expect(document.querySelectorAll("[data-testid^='timeline-entry-']").length).toBe(GRADUATED.length);
    expect(document.querySelectorAll("[aria-expanded]").length).toBe(0);
  });

  it("中途结局的局：分隔写“离开学校以后”", () => {
    const early = [
      ...GRADUATED.slice(0, 3),
      entry("EARLY", "大二上", 19, "SCHOOL", [line("EARLY_END", "你决定辍学创业。")]),
      entry("LIFE:1", "离校第 1 年", 20, "LIFE", [line("LIFE_BASE", "车库里的第一年。")]),
      entry("OUTCOME", "五年后", 24, "END", [line("OUTCOME", "五年后，你成了：连续创业者。")]),
    ];
    renderTimeline(early, early.length);
    expect(screen.getByTestId("timeline-divider-life").textContent).toBe("离开学校以后");
  });

  it("只有最新的一段逐行淡入（每行带 --i），之前的段直接显示", () => {
    renderTimeline(GRADUATED, 5);
    const latest = Array.from(screen.getByTestId("timeline-entry-LIFE:1").querySelectorAll<HTMLElement>(".tl-line"));
    expect(latest.map((node) => node.style.getPropertyValue("--i"))).toEqual(["0", "1", "2", "3"]);
    expect(screen.getByTestId("timeline-entry-LIFE:1").className).toContain("latest");
    const older = screen.getByTestId("timeline-entry-UG:1").querySelector<HTMLElement>(".tl-line");
    expect(older?.style.getPropertyValue("--i")).toBe("");
  });

  it("自动播放：停留时间按刚出现那一段的行数算", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { onReveal, view } = renderTimeline(GRADUATED, 5);
    fireEvent.click(screen.getByTestId("auto-play"));
    const wait = autoDelay(GRADUATED[4].lines.length);
    expect(wait).toBe(1740);
    await act(async () => {
      vi.advanceTimersByTime(wait - 1);
    });
    expect(onReveal).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onReveal).toHaveBeenCalledWith(6);
    // 外面把段数加一之后，下一次等的是新一段（一行）的时间。
    view.rerender(<TimelineView entries={GRADUATED} shown={6} onReveal={onReveal} onSummary={vi.fn()} />);
    await act(async () => {
      vi.advanceTimersByTime(autoDelay(1) - 1);
    });
    expect(onReveal).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onReveal).toHaveBeenLastCalledWith(7);
  });
});

// ---------- 人生总结 ----------

const CARD: EndingCard = {
  early: null,
  flavor: { id: "F_LOCAL_DEFAULT", name: "OPT 打工人", roast: "工牌到手，身份倒计时同步开始。", text: "你留在美国上班。" },
  tier: "SR_PLUS",
  tierLabel: "SR＋",
  tierKind: "精英结局",
  name: "职业上岸，身份仍在加载",
  roast: "工资条已经通关，人生还在续费。",
  facts: ["接受了留美工作"],
  hidden: [],
  status: "TBC",
  statusLabel: "未完待续",
  combo: "SR＋＋未完待续",
  draws: [],
};
const rated = (values: Stats) =>
  (["money", "academics", "career", "wellbeing"] as const).map((key) => ({
    key,
    name: { money: "可动用资金", academics: "学业积累", career: "职业积累", wellbeing: "身心状态" }[key],
    value: values[key],
    rating: "普通",
  }));

function summary(overrides: Partial<SummaryView> = {}): SummaryView {
  return {
    seed: 42,
    kind: "GRADUATION",
    title: "把下一段职业起点放在美国",
    label: "本科毕业",
    text: "你决定接受这次美国的工作机会。",
    keyExperience: null,
    epilogue: "五年后，最初的求职材料已经很久没有打开过。",
    school: null,
    stats: rated({ money: 77, academics: 61, career: 88, wellbeing: 45 }),
    focusSummary: [],
    talents: [],
    points: { family: 5, academics: 5, career: 5, wellbeing: 5 },
    opportunities: [],
    card: CARD,
    gpa: 3.27,
    life: {
      outcome: { id: "LO_HOME_JOB_MIDDLE", name: "海归中层", roast: "开会比写代码多。", text: "你回国做到了中层。", grade: "SR" },
      age: 27,
      track: "HOME_JOB",
      trackName: "回国工作",
      trackNames: ["留美工作", "回国工作"],
      startStats: rated({ money: 30, academics: 70, career: 66, wellbeing: 52 }),
    },
    ...overrides,
  };
}

function renderSummary(view: SummaryView) {
  return render(
    <SummaryContent view={view} rewards={null} inherit={null} onInherit={vi.fn()} onPlayAgain={vi.fn()} onOpenGallery={vi.fn()} />,
  );
}

describe("人生总结（第四版）", () => {
  it("最上面是五年后：年龄、稀有度、结局名、吐槽、描述、走过的轨道", () => {
    renderSummary(summary());
    expect(screen.getByTestId("life-outcome").textContent).toBe("海归中层");
    expect(screen.getByTestId("life-age").textContent).toBe("27 岁");
    expect(screen.getByTestId("life-path").textContent).toBe("留美工作 → 回国工作");
    const block = screen.getByTestId("life-block");
    expect(block.getAttribute("data-grade")).toBe("SR");
    expect(block.querySelector(".rarity")?.textContent).toBe("SR");
    expect(block.textContent).toContain("开会比写代码多。");
    expect(block.textContent).toContain("你回国做到了中层。");
    // 顺序：五年后 → 当年的去向结局 → 结局标题 → 结局卡。
    const order = ["life-block", "ending-flavor", "ending-title", "ending-card"].map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("毕业那年，人们叫你")).toBeTruthy();
    expect(screen.getByTestId("ending-flavor").textContent).toBe("OPT 打工人");
  });

  it("有五年后时不再显示原来那段“五年后”文字；事实写五年后、离开学校时与平均 GPA", () => {
    renderSummary(summary());
    expect(screen.queryByTestId("ending-epilogue")).toBeNull();
    const facts = screen.getByTestId("summary-facts").textContent ?? "";
    expect(facts).toContain("五年后");
    expect(screen.getByTestId("final-money").textContent).toContain("77");
    expect(screen.getByTestId("start-stats").textContent).toContain("离开学校时");
    expect(screen.getByTestId("start-stats").textContent).toContain("可动用资金 30");
    expect(screen.getByTestId("summary-gpa").textContent).toBe("在校平均 GPA3.27");
    expect(document.querySelectorAll("[aria-expanded]").length).toBe(0);
  });

  it("中途结局也有五年后：当年那一块标“当年”，用中途结局自己的名字", () => {
    renderSummary(
      summary({
        kind: "EARLY",
        card: { ...CARD, early: "E_STARTUP", flavor: null, tier: "SR", tierLabel: "SR", name: "辍学创业", roast: "车库就是办公室。" },
        gpa: 2.9,
      }),
    );
    expect(screen.getByTestId("life-outcome")).toBeTruthy();
    expect(screen.getByTestId("ending-early").textContent).toBe("辍学创业");
    expect(screen.getByText("当年")).toBeTruthy();
    expect(screen.queryByTestId("ending-flavor")).toBeNull();
  });

  it("没有毕业后五年的局（经典模式）照第三版显示：没有五年后一块，保留原来的五年后文字", () => {
    renderSummary(summary({ life: null, gpa: null }));
    expect(screen.queryByTestId("life-block")).toBeNull();
    expect(screen.getByTestId("ending-epilogue").textContent).toContain("五年后，最初的求职材料");
    expect(screen.queryByTestId("start-stats")).toBeNull();
    expect(screen.queryByTestId("summary-gpa")).toBeNull();
    expect(screen.getByText("后来，人们叫你")).toBeTruthy();
  });
});
