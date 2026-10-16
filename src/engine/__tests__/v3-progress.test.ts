// 成就与天赋解锁（docs/22 §7、docs/23；第四版新增的 22 条见 docs/24 §10）：每条成就的判定、判定顺序、
// 解锁概率与确定性。成就清单随时会加：这里不写死条数，但要求内容里的每一条在引擎里有规则、在下面的 CASES 里有构造用例。
// 五年后结局的稀有度要用到 SR／SSR 的条目：内容还在写，所以在本文件的进程里临时加几条测试用的（不动内容文件）。

import { afterAll, describe, expect, it } from "vitest";
import { ACHIEVEMENTS, EARLY_ENDINGS, LIFE_TRACKS, TALENTS } from "../../content";
import { BUSY_LIFE_HAPPENINGS_MIN, ENDING_TIER_ORDER } from "../constants";
import { evaluateRun, setupView, simulate } from "../index";
import type { ActiveRun, EndingTierId, HiddenEndingId, LifeOutcome, LifeTrack, Points, ProgressSnapshot, TalentRarity } from "../index";
import { ACHIEVEMENT_IDS_WITH_RULES, unlockChancePercent } from "../progress";
import { draw01, pickIndex } from "../rng";
import { asActive, autoInput, classicPolicy, clone, ctx, play, simulateObserved, start, startClassic } from "./helpers";

const TEST_OUTCOMES: LifeOutcome[] = (["N", "SR", "SSR"] as TalentRarity[]).map((grade) => ({
  id: `LO_TEST_${grade}`, name: `测试${grade}`, roast: "测试用。", text: "测试用。", hint: "测试用。", grade, when: { tracks: ["DROPOUT"], yearMin: 9 }, weight: 1,
}));
LIFE_TRACKS.DROPOUT.outcomes.push(...TEST_OUTCOMES); // when 永远不满足：只给成就判定查名字与稀有度，不会被真的抽到
afterAll(() => {
  LIFE_TRACKS.DROPOUT.outcomes.splice(LIFE_TRACKS.DROPOUT.outcomes.length - TEST_OUTCOMES.length, TEST_OUTCOMES.length);
});

const TALENTS_ALL = "A_TALENTS_ALL";
const ALL_IDS = ACHIEVEMENTS.map((achievement) => achievement.id);
const LOCKED = TALENTS.filter((talent) => talent.locked).map((talent) => talent.id);
const N_TALENTS = TALENTS.filter((talent) => talent.rarity === "N").map((talent) => talent.id);
const P = (family: number, academics: number, career: number, wellbeing: number): Points => ({ family, academics, career, wellbeing });

