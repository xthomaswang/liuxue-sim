// 结局卡（docs/14）：十档主线等级、十二个隐藏结局、完结状态与组合写法。
// 用构造的毕业快照逐一覆盖；尾声抽签的命中/未中通过挑选 seed 得到。

import { describe, expect, it } from "vitest";
import { ENDING_CARDS } from "../../content";
import { computeEndingCard } from "../endingCard";
import type { EndingCardInput } from "../endingCard";
import type {
  ArcId, Degree, EndingCard, FinalRoute, FocusCounts, Graduation, HistoryEntry, Outcome, Profile, Stats,
  TransitionMode,
} from "../index";
import { draw01 } from "../rng";
import { act, asActive, at, classicPolicy, clone, play, startClassic } from "./helpers";

type Outcomes = Record<"PHD" | "LOCAL_JOB" | "HOME_JOB", Outcome>;
const stats = (money: number, academics: number, career: number, wellbeing: number): Stats => ({ money, academics, career, wellbeing });

const NO_OFFERS: Outcomes = { PHD: "NOT_OFFERED", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "NOT_OFFERED" };
const ALL_INELIGIBLE: Outcomes = { PHD: "INELIGIBLE", LOCAL_JOB: "INELIGIBLE", HOME_JOB: "INELIGIBLE" };

function graduation(degree: Degree, s: Stats, counts: Partial<FocusCounts>, flags: string[], outcomes: Outcomes): Graduation {
  return {
    degree,
    frozenStats: { ...s },
    frozenFocusCounts: { STUDY: 0, CAREER: 0, CAMPUS: 0, WORK: 0, REST: 0, ...counts },
    frozenFlags: [...flags],
    probabilities: {
      PHD: outcomes.PHD === "INELIGIBLE" ? null : 50,
      LOCAL_JOB: outcomes.LOCAL_JOB === "INELIGIBLE" ? null : 50,
      HOME_JOB: outcomes.HOME_JOB === "INELIGIBLE" ? null : 50,
    },
    rolls: { PHD: 0.5, LOCAL_JOB: 0.5, HOME_JOB: 0.5 },
    outcomes: { ...outcomes },
    resolution: null,
  };
}

function findSeed(predicate: (seed: number) => boolean): number {
  for (let seed = 1; seed < 200000; seed++) if (predicate(seed)) return seed;
  throw new Error("找不到满足条件的 seed");
}
const roll = (seed: number, name: string) => draw01(seed, `epilogue:${name}`);
/** 五个尾声抽签全部未中的 seed：默认情况下不带任何靠运气的隐藏标签。 */
const QUIET = findSeed((seed) => roll(seed, "status") >= 0.5 && roll(seed, "love") >= 0.5 && roll(seed, "dream") >= 0.03 && roll(seed, "subscription") >= 0.25 && roll(seed, "scam") >= 0.06);

interface CaseInput {
  seed?: number;
  route: FinalRoute;
  degree?: Degree;
  stats: Stats;
  counts?: Partial<FocusCounts>;
  flags?: string[];
  outcomes: Outcomes;
  ugOutcomes?: Outcomes;
  profile?: Partial<Profile>;
  arcs?: { A: ArcId; B: ArcId };
  shortfallTerms?: number;
}

function card(input: CaseInput): EndingCard {
  const degree = input.degree ?? "UG";
  const offered = Object.values(input.outcomes).some((outcome) => outcome === "OFFERED");
  const transitionMode: TransitionMode | null = input.route === "TRANSITION" ? (offered ? "SELF_CHOSEN" : "NO_OFFER") : null;
  const history = Array.from({ length: input.shortfallTerms ?? 0 }, () => ({
    kind: "UPKEEP",
    upkeep: { cost: 12, paid: 5, shortfall: 7, stress: 9 },
  })) as unknown as HistoryEntry[];
  const final = graduation(degree, input.stats, input.counts ?? {}, input.flags ?? [], input.outcomes);
  const built: EndingCardInput = {
    seed: input.seed ?? QUIET,
    profile: { economy: "MID", expectation: "STABILITY", aspiration: "BELONGING", talents: [], points: null, ...input.profile },
    arcs: input.arcs ?? { A: "FAMILY", B: "FRIENDSHIP" },
    history,
    graduations:
      degree === "UG"
        ? { UG: final, MS: null }
        : { UG: graduation("UG", stats(50, 80, 40, 50), {}, [], input.ugOutcomes ?? NO_OFFERS), MS: final },
    degree,
    route: input.route,
    transitionMode,
  };
  return computeEndingCard(built);
}

