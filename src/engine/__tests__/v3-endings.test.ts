// 中途结局与去向结局（docs/22 §4、§5.2）：条件求值、按内容里的 when 通用构造用例、与 reducer 的接线、
// 去向结局的抽取。内容随时在加，这里不写死条数与顺序——每条内容都按它自己的 when 构造满足与不满足的情形。

import { describe, expect, it } from "vitest";
import { CATALOG, EARLY_ENDINGS, ENDING_CARDS, ENDING_FLAVORS, TALENTS } from "../../content";
import { conditionFacts, conditionMet, shortfallStreak, zeroWellbeingStreak } from "../conditions";
import type { ConditionContext } from "../conditions";
import { ASPIRATION_ORDER, ENDING_TIER_ORDER, MS_TERM_LABELS, UG_TERM_LABELS } from "../constants";
import { checkEarlyEnding, findEarlyEnding, pickFlavor, termLabel } from "../early";
import { earlyEndingCard } from "../endingCard";
import { endingView, simulate } from "../index";
import type {
  ActiveRun, EarlyEnding, EndingCondition, EndingFlavor, EngineContext, FinalRoute, Focus, HistoryEntry, OfferTier,
  Points, RuntimeSchool, Stats,
} from "../index";
import { draw01 } from "../rng";
import {
  asActive, autoInput, catalog, classicPolicy, ctx, play, simulateObserved, startClassic, termEndContext, tryAct,
} from "./helpers";

const REAL: EngineContext = { catalog: CATALOG };
const STATS = ["money", "academics", "career", "wellbeing"] as const;
const FOCUSES: Focus[] = ["STUDY", "WORK", "CAREER", "CAMPUS", "REST"];
const POINTS = ["family", "academics", "career", "wellbeing"] as const;
const OFFER_TIERS: OfferTier[] = ["S", "A", "B", "C", "D", "U"];
const ROUTES: FinalRoute[] = ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"];
const zero = (): Stats => ({ money: 0, academics: 0, career: 0, wellbeing: 0 });

function entry(kind: HistoryEntry["kind"], term: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    kind, stage: "UG", termIndex: term, revision: term, actionId: `t-${term}`, beforeStats: zero(), requestedDelta: zero(),
    appliedDelta: zero(), afterStats: { money: 10, academics: 10, career: 10, wellbeing: 10 }, ...extra,
  };
}

/** 一段历史：最近 shortfall 个学期期末资金短缺、最近 zeroWellbeing 个学期期末身心为 0；之前的学期一切正常。 */
function historyWith(shortfall: number, zeroWellbeing: number): HistoryEntry[] {
  const terms = Math.max(shortfall, zeroWellbeing) + 1;
  const history: HistoryEntry[] = [];
  for (let term = 1; term <= terms; term++) {
    const short = term > terms - shortfall;
    const empty = term > terms - zeroWellbeing;
    history.push(entry("STIPEND", term), entry("FOCUS", term));
    history.push(entry("UPKEEP", term, { upkeep: { cost: 12, paid: short ? 5 : 12, shortfall: short ? 7 : 0, stress: short ? 4 : 0 } }));
    history.push(entry("GROWTH", term, { afterStats: { money: 10, academics: 10, career: 10, wellbeing: empty ? 0 : 10 } }));
  }
  return history;
}

const school = (state: string, tier: OfferTier): RuntimeSchool => ({ ...catalog.schools[0], state, tier });

/** 按一条 when 构造一个恰好满足它的上下文：写了的取边界值，没写的取不会碍事的中间值。 */
function satisfying(when: EndingCondition): ConditionContext {
  const stats = zero();
  for (const key of STATS) stats[key] = when.statMin?.[key] ?? Math.min(when.statMax?.[key] ?? 50, 50);
  const counts = { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 };
  for (const focus of FOCUSES) counts[focus] = when.countMin?.[focus] ?? 0;
  const points: Points = { family: 5, academics: 5, career: 5, wellbeing: 5 };
  for (const key of POINTS) points[key] = when.pointsMin?.[key] ?? Math.min(when.pointsMax?.[key] ?? 5, 5);
  return {
    stage: when.stage ?? "UG",
    term: when.termMin ?? Math.min(when.termMax ?? 3, 3),
    stats,
    counts,
    points,
    flags: [...(when.flagsAll ?? [])],
    talents: when.talentsAny ? [when.talentsAny[0]] : [],
    history: historyWith(when.shortfallStreak ?? 0, when.zeroWellbeingStreak ?? 0),
    school: school(when.schoolStates?.[0] ?? "ZZ", when.schoolTiers?.[0] ?? "B"),
    aspiration: when.aspirations?.[0] ?? "DISCOVERY",
    transitionMode: when.transitionMode ?? null,
    tier: when.tiers?.[0] ?? "R",
  };
}