const empty = (patch: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({
  runs: 0, tiers: {}, hidden: {}, early: {}, flavors: {}, achievements: [], unlockedTalents: [], ...patch,
});
/** 除了列出的几条之外全部成就都已到手的进度：用来精确控制“本局新成就数”。 */
const ownedExcept = (missing: string[], patch: Partial<ProgressSnapshot> = {}): ProgressSnapshot =>
  empty({ achievements: ALL_IDS.filter((id) => !missing.includes(id)), ...patch });

/** 找一局真实的结局状态作为构造用例的底子。 */
function findRun(test: (run: ActiveRun) => boolean): ActiveRun {
  for (let seed = 1; seed < 5000; seed++) {
    const { setup, input } = autoInput(seed);
    const run = asActive(simulate(setup, input, ctx).state);
    if (test(run)) return run;
  }
  throw new Error("找不到符合要求的局");
}
const hasSsrDraw = (run: ActiveRun): boolean => setupView(start(run.seed)).draw.some((talent) => talent.rarity === "SSR");
/** 一局平平常常的本科毕业结局：十连抽里没有 SSR，点数没有 0 也没有 10，没有隐藏结局。 */
const GRAD = findRun((run) =>
  run.ending?.kind === "GRADUATION" && run.ending.degree === "UG" && !hasSsrDraw(run) && run.ending.card.hidden.length === 0 &&
  Object.values(run.profile.points ?? {}).every((value) => value > 0 && value < 10) && new Set(Object.values(run.profile.points ?? {})).size > 1,
);
const EARLY = findRun((run) => run.ending?.kind === "EARLY" && run.ending.early !== "E_LOTTERY" && !hasSsrDraw(run));
/** 经典模式走到结局的一局：没有毕业后的五年。 */
const CLASSIC = asActive(play(startClassic(13, "MID"), classicPolicy({ focus: "STUDY", event: "A" })).state);

type Edit = (run: ActiveRun) => void;
const edit = (base: ActiveRun, ...edits: Edit[]): ActiveRun => {
  const run = clone(base);
  for (const apply of edits) apply(run);
  return run;
};
const ending = (run: ActiveRun) => {
  if (!run.ending) throw new Error("没有结局");
  return run.ending;
};
const route = (value: "PHD" | "LOCAL_JOB" | "HOME_JOB" | "TRANSITION"): Edit => (run) => void (ending(run).route = value);
const stat = (key: "money" | "academics" | "career" | "wellbeing", value: number): Edit => (run) => void (run.stats[key] = value);
/** 离校时的四属性（life.startStats）。 */
const exitStat = (key: "money" | "academics" | "career" | "wellbeing", value: number): Edit => (run) => {
  if (!run.life) throw new Error("没有毕业后的五年");
  run.life.startStats[key] = value;
};
const lifeFlags = (...flags: string[]): Edit => (run) => {
  if (!run.life) throw new Error("没有毕业后的五年");
  run.life.flags = flags;
};
const lifeTracks = (...tracks: LifeTrack[]): Edit => (run) => {
  if (!run.life) throw new Error("没有毕业后的五年");
  run.life.tracks = tracks;
  run.life.track = tracks[tracks.length - 1];
};
const outcome = (grade: TalentRarity): Edit => (run) => {
  if (!run.life) throw new Error("没有毕业后的五年");
  run.life.outcome = { id: `LO_TEST_${grade}`, track: "DROPOUT" };
};
/** 把每个结算完的学期期末的学业与身心改成给定值（期末 GPA 由它们决定，docs/24 §2.4）。 */
const termEnds = (academics: number, wellbeing: number, stage?: "UG" | "MS"): Edit => (run) => {
  for (const entry of run.history) {
    if (entry.kind === "GROWTH" && (stage === undefined || entry.stage === stage)) entry.afterStats = { ...entry.afterStats, academics, wellbeing };
  }
};
const GPA_TALENTS = TALENTS.filter((talent) => (talent.effects.gpa ?? 0) > 0).sort((a, b) => (b.effects.gpa ?? 0) - (a.effects.gpa ?? 0)).slice(0, 3).map((talent) => talent.id);
const PLAIN_TALENTS = TALENTS.filter((talent) => talent.effects.gpa === undefined).slice(0, 3).map((talent) => talent.id);
const outcomesSeen = (n: number): Record<string, number> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`LO_SEEN_${i}`, 1]));
const count = (key: "STUDY" | "WORK" | "CAREER" | "CAMPUS" | "REST", value: number): Edit => (run) => void (run.focusCounts[key] = value);
const points = (value: Points): Edit => (run) => void (run.profile.points = value);
const tier = (value: EndingTierId): Edit => (run) => void (ending(run).card.tier = value);
const schoolTier = (value: "S" | "A" | "U"): Edit => (run) => {
  if (!run.school) throw new Error("没有学校");
  run.school.tier = value;
};
const outcomes = (phd: string, local: string, home: string): Edit => (run) => {
  const checkpoint = run.graduations[ending(run).degree];
  if (!checkpoint) throw new Error("没有毕业快照");
  checkpoint.outcomes = { PHD: phd, LOCAL_JOB: local, HOME_JOB: home } as NonNullable<typeof checkpoint.outcomes>;
};
const masters: Edit = (run) => {
  ending(run).degree = "MS";
  run.graduations.MS = clone(run.graduations.UG);
};
const hidden = (...ids: HiddenEndingId[]): Edit => (run) => void (ending(run).card.hidden = ids.map((id) => ({ id, name: id, roast: id, facts: [] })));
const happenings = (n: number): Edit => (run) => {
  const template = run.history[run.history.length - 1];
  run.history = run.history.filter((entry) => entry.kind !== "HAPPENING");
  for (let i = 0; i < n; i++) run.history.push({ ...clone(template), kind: "HAPPENING", happeningId: `X${i}` });
};
const talents = (ids: string[]): Edit => (run) => void (run.profile.talents = ids);
const earlyId = (id: string): Edit => (run) => {
  ending(run).early = id;
  ending(run).card.early = id;
};
/** 让这一局的十连抽里出现 SSR：继承一张 SSR 天赋（锁着的先算作已解锁）。 */
const ssrDraw: Edit = (run) => {
  const ssr = TALENTS.find((talent) => talent.rarity === "SSR");
  if (!ssr) throw new Error("天赋池里没有 SSR");
  run.unlockedTalents = ssr.locked ? [ssr.id] : [];
  run.inheritedTalent = ssr.id;
};
const seeded = (seed: number): Edit => (run) => void (run.seed = seed);
/** 同一局，只是把 seed 换成“解锁抽签一定命中”的那种（roll < 20%，新成就再少也解锁）。 */
const UNLOCK_SEED = (() => {
  for (let seed = 1; seed < 100000; seed++) if (draw01(seed, "unlock:roll") < 0.2) return seed;
  throw new Error("找不到 seed");
})();
const tiersSeen = (n: number, except: EndingTierId): Record<string, number> =>
  Object.fromEntries(ENDING_TIER_ORDER.filter((id) => id !== except).slice(0, n).map((id) => [id, 1]));