const offer = (...keys: Array<"PHD" | "LOCAL_JOB" | "HOME_JOB">): Outcomes => ({
  PHD: keys.includes("PHD") ? "OFFERED" : "NOT_OFFERED",
  LOCAL_JOB: keys.includes("LOCAL_JOB") ? "OFFERED" : "NOT_OFFERED",
  HOME_JOB: keys.includes("HOME_JOB") ? "OFFERED" : "NOT_OFFERED",
});
const ids = (c: EndingCard) => c.hidden.map((entry) => entry.id);

describe("主线等级：自上而下取第一个命中的（14 §2）", () => {
  it("EX 学术飞升：博士 + 学业 95 + 学习 4 次 + 研究报告", () => {
    const base = { route: "PHD" as const, outcomes: offer("PHD"), counts: { STUDY: 4 } };
    expect(card({ ...base, stats: stats(20, 95, 40, 30), flags: ["ARC_RESEARCH_3_A"] }).tier).toBe("EX");
    expect(card({ ...base, degree: "MS", stats: stats(20, 100, 40, 30), flags: ["MASTER_04_A"] }).tier).toBe("EX");
    // 任一条件不满足都只是 SR＋ 的博士变体
    expect(card({ ...base, stats: stats(20, 94, 40, 30), flags: ["ARC_RESEARCH_3_A"] }).tier).toBe("SR_PLUS");
    expect(card({ ...base, counts: { STUDY: 3 }, stats: stats(20, 100, 40, 30), flags: ["ARC_RESEARCH_3_A"] }).tier).toBe("SR_PLUS");
    expect(card({ ...base, stats: stats(20, 100, 40, 30), flags: ["ARC_RESEARCH_3_B"] }).tier).toBe("SR_PLUS");
    const ex = card({ ...base, stats: stats(20, 95, 40, 30), flags: ["ARC_RESEARCH_3_A"] });
    expect(ex).toMatchObject({ tierLabel: "EX", tierKind: "传奇结局", name: "学术飞升", status: "HE", combo: "EX＋HE" });
  });

  it("UR 家族存档继承者：HIGH + 资金 80 + 三个机会全部取得，任意去向", () => {
    const rich = { profile: { economy: "HIGH" as const }, stats: stats(80, 60, 60, 30), outcomes: offer("PHD", "LOCAL_JOB", "HOME_JOB") };
    expect(card({ ...rich, route: "HOME_JOB" }).tier).toBe("UR");
    expect(card({ ...rich, route: "PHD" }).tier).toBe("UR");
    expect(card({ ...rich, route: "TRANSITION" })).toMatchObject({ tier: "UR", status: "OPEN", combo: "UR＋开放结局" });
    expect(card({ ...rich, route: "LOCAL_JOB" }).tier).toBe("UR");
    expect(card({ ...rich, route: "HOME_JOB", stats: stats(79, 60, 60, 30) }).tier).not.toBe("UR");
    expect(card({ ...rich, route: "HOME_JOB", outcomes: offer("HOME_JOB") }).tier).not.toBe("UR");
    // 只拿到两个机会不够
    expect(card({ ...rich, route: "HOME_JOB", outcomes: offer("PHD", "HOME_JOB") }).tier).not.toBe("UR");
    expect(card({ ...rich, route: "HOME_JOB", outcomes: offer("LOCAL_JOB", "HOME_JOB") }).tier).not.toBe("UR");
    expect(card({ ...rich, route: "HOME_JOB", profile: { economy: "MID" } }).tier).not.toBe("UR");
    // EX 排在 UR 前面；UR 排在 SSR 前面
    expect(card({ ...rich, route: "PHD", stats: stats(90, 100, 60, 30), counts: { STUDY: 5 }, flags: ["ARC_RESEARCH_3_A"] }).tier).toBe("EX");
    const lucky = findSeed((seed) => roll(seed, "status") < 0.35);
    const ur = card({ ...rich, seed: lucky, route: "LOCAL_JOB", stats: stats(80, 60, 90, 60) });
    expect(ur.tier).toBe("UR");
    expect(ur.draws.some((draw) => draw.key === "epilogue:status")).toBe(false); // 没轮到身份抽签，就不读取它
  });

  it("SSR／SR＋：留美工作 + 职业 70 + 身心 40 + 身份抽签；本科 35%，硕士 50%", () => {
    const job = { route: "LOCAL_JOB" as const, outcomes: offer("LOCAL_JOB"), stats: stats(20, 60, 70, 40) };
    const win = findSeed((seed) => roll(seed, "status") < 0.35 && roll(seed, "dream") >= 0.03 && roll(seed, "scam") >= 0.06);
    const between = findSeed((seed) => roll(seed, "status") >= 0.35 && roll(seed, "status") < 0.5 && roll(seed, "dream") >= 0.03);
    const lose = findSeed((seed) => roll(seed, "status") >= 0.5 && roll(seed, "dream") >= 0.03);

    const ssr = card({ ...job, seed: win });
    expect(ssr).toMatchObject({ tier: "SSR", tierLabel: "SSR", name: "事业、身份双通关", status: "HE", combo: "SSR＋HE" });
    expect(ssr.draws.find((draw) => draw.key === "epilogue:status")).toMatchObject({ label: "身份抽签", probabilityPercent: 35, success: true, roll: roll(win, "status") });

    const missed = card({ ...job, seed: between });
    expect(missed).toMatchObject({ tier: "SR_PLUS", tierLabel: "SR＋", name: "职业上岸，身份仍在加载", status: "TBC", combo: "SR＋＋未完待续" });
    expect(missed.draws.find((draw) => draw.key === "epilogue:status")).toMatchObject({ probabilityPercent: 35, success: false });
    // 同一个 roll 在硕士检查点按 50% 判定
    const masters = card({ ...job, seed: between, degree: "MS", ugOutcomes: offer("PHD") });
    expect(masters.tier).toBe("SSR");
    expect(masters.draws.find((draw) => draw.key === "epilogue:status")).toMatchObject({ probabilityPercent: 50, success: true });
    expect(card({ ...job, seed: lose, degree: "MS", ugOutcomes: offer("PHD") }).tier).toBe("SR_PLUS");

    // 前置条件不满足时不读取身份抽签的结果
    for (const s of [stats(20, 60, 69, 40), stats(20, 60, 70, 39)]) {
      const blocked = card({ ...job, seed: win, stats: s });
      expect(blocked.tier).toBe("SR_PLUS");
      expect(blocked.draws.some((draw) => draw.key === "epilogue:status")).toBe(false);
    }
  });

  it("SR＋ 的博士变体：博士上岸，学位仍在加载", () => {
    const phd = card({ route: "PHD", outcomes: offer("PHD"), stats: stats(20, 70, 40, 30), counts: { STUDY: 3 } });
    expect(phd).toMatchObject({ tier: "SR_PLUS", tierLabel: "SR＋", tierKind: "精英结局", name: "博士上岸，学位仍在加载", status: "TBC" });
    expect(phd.roast).toBe(ENDING_CARDS.tiers.find((tier) => tier.id === "SR_PLUS")?.phdVariant?.roast);
  });

  it("SR／R＋／R：回国工作按职业、身心、资金分档", () => {
    const home = { route: "HOME_JOB" as const, outcomes: offer("HOME_JOB") };
    expect(card({ ...home, stats: stats(0, 50, 85, 0) })).toMatchObject({ tier: "SR", name: "归国好岗", status: "HE", combo: "SR＋HE" });
    expect(card({ ...home, stats: stats(20, 50, 84, 40) })).toMatchObject({ tier: "R_PLUS", tierLabel: "R＋", name: "回家过好日子", status: "HE", combo: "R＋＋HE" });
    expect(card({ ...home, stats: stats(19, 50, 84, 40) })).toMatchObject({ tier: "R", name: "普通毕业，普通上班", status: "HE", combo: "R＋HE" });
    expect(card({ ...home, stats: stats(20, 50, 84, 39) }).tier).toBe("R");
    // 职业 70–84 不再是 SR（SSR 的职业门槛仍是 70，两者互不影响）
    expect(card({ ...home, stats: stats(0, 50, 70, 0) }).tier).toBe("R");
  });

  it("BE／D／N：过渡期按学业、资格、读硕、资金与短缺分档", () => {
    const pause = { route: "TRANSITION" as const };
    // BE：没有机会，且学业不足 55 或三路都无资格
    expect(card({ ...pause, outcomes: NO_OFFERS, stats: stats(50, 54, 40, 30) })).toMatchObject({ tier: "BE", name: "学业／申请线崩盘", status: "TBC", combo: "BE＋未完待续" });
    expect(card({ ...pause, outcomes: ALL_INELIGIBLE, stats: stats(50, 90, 40, 30) }).tier).toBe("BE");
    // D：没有机会，且读过硕士 / 资金不足 10 / 两个学期以上短缺
    expect(card({ ...pause, outcomes: NO_OFFERS, stats: stats(9, 55, 40, 30) })).toMatchObject({ tier: "D", name: "阶层改变，但方向反了", status: "TBC" });
    expect(card({ ...pause, outcomes: NO_OFFERS, stats: stats(50, 55, 40, 30), shortfallTerms: 2 }).tier).toBe("D");
    expect(card({ ...pause, outcomes: NO_OFFERS, stats: stats(50, 55, 40, 30), shortfallTerms: 1 }).tier).toBe("N");
    const mastersNoOffer = card({ ...pause, degree: "MS", outcomes: NO_OFFERS, stats: stats(50, 80, 40, 30) });
    expect(mastersNoOffer).toMatchObject({ tier: "D", combo: "D＋H04＋未完待续" });
    // BE 排在 D 前面
    expect(card({ ...pause, degree: "MS", outcomes: NO_OFFERS, stats: stats(0, 40, 40, 30) }).tier).toBe("BE");
    // N：其余过渡期
    expect(card({ ...pause, outcomes: NO_OFFERS, stats: stats(10, 55, 40, 30) })).toMatchObject({ tier: "N", name: "毕业了，但下一关没开", status: "TBC", combo: "N＋未完待续" });
    // 手里有机会而主动过渡：不会是 BE / D
    expect(card({ ...pause, outcomes: offer("HOME_JOB"), stats: stats(0, 30, 40, 30) })).toMatchObject({ tier: "N", status: "OPEN", combo: "N＋开放结局" });
  });

  it("十档都有构造用例命中，图鉴顺序固定为 EX → BE", () => {
    expect(ENDING_CARDS.tiers.map((tier) => tier.id)).toEqual(["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"]);
    const win = findSeed((seed) => roll(seed, "status") < 0.35);
    const hit = new Set<string>([
      card({ route: "PHD", outcomes: offer("PHD"), stats: stats(20, 95, 40, 30), counts: { STUDY: 4 }, flags: ["ARC_RESEARCH_3_A"] }).tier,
      card({ route: "HOME_JOB", profile: { economy: "HIGH" }, stats: stats(80, 60, 60, 30), outcomes: offer("PHD", "LOCAL_JOB", "HOME_JOB") }).tier,
      card({ seed: win, route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), stats: stats(20, 60, 70, 40) }).tier,
      card({ route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), stats: stats(20, 60, 50, 40) }).tier,
      card({ route: "HOME_JOB", outcomes: offer("HOME_JOB"), stats: stats(0, 50, 85, 0) }).tier,
      card({ route: "HOME_JOB", outcomes: offer("HOME_JOB"), stats: stats(20, 50, 84, 40) }).tier,
      card({ route: "HOME_JOB", outcomes: offer("HOME_JOB"), stats: stats(19, 50, 84, 40) }).tier,
      card({ route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(10, 55, 40, 30) }).tier,
      card({ route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(9, 55, 40, 30) }).tier,
      card({ route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(50, 54, 40, 30) }).tier,
    ]);
    expect([...hit].sort()).toEqual([...ENDING_CARDS.tiers.map((tier) => tier.id)].sort());
  });
});

