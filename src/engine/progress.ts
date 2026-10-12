// 成就与天赋解锁（docs/22 第 7 节、docs/23）：一局结束后，按这一局的结果与既有的跨局进度，
// 算出本局新得到的成就与新解锁的天赋。纯函数：同一局、同样的既有进度，得到同样的结果。

import { ACHIEVEMENTS } from "../content";
import {
  ENDING_TIER_ORDER, OPPORTUNITY_ORDER, POINT_KEYS, POINT_MAX, UNLOCK_BASE_PERCENT, UNLOCK_PERCENT_PER_ACHIEVEMENT,
} from "./constants";
import { talentPool } from "./pools";
import { drawFor } from "./reducer";
import { draw01, pickIndex } from "./rng";
import { talentsByIds } from "./talents";
import type { ActiveRun, EndingRecord, EndingTierId, ProgressSnapshot, RunRewards, RunState } from "./types";

const A_TALENTS_ALL = "A_TALENTS_ALL";
const HIGH_TIERS: readonly EndingTierId[] = ["EX", "UR", "SSR", "SR_PLUS", "SR"];
const TOP_TIERS: readonly EndingTierId[] = ["EX", "UR", "SSR"];

/** 已出现过的种类数：既有进度里次数大于 0 的，加上本局新出现的。 */
function kindsAfter(counts: Record<string, number> | undefined, added: readonly string[], known?: readonly string[]): number {
  const seen = new Set<string>(Object.entries(counts ?? {}).filter(([, n]) => n > 0).map(([id]) => id));
  for (const id of added) seen.add(id);
  return known ? known.filter((id) => seen.has(id)).length : seen.size;
}

interface Facts {
  run: ActiveRun;
  ending: EndingRecord;
  progress: ProgressSnapshot;
  graduation: boolean;
}

/** 每条成就的判定条件（docs/23 的条件表）。A_TALENTS_ALL 要等解锁结果出来之后单独判定。 */
const CONDITIONS: Readonly<Record<string, (facts: Facts) => boolean>> = {
  A_FIRST: () => true,
  A_PHD: ({ ending, graduation }) => graduation && ending.route === "PHD",
  A_LOCAL: ({ ending }) => ending.route === "LOCAL_JOB",
  A_HOME: ({ ending }) => ending.route === "HOME_JOB",
  A_GAP: ({ ending }) => ending.route === "TRANSITION",
  A_MASTERS: ({ ending, graduation }) => graduation && ending.degree === "MS",
  A_EARLY: ({ ending }) => ending.kind === "EARLY",
  A_ALL_OFFERS: ({ run, ending, graduation }) => {
    const outcomes = graduation ? run.graduations[ending.degree]?.outcomes : null;
    return !!outcomes && OPPORTUNITY_ORDER.every((key) => outcomes[key] === "OFFERED");
  },
  A_ALL_MISSED: ({ run, ending, graduation }) => {
    const outcomes = graduation ? run.graduations[ending.degree]?.outcomes : null;
    if (!outcomes || OPPORTUNITY_ORDER.some((key) => outcomes[key] === "OFFERED")) return false;
    return OPPORTUNITY_ORDER.filter((key) => outcomes[key] === "NOT_OFFERED").length >= 2;
  },
  A_ACADEMICS_100: ({ run }) => run.stats.academics === 100,
  A_CAREER_100: ({ run }) => run.stats.career === 100,
  A_RICH: ({ run, graduation }) => graduation && run.stats.money >= 70,
  A_BROKE_GRAD: ({ run, graduation }) => graduation && run.stats.money === 0,
  A_FULL_BATTERY: ({ run, graduation }) => graduation && run.stats.wellbeing >= 90,
  A_EMPTY_BATTERY: ({ run, graduation }) => graduation && run.stats.wellbeing === 0,
  A_NO_WORK: ({ run, graduation }) => graduation && run.focusCounts.WORK === 0,
  A_WORKER: ({ run }) => run.focusCounts.WORK >= 4,
  A_GRINDER: ({ run }) => run.focusCounts.STUDY >= 5,
  A_SLACKER: ({ run }) => run.focusCounts.REST >= 3,
  A_S_TIER: ({ run }) => run.school?.tier === "S",
  A_U_TIER: ({ run }) => run.school?.tier === "U",
  A_MORTAL: ({ run, ending }) => {
    const talents = talentsByIds(run.profile.talents);
    return talents.length === 3 && talents.every((talent) => talent.rarity === "N") && HIGH_TIERS.includes(ending.card.tier);
  },
  A_LUCKY_DRAW: ({ run }) => drawFor(run).some((talent) => talent.rarity === "SSR"),
  A_ALL_IN: ({ run }) => {
    const points = run.profile.points;
    return points !== null && POINT_KEYS.some((key) => points[key] === POINT_MAX);
  },
  A_DUMP_STAT: ({ run, graduation }) => {
    const points = run.profile.points;
    return graduation && points !== null && POINT_KEYS.some((key) => points[key] === 0);
  },
  A_EVEN: ({ run }) => {
    const points = run.profile.points;
    return points !== null && POINT_KEYS.every((key) => points[key] === points.family);
  },
  A_BUSY_LIFE: ({ run }) => run.history.filter((entry) => entry.kind === "HAPPENING").length >= 7,
  A_TOP_TIER: ({ ending }) => TOP_TIERS.includes(ending.card.tier),
  A_BAD_END: ({ ending }) => ending.card.tier === "BE",
  A_DREAM: ({ ending }) => ending.card.hidden.some((entry) => entry.id === "H08"),
  A_JACKPOT: ({ ending }) => ending.early === "E_LOTTERY",
  A_RUNS_10: ({ progress }) => progress.runs + 1 >= 10,
  A_RUNS_50: ({ progress }) => progress.runs + 1 >= 50,
  A_TIERS_5: ({ ending, progress }) => kindsAfter(progress.tiers, [ending.card.tier], ENDING_TIER_ORDER) >= 5,
  A_TIERS_ALL: ({ ending, progress }) => kindsAfter(progress.tiers, [ending.card.tier], ENDING_TIER_ORDER) >= ENDING_TIER_ORDER.length,
  A_HIDDEN_6: ({ ending, progress }) => kindsAfter(progress.hidden, ending.card.hidden.map((entry) => entry.id)) >= 6,
  A_EARLY_4: ({ ending, progress }) => kindsAfter(progress.early, ending.early ? [ending.early] : []) >= 4,
};

