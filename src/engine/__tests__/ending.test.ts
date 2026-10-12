// 结局与人生回顾（docs/07；第二版的调整见 docs/16 §8）。通过状态机走到毕业结果，再把毕业快照改成需要覆盖的边界值。
// 基线用经典模式走出来（主线槽固定原事件）；第二版主线槽的回顾另见 v2 的测试。

import { describe, expect, it } from "vitest";
import { ALL_EVENTS, EVENT_BY_ID, TEXTS } from "../../content";
import { endingView, graduationView } from "../index";
import type {
  ActiveRun, Aspiration, EndingView, Expectation, FinalRoute, MastersProgram, Outcome, RunState, Stats,
} from "../index";
import { truncateCodePoints } from "../labels";
import { act, asActive, at, classicPolicy, clone, play, start, startClassic } from "./helpers";

const policy = classicPolicy({ talent: "T_FOCUSED", focus: "STUDY", event: "B" });
const stats = (money: number, academics: number, career: number, wellbeing: number): Stats => ({ money, academics, career, wellbeing });
type Outcomes = Record<"PHD" | "LOCAL_JOB" | "HOME_JOB", Outcome>;

const undergradBase = asActive(play(startClassic(21, "MID"), policy, at("GRAD_RESULTS")).state);

function mastersBase(program: MastersProgram): ActiveRun {
  const ug = clone(undergradBase);
  ug.stats = stats(80, 90, 40, 60);
  const grad = ug.graduations.UG;
  if (!grad) throw new Error("缺少本科快照");
  grad.frozenStats = { ...ug.stats };
  grad.outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" };
  return asActive(play(act(ug, { type: "ENTER_MASTERS", program }), { ...policy, event: () => "A" }, at("GRAD_RESULTS")).state);
}
const mastersOneYear = mastersBase("MS_1Y");
const mastersTwoYears = mastersBase("MS_2Y");

function ended(
  base: ActiveRun,
  route: FinalRoute,
  outcomes: Outcomes,
  overrides: { wellbeing?: number; money?: number; aspiration?: Aspiration; expectation?: Expectation } = {},
): ActiveRun {
  const run = clone(base);
  const degree = run.stage === "MS" ? "MS" : "UG";
  const grad = run.graduations[degree];
  if (!grad) throw new Error("缺少毕业快照");
  grad.outcomes = { ...outcomes };
  for (const key of ["PHD", "LOCAL_JOB", "HOME_JOB"] as const) {
    grad.probabilities[key] = outcomes[key] === "INELIGIBLE" ? null : (grad.probabilities[key] ?? 50);
  }
  if (overrides.wellbeing !== undefined) grad.frozenStats.wellbeing = overrides.wellbeing;
  if (overrides.money !== undefined) grad.frozenStats.money = overrides.money;
  run.stats = { ...grad.frozenStats };
  if (overrides.aspiration) run.profile.aspiration = overrides.aspiration;
  if (overrides.expectation) run.profile.expectation = overrides.expectation;
  return asActive(act(run, { type: "CHOOSE_ROUTE", route }));
}

const ALL_OFFERED: Outcomes = { PHD: "OFFERED", LOCAL_JOB: "OFFERED", HOME_JOB: "OFFERED" };
const NONE: Outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" };

function view(state: RunState): EndingView {
  const result = endingView(state);
  if (!result) throw new Error("没有结局视图");
  return result;
}

/** 遍历视图里的所有字符串。 */
function strings(value: unknown, path = "view", out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      expect(item, `${path}.${key} 不应为 undefined`).not.toBeUndefined();
      strings(item, `${path}.${key}`, out);
    }
  }
  return out;
}

describe("结局视图只在 ENDING 阶段存在", () => {
  it("其它阶段为 null", () => {
    expect(endingView(start(1))).toBeNull();
    expect(endingView(undergradBase)).toBeNull();
  });
});