interface Case {
  run: ActiveRun;
  progress?: ProgressSnapshot;
}
/** 每条成就：一个满足条件的用例（yes），若干个差一点的用例（no）。 */
const CASES: Record<string, { yes: Case[]; no: Case[] }> = {
  A_FIRST: { yes: [{ run: GRAD }, { run: EARLY }], no: [] },
  A_PHD: { yes: [{ run: edit(GRAD, route("PHD")) }], no: [{ run: edit(GRAD, route("LOCAL_JOB")) }, { run: EARLY }] },
  A_LOCAL: { yes: [{ run: edit(GRAD, route("LOCAL_JOB")) }], no: [{ run: edit(GRAD, route("HOME_JOB")) }, { run: EARLY }] },
  A_HOME: { yes: [{ run: edit(GRAD, route("HOME_JOB")) }], no: [{ run: edit(GRAD, route("PHD")) }, { run: EARLY }] },
  A_GAP: { yes: [{ run: edit(GRAD, route("TRANSITION")) }], no: [{ run: edit(GRAD, route("PHD")) }, { run: EARLY }] },
  A_MASTERS: { yes: [{ run: edit(GRAD, masters) }], no: [{ run: GRAD }, { run: edit(EARLY, (run) => void (ending(run).degree = "MS")) }] },
  A_EARLY: { yes: [{ run: EARLY }], no: [{ run: GRAD }] },
  A_ALL_OFFERS: {
    yes: [{ run: edit(GRAD, outcomes("OFFERED", "OFFERED", "OFFERED")) }],
    no: [{ run: edit(GRAD, outcomes("OFFERED", "OFFERED", "NOT_OFFERED")) }, { run: edit(GRAD, outcomes("OFFERED", "INELIGIBLE", "OFFERED")) }, { run: EARLY }],
  },
  // 没有任何一路到手，且至少两路是“申请了没拿到”（剩下那一路可以是没资格）
  A_ALL_MISSED: {
    yes: [
      { run: edit(GRAD, outcomes("NOT_OFFERED", "NOT_OFFERED", "NOT_OFFERED")) },
      { run: edit(GRAD, outcomes("NOT_OFFERED", "INELIGIBLE", "NOT_OFFERED")) },
      { run: edit(GRAD, outcomes("INELIGIBLE", "NOT_OFFERED", "NOT_OFFERED")) },
    ],
    no: [
      { run: edit(GRAD, outcomes("NOT_OFFERED", "INELIGIBLE", "INELIGIBLE")) },
      { run: edit(GRAD, outcomes("INELIGIBLE", "INELIGIBLE", "INELIGIBLE")) },
      { run: edit(GRAD, outcomes("NOT_OFFERED", "NOT_OFFERED", "OFFERED")) },
      { run: EARLY },
    ],
  },
  // 属性类成就看离校时的四属性（life.startStats），不看五年后的
  A_ACADEMICS_100: {
    yes: [{ run: edit(GRAD, exitStat("academics", 100), stat("academics", 3)) }, { run: edit(EARLY, exitStat("academics", 100)) }, { run: edit(CLASSIC, stat("academics", 100)) }],
    no: [{ run: edit(GRAD, exitStat("academics", 99), stat("academics", 100)) }],
  },
  A_CAREER_100: {
    yes: [{ run: edit(GRAD, exitStat("career", 100), stat("career", 3)) }, { run: edit(EARLY, exitStat("career", 100)) }],
    no: [{ run: edit(GRAD, exitStat("career", 99), stat("career", 100)) }],
  },
  A_RICH: {
    yes: [{ run: edit(GRAD, exitStat("money", 70), stat("money", 0)) }, { run: edit(GRAD, exitStat("money", 100)) }],
    no: [{ run: edit(GRAD, exitStat("money", 69), stat("money", 100)) }, { run: edit(EARLY, exitStat("money", 100)) }],
  },
  A_BROKE_GRAD: {
    yes: [{ run: edit(GRAD, exitStat("money", 0), stat("money", 50)) }],
    no: [{ run: edit(GRAD, exitStat("money", 1), stat("money", 0)) }, { run: edit(EARLY, exitStat("money", 0)) }],
  },
  A_FULL_BATTERY: {
    yes: [{ run: edit(GRAD, exitStat("wellbeing", 90), stat("wellbeing", 10)) }],
    no: [{ run: edit(GRAD, exitStat("wellbeing", 89), stat("wellbeing", 100)) }, { run: edit(EARLY, exitStat("wellbeing", 100)) }],
  },
  A_EMPTY_BATTERY: {
    yes: [{ run: edit(GRAD, exitStat("wellbeing", 0), stat("wellbeing", 50)) }],
    no: [{ run: edit(GRAD, exitStat("wellbeing", 1), stat("wellbeing", 0)) }, { run: edit(EARLY, exitStat("wellbeing", 0)) }],
  },
  A_NO_WORK: { yes: [{ run: edit(GRAD, count("WORK", 0)) }], no: [{ run: edit(GRAD, count("WORK", 1)) }, { run: edit(EARLY, count("WORK", 0)) }] },
  A_WORKER: { yes: [{ run: edit(GRAD, count("WORK", 4)) }, { run: edit(EARLY, count("WORK", 6)) }], no: [{ run: edit(GRAD, count("WORK", 3)) }] },
  A_GRINDER: { yes: [{ run: edit(GRAD, count("STUDY", 5)) }, { run: edit(EARLY, count("STUDY", 7)) }], no: [{ run: edit(GRAD, count("STUDY", 4)) }] },
  A_SLACKER: { yes: [{ run: edit(GRAD, count("REST", 3)) }, { run: edit(EARLY, count("REST", 5)) }], no: [{ run: edit(GRAD, count("REST", 2)) }] },
  A_S_TIER: { yes: [{ run: edit(GRAD, schoolTier("S")) }, { run: edit(EARLY, schoolTier("S")) }], no: [{ run: edit(GRAD, schoolTier("A")) }] },
  A_U_TIER: { yes: [{ run: edit(GRAD, schoolTier("U")) }], no: [{ run: edit(GRAD, schoolTier("S")) }] },
  A_MORTAL: {
    yes: [{ run: edit(GRAD, talents(N_TALENTS.slice(0, 3)), tier("SR")) }, { run: edit(GRAD, talents(N_TALENTS.slice(0, 3)), tier("EX")) }],
    no: [
      { run: edit(GRAD, talents(N_TALENTS.slice(0, 3)), tier("R_PLUS")) },
      { run: edit(GRAD, talents([N_TALENTS[0], N_TALENTS[1], TALENTS.find((talent) => talent.rarity !== "N")?.id ?? ""]), tier("SR")) },
    ],
  },
  A_LUCKY_DRAW: { yes: [{ run: edit(GRAD, ssrDraw) }, { run: edit(EARLY, ssrDraw) }], no: [{ run: GRAD }, { run: EARLY }] },
  A_ALL_IN: { yes: [{ run: edit(GRAD, points(P(2, 10, 4, 4))) }, { run: edit(EARLY, points(P(10, 4, 3, 3))) }], no: [{ run: edit(GRAD, points(P(9, 9, 1, 1))) }] },
  A_DUMP_STAT: { yes: [{ run: edit(GRAD, points(P(6, 7, 7, 0))) }], no: [{ run: edit(GRAD, points(P(6, 7, 6, 1))) }, { run: edit(EARLY, points(P(0, 8, 6, 6))) }] },
  A_EVEN: { yes: [{ run: edit(GRAD, points(P(5, 5, 5, 5))) }, { run: edit(EARLY, points(P(5, 5, 5, 5))) }], no: [{ run: edit(GRAD, points(P(5, 5, 6, 4))) }] },
  A_BUSY_LIFE: {
    yes: [{ run: edit(GRAD, happenings(BUSY_LIFE_HAPPENINGS_MIN)) }, { run: edit(EARLY, happenings(BUSY_LIFE_HAPPENINGS_MIN + 1)) }],
    no: [{ run: edit(GRAD, happenings(BUSY_LIFE_HAPPENINGS_MIN - 1)) }],
  },
  A_TOP_TIER: {
    yes: [{ run: edit(GRAD, tier("SSR")) }, { run: edit(GRAD, tier("UR")) }, { run: edit(EARLY, tier("EX")) }],
    no: [{ run: edit(GRAD, tier("SR_PLUS")) }, { run: edit(GRAD, tier("BE")) }],
  },
  A_BAD_END: { yes: [{ run: edit(GRAD, tier("BE")) }, { run: edit(EARLY, tier("BE")) }], no: [{ run: edit(GRAD, tier("D")) }] },
  A_DREAM: { yes: [{ run: edit(GRAD, hidden("H02", "H08")) }], no: [{ run: edit(GRAD, hidden("H02", "H09")) }, { run: GRAD }] },
  A_JACKPOT: { yes: [{ run: edit(EARLY, earlyId("E_LOTTERY")) }], no: [{ run: EARLY }, { run: GRAD }] },
  A_RUNS_10: { yes: [{ run: GRAD, progress: empty({ runs: 9 }) }, { run: EARLY, progress: empty({ runs: 30 }) }], no: [{ run: GRAD, progress: empty({ runs: 8 }) }] },
  A_RUNS_50: { yes: [{ run: GRAD, progress: empty({ runs: 49 }) }], no: [{ run: GRAD, progress: empty({ runs: 48 }) }] },
  A_TIERS_5: {
    yes: [{ run: edit(GRAD, tier("N")), progress: empty({ tiers: tiersSeen(4, "N") }) }, { run: edit(GRAD, tier("N")), progress: empty({ tiers: { ...tiersSeen(5, "N"), N: 3 } }) }],
    no: [
      { run: edit(GRAD, tier("N")), progress: empty({ tiers: tiersSeen(3, "N") }) },
      { run: edit(GRAD, tier("N")), progress: empty({ tiers: { ...tiersSeen(3, "N"), N: 9 } }) }, // 重复的等级不多算
      { run: edit(GRAD, tier("N")), progress: empty({ tiers: { ...tiersSeen(3, "N"), [ENDING_TIER_ORDER.filter((id) => id !== "N")[5]]: 0 } }) }, // 次数为 0 的不算
    ],
  },
  A_TIERS_ALL: {
    yes: [{ run: edit(GRAD, tier("N")), progress: empty({ tiers: tiersSeen(ENDING_TIER_ORDER.length - 1, "N") }) }],
    no: [{ run: edit(GRAD, tier("N")), progress: empty({ tiers: tiersSeen(ENDING_TIER_ORDER.length - 2, "N") }) }],
  },
  A_HIDDEN_6: {
    yes: [
      { run: edit(GRAD, hidden("H06")), progress: empty({ hidden: { H01: 1, H02: 2, H03: 1, H04: 1, H05: 1 } }) },
      { run: edit(GRAD, hidden("H06", "H07")), progress: empty({ hidden: { H01: 1, H02: 2, H03: 1, H04: 1 } }) },
    ],
    no: [
      { run: edit(GRAD, hidden("H05")), progress: empty({ hidden: { H01: 1, H02: 2, H03: 1, H04: 1, H05: 1 } }) },
      { run: GRAD, progress: empty({ hidden: { H01: 1, H02: 2, H03: 1, H04: 1, H05: 1 } }) },
    ],
  },
  A_EARLY_4: {
    yes: [{ run: edit(EARLY, earlyId("E_TEST_D")), progress: empty({ early: { E_TEST_A: 1, E_TEST_B: 1, E_TEST_C: 4 } }) }],
    no: [
      { run: edit(EARLY, earlyId("E_TEST_C")), progress: empty({ early: { E_TEST_A: 1, E_TEST_B: 1, E_TEST_C: 4 } }) },
      { run: GRAD, progress: empty({ early: { E_TEST_A: 1, E_TEST_B: 1, E_TEST_C: 4 } }) },
    ],
  },
  // 只差一张、这一局又解锁了它（用解锁抽签必中的 seed）；或者之前就已经全部解锁
  A_TALENTS_ALL: {
    yes: [{ run: edit(GRAD, seeded(UNLOCK_SEED)), progress: empty({ unlockedTalents: LOCKED.slice(1) }) }, { run: GRAD, progress: empty({ unlockedTalents: [...LOCKED] }) }],
    no: [{ run: edit(GRAD, seeded(UNLOCK_SEED)), progress: empty({ unlockedTalents: LOCKED.slice(2) }) }, { run: edit(GRAD, seeded(UNLOCK_SEED)) }],
  },
  // ---- 第四版（docs/24 §10） ----
  // 期末 GPA：学业 100、身心 80、三张 gpa 天赋 → 每学期都到顶 4.00；学业 0、身心 0、没有 gpa 天赋 → 每学期都低于 2.00
  A_GPA_4: {
    yes: [{ run: edit(GRAD, talents(GPA_TALENTS), termEnds(100, 80)) }, { run: edit(EARLY, talents(GPA_TALENTS), termEnds(100, 80)) }],
    no: [{ run: edit(GRAD, talents(PLAIN_TALENTS), termEnds(50, 60)) }, { run: edit(CLASSIC, termEnds(100, 80)) }],
  },
  A_GPA_WARNING: {
    yes: [{ run: edit(GRAD, talents(PLAIN_TALENTS), termEnds(0, 0)) }],
    no: [{ run: edit(GRAD, talents(PLAIN_TALENTS), termEnds(60, 60)) }, { run: edit(CLASSIC, termEnds(0, 0)) }],
  },
  A_DEANS_LIST: {
    yes: [{ run: edit(GRAD, talents(GPA_TALENTS), termEnds(100, 80, "UG")) }],
    no: [
      { run: edit(GRAD, talents(PLAIN_TALENTS), termEnds(50, 60, "UG")) },
      { run: edit(EARLY, talents(GPA_TALENTS), termEnds(100, 80)) }, // 没读到本科毕业
    ],
  },
  A_FIVE_YEARS: { yes: [{ run: GRAD }, { run: EARLY }], no: [{ run: CLASSIC }] },
  A_GREEN_CARD: { yes: [{ run: edit(GRAD, lifeFlags("H1B", "GREEN_CARD")) }], no: [{ run: edit(GRAD, lifeFlags("H1B")) }, { run: CLASSIC }] },
  A_H1B_OUT: { yes: [{ run: edit(GRAD, lifeFlags("H1B_OUT")) }], no: [{ run: edit(GRAD, lifeFlags("H1B")) }] },
  A_CANADA: { yes: [{ run: edit(GRAD, lifeFlags("H1B_OUT", "CANADA")) }], no: [{ run: edit(GRAD, lifeFlags("H1B_OUT")) }] },
  A_LAID_OFF: { yes: [{ run: edit(EARLY, lifeFlags("LAID_OFF")) }], no: [{ run: edit(GRAD, lifeFlags()) }] },
  A_HOUSE: { yes: [{ run: edit(GRAD, lifeFlags("MARRIED", "HOUSE")) }], no: [{ run: edit(GRAD, lifeFlags("MARRIED")) }] },
  A_MARRIED: { yes: [{ run: edit(GRAD, lifeFlags("DATING", "MARRIED")) }], no: [{ run: edit(GRAD, lifeFlags("DATING")) }] },
  A_DR: { yes: [{ run: edit(GRAD, lifeFlags("PHD_QUAL", "PHD_DONE")) }], no: [{ run: edit(GRAD, lifeFlags("PHD_QUAL")) }] },
  A_PHD_QUIT: { yes: [{ run: edit(GRAD, lifeFlags("PHD_QUIT")) }], no: [{ run: edit(GRAD, lifeFlags("PHD_QUAL")) }] },
  A_CIVIL: { yes: [{ run: edit(EARLY, lifeFlags("CIVIL_SERVANT")) }], no: [{ run: edit(EARLY, lifeFlags()) }] },
  A_EXIT: {
    yes: [{ run: edit(GRAD, lifeFlags("STARTUP", "STARTUP_EXIT")) }, { run: edit(GRAD, lifeFlags("FIRE")) }],
    no: [{ run: edit(GRAD, lifeFlags("STARTUP")) }],
  },
  A_RETURNEE: { yes: [{ run: edit(GRAD, lifeFlags("RETURNED")) }], no: [{ run: edit(GRAD, lifeFlags("LAID_OFF")) }] },
  A_SWITCH: {
    yes: [{ run: edit(GRAD, lifeTracks("LOCAL_JOB", "HOME_JOB")) }],
    no: [{ run: edit(GRAD, lifeTracks("LOCAL_JOB")) }, { run: CLASSIC }],
  },
  A_ZIGZAG: {
    yes: [{ run: edit(GRAD, lifeTracks("PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION")) }],
    no: [{ run: edit(GRAD, lifeTracks("PHD", "LOCAL_JOB", "HOME_JOB")) }],
  },
  A_COMEBACK: {
    yes: [{ run: edit(EARLY, outcome("SR")) }, { run: edit(EARLY, outcome("SSR")) }],
    no: [{ run: edit(EARLY, outcome("N")) }, { run: edit(GRAD, outcome("SSR")) }],
  },
  A_LIFE_SSR: { yes: [{ run: edit(GRAD, outcome("SSR")) }, { run: edit(EARLY, outcome("SSR")) }], no: [{ run: edit(GRAD, outcome("SR")) }, { run: CLASSIC }] },
  A_OUTCOMES_10: {
    yes: [{ run: edit(GRAD, outcome("N")), progress: empty({ outcomes: outcomesSeen(9) }) }],
    no: [
      { run: edit(GRAD, outcome("N")), progress: empty({ outcomes: outcomesSeen(8) }) },
      { run: edit(GRAD, outcome("N")), progress: empty({ outcomes: { ...outcomesSeen(8), LO_TEST_N: 2 } }) }, // 见过的不多算
      { run: CLASSIC, progress: empty({ outcomes: outcomesSeen(9) }) },
      { run: edit(GRAD, outcome("N")), progress: empty() }, // 旧进度没有 outcomes 这一项
    ],
  },
  A_LIFE_BROKE: { yes: [{ run: edit(GRAD, stat("money", 0)) }], no: [{ run: edit(GRAD, stat("money", 1), exitStat("money", 0)) }, { run: edit(CLASSIC, stat("money", 0)) }] },
  A_LIFE_ZEN: { yes: [{ run: edit(EARLY, stat("wellbeing", 90)) }], no: [{ run: edit(GRAD, stat("wellbeing", 89), exitStat("wellbeing", 100)) }, { run: edit(CLASSIC, stat("wellbeing", 100)) }] },
};