/** 引擎里写了条件的成就 id（用于核对与内容清单一致）。 */
export const ACHIEVEMENT_IDS_WITH_RULES: readonly string[] = [...Object.keys(CONDITIONS), A_TALENTS_ALL];

/**
 * 一局结束后的跨局收获（docs/23 的判定顺序）：
 * 先判定除“天赋全开”以外的全部成就，得到本局新成就数；再按 22 §7.2 抽一次天赋解锁；最后判定“天赋全开”。
 */
export function evaluateRun(state: RunState, progress: ProgressSnapshot): RunRewards {
  if (state.phase !== "ENDING" || !state.ending) throw new Error("PROGRESS_NOT_READY: 这一局还没有走到结局");
  const run = state;
  const ending = state.ending;
  const facts: Facts = { run, ending, progress, graduation: ending.kind === "GRADUATION" };
  const already = new Set(progress.achievements ?? []);

  const gained: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (achievement.id === A_TALENTS_ALL || already.has(achievement.id)) continue;
    // 内容里有、这里还没写条件的成就一律不授予（清单与条件表一致由测试保证），不让一局因此算不出结果。
    const condition = CONDITIONS[achievement.id];
    if (condition?.(facts)) gained.push(achievement.id);
  }

  // 天赋解锁：还没解锁的锁定天赋按池内顺序；概率 = min(100, 20 + 20 × 本局新成就数)%。
  const unlockedBefore = new Set(progress.unlockedTalents ?? []);
  const lockedPool = talentPool().filter((talent) => talent.locked === true);
  const stillLocked = lockedPool.filter((talent) => !unlockedBefore.has(talent.id));
  const chance = unlockChancePercent(gained.length);
  let unlockedTalent: string | null = null;
  if (stillLocked.length > 0 && draw01(run.seed, "unlock:roll") < chance / 100) {
    unlockedTalent = stillLocked[pickIndex(run.seed, "unlock:pick", stillLocked.length)].id;
  }

  // 天赋全开：计入本局的解锁结果后，锁定天赋全部解锁（它不反过来影响解锁概率）。
  const hasTalentsAll = ACHIEVEMENTS.some((achievement) => achievement.id === A_TALENTS_ALL);
  const allUnlocked = lockedPool.length > 0 && lockedPool.every((talent) => unlockedBefore.has(talent.id) || talent.id === unlockedTalent);
  if (hasTalentsAll && !already.has(A_TALENTS_ALL) && allUnlocked) gained.push(A_TALENTS_ALL);

  // 按成就清单顺序给出。
  const order = new Map(ACHIEVEMENTS.map((achievement, index) => [achievement.id, index]));
  gained.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { achievements: gained, unlockedTalent };
}

/** 解锁概率（百分比），给界面与测试用。 */
export function unlockChancePercent(newAchievements: number): number {
  return Math.min(100, UNLOCK_BASE_PERCENT + UNLOCK_PERCENT_PER_ACHIEVEMENT * newAchievements);
}