describe("六个去向变体 × 教育路径（07 §2–§4、§9）", () => {
  const variants: Array<{
    name: string;
    base: ActiveRun;
    route: FinalRoute;
    outcomes: Outcomes;
    key: keyof typeof TEXTS.ending.route;
    shortKey: keyof typeof TEXTS.ending.short;
    label: string;
    labelExtra: string | null;
    path: "UG" | "MS_1Y" | "MS_2Y";
  }> = [
    { name: "本科直博", base: undergradBase, route: "PHD", outcomes: ALL_OFFERED, key: "PHD/undergrad_direct", shortKey: "PHD/ANY", label: "本科直博 · 即将入学", labelExtra: null, path: "UG" },
    { name: "本科留美工作", base: undergradBase, route: "LOCAL_JOB", outcomes: ALL_OFFERED, key: "LOCAL_JOB", shortKey: "LOCAL_JOB", label: "本科毕业", labelExtra: null, path: "UG" },
    { name: "本科回国工作", base: undergradBase, route: "HOME_JOB", outcomes: ALL_OFFERED, key: "HOME_JOB", shortKey: "HOME_JOB", label: "本科毕业", labelExtra: null, path: "UG" },
    { name: "本科主动过渡", base: undergradBase, route: "TRANSITION", outcomes: ALL_OFFERED, key: "TRANSITION/SELF_CHOSEN", shortKey: "TRANSITION/SELF_CHOSEN", label: "本科毕业", labelExtra: null, path: "UG" },
    { name: "本科无机会过渡", base: undergradBase, route: "TRANSITION", outcomes: NONE, key: "TRANSITION/NO_OFFER", shortKey: "TRANSITION/NO_OFFER", label: "本科毕业", labelExtra: null, path: "UG" },
    { name: "一年硕士后申博", base: mastersOneYear, route: "PHD", outcomes: ALL_OFFERED, key: "PHD/masters_entry", shortKey: "PHD/ANY", label: "硕士后申博 · 即将入学", labelExtra: "一年制硕士", path: "MS_1Y" },
    { name: "两年硕士后申博", base: mastersTwoYears, route: "PHD", outcomes: ALL_OFFERED, key: "PHD/masters_entry", shortKey: "PHD/ANY", label: "硕士后申博 · 即将入学", labelExtra: "两年制硕士", path: "MS_2Y" },
    { name: "一年硕士留美工作", base: mastersOneYear, route: "LOCAL_JOB", outcomes: ALL_OFFERED, key: "LOCAL_JOB", shortKey: "LOCAL_JOB", label: "一年制硕士毕业", labelExtra: null, path: "MS_1Y" },
    { name: "两年硕士回国工作", base: mastersTwoYears, route: "HOME_JOB", outcomes: ALL_OFFERED, key: "HOME_JOB", shortKey: "HOME_JOB", label: "两年制硕士毕业", labelExtra: null, path: "MS_2Y" },
    { name: "一年硕士主动过渡", base: mastersOneYear, route: "TRANSITION", outcomes: ALL_OFFERED, key: "TRANSITION/SELF_CHOSEN", shortKey: "TRANSITION/SELF_CHOSEN", label: "一年制硕士毕业", labelExtra: null, path: "MS_1Y" },
    { name: "两年硕士仍无机会", base: mastersTwoYears, route: "TRANSITION", outcomes: NONE, key: "TRANSITION/NO_OFFER", shortKey: "TRANSITION/NO_OFFER", label: "两年制硕士毕业", labelExtra: null, path: "MS_2Y" },
  ];

  it.each(variants)("$name：标题、标签、正文、桥接、后记查表正确", (variant) => {
    const run = ended(variant.base, variant.route, variant.outcomes);
    const v = view(run);
    expect(v.route).toBe(variant.route);
    expect(v.educationPath).toBe(variant.path);
    expect(v.degree).toBe(variant.path === "UG" ? "UG" : "MS");
    expect(v.title).toBe(TEXTS.ending.route[variant.key].title);
    expect(v.full.body).toBe(TEXTS.ending.route[variant.key].body);
    expect(v.short.text).toBe(TEXTS.ending.short[variant.shortKey]);
    expect(v.full.epilogue).toBe(TEXTS.ending.epilogue[variant.key]);
    expect(v.label).toBe(variant.label);
    expect(v.labelExtra).toBe(variant.labelExtra);
    expect(v.entryMode).toBe(variant.route === "PHD" ? (variant.path === "UG" ? "undergrad_direct" : "masters_entry") : null);
    const schoolName = run.school?.nameZh ?? "";
    if (variant.path === "UG") {
      // 合成目录的中文名是“样本学校 S1”这类：中文与中文之间不留空格，中文与拉丁字母之间保留
      expect(v.full.bridge).toBe(TEXTS.ending.bridge.UG.replace(" {schoolName} ", `${schoolName} `));
      expect(v.full.bridge).toContain(`从来到${schoolName} 到本科毕业`);
      expect(v.full.undergradOpportunities).toBeNull();
      expect(v.full.review).toHaveLength(7);
    } else {
      expect(v.full.bridge).toBe(TEXTS.ending.bridge[variant.path]);
      expect(v.full.undergradOpportunities).toHaveLength(3);
      expect(v.full.undergradOpportunities).toEqual(graduationView(run, "UG")?.opportunities);
      expect(v.full.review).toHaveLength(8);
    }
    expect(v.opportunities).toEqual(graduationView(run, v.degree)?.opportunities);
    expect(v.card).toEqual(run.ending?.card);
    expect(v.seed).toBe(run.seed);
    // 本局的天赋（池内顺序）
    expect(v.talents.map((talent) => talent.id)).toEqual(run.profile.talents);
    expect(v.talents.every((talent) => talent.name.length > 0 && talent.text.length > 0)).toBe(true);
    // 博士结局不替玩家写完学位；工作结局不写身份
    expect(`${v.short.text}${v.full.body}${v.full.epilogue}`).not.toMatch(/博士毕业了|已获得博士学位|绿卡|成为教授/);
  });

  it("本科未取得的机会不会被写成硕士结局可用；硕士局保留本科旧结果供回看", () => {
    const run = ended(mastersTwoYears, "TRANSITION", NONE);
    const v = view(run);
    expect(run.graduations.UG?.resolution).toBe("MASTERS");
    expect(v.transitionMode).toBe("NO_OFFER");
    expect(v.full.undergradOpportunities?.map((item) => item.outcome)).toEqual(["NOT_OFFERED", "INELIGIBLE", "NOT_OFFERED"]);
  });
});