describe("成就清单与引擎规则一致（23）", () => {
  it("内容里的每一条成就在引擎里都有判定条件，在这里都有构造用例", () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
    const withoutRule = ALL_IDS.filter((id) => !ACHIEVEMENT_IDS_WITH_RULES.includes(id));
    expect(withoutRule, "这些成就在 progress.ts 里还没有判定条件（玩家永远拿不到）").toEqual([]);
    const withoutCase = ALL_IDS.filter((id) => !CASES[id]);
    expect(withoutCase, "这些成就在 v3-progress.test.ts 的 CASES 里还没有构造用例").toEqual([]);
    const orphan = ACHIEVEMENT_IDS_WITH_RULES.filter((id) => !ALL_IDS.includes(id));
    if (orphan.length > 0) console.log(`引擎里有规则、内容清单里已经没有的成就（无害）：${orphan.join("、")}`);
  });

  it("内容里有、引擎没写规则的成就不授予，也不让判定出错", () => {
    ACHIEVEMENTS.push({ id: "A_TEST_NO_RULE", name: "还没写规则", grade: "N", text: "测试用" });
    try {
      const rewards = evaluateRun(GRAD, empty());
      expect(rewards.achievements).not.toContain("A_TEST_NO_RULE");
      expect(rewards.achievements).toContain("A_FIRST");
    } finally {
      ACHIEVEMENTS.pop();
    }
    expect(ACHIEVEMENTS.map((achievement) => achievement.id)).toEqual(ALL_IDS);
  });
});