describe("隐藏／特殊结局：命中的全部挂上（14 §3）", () => {
  const home = { route: "HOME_JOB" as const, outcomes: offer("HOME_JOB"), stats: stats(10, 60, 50, 30) };

  it("H01 爱情支线：校园 3 次 + 身心 50 + 抽签", () => {
    const win = findSeed((seed) => roll(seed, "love") < 0.5 && roll(seed, "dream") >= 0.03);
    const lose = findSeed((seed) => roll(seed, "love") >= 0.5 && roll(seed, "dream") >= 0.03);
    const base = { ...home, counts: { CAMPUS: 3 }, stats: stats(10, 60, 50, 50) };
    const hit = card({ ...base, seed: win });
    expect(ids(hit)).toContain("H01");
    expect(hit.draws.find((draw) => draw.key === "epilogue:love")).toMatchObject({ probabilityPercent: 50, success: true });
    const missed = card({ ...base, seed: lose });
    expect(ids(missed)).not.toContain("H01");
    expect(missed.draws.some((draw) => draw.key === "epilogue:love")).toBe(false);
    const noCampus = card({ ...base, seed: win, counts: { CAMPUS: 2 } });
    expect(ids(noCampus)).not.toContain("H01");
    expect(noCampus.draws.some((draw) => draw.key === "epilogue:love")).toBe(false);
    expect(ids(card({ ...base, seed: win, stats: stats(10, 60, 50, 49) }))).not.toContain("H01");
  });

  it("H02 双地图生活：有留美机会却回国", () => {
    expect(ids(card({ ...home, outcomes: offer("LOCAL_JOB", "HOME_JOB") }))).toContain("H02");
    expect(ids(card(home))).not.toContain("H02");
    expect(ids(card({ ...home, route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB", "HOME_JOB") }))).not.toContain("H02");
  });

  it("H03 跨职业转职：转向支线写下新方向且没有读博", () => {
    expect(ids(card({ ...home, flags: ["ARC_REORIENTATION_3_A"] }))).toContain("H03");
    expect(ids(card({ ...home, flags: ["ARC_REORIENTATION_3_B"] }))).not.toContain("H03");
    expect(ids(card({ route: "PHD", outcomes: offer("PHD"), stats: home.stats, flags: ["ARC_REORIENTATION_3_A"] }))).not.toContain("H03");
  });

  it("H04 留学中介闭环：读过硕士后回国或过渡", () => {
    expect(ids(card({ ...home, degree: "MS", ugOutcomes: offer("PHD") }))).toContain("H04");
    expect(ids(card({ ...home, degree: "MS", route: "TRANSITION", ugOutcomes: offer("PHD") }))).toContain("H04");
    expect(ids(card({ ...home, degree: "MS", route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), ugOutcomes: offer("PHD") }))).not.toContain("H04");
    expect(ids(card(home))).not.toContain("H04");
  });

  it("H05 流量转职：公开了作品且没有读博", () => {
    const job = card({ route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), stats: stats(10, 60, 60, 30), flags: ["ARC_CREATIVE_3_A"] });
    expect(ids(job)).toContain("H05");
    expect(job.combo).toBe("SR＋＋H05＋未完待续"); // 用户总表里的组合示例
    expect(ids(card({ ...home, flags: ["ARC_CREATIVE_3_B"] }))).not.toContain("H05");
    expect(ids(card({ route: "PHD", outcomes: offer("PHD"), stats: home.stats, flags: ["ARC_CREATIVE_3_A"] }))).not.toContain("H05");
  });

  it("H06 二周目翻盘：本科一个机会都没有，硕士后接受了机会", () => {
    expect(ids(card({ ...home, degree: "MS", ugOutcomes: NO_OFFERS }))).toContain("H06");
    expect(ids(card({ ...home, degree: "MS", ugOutcomes: offer("PHD") }))).not.toContain("H06");
    expect(ids(card({ ...home, degree: "MS", route: "TRANSITION", ugOutcomes: NO_OFFERS }))).not.toContain("H06");
    expect(ids(card(home))).not.toContain("H06");
  });

  it("H07 主线任务被顶掉：想做研究、博士到手、却接了工作", () => {
    const base = { ...home, outcomes: offer("PHD", "HOME_JOB"), profile: { aspiration: "DISCOVERY" as const } };
    expect(ids(card(base))).toContain("H07");
    expect(ids(card({ ...base, profile: { aspiration: "INDEPENDENCE" } }))).not.toContain("H07");
    expect(ids(card({ ...base, outcomes: offer("HOME_JOB") }))).not.toContain("H07");
    expect(ids(card({ ...base, route: "PHD" }))).not.toContain("H07");
    expect(ids(card({ ...base, route: "TRANSITION" }))).not.toContain("H07");
  });

  it("H08 梦醒：3% 的纯运气，任意等级都可能", () => {
    const dream = findSeed((seed) => roll(seed, "dream") < 0.03);
    const hit = card({ ...home, seed: dream });
    expect(ids(hit)).toContain("H08");
    expect(hit.draws.find((draw) => draw.key === "epilogue:dream")).toMatchObject({ probabilityPercent: 3, success: true });
    expect(ids(card({ route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(0, 30, 10, 0), seed: dream }))).toContain("H08");
    expect(ids(card(home))).not.toContain("H08");
    // 没命中的隐藏结局抽签不写进卡面，免得剧透
    expect(card(home).draws.some((draw) => draw.key === "epilogue:dream")).toBe(false);
  });

  it("H09 自我探索：休息 3 次 + 校园 2 次", () => {
    expect(ids(card({ ...home, counts: { REST: 3, CAMPUS: 2 } }))).toContain("H09");
    expect(ids(card({ ...home, counts: { REST: 2, CAMPUS: 2 } }))).not.toContain("H09");
    expect(ids(card({ ...home, counts: { REST: 3, CAMPUS: 1 } }))).not.toContain("H09");
  });

  it("H10 订阅制创作：走过创作支线 + 过渡期 + 抽签", () => {
    const win = findSeed((seed) => roll(seed, "subscription") < 0.25 && roll(seed, "dream") >= 0.03);
    const lose = findSeed((seed) => roll(seed, "subscription") >= 0.25 && roll(seed, "dream") >= 0.03);
    const base = { route: "TRANSITION" as const, outcomes: NO_OFFERS, stats: stats(10, 60, 50, 30), arcs: { A: "CREATIVE" as const, B: "FAMILY" as const } };
    const hit = card({ ...base, seed: win });
    expect(ids(hit)).toContain("H10");
    expect(hit.draws.find((draw) => draw.key === "epilogue:subscription")).toMatchObject({ probabilityPercent: 25, success: true });
    const missedSubscription = card({ ...base, seed: lose });
    expect(ids(missedSubscription)).not.toContain("H10");
    expect(missedSubscription.draws.some((draw) => draw.key === "epilogue:subscription")).toBe(false);
    expect(ids(card({ ...base, seed: win, arcs: { A: "FAMILY", B: "CREATIVE" } }))).toContain("H10");
    const noArc = card({ ...base, seed: win, arcs: { A: "FAMILY", B: "RESEARCH" } });
    expect(ids(noArc)).not.toContain("H10");
    expect(noArc.draws.some((draw) => draw.key === "epilogue:subscription")).toBe(false);
    expect(ids(card({ ...base, seed: win, route: "HOME_JOB", outcomes: offer("HOME_JOB") }))).not.toContain("H10");
  });

  it("H11 黑色幽默：资金 30 + 6% 抽签", () => {
    const win = findSeed((seed) => roll(seed, "scam") < 0.06 && roll(seed, "dream") >= 0.03);
    const base = { ...home, stats: stats(30, 60, 50, 30) };
    const hit = card({ ...base, seed: win });
    expect(ids(hit)).toContain("H11");
    expect(hit.draws.find((draw) => draw.key === "epilogue:scam")).toMatchObject({ probabilityPercent: 6, success: true });
    const poor = card({ ...base, seed: win, stats: stats(29, 60, 50, 30) });
    expect(ids(poor)).not.toContain("H11");
    expect(poor.draws.some((draw) => draw.key === "epilogue:scam")).toBe(false);
    const missedScam = card(base); // 默认 seed 的五个抽签都不中
    expect(ids(missedScam)).not.toContain("H11");
    expect(missedScam.draws).toEqual([]);
  });

  it("H12／TE 真正结局：状态不错且主动放下机会，或普通结局里把时间留给休息与校园", () => {
    const chosen = card({ route: "TRANSITION", outcomes: offer("HOME_JOB"), stats: stats(10, 60, 50, 50) });
    expect(chosen).toMatchObject({ tier: "N", status: "TE", statusLabel: "TE", combo: "N＋TE" });
    expect(ids(chosen)).toEqual(["H12"]);
    expect(card({ route: "TRANSITION", outcomes: offer("HOME_JOB"), stats: stats(10, 60, 50, 49) })).toMatchObject({ status: "OPEN" });

    // 用户总表里的示例 “R＋TE”：工作普通、生活满意
    const ordinary = card({ ...home, stats: stats(10, 60, 50, 55), counts: { REST: 2, CAMPUS: 2 } });
    expect(ordinary).toMatchObject({ tier: "R", status: "TE", combo: "R＋TE" });
    expect(card({ ...home, stats: stats(25, 60, 50, 55), counts: { REST: 1, CAMPUS: 3 } })).toMatchObject({ tier: "R_PLUS", status: "TE", combo: "R＋＋TE" });
    expect(card({ route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(20, 60, 50, 55), counts: { REST: 4 } })).toMatchObject({ tier: "N", status: "TE" });
    expect(card({ ...home, stats: stats(10, 60, 50, 55), counts: { REST: 2, CAMPUS: 1 } }).status).toBe("HE");
    // 非普通档不因休息与校园次数得到 TE
    expect(card({ ...home, stats: stats(10, 60, 90, 55), counts: { REST: 2, CAMPUS: 2 } })).toMatchObject({ tier: "SR", status: "HE" });
  });

  it("十二个隐藏结局都有构造用例命中，名称与吐槽取自内容表", () => {
    expect(ENDING_CARDS.hidden.map((entry) => entry.id)).toEqual(["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12"]);
    const all = findSeed((seed) => roll(seed, "love") < 0.5 && roll(seed, "dream") < 0.03 && roll(seed, "scam") < 0.06 && roll(seed, "subscription") < 0.25);
    // 一张回国工作的卡能同时挂上的最多标签
    const homeCard = card({
      seed: all,
      degree: "MS",
      route: "HOME_JOB",
      outcomes: offer("PHD", "LOCAL_JOB", "HOME_JOB"),
      ugOutcomes: NO_OFFERS,
      stats: stats(30, 60, 50, 60),
      counts: { CAMPUS: 3, REST: 3 },
      flags: ["ARC_REORIENTATION_3_A", "ARC_CREATIVE_3_A"],
      profile: { aspiration: "DISCOVERY" },
    });
    expect(ids(homeCard)).toEqual(["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H11", "H12"]);
    expect(homeCard.status).toBe("TE");
    expect(homeCard.combo).toBe("R＋＋H01＋H02＋H03＋H04＋H05＋H06＋H07＋H08＋H09＋H11＋TE");
    const pauseCard = card({ seed: all, route: "TRANSITION", outcomes: NO_OFFERS, stats: stats(10, 60, 50, 30), arcs: { A: "CREATIVE", B: "FAMILY" } });
    expect(ids(pauseCard)).toContain("H10");
    for (const entry of [...homeCard.hidden, ...pauseCard.hidden]) {
      const content = ENDING_CARDS.hidden.find((item) => item.id === entry.id);
      expect(entry.name).toBe(content?.name);
      expect(entry.roast).toBe(content?.roast);
      expect(entry.facts.length).toBeGreaterThan(0);
    }
    expect(new Set(ids(homeCard)).size).toBe(ids(homeCard).length);
  });
});

describe("完结状态与组合写法（14 §4）", () => {
  it("用户总表里的组合示例", () => {
    const loveWin = findSeed((seed) => roll(seed, "status") < 0.35 && roll(seed, "love") < 0.5 && roll(seed, "dream") >= 0.03 && roll(seed, "scam") >= 0.06);
    expect(card({ seed: loveWin, route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), stats: stats(20, 60, 80, 60), counts: { CAMPUS: 3 } }).combo).toBe("SSR＋H01＋HE");
    expect(card({ route: "TRANSITION", degree: "MS", outcomes: NO_OFFERS, stats: stats(20, 80, 40, 30) }).combo).toBe("D＋H04＋未完待续");
    expect(card({ route: "TRANSITION", profile: { economy: "HIGH" }, outcomes: offer("PHD", "LOCAL_JOB", "HOME_JOB"), stats: stats(80, 60, 60, 30) }).combo).toBe("UR＋开放结局");
    // 少一个机会或少 1 点资金就只是普通的主动过渡
    expect(card({ route: "TRANSITION", profile: { economy: "HIGH" }, outcomes: offer("PHD", "HOME_JOB"), stats: stats(80, 60, 60, 30) }).combo).toBe("N＋开放结局");
    expect(card({ route: "TRANSITION", profile: { economy: "HIGH" }, outcomes: offer("PHD", "LOCAL_JOB", "HOME_JOB"), stats: stats(79, 60, 60, 30) }).combo).toBe("N＋开放结局");
  });

  it("任意构造的终局都恰好一个等级、一个状态，标签无重复，卡面与内容表一致", () => {
    const routes: FinalRoute[] = ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"];
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const pick = (key: string, n: number) => Math.floor(draw01(seed, `case:${key}`) * n);
      const route = routes[pick("route", 4)];
      const others = offer(...(["PHD", "LOCAL_JOB", "HOME_JOB"] as const).filter((key) => pick(`o:${key}`, 2) === 1));
      const outcomes: Outcomes = route === "TRANSITION" ? (pick("none", 2) === 1 ? NO_OFFERS : others) : { ...others, [route]: "OFFERED" };
      const result = card({
        seed,
        route,
        degree: pick("degree", 2) === 1 ? "MS" : "UG",
        outcomes,
        ugOutcomes: pick("ug", 2) === 1 ? NO_OFFERS : offer("PHD"),
        stats: stats(pick("m", 101), pick("a", 101), pick("c", 101), pick("w", 101)),
        counts: { STUDY: pick("s", 6), CAMPUS: pick("u", 5), REST: pick("r", 5) },
        flags: ["ARC_RESEARCH_3_A", "ARC_CREATIVE_3_A", "ARC_REORIENTATION_3_A", "MASTER_04_A"].filter((_, index) => pick(`f${index}`, 3) === 0),
        profile: { economy: (["LOW", "MID", "HIGH"] as const)[pick("eco", 3)], aspiration: (["DISCOVERY", "INDEPENDENCE", "BELONGING"] as const)[pick("asp", 3)] },
        arcs: pick("arc", 2) === 1 ? { A: "CREATIVE", B: "FAMILY" } : { A: "RESEARCH", B: "FAMILY" },
        shortfallTerms: pick("sf", 4),
      });
      const content = ENDING_CARDS.tiers.find((tier) => tier.id === result.tier);
      expect(content).toBeDefined();
      expect(result.tierLabel).toBe(content?.label);
      expect(result.tierKind).toBe(content?.kind);
      expect([content?.name, content?.phdVariant?.name]).toContain(result.name);
      expect(["TE", "OPEN", "HE", "TBC"]).toContain(result.status);
      expect(result.statusLabel).toBe(ENDING_CARDS.status[result.status]);
      expect(result.facts.length).toBeGreaterThan(0);
      expect(new Set(ids(result)).size).toBe(ids(result).length);
      expect(result.status === "TE").toBe(ids(result).includes("H12"));
      const parts = result.combo.split("＋");
      expect(result.combo.startsWith(result.tierLabel)).toBe(true);
      expect(parts[parts.length - 1]).toBe(result.statusLabel);
      expect(result.combo).not.toContain("H12");
      for (const id of ids(result).filter((item) => item !== "H12")) expect(parts).toContain(id);
      // 路线与等级的对应
      if (route === "LOCAL_JOB") expect(["UR", "SSR", "SR_PLUS"]).toContain(result.tier);
      if (route === "HOME_JOB") expect(["UR", "SR", "R_PLUS", "R"]).toContain(result.tier);
      if (route === "PHD") expect(["EX", "UR", "SR_PLUS"]).toContain(result.tier);
      if (route === "TRANSITION") expect(["UR", "N", "D", "BE"]).toContain(result.tier);
      for (const draw of result.draws) {
        expect(draw.success).toBe(draw.roll < draw.probabilityPercent / 100);
        // 只有身份抽签会在未中时列出；隐藏结局的抽签只在命中时出现
        if (draw.key !== "epilogue:status") expect(draw.success).toBe(true);
      }
      const hiddenByDraw: Record<string, string> = { "epilogue:love": "H01", "epilogue:dream": "H08", "epilogue:subscription": "H10", "epilogue:scam": "H11" };
      for (const [key, id] of Object.entries(hiddenByDraw)) {
        expect(result.draws.some((draw) => draw.key === key)).toBe(ids(result).includes(id as never));
      }
      checked++;
    }
    expect(checked).toBe(400);
  });

  it("卡面文字不声称学位、教职或身份已经到手", () => {
    const forbidden = /教授|绿卡|博士学位|工作许可|永久身份|已获得|已经拿到/;
    for (const tier of ENDING_CARDS.tiers) {
      for (const text of [tier.name, tier.roast, tier.kind, tier.phdVariant?.name ?? "", tier.phdVariant?.roast ?? ""]) expect(text).not.toMatch(forbidden);
    }
    for (const entry of ENDING_CARDS.hidden) for (const text of [entry.name, entry.roast, entry.hint]) expect(text).not.toMatch(forbidden);
    const ex = card({ route: "PHD", outcomes: offer("PHD"), stats: stats(20, 100, 40, 30), counts: { STUDY: 5 }, flags: ["ARC_RESEARCH_3_A"] });
    const win = findSeed((seed) => roll(seed, "status") < 0.35);
    const ssr = card({ seed: win, route: "LOCAL_JOB", outcomes: offer("LOCAL_JOB"), stats: stats(20, 60, 80, 60) });
    for (const result of [ex, ssr]) expect(JSON.stringify(result)).not.toMatch(forbidden);
  });
});