describe("身心与资金三态的边界（07 §5）", () => {
  it("0–19 / 20–39 / 40–100 与 0–9 / 10–39 / 40–100", () => {
    const wb: Array<[number, "DRAINED" | "STRETCHED" | "STEADY"]> = [[0, "DRAINED"], [19, "DRAINED"], [20, "STRETCHED"], [39, "STRETCHED"], [40, "STEADY"], [100, "STEADY"]];
    const money: Array<[number, "NARROW" | "LIMITED" | "BUFFERED"]> = [[0, "NARROW"], [9, "NARROW"], [10, "LIMITED"], [39, "LIMITED"], [40, "BUFFERED"], [100, "BUFFERED"]];
    for (const [w, wBand] of wb) {
      for (const [m, mBand] of money) {
        const v = view(ended(undergradBase, "HOME_JOB", ALL_OFFERED, { wellbeing: w, money: m }));
        expect(v.full.wellbeing).toEqual({ band: wBand, text: TEXTS.ending.wellbeingState[wBand] });
        expect(v.full.money).toEqual({ band: mBand, text: TEXTS.ending.moneyState[mBand] });
        expect(v.short.status).toBe(`${TEXTS.ending.stateShort[wBand]}${TEXTS.ending.stateShort[mBand]}`);
      }
    }
  });

  it("低资金、低身心不改写主结局", () => {
    const low = view(ended(undergradBase, "PHD", ALL_OFFERED, { wellbeing: 0, money: 0 }));
    const high = view(ended(undergradBase, "PHD", ALL_OFFERED, { wellbeing: 100, money: 100 }));
    expect(low.title).toBe(high.title);
    expect(low.full.body).toBe(high.full.body);
    expect(low.short.text).toBe(high.short.text);
    expect(low.label).toBe("本科直博 · 即将入学");
    expect(low.full.wellbeing.band).toBe("DRAINED");
    expect(low.full.money.band).toBe("NARROW");
  });
});