/** 对 when 里写了的每一项，各给出一个“只把这一项改到不满足”的上下文。 */
function violations(when: EndingCondition): Array<{ label: string; context: ConditionContext }> {
  const base = satisfying(when);
  const out: Array<{ label: string; context: ConditionContext }> = [];
  const push = (label: string, patch: Partial<ConditionContext>) => out.push({ label, context: { ...base, ...patch } });
  if (when.stage !== undefined) push("stage", { stage: when.stage === "UG" ? "MS" : "UG" });
  if (when.termMin !== undefined) push("termMin", { term: when.termMin - 1 });
  if (when.termMax !== undefined) push("termMax", { term: when.termMax + 1 });
  for (const key of STATS) {
    const min = when.statMin?.[key];
    const max = when.statMax?.[key];
    if (min !== undefined && min > 0) push(`statMin.${key}`, { stats: { ...base.stats, [key]: min - 1 } });
    if (max !== undefined && max < 100) push(`statMax.${key}`, { stats: { ...base.stats, [key]: max + 1 } });
  }
  for (const focus of FOCUSES) {
    const min = when.countMin?.[focus];
    const max = when.countMax?.[focus];
    if (min !== undefined && min > 0) push(`countMin.${focus}`, { counts: { ...base.counts, [focus]: min - 1 } });
    if (max !== undefined) push(`countMax.${focus}`, { counts: { ...base.counts, [focus]: max + 1 } });
  }
  for (const key of POINTS) {
    const min = when.pointsMin?.[key];
    const max = when.pointsMax?.[key];
    if (min !== undefined && min > 0 && base.points) push(`pointsMin.${key}`, { points: { ...base.points, [key]: min - 1 } });
    if (max !== undefined && max < 10 && base.points) push(`pointsMax.${key}`, { points: { ...base.points, [key]: max + 1 } });
    if (min !== undefined || max !== undefined) push(`points.${key}（经典模式没有点数）`, { points: null });
  }
  if (when.flagsAll?.length) push("flagsAll", { flags: when.flagsAll.slice(1) });
  if (when.talentsAny) push("talentsAny", { talents: TALENTS.map((talent) => talent.id).filter((id) => !when.talentsAny?.includes(id)).slice(0, 3) });
  if (when.shortfallStreak) push("shortfallStreak", { history: historyWith(when.shortfallStreak - 1, when.zeroWellbeingStreak ?? 0) });
  if (when.zeroWellbeingStreak) push("zeroWellbeingStreak", { history: historyWith(when.shortfallStreak ?? 0, when.zeroWellbeingStreak - 1) });
  if (when.schoolStates) {
    push("schoolStates", { school: school("XX", base.school?.tier ?? "B") });
    push("schoolStates（还没有学校）", { school: null });
  }
  if (when.schoolTiers) {
    const other = OFFER_TIERS.find((tier) => !when.schoolTiers?.includes(tier));
    if (other) push("schoolTiers", { school: school(base.school?.state ?? "ZZ", other) });
  }
  if (when.aspirations) {
    const other = ASPIRATION_ORDER.find((aspiration) => !when.aspirations?.includes(aspiration));
    if (other) push("aspirations", { aspiration: other });
  }
  if (when.transitionMode !== undefined) {
    push("transitionMode", { transitionMode: when.transitionMode === "NO_OFFER" ? "SELF_CHOSEN" : "NO_OFFER" });
    push("transitionMode（不是过渡期）", { transitionMode: null });
  }
  if (when.tiers) {
    const other = ENDING_TIER_ORDER.find((tier) => !when.tiers?.includes(tier));
    if (other) push("tiers", { tier: other });
    push("tiers（没有等级）", { tier: undefined });
  }
  return out;
}

/** 找一个让 draw01(seed, key) 落在阈值之内（或之外）的 seed。 */
function seedWhere(key: string, test: (roll: number) => boolean): number {
  for (let seed = 1; seed < 200000; seed++) if (test(draw01(seed, key))) return seed;
  throw new Error(`找不到满足条件的 seed：${key}`);
}