describe("每条成就的判定条件（23 的条件表）", () => {
  for (const achievement of ACHIEVEMENTS) {
    const cases = CASES[achievement.id];
    if (!cases) continue; // 上面的用例会报出来
    it(`${achievement.id} ${achievement.name}`, () => {
      expect(cases.yes.length).toBeGreaterThan(0);
      for (const [index, item] of cases.yes.entries()) {
        const progress = item.progress ?? empty();
        expect(evaluateRun(item.run, progress).achievements, `满足条件的用例 ${index}`).toContain(achievement.id);
        // 已经得到过的不再算作新成就
        expect(evaluateRun(item.run, { ...progress, achievements: [achievement.id] }).achievements, `已有时 ${index}`).not.toContain(achievement.id);
      }
      for (const [index, item] of cases.no.entries()) {
        expect(evaluateRun(item.run, item.progress ?? empty()).achievements, `不满足条件的用例 ${index}`).not.toContain(achievement.id);
      }
    });
  }
});

describe("判定是纯函数（22 §10）", () => {
  it("还没走到结局的局不能判定", () => {
    const { setup, input } = autoInput(3);
    expect(() => evaluateRun(setup, empty())).toThrow("PROGRESS_NOT_READY");
    let checked = 0;
    const { state } = simulateObserved(setup, input, ctx, (_before, _action, after) => {
      if (after.phase === "ENDING") return;
      checked += 1;
      expect(() => evaluateRun(after, empty())).toThrow("PROGRESS_NOT_READY");
    });
    expect(checked).toBeGreaterThan(10);
    expect(evaluateRun(state, empty()).achievements).toContain("A_FIRST");
  });

  it("同一局、同样的既有进度，结果完全相同；不改传进来的状态与进度；新成就按清单顺序给出", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { setup, input } = autoInput(seed);
      const run = asActive(simulate(setup, input, ctx).state);
      const progress = empty({ runs: seed % 12, tiers: tiersSeen(seed % 6, "N"), unlockedTalents: LOCKED.slice(0, seed % 4), achievements: ALL_IDS.filter((_, i) => (i + seed) % 3 === 0) });
      const before = [JSON.stringify(run), JSON.stringify(progress)];
      const rewards = evaluateRun(run, progress);
      expect(evaluateRun(clone(run), clone(progress))).toEqual(rewards);
      expect([JSON.stringify(run), JSON.stringify(progress)]).toEqual(before);
      // 都是清单里的、之前没有的，按清单顺序、不重复
      const order = rewards.achievements.map((id) => ALL_IDS.indexOf(id));
      expect(order.every((index) => index >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(new Set(order).size).toBe(order.length);
      for (const id of rewards.achievements) expect(progress.achievements).not.toContain(id);
      // 解锁的一定是还锁着的锁定天赋
      if (rewards.unlockedTalent !== null) {
        expect(LOCKED).toContain(rewards.unlockedTalent);
        expect(progress.unlockedTalents).not.toContain(rewards.unlockedTalent);
      }
    }
  });
});