describe("愿望与家庭回应（07 §6–§7）", () => {
  const routes: Array<[FinalRoute, Outcomes, "RESEARCH" | "WORK" | "PAUSE"]> = [
    ["PHD", ALL_OFFERED, "RESEARCH"],
    ["LOCAL_JOB", ALL_OFFERED, "WORK"],
    ["HOME_JOB", ALL_OFFERED, "WORK"],
    ["TRANSITION", ALL_OFFERED, "PAUSE"],
    ["TRANSITION", NONE, "PAUSE"],
  ];
  it("3 种愿望 × 4 个去向、3 种期待 × 3 个路线组全部查表", () => {
    for (const aspiration of ["DISCOVERY", "INDEPENDENCE", "BELONGING"] as Aspiration[]) {
      for (const expectation of ["ACADEMIC", "STABILITY", "AUTONOMY"] as Expectation[]) {
        for (const [route, outcomes, group] of routes) {
          const v = view(ended(undergradBase, route, outcomes, { aspiration, expectation }));
          expect(v.full.aspiration).toBe(TEXTS.ending.aspirationResponse[aspiration][route]);
          expect(v.full.family).toBe(TEXTS.ending.familyResponse[expectation][group]);
        }
      }
    }
  });
});

describe("全组合覆盖：没有 undefined、没有未替换的占位符", () => {
  it("去向变体 × 教育路径 × 身心/资金边界 × 愿望 × 期待", () => {
    const bases: Array<[ActiveRun, number]> = [[undergradBase, 7], [mastersOneYear, 8], [mastersTwoYears, 8]];
    const routes: Array<[FinalRoute, Outcomes]> = [
      ["PHD", ALL_OFFERED], ["LOCAL_JOB", ALL_OFFERED], ["HOME_JOB", ALL_OFFERED], ["TRANSITION", ALL_OFFERED], ["TRANSITION", NONE],
    ];
    const wbs = [0, 19, 20, 39, 40, 100];
    const moneys = [0, 9, 10, 39, 40, 100];
    const aspirations: Aspiration[] = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
    const expectations: Expectation[] = ["ACADEMIC", "STABILITY", "AUTONOMY"];
    let combos = 0;
    for (const [base, reviewCount] of bases) {
      for (const [route, outcomes] of routes) {
        for (let i = 0; i < wbs.length; i++) {
          for (let j = 0; j < moneys.length; j++) {
            // 愿望与期待随身心/资金轮换，保证每一对取值都与各去向相遇过
            const aspiration = aspirations[(i + j) % 3];
            const expectation = expectations[(i * 2 + j) % 3];
            const v = view(ended(base, route, outcomes, { wellbeing: wbs[i], money: moneys[j], aspiration, expectation }));
            for (const [path, text] of strings(v)) {
              expect(text.length, `${path} 为空`).toBeGreaterThan(0);
              expect(text, `${path} 含未替换的占位符`).not.toMatch(/[{}]|undefined|null|NaN/);
            }
            expect(v.full.review).toHaveLength(reviewCount);
            expect(v.full.arcRecaps).toHaveLength(2);
            expect(v.full.focusSummary.map((item) => item.name)).toEqual(["学习", "职业准备", "校园生活", "校内兼职", "休息整理"]);
            combos++;
          }
        }
      }
    }
    expect(combos).toBe(3 * 5 * 36);
  });
});