describe("条件求值（22 §4 的 when 表）", () => {
  const base = satisfying({});

  it("没写条件就是不限制；出现不认识的键直接报错", () => {
    expect(conditionMet({}, base)).toBe(true);
    expect(() => conditionMet({ statMni: { money: 1 } } as unknown as EndingCondition, base)).toThrow("UNKNOWN_CONDITION_KEY");
  });

  it("每个键的正反用例", () => {
    const cases: Array<[EndingCondition, Partial<ConditionContext>, boolean]> = [
      [{ stage: "UG" }, { stage: "UG" }, true],
      [{ stage: "UG" }, { stage: "MS" }, false],
      [{ termMin: 3, termMax: 5 }, { term: 3 }, true],
      [{ termMin: 3, termMax: 5 }, { term: 5 }, true],
      [{ termMin: 3, termMax: 5 }, { term: 2 }, false],
      [{ termMin: 3, termMax: 5 }, { term: 6 }, false],
      [{ statMin: { money: 30, career: 35 } }, { stats: { money: 30, academics: 0, career: 35, wellbeing: 0 } }, true],
      [{ statMin: { money: 30, career: 35 } }, { stats: { money: 30, academics: 0, career: 34, wellbeing: 0 } }, false],
      [{ statMax: { wellbeing: 10 } }, { stats: { money: 99, academics: 99, career: 99, wellbeing: 10 } }, true],
      [{ statMax: { wellbeing: 10 } }, { stats: { money: 0, academics: 0, career: 0, wellbeing: 11 } }, false],
      [{ statMin: { academics: 40 }, statMax: { academics: 60 } }, { stats: { money: 0, academics: 50, career: 0, wellbeing: 0 } }, true],
      [{ statMin: { academics: 40 }, statMax: { academics: 60 } }, { stats: { money: 0, academics: 61, career: 0, wellbeing: 0 } }, false],
      [{ countMin: { CAMPUS: 3 } }, { counts: { STUDY: 0, WORK: 0, CAREER: 0, CAMPUS: 3, REST: 0 } }, true],
      [{ countMin: { CAMPUS: 3 } }, { counts: { STUDY: 9, WORK: 9, CAREER: 9, CAMPUS: 2, REST: 9 } }, false],
      [{ countMax: { STUDY: 1 } }, { counts: { STUDY: 1, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 } }, true],
      [{ countMax: { STUDY: 1 } }, { counts: { STUDY: 2, WORK: 0, CAREER: 0, CAMPUS: 0, REST: 0 } }, false],
      [{ pointsMin: { family: 9 } }, { points: { family: 9, academics: 0, career: 0, wellbeing: 0 } }, true],
      [{ pointsMin: { family: 9 } }, { points: { family: 8, academics: 10, career: 10, wellbeing: 10 } }, false],
      [{ pointsMax: { wellbeing: 3 } }, { points: { family: 10, academics: 10, career: 10, wellbeing: 3 } }, true],
      [{ pointsMax: { wellbeing: 3 } }, { points: { family: 0, academics: 0, career: 0, wellbeing: 4 } }, false],
      [{ pointsMax: { wellbeing: 3 } }, { points: null }, false],
      [{ pointsMin: { family: 0 } }, { points: null }, false],
      [{ flagsAll: ["F1", "F2"] }, { flags: ["F2", "F0", "F1"] }, true],
      [{ flagsAll: ["F1", "F2"] }, { flags: ["F1"] }, false],
      [{ flagsAll: [] }, { flags: [] }, true],
      [{ talentsAny: ["T1", "T2"] }, { talents: ["T9", "T2"] }, true],
      [{ talentsAny: ["T1", "T2"] }, { talents: ["T9"] }, false],
      [{ talentsAny: [] }, { talents: ["T9"] }, false],
      [{ shortfallStreak: 2 }, { history: historyWith(2, 0) }, true],
      [{ shortfallStreak: 2 }, { history: historyWith(3, 0) }, true],
      [{ shortfallStreak: 2 }, { history: historyWith(1, 0) }, false],
      [{ zeroWellbeingStreak: 2 }, { history: historyWith(0, 2) }, true],
      [{ zeroWellbeingStreak: 2 }, { history: historyWith(5, 1) }, false],
      [{ schoolStates: ["CA", "WA"] }, { school: school("WA", "B") }, true],
      [{ schoolStates: ["CA", "WA"] }, { school: school("NY", "B") }, false],
      [{ schoolStates: ["CA"] }, { school: null }, false],
      [{ schoolTiers: ["S", "A"] }, { school: school("ZZ", "A") }, true],
      [{ schoolTiers: ["S", "A"] }, { school: school("ZZ", "U") }, false],
      [{ schoolTiers: ["S"] }, { school: null }, false],
      [{ aspirations: ["BELONGING"] }, { aspiration: "BELONGING" }, true],
      [{ aspirations: ["BELONGING"] }, { aspiration: "DISCOVERY" }, false],
      [{ transitionMode: "SELF_CHOSEN" }, { transitionMode: "SELF_CHOSEN" }, true],
      [{ transitionMode: "SELF_CHOSEN" }, { transitionMode: "NO_OFFER" }, false],
      [{ transitionMode: "NO_OFFER" }, { transitionMode: null }, false],
      [{ transitionMode: "NO_OFFER" }, { transitionMode: undefined }, false],
      [{ tiers: ["BE", "D"] }, { tier: "D" }, true],
      [{ tiers: ["BE", "D"] }, { tier: "N" }, false],
      [{ tiers: ["BE", "D"] }, { tier: undefined }, false],
    ];
    for (const [when, patch, expected] of cases) {
      expect(conditionMet(when, { ...base, ...patch }), `${JSON.stringify(when)} / ${JSON.stringify(Object.keys(patch))}`).toBe(expected);
    }
    // 写了的每一项都必须满足：两项里只满足一项不算
    const both: EndingCondition = { stage: "UG", statMin: { money: 30 }, countMin: { WORK: 3 } };
    expect(conditionMet(both, satisfying(both))).toBe(true);
    for (const item of violations(both)) expect(conditionMet(both, item.context), item.label).toBe(false);
  });

  it("连续短缺与连续身心为 0：只数最近连着的学期，中间断过就从头算", () => {
    expect(shortfallStreak([])).toBe(0);
    expect(zeroWellbeingStreak([])).toBe(0);
    expect(shortfallStreak(historyWith(3, 1))).toBe(3);
    expect(zeroWellbeingStreak(historyWith(3, 1))).toBe(1);
    // 短缺、正常、短缺 → 只算最后一次
    const broken = [...historyWith(1, 1), ...historyWith(0, 0), ...historyWith(1, 2)];
    expect(shortfallStreak(broken)).toBe(1);
    expect(zeroWellbeingStreak(broken)).toBe(2);
    // 期末之后又记了下一学期的资助、安排，不影响已经数出来的结果
    const next = [...historyWith(2, 2), entry("STIPEND", 9), entry("HAPPENING", 9), entry("FOCUS", 9), entry("EVENT", 9)];
    expect(shortfallStreak(next)).toBe(2);
    expect(zeroWellbeingStreak(next)).toBe(2);
  });

  it("给玩家看的事实只写条件里出现的项，数值用当时的真实值", () => {
    const when: EndingCondition = { statMin: { money: 30 }, statMax: { wellbeing: 35 }, countMin: { CAMPUS: 3 }, pointsMin: { family: 8 }, shortfallStreak: 2 };
    const context = { ...satisfying(when), stats: { money: 47, academics: 66, career: 12, wellbeing: 20 } };
    const facts = conditionFacts(when, context);
    expect(facts).toHaveLength(5);
    expect(facts.join("｜")).toContain("47");
    expect(facts.join("｜")).toContain("20");
    expect(facts.join("｜")).not.toContain("66");
    expect(facts.join("｜")).toContain("连续 2 个学期");
    expect(conditionFacts({}, context)).toEqual([]);
  });
});