describe("天赋解锁（22 §7.2）", () => {
  it("概率 = min(100, 20 + 20 × 本局新成就数)%", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(unlockChancePercent)).toEqual([20, 40, 60, 80, 100, 100, 100]);
  });

  it("按 unlock:roll 决定解不解锁，按 unlock:pick 在还锁着的天赋里（池内顺序）挑一张", () => {
    expect(LOCKED.length).toBeGreaterThan(2);
    // 新成就数分别恰好是 0、1、2、3 的四种进度
    const setups: Array<{ fresh: string[]; progress: ProgressSnapshot }> = [
      { fresh: [], progress: ownedExcept([TALENTS_ALL]) },
      { fresh: ["A_FIRST"], progress: ownedExcept(["A_FIRST", TALENTS_ALL]) },
      { fresh: ["A_FIRST", "A_RUNS_10"], progress: ownedExcept(["A_FIRST", "A_RUNS_10", TALENTS_ALL], { runs: 9 }) },
      { fresh: ["A_FIRST", "A_RUNS_10", "A_RUNS_50"], progress: ownedExcept(["A_FIRST", "A_RUNS_10", "A_RUNS_50", TALENTS_ALL], { runs: 49 }) },
    ];
    for (const { fresh, progress } of setups) {
      const still = LOCKED.filter((id) => !progress.unlockedTalents.includes(id));
      const chance = Math.min(100, 20 + 20 * fresh.length) / 100;
      let unlocked = 0;
      const picked = new Set<string>();
      const runs = 3000;
      for (let seed = 1; seed <= runs; seed++) {
        const rewards = evaluateRun(edit(GRAD, seeded(seed)), progress);
        expect(rewards.achievements, `seed ${seed}`).toEqual(ALL_IDS.filter((id) => fresh.includes(id)));
        const expected = draw01(seed, "unlock:roll") < chance ? still[pickIndex(seed, "unlock:pick", still.length)] : null;
        expect(rewards.unlockedTalent, `seed ${seed} 新成就 ${fresh.length}`).toBe(expected);
        if (rewards.unlockedTalent) {
          unlocked += 1;
          picked.add(rewards.unlockedTalent);
        }
      }
      expect(Math.abs(unlocked / runs - chance), `新成就 ${fresh.length} 条`).toBeLessThan(0.03);
      expect(picked.size).toBe(still.length); // 每一张都可能被解锁
    }
  });

  it("已解锁的不会再被抽到；全部解锁之后不再解锁", () => {
    const some = [LOCKED[0], LOCKED[LOCKED.length - 1]];
    const still = LOCKED.filter((id) => !some.includes(id));
    for (let seed = 1; seed <= 500; seed++) {
      const run = edit(GRAD, seeded(seed));
      const rewards = evaluateRun(run, empty({ unlockedTalents: some }));
      const chance = unlockChancePercent(rewards.achievements.filter((id) => id !== TALENTS_ALL).length) / 100;
      expect(rewards.unlockedTalent).toBe(draw01(seed, "unlock:roll") < chance ? still[pickIndex(seed, "unlock:pick", still.length)] : null);
      if (rewards.unlockedTalent) expect(some).not.toContain(rewards.unlockedTalent);
      expect(evaluateRun(run, empty({ unlockedTalents: [...LOCKED] })).unlockedTalent).toBeNull();
    }
  });

  it("中途结局的局同样抽解锁", () => {
    const rewards = evaluateRun(EARLY, empty());
    expect(rewards.achievements).toEqual(expect.arrayContaining(["A_FIRST", "A_EARLY"]));
    expect(rewards.unlockedTalent === null || LOCKED.includes(rewards.unlockedTalent)).toBe(true);
  });
});