describe("结局卡写入存档后不重算", () => {
  const policy = classicPolicy({ talent: "T_PRACTICAL", focus: (state) => (state.termIndex % 2 === 0 ? "CAREER" : "STUDY"), event: "A" });

  it("同 seed 同选择得到同一张卡；卡片在确认去向时冻结进状态", () => {
    for (let seed = 0; seed < 25; seed++) {
      const first = asActive(play(startClassic(seed, "HIGH"), policy).state);
      const second = asActive(play(startClassic(seed, "HIGH"), policy).state);
      expect(first.phase).toBe("ENDING");
      expect(first.ending?.card).toEqual(second.ending?.card);
      expect(first.ending?.card.combo.length).toBeGreaterThan(0);
    }
  });

  it("结局卡不修改属性、机会或毕业快照", () => {
    const results = asActive(play(startClassic(4, "HIGH"), policy, at("GRAD_RESULTS")).state);
    const before = clone(results);
    const ended = asActive(act(results, { type: "CHOOSE_ROUTE", route: "TRANSITION" }));
    expect(ended.stats).toEqual(before.stats);
    expect(ended.flags).toEqual(before.flags);
    expect(ended.history).toEqual(before.history);
    expect(ended.graduations.UG?.outcomes).toEqual(before.graduations.UG?.outcomes);
    expect(ended.graduations.UG?.probabilities).toEqual(before.graduations.UG?.probabilities);
    expect(ended.graduations.UG?.frozenStats).toEqual(before.graduations.UG?.frozenStats);
  });
});