describe("学期的叫法", () => {
  it("大一上 … 大四下；硕一上 … 硕二下", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((term) => termLabel("UG", term))).toEqual([...UG_TERM_LABELS]);
    expect([1, 2, 3, 4].map((term) => termLabel("MS", term))).toEqual([...MS_TERM_LABELS]);
    expect(termLabel("UG", 1)).toBe("大一上");
    expect(termLabel("UG", 8)).toBe("大四下");
    expect(termLabel("MS", 3)).toBe("硕二上");
  });
});

describe("中途结局：内容里的每一条（22 §4）", () => {
  it("内容自洽：id 不重复，等级与完结状态在结局卡内容里有对应，概率是 1–1000 的整数，条件只用认识的键", () => {
    expect(EARLY_ENDINGS.length).toBeGreaterThan(0);
    expect(new Set(EARLY_ENDINGS.map((ending) => ending.id)).size).toBe(EARLY_ENDINGS.length);
    for (const ending of EARLY_ENDINGS) {
      expect(ENDING_CARDS.tiers.some((tier) => tier.id === ending.tier), `${ending.id} tier`).toBe(true);
      expect(ENDING_CARDS.status[ending.status], `${ending.id} status`).toBeTruthy();
      expect(Number.isInteger(ending.chancePermille) && ending.chancePermille >= 1 && ending.chancePermille <= 1000, `${ending.id} chancePermille`).toBe(true);
      expect(() => conditionMet(ending.when, satisfying({})), ending.id).not.toThrow();
      for (const text of [ending.name, ending.roast, ending.title, ending.text, ending.epilogue, ending.condition, ending.hint]) {
        expect(typeof text === "string" && text.trim().length > 0, `${ending.id} 文案`).toBe(true);
      }
      expect(findEarlyEnding(ending.id)).toBe(ending);
    }
    expect(findEarlyEnding("E_NOT_AN_ENDING")).toBeUndefined();
    expect(findEarlyEnding(null)).toBeUndefined();
  });

  it("每一条：按它的 when 构造的上下文满足条件；把任何一项改到不满足就不再触发", () => {
    for (const ending of EARLY_ENDINGS) {
      const context = satisfying(ending.when);
      expect(conditionMet(ending.when, context), ending.id).toBe(true);
      for (const item of violations(ending.when)) {
        expect(conditionMet(ending.when, item.context), `${ending.id} ${item.label}`).toBe(false);
        // 条件不满足时，抽签再小也不触发
        const key = `early:${ending.id}:${item.context.stage}:${item.context.term}`;
        expect(checkEarlyEnding(seedWhere(key, (roll) => roll < 0.0005), item.context, [ending]), `${ending.id} ${item.label}`).toBeNull();
      }
    }
  });

  it("每一条：条件满足时按 draw01(seed, early:<id>:<stage>:<term>) < chancePermille/1000 触发；卡片取内容里的等级与状态", () => {
    for (const ending of EARLY_ENDINGS) {
      const context = satisfying(ending.when);
      const key = `early:${ending.id}:${context.stage}:${context.term}`;
      const threshold = ending.chancePermille / 1000;
      const hitSeed = seedWhere(key, (roll) => roll < threshold);
      const hit = checkEarlyEnding(hitSeed, context, [ending]);
      expect(hit?.ending, ending.id).toBe(ending);
      if (!hit) continue;
      if (ending.chancePermille < 1000) {
        const missSeed = seedWhere(key, (roll) => roll >= threshold);
        expect(checkEarlyEnding(missSeed, context, [ending]), `${ending.id} 没抽中`).toBeNull();
        expect(hit.draws).toEqual([{ key, label: ending.name, probabilityPercent: ending.chancePermille / 10, roll: draw01(hitSeed, key), success: true }]);
      } else {
        // 必然触发的：任何 seed 都触发，也不列抽签
        for (let seed = 1; seed <= 50; seed++) expect(checkEarlyEnding(seed, context, [ending])?.ending).toBe(ending);
        expect(hit.draws).toEqual([]);
      }
      // 学期不同，抽签的 key 也不同
      expect(key).toContain(`${context.stage}:${context.term}`);
      expect(hit.facts[0]).toBe(`${termLabel(context.stage, context.term)}期末`);
      for (const fact of hit.facts) expect(fact).not.toMatch(/undefined|null|NaN/);

      const card = earlyEndingCard(hit);
      const tier = ENDING_CARDS.tiers.find((item) => item.id === ending.tier);
      expect(card).toMatchObject({
        early: ending.id, flavor: null, tier: ending.tier, tierLabel: tier?.label, tierKind: tier?.kind, name: ending.name,
        roast: ending.roast, hidden: [], status: ending.status, statusLabel: ENDING_CARDS.status[ending.status],
        combo: `${tier?.label}＋${ENDING_CARDS.status[ending.status]}`,
      });
      expect(card.facts).toEqual(hit.facts);
      expect(card.draws).toEqual(hit.draws);
    }
  });

  it("按数组顺序检查：排在前面的先触发；前面的没抽中才轮到后面的", () => {
    const make = (id: string, chancePermille: number, when: EndingCondition = {}): EarlyEnding => ({ ...EARLY_ENDINGS[0], id, when, chancePermille });
    const context = satisfying({});
    const first = make("E_TEST_FIRST", 500);
    const second = make("E_TEST_SECOND", 1000);
    const key = `early:E_TEST_FIRST:${context.stage}:${context.term}`;
    const hit = seedWhere(key, (roll) => roll < 0.5);
    const miss = seedWhere(key, (roll) => roll >= 0.5);
    expect(checkEarlyEnding(hit, context, [first, second])?.ending.id).toBe("E_TEST_FIRST");
    expect(checkEarlyEnding(miss, context, [first, second])?.ending.id).toBe("E_TEST_SECOND");
    expect(checkEarlyEnding(hit, context, [second, first])?.ending.id).toBe("E_TEST_SECOND");
    // 条件不满足的直接跳过，不占用顺序
    const blocked = make("E_TEST_BLOCKED", 1000, { stage: "MS" });
    expect(checkEarlyEnding(hit, context, [blocked, second])?.ending.id).toBe("E_TEST_SECOND");
    expect(checkEarlyEnding(hit, context, [blocked])).toBeNull();
    expect(checkEarlyEnding(hit, context, [])).toBeNull();
    // 每条用自己的 key、每个学期各抽一次：频率与 chancePermille 相符
    const rare = make("E_TEST_RARE", 100);
    let hits = 0;
    for (let seed = 1; seed <= 20000; seed++) if (checkEarlyEnding(seed, context, [rare])) hits += 1;
    expect(Math.abs(hits / 20000 - 0.1)).toBeLessThan(0.01);
    const perTerm = new Set<number>();
    for (let term = 1; term <= 8; term++) perTerm.add(draw01(1, `early:E_TEST_RARE:UG:${term}`));
    expect(perTerm.size).toBe(8);
  });
});