describe("判定顺序（23）：先判其它成就 → 抽解锁 → 最后判“天赋全开”", () => {
  const lastOne = empty({ unlockedTalents: LOCKED.slice(1) }); // 只差池内第一张

  it("只差一张、这一局解锁了它：同一局就拿到“天赋全开”", () => {
    const rewards = evaluateRun(edit(GRAD, seeded(UNLOCK_SEED)), lastOne);
    expect(rewards.unlockedTalent).toBe(LOCKED[0]);
    expect(rewards.achievements).toContain(TALENTS_ALL);
    // 虽然最后才判定，给出来时仍按清单顺序排
    expect(rewards.achievements).toEqual(ALL_IDS.filter((id) => rewards.achievements.includes(id)));
  });

  it("“天赋全开”不反过来抬高解锁概率：其它成就一条都不新得时概率只有 20%", () => {
    // 除“天赋全开”外全部成就已到手 → 本局新成就数是 0；roll 落在 20%–40% 之间的 seed：
    // 如果把“天赋全开”也算进新成就数，概率会变成 40%、这一局就会解锁——实际不会。
    const progress = ownedExcept([TALENTS_ALL], { unlockedTalents: LOCKED.slice(1) });
    let between = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const roll = draw01(seed, "unlock:roll");
      const rewards = evaluateRun(edit(GRAD, seeded(seed)), progress);
      if (roll < 0.2) {
        expect(rewards).toEqual({ achievements: [TALENTS_ALL], unlockedTalent: LOCKED[0] });
      } else {
        expect(rewards).toEqual({ achievements: [], unlockedTalent: null });
        if (roll < 0.4) between += 1;
      }
    }
    expect(between).toBeGreaterThan(40);
  });

  it("之前就已经全部解锁、但还没拿到这条成就：这一局补上；已经拿到就不重复", () => {
    const all = empty({ unlockedTalents: [...LOCKED] });
    const rewards = evaluateRun(GRAD, all);
    expect(rewards.unlockedTalent).toBeNull();
    expect(rewards.achievements).toContain(TALENTS_ALL);
    expect(evaluateRun(GRAD, { ...all, achievements: [TALENTS_ALL] }).achievements).not.toContain(TALENTS_ALL);
  });

  it("还差两张时最多解锁一张，拿不到“天赋全开”", () => {
    const rewards = evaluateRun(edit(GRAD, seeded(UNLOCK_SEED)), empty({ unlockedTalents: LOCKED.slice(2) }));
    expect(LOCKED.slice(0, 2)).toContain(rewards.unlockedTalent);
    expect(rewards.achievements).not.toContain(TALENTS_ALL);
  });
});

describe("成就与内容的对应", () => {
  it("“欧皇本皇”指向的中途结局在内容里存在", () => {
    if (ALL_IDS.includes("A_JACKPOT")) expect(EARLY_ENDINGS.some((item) => item.id === "E_LOTTERY")).toBe(true);
  });
});