describe("历史回顾与关键经历（07 §2.1、§8）", () => {
  it("本科七条、硕士八条，按真实时间顺序，A/B 与实际一致", () => {
    for (const base of [undergradBase, mastersOneYear, mastersTwoYears]) {
      const run = ended(base, "TRANSITION", ALL_OFFERED);
      const v = view(run);
      const expected = ["HS_01", "HS_02", "CORE_01", "CORE_04", `ARC_${run.arcs.A}_3`, `ARC_${run.arcs.B}_3`, "CORE_08"];
      if (run.mastersYears !== null) expected.push("MASTER_04");
      expect(v.full.review.map((entry) => entry.eventId)).toEqual(expected);
      for (const entry of v.full.review) {
        const event = EVENT_BY_ID[entry.eventId];
        const choice = event.choices.find((item) => item.id === entry.choiceId);
        expect(run.flags).toContain(`${entry.eventId}_${entry.choiceId}`);
        expect(run.flags).not.toContain(`${entry.eventId}_${entry.choiceId === "A" ? "B" : "A"}`);
        expect(entry.title).toBe(event.title);
        expect(entry.choiceLabel).toBe(choice?.label);
        expect(entry.result).toBe(choice?.result);
        const played = run.history.find((item) => item.eventId === entry.eventId);
        expect(played?.choiceId).toBe(entry.choiceId);
      }
      expect(v.full.review.slice(0, 2).map((entry) => entry.when)).toEqual(["高中", "高中"]);
      expect(v.full.review[2].when).toBe("本科 · 一年级秋");
      expect(v.full.review[3].when).toBe("本科 · 二年级末");
      expect(v.full.review[4].when).toBe("本科 · 三年级末");
      expect(v.full.review[5].when).toBe("本科 · 四年级秋");
      expect(v.full.review[6].when).toBe("本科 · 毕业前");
      if (run.mastersYears !== null) expect(v.full.review[7].when).toBe(`硕士 · 第 ${run.mastersYears * 2} 学期`);
      // 支线回顾短句对应实际的第三幕选择
      expect(v.full.arcRecaps).toEqual(
        [run.arcs.A, run.arcs.B].map((arc) => TEXTS.arcRecap[run.flags.find((flag) => flag.startsWith(`ARC_${arc}_3_`)) ?? ""]),
      );
    }
  });

  it("选了 B 的第三幕与硕士结尾也如实进入回顾", () => {
    // undergradBase 的事件全选 B；硕士基线全选 A
    const ug = view(ended(undergradBase, "TRANSITION", NONE));
    expect(ug.full.review.every((entry) => entry.choiceId === "B")).toBe(true);
    const ms = view(ended(mastersOneYear, "TRANSITION", NONE));
    expect(ms.full.review[7]).toMatchObject({ eventId: "MASTER_04", choiceId: "A" });
  });

  it("关键经历：硕士取 MASTER_04，否则取最后发生的支线第三幕；句式与截断符合约定", () => {
    const ug = ended(undergradBase, "HOME_JOB", ALL_OFFERED);
    const arcEvent = EVENT_BY_ID[`ARC_${ug.arcs.B}_3`];
    const arcChoice = arcEvent.choices.find((choice) => ug.flags.includes(`${arcEvent.id}_${choice.id}`));
    const clip = (text: string, max: number) => (Array.from(text).length > max ? `${Array.from(text).slice(0, max).join("")}…` : text);
    expect(view(ug).short.keyExperience).toBe(`你记得「${clip(arcEvent.title, 12)}」里的决定：${clip(arcChoice?.label ?? "", 18)}。`);

    const ms = ended(mastersTwoYears, "HOME_JOB", ALL_OFFERED);
    const master = EVENT_BY_ID.MASTER_04;
    const masterChoice = master.choices.find((choice) => ms.flags.includes(`MASTER_04_${choice.id}`));
    expect(view(ms).short.keyExperience).toBe(`你记得「${clip(master.title, 12)}」里的决定：${clip(masterChoice?.label ?? "", 18)}。`);
  });

  it("截断按 Unicode 码点计数：标题 12、标签 18，超出才加省略号", () => {
    expect(truncateCodePoints("一二三四五六七八九十甲乙", 12)).toBe("一二三四五六七八九十甲乙");
    expect(truncateCodePoints("一二三四五六七八九十甲乙丙", 12)).toBe("一二三四五六七八九十甲乙…");
    expect(truncateCodePoints("𠮷𠮷𠮷", 2)).toBe("𠮷𠮷…"); // 代理对算一个码点
    // 事件库里确有超过 18 个码点的选项标签，走真实数据验证一次
    const long = ALL_EVENTS.flatMap((event) => event.choices).find((choice) => Array.from(choice.label).length > 18);
    expect(long).toBeDefined();
    expect(Array.from(truncateCodePoints(long?.label ?? "", 18))).toHaveLength(19);
    expect(ALL_EVENTS.every((event) => Array.from(event.title).length <= 12)).toBe(true);
  });

  it("申请摘要与投入概览", () => {
    const run = ended(undergradBase, "HOME_JOB", ALL_OFFERED);
    const v = view(run);
    const strategy = run.admission.strategy === "REACH" ? "冲刺" : "稳健";
    expect(v.full.applicationSummary).toBe(
      `当时的申请准备度为 ${run.admission.readiness}，你选择了${strategy}方案，最后在三所 offer 中选择了${run.school?.nameZh}。`,
    );
    expect(v.full.focusSummary.map((item) => item.focus)).toEqual(["STUDY", "CAREER", "CAMPUS", "WORK", "REST"]);
    expect(v.full.focusSummary.reduce((sum, item) => sum + item.count, 0)).toBe(8);
    expect(view(ended(mastersTwoYears, "HOME_JOB", ALL_OFFERED)).full.focusSummary.reduce((sum, item) => sum + item.count, 0)).toBe(12);
  });

  it("中文校名前后不留多余空格；英文校名两侧的空格保留", () => {
    const zh = clone(undergradBase);
    const en = clone(undergradBase);
    if (!zh.school || !en.school) throw new Error("缺少学校");
    zh.school.nameZh = "本特利大学";
    en.school.nameZh = null;
    en.school.name = "Bentley University";
    const zhView = view(ended(zh, "HOME_JOB", ALL_OFFERED));
    expect(zhView.full.bridge).toBe("从来到本特利大学到本科毕业，你走过了本科四年。八个故事节点没有排成一条直线，却逐渐留下了自己的方向。");
    expect(zhView.full.applicationSummary).toMatch(/^当时的申请准备度为 \d+，你选择了(冲刺|稳健)方案，最后在三所 offer 中选择了本特利大学。$/);
    const enView = view(ended(en, "HOME_JOB", ALL_OFFERED));
    expect(enView.full.bridge).toBe(TEXTS.ending.bridge.UG.replace("{schoolName}", "Bentley University"));
    expect(enView.full.bridge).toContain("从来到 Bentley University 到本科毕业");
    expect(enView.full.applicationSummary).toContain("选择了 Bentley University。");
    // 没有占位符的硕士桥接原样返回
    expect(view(ended(mastersOneYear, "HOME_JOB", ALL_OFFERED)).full.bridge).toBe(TEXTS.ending.bridge.MS_1Y);
  });

  it("学校没有中文名时用官方英文名", () => {
    const base = clone(undergradBase);
    if (!base.school) throw new Error("缺少学校");
    base.school.nameZh = null;
    const v = view(ended(base, "HOME_JOB", ALL_OFFERED));
    expect(v.full.bridge).toContain(base.school.name);
    expect(v.full.applicationSummary).toContain(base.school.name);
  });

  it("回顾标记缺失或双选属于数据错误，不默认当作选 A", () => {
    const broken = clone(ended(undergradBase, "HOME_JOB", ALL_OFFERED));
    broken.flags = broken.flags.filter((flag) => !flag.startsWith("CORE_04_"));
    expect(() => endingView(broken)).toThrow();
    const doubled = clone(ended(undergradBase, "HOME_JOB", ALL_OFFERED));
    doubled.flags.push("CORE_04_A");
    expect(() => endingView(doubled)).toThrow();
  });
});