describe("中途结局与 reducer 的接线", () => {
  it("每个学期期末：引擎判出的结果与按期末状态独立重算的一致；结束的局停在那个学期", () => {
    const seen = new Set<string>();
    let early = 0;
    let termEnds = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const { setup, input } = autoInput(seed);
      const { state } = simulateObserved(setup, input, ctx, (before, _action, after) => {
        const context = termEndContext(before, after);
        if (!context) return;
        termEnds += 1;
        const expected = checkEarlyEnding(seed, context);
        const actual = after.phase === "ENDING" && after.ending?.kind === "EARLY" ? after.ending.early : null;
        expect(actual, `seed ${seed} ${context.stage}:${context.term}`).toBe(expected?.ending.id ?? null);
        if (!expected) return;
        // 结局记录与卡片
        expect(after.ending).toEqual({
          kind: "EARLY", route: null, early: expected.ending.id, degree: context.stage, transitionMode: null, entryMode: null,
          card: earlyEndingCard(expected),
        });
        expect(after.ending?.card.flavor).toBeNull();
        expect(after.ending?.card.hidden).toEqual([]);
        // 停在这个学期：没有发下一学期的资助，也没有这一学段的毕业快照
        const last = after.history[after.history.length - 1];
        expect(last).toMatchObject({ kind: "GROWTH", stage: context.stage, termIndex: context.term });
        expect(after.stats).toEqual(context.stats);
        expect(after).toMatchObject({ phase: "ENDING", stage: context.stage, termIndex: context.term });
        expect(after.graduations[context.stage]).toBeNull();
      });
      const end = asActive(state);
      if (end.ending?.kind !== "EARLY") continue;
      early += 1;
      seen.add(end.ending.early ?? "?");
      expect(endingView(end)).toBeNull();
      // 结局之后任何操作都不再被接受
      for (const action of [{ type: "CHOOSE_PLAN", planId: "REST" }, { type: "REVEAL_GRADUATION" }, { type: "CHOOSE_ROUTE", route: "TRANSITION" }] as const) {
        const result = tryAct(end, action);
        expect(result.ok ? "OK" : result.error.code).toBe("WRONG_PHASE");
      }
    }
    expect(termEnds).toBeGreaterThan(2500);
    expect(early).toBeGreaterThan(50);
    expect(seen.size).toBeGreaterThan(1);
    for (const id of seen) expect(findEarlyEnding(id), id).toBeDefined();
    const unseen = EARLY_ENDINGS.filter((ending) => !seen.has(ending.id)).map((ending) => ending.id);
    if (unseen.length > 0) console.log(`这 500 局里没出现的中途结局（只是提示，频率见 simulation.test）：${unseen.join("、")}`);
  });

  it("经典模式没有中途结局", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const focus = FOCUSES[seed % FOCUSES.length];
      const end = asActive(play(startClassic(seed, (["LOW", "MID", "HIGH"] as const)[seed % 3]), classicPolicy({ focus, event: seed % 2 === 0 ? "A" : "B" })).state);
      expect(end.ending?.kind, `seed ${seed}`).toBe("GRADUATION");
      expect(end.ending?.early).toBeNull();
      expect(end.ending?.card.early).toBeNull();
    }
  });
});

// ---------- 去向结局 ----------

/** docs/22 §5.2 的伪代码原样写。 */
function referenceFlavor(seed: number, route: FinalRoute, context: ConditionContext, flavors: readonly EndingFlavor[] = ENDING_FLAVORS): string | null {
  const candidates = flavors.filter((flavor) => flavor.route === route && conditionMet(flavor.when, context));
  if (candidates.length === 0) return null;
  const r = draw01(seed, `flavor:${route}`) * candidates.reduce((sum, flavor) => sum + flavor.weight, 0);
  let cumulative = 0;
  for (const flavor of candidates) {
    cumulative += flavor.weight;
    if (cumulative > r) return flavor.id;
  }
  return candidates[candidates.length - 1].id;
}

/** 从结局状态重建去向结局用的上下文：属性、次数、标记都取最终检查点的冻结快照。 */
function flavorContext(run: ActiveRun): ConditionContext {
  const ending = run.ending;
  const checkpoint = ending ? run.graduations[ending.degree] : null;
  if (!ending || !checkpoint) throw new Error("不是毕业结局");
  return {
    stage: ending.degree,
    term: run.termIndex,
    stats: checkpoint.frozenStats,
    counts: checkpoint.frozenFocusCounts,
    points: run.profile.points,
    flags: checkpoint.frozenFlags,
    talents: run.profile.talents,
    history: run.history,
    school: run.school,
    aspiration: run.profile.aspiration,
    transitionMode: ending.transitionMode,
    tier: ending.card.tier,
  };
}

describe("去向结局（22 §5.2）", () => {
  it("内容自洽：id 不重复，权重为正，条件只用认识的键；每个去向都有一条没有条件的兜底", () => {
    expect(new Set(ENDING_FLAVORS.map((flavor) => flavor.id)).size).toBe(ENDING_FLAVORS.length);
    for (const flavor of ENDING_FLAVORS) {
      expect(ROUTES, flavor.id).toContain(flavor.route);
      expect(flavor.weight, flavor.id).toBeGreaterThan(0);
      expect(() => conditionMet(flavor.when, satisfying({})), flavor.id).not.toThrow();
      if (flavor.fallback) expect(Object.keys(flavor.when), flavor.id).toEqual([]);
      for (const text of [flavor.name, flavor.roast, flavor.text]) expect(typeof text === "string" && text.trim().length > 0, flavor.id).toBe(true);
    }
    for (const route of ROUTES) {
      const unconditional = ENDING_FLAVORS.filter((flavor) => flavor.route === route && Object.keys(flavor.when).length === 0);
      expect(unconditional.length, route).toBeGreaterThanOrEqual(1);
      // 所以不论什么情形都至少有一条候选
      expect(pickFlavor(1, route, { ...satisfying({}), points: null, school: null, tier: undefined })).not.toBeNull();
    }
  });

  it("每一条：按它的 when 构造的上下文满足条件，且确实抽得到；改掉任何一项就不再是候选", () => {
    for (const flavor of ENDING_FLAVORS) {
      const context = satisfying(flavor.when);
      expect(conditionMet(flavor.when, context), flavor.id).toBe(true);
      expect(pickFlavor(1, flavor.route, context, [flavor])).toBe(flavor);
      let found = false;
      for (let seed = 1; seed <= 3000 && !found; seed++) found = pickFlavor(seed, flavor.route, context)?.id === flavor.id;
      expect(found, `${flavor.id} 在全部内容里也抽得到`).toBe(true);
      for (const item of violations(flavor.when)) {
        expect(conditionMet(flavor.when, item.context), `${flavor.id} ${item.label}`).toBe(false);
        expect(pickFlavor(1, flavor.route, item.context, [flavor]), `${flavor.id} ${item.label}`).toBeNull();
      }
      // 别的去向不会抽到它
      for (const route of ROUTES.filter((item) => item !== flavor.route)) expect(pickFlavor(1, route, context, [flavor])).toBeNull();
    }
  });

  it("按权重抽：数组顺序累计，取第一条累计值严格大于 r 的", () => {
    const make = (id: string, weight: number, when: EndingCondition = {}): EndingFlavor => ({ ...ENDING_FLAVORS[0], id, route: "PHD", weight, when });
    const list = [make("F_TEST_ONE", 1), make("F_TEST_THREE", 3), make("F_TEST_MS", 4, { stage: "MS" })];
    const context = satisfying({});
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 20000; seed++) {
      const picked = pickFlavor(seed, "PHD", context, list);
      if (!picked) throw new Error("应当有候选");
      counts[picked.id] = (counts[picked.id] ?? 0) + 1;
      // 候选只有前两条（第三条要求硕士）：r = u × 4，r < 1 取第一条
      expect(picked.id).toBe(draw01(seed, "flavor:PHD") * 4 < 1 ? "F_TEST_ONE" : "F_TEST_THREE");
      expect(picked.id).toBe(referenceFlavor(seed, "PHD", context, list));
    }
    expect(counts.F_TEST_MS).toBeUndefined();
    expect(Math.abs(counts.F_TEST_ONE / 20000 - 0.25)).toBeLessThan(0.012);
    // 条件满足后第三条才进入候选
    const ms = { ...context, stage: "MS" as const };
    let third = 0;
    for (let seed = 1; seed <= 20000; seed++) if (pickFlavor(seed, "PHD", ms, list)?.id === "F_TEST_MS") third += 1;
    expect(Math.abs(third / 20000 - 0.5)).toBeLessThan(0.012);
    expect(pickFlavor(1, "PHD", context, [])).toBeNull();
    expect(pickFlavor(1, "HOME_JOB", context, list)).toBeNull();
  });

  it("整局里：毕业结局的去向结局与参考实现一致（真实学校目录）；它不改变等级、隐藏标签和任何数值", () => {
    const seen = new Set<string>();
    const routes = new Set<string>();
    let graduated = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      const { setup, input } = autoInput(seed, REAL);
      let beforeRoute: ActiveRun | null = null;
      const { state } = simulateObserved(setup, input, REAL, (before, action) => {
        if (action.type === "CHOOSE_ROUTE" && before.phase !== "SETUP") beforeRoute = before;
      });
      const run = asActive(state);
      const ending = run.ending;
      if (!ending || ending.kind !== "GRADUATION") {
        expect(ending?.card.flavor ?? null, `seed ${seed}`).toBeNull();
        continue;
      }
      graduated += 1;
      if (!ending.route) throw new Error("毕业结局应当有去向");
      routes.add(ending.route);
      const expected = referenceFlavor(seed, ending.route, flavorContext(run));
      const content = ENDING_FLAVORS.find((flavor) => flavor.id === expected);
      expect(ending.card.flavor, `seed ${seed}`).toEqual({ id: content?.id, name: content?.name, roast: content?.roast, text: content?.text });
      expect(content?.route).toBe(ending.route);
      if (expected) seen.add(expected);
      // 选定去向这一步只写结局：四属性、历史、安排次数都不变
      const prior = beforeRoute as ActiveRun | null;
      if (!prior) throw new Error("没有记录到选择去向的那一步");
      expect(run.stats).toEqual(prior.stats);
      expect(run.history).toEqual(prior.history);
      expect(run.focusCounts).toEqual(prior.focusCounts);
    }
    expect(graduated).toBeGreaterThan(400);
    expect([...routes].sort()).toEqual(["HOME_JOB", "LOCAL_JOB", "PHD", "TRANSITION"]);
    // 真实目录里有真实的州：带 schoolStates 条件的去向结局确实出现过
    const stateBased = ENDING_FLAVORS.filter((flavor) => flavor.when.schoolStates).map((flavor) => flavor.id);
    if (stateBased.length > 0) expect(stateBased.some((id) => seen.has(id))).toBe(true);
    const unseen = ENDING_FLAVORS.filter((flavor) => !seen.has(flavor.id)).map((flavor) => flavor.id);
    if (unseen.length > 0) console.log(`这 1200 局里没出现的去向结局（只是提示，频率见 simulation.test）：${unseen.join("、")}`);
  });

  it("去向结局不参与别的判定：把内容临时换成只剩兜底的几条，整局除了 flavor 之外一字不差", () => {
    const seeds = Array.from({ length: 200 }, (_, i) => 3000 + i);
    const run = (seed: number): ActiveRun => {
      const { setup, input } = autoInput(seed, REAL);
      return asActive(simulate(setup, input, REAL).state);
    };
    const originals = seeds.map(run);
    const saved = ENDING_FLAVORS.splice(0, ENDING_FLAVORS.length);
    let changed = 0;
    try {
      ENDING_FLAVORS.push(...saved.filter((flavor) => Object.keys(flavor.when).length === 0));
      seeds.forEach((seed, index) => {
        const original = originals[index];
        const plain = run(seed);
        const strip = (state: ActiveRun) => (state.ending ? { ...state, ending: { ...state.ending, card: { ...state.ending.card, flavor: null } } } : state);
        expect(strip(plain), `seed ${seed}`).toEqual(strip(original));
        if (original.ending?.kind !== "GRADUATION") return;
        expect(Object.keys(saved.find((flavor) => flavor.id === plain.ending?.card.flavor?.id)?.when ?? { x: 1 })).toEqual([]);
        if (plain.ending?.card.flavor?.id !== original.ending.card.flavor?.id) changed += 1;
      });
    } finally {
      ENDING_FLAVORS.splice(0, ENDING_FLAVORS.length, ...saved);
    }
    expect(ENDING_FLAVORS).toHaveLength(saved.length);
    expect(changed).toBeGreaterThan(20); // 确实有不少局原本抽到的不是兜底
  });
});
