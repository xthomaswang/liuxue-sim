// 第三版开局（docs/22 §2、§6、§7.2；docs/16 §1.2–1.3）：十连抽（含锁定与继承）、选三张、分配点数，
// 以及天赋效果在整局里的各个作用点。内容池用真实数据，不写死条数。

import { describe, expect, it } from "vitest";
import { LIFE_TRACKS, TALENTS } from "../../content";
import { CLASSIC_TALENT_IDS, TALENT_WEIGHTS, TERM_GROWTH, UPKEEP_DEFAULT } from "../constants";
import { probabilities } from "../graduation";
import {
  admissionPreview, admissionResult, createRun, currentEvent, endingView, focusView, graduationView, setupView,
  startPreview,
} from "../index";
import type { ActiveRun, Points, RunState, Talent, TalentEffects, TalentRarity } from "../index";
import { CLASSIC_TALENT_EFFECTS, findPlan, findTalent } from "../pools";
import { draw01 } from "../rng";
import { arcWeights, pickArc, planVector } from "../rules";
import {
  drawPool, drawTalents, economyFromFamily, normalizeUnlocked, originFor, pointBudget, startStatsFromPoints,
  sumTalentEffects, totalsFor,
} from "../talents";
import { act, asActive, at, catalog, evenPoints, fitPoints, play, start, startClassic, tryAct } from "./helpers";
import type { Policy } from "./helpers";

const poolIndex = (id: string) => TALENTS.findIndex((talent) => talent.id === id);
const LOCKED = TALENTS.filter((talent) => talent.locked).map((talent) => talent.id);
const OPEN = TALENTS.filter((talent) => !talent.locked);
const P = (family: number, academics: number, career: number, wellbeing: number): Points => ({ family, academics, career, wellbeing });
const basic: Policy = {
  plan: (view, state) => view.options[(state.termIndex + state.seed) % view.options.length].plan.id,
  event: (view, state) => ((view.event.id.length + state.seed) % 2 === 0 ? "A" : "B"),
};

describe("天赋池的基本形状", () => {
  it("四种稀有度都有；六张特质天赋不锁定且效果与 03 §2.3 相同；未锁定的足够十连抽", () => {
    expect(new Set(TALENTS.map((talent) => talent.id)).size).toBe(TALENTS.length);
    for (const rarity of ["N", "R", "SR", "SSR"] as TalentRarity[]) {
      expect(TALENTS.some((talent) => talent.rarity === rarity), rarity).toBe(true);
    }
    for (const id of CLASSIC_TALENT_IDS) {
      const talent = TALENTS.find((entry) => entry.id === id);
      expect(talent, id).toBeDefined();
      expect(talent?.locked ?? false).toBe(false);
      expect(talent?.effects).toEqual(CLASSIC_TALENT_EFFECTS[id]);
      expect(findTalent(id)).toBe(talent);
    }
    expect(findTalent("T_NOT_A_TALENT")).toBeUndefined();
    expect(OPEN.length).toBeGreaterThanOrEqual(12);
    expect(LOCKED.length).toBeGreaterThan(0);
  });
});

describe("家庭期待与愿望：抽出来，不能选（16 §1.1、22 §2）", () => {
  it("按各自的 key 抽；经济档不再抽", () => {
    const expectations = ["ACADEMIC", "STABILITY", "AUTONOMY"];
    const aspirations = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
    for (let seed = 0; seed < 1000; seed++) {
      const origin = originFor(seed);
      expect(Object.keys(origin).sort()).toEqual(["aspiration", "expectation"]);
      expect(origin.expectation).toBe(expectations[Math.floor(draw01(seed, "origin:expectation") * 3)]);
      expect(origin.aspiration).toBe(aspirations[Math.floor(draw01(seed, "origin:aspiration") * 3)]);
    }
  });

  it("开局视图：期待与愿望、十张天赋、选 3 张、每项点数上限 10、基础准备度；同 seed 可复现", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const setup = start(seed);
      expect(setup).toMatchObject({ phase: "SETUP", mode: "standard", revision: 0, unlockedTalents: [], inheritedTalent: null });
      expect("classicEconomy" in setup).toBe(false);
      const view = setupView(setup);
      expect(view.origin).toEqual(originFor(seed));
      expect(view).toMatchObject({ pickCount: 3, pointMax: 10, inherited: null });
      expect(view.baseReadiness).toBe(admissionPreview(setup).baseReadiness);
      expect(view.draw).toHaveLength(10);
      expect(setupView(start(seed))).toEqual(view);
      // 经典模式的期待与愿望用同样的 key
      expect(setupView(startClassic(seed, "LOW")).origin).toEqual(view.origin);
    }
  });

  it("createRun：classic 必须给经济档，standard 不能给；mode 缺省为 standard", () => {
    expect(createRun({ seed: 1, runId: "a", catalog }).mode).toBe("standard");
    expect(() => createRun({ seed: 1, runId: "a", catalog, mode: "classic" })).toThrow("INVALID_MODE");
    expect(() => createRun({ seed: 1, runId: "a", catalog, classicEconomy: "LOW" })).toThrow("INVALID_MODE");
    expect(() => createRun({ seed: 1, runId: "a", catalog, mode: "easy" as never })).toThrow("INVALID_MODE");
    expect(createRun({ seed: 1, runId: "a", catalog, mode: "classic", classicEconomy: "HIGH" })).toMatchObject({ mode: "classic", classicEconomy: "HIGH" });
  });
});

/** docs/16 §1.2 的伪代码加上 docs/22 §6 的继承规则，原样写成参考实现。 */
function referenceDraw(seed: number, pool: readonly Talent[], inherited: string | null = null, count = 10): string[] {
  const remaining = [...pool];
  const out: string[] = inherited !== null && pool.some((talent) => talent.id === inherited) ? [inherited] : [];
  for (let i = 0; out.length < count && remaining.length > 0; i++) {
    const total = remaining.reduce((sum, talent) => sum + TALENT_WEIGHTS[talent.rarity], 0);
    const r = draw01(seed, `talent:draw:${i}`) * total;
    let cumulative = 0;
    let index = remaining.length - 1;
    for (let k = 0; k < remaining.length; k++) {
      cumulative += TALENT_WEIGHTS[remaining[k].rarity];
      if (cumulative > r) {
        index = k;
        break;
      }
    }
    const [picked] = remaining.splice(index, 1);
    if (picked.id === inherited) continue;
    out.push(picked.id);
  }
  return out;
}

const fake = (id: string, rarity: TalentRarity, effects: TalentEffects = {}, locked = false): Talent => ({ id, name: id, rarity, text: id, effects, ...(locked ? { locked: true } : {}) });

describe("十连抽：按权重的无放回抽样（16 §1.2）", () => {
  it("权重为 100 / 45 / 15 / 4", () => {
    expect(TALENT_WEIGHTS).toEqual({ N: 100, R: 45, SR: 15, SSR: 4 });
  });

  it("合成池：结果与文档伪代码一致，互不相同，可复现，不改入参", () => {
    const pool = [
      fake("A", "N"), fake("B", "SSR"), fake("C", "R"), fake("D", "N"), fake("E", "SR"), fake("F", "N"), fake("G", "R"),
      fake("H", "N"), fake("I", "SR"), fake("J", "N"), fake("K", "R"), fake("L", "SSR"), fake("M", "N"), fake("O", "N"),
    ];
    for (let seed = 0; seed < 500; seed++) {
      const drawn = drawTalents(seed, pool).map((talent) => talent.id);
      expect(drawn).toEqual(referenceDraw(seed, pool));
      expect(drawn).toHaveLength(10);
      expect(new Set(drawn).size).toBe(10);
      expect(drawTalents(seed, pool).map((talent) => talent.id)).toEqual(drawn);
    }
    expect(pool).toHaveLength(14);
  });

  it("合成池：池内顺序决定累计区间；单张池、空池与不足十张的池", () => {
    const two = [fake("N1", "N"), fake("S1", "SSR")];
    for (let seed = 0; seed < 300; seed++) {
      // 第一抽：r = u × 104；r < 100 取 N1，否则取 S1
      expect(drawTalents(seed, two, 1)[0].id).toBe(draw01(seed, "talent:draw:0") * 104 < 100 ? "N1" : "S1");
      expect(drawTalents(seed, two).map((talent) => talent.id).sort()).toEqual(["N1", "S1"]);
    }
    expect(drawTalents(5, [])).toEqual([]);
    expect(drawTalents(5, [fake("ONLY", "SR")]).map((talent) => talent.id)).toEqual(["ONLY"]);
  });

  it("真实天赋池：十张互不相同、都未锁定、与参考实现一致", () => {
    for (let seed = 0; seed < 400; seed++) {
      const ids = setupView(start(seed)).draw.map((talent) => talent.id);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      expect(ids).toEqual(referenceDraw(seed, OPEN));
    }
  });

  it("真实天赋池：第一抽各稀有度的频率与权重大致相符；越稀有越少被抽到", () => {
    const totalWeight = OPEN.reduce((sum, talent) => sum + TALENT_WEIGHTS[talent.rarity], 0);
    const expected = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    for (const talent of OPEN) expected[talent.rarity] += TALENT_WEIGHTS[talent.rarity] / totalWeight;
    const first = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    const inTen = { N: 0, R: 0, SR: 0, SSR: 0 } as Record<TalentRarity, number>;
    const runs = 20000;
    for (let seed = 0; seed < runs; seed++) {
      const drawn = drawTalents(seed, OPEN);
      first[drawn[0].rarity] += 1;
      for (const talent of drawn) inTen[talent.rarity] += 1;
    }
    const rarities = (["N", "R", "SR", "SSR"] as TalentRarity[]).filter((rarity) => OPEN.some((talent) => talent.rarity === rarity));
    for (const rarity of rarities) {
      expect(Math.abs(first[rarity] / runs - expected[rarity]), `第一抽 ${rarity}`).toBeLessThan(0.012);
    }
    const perCard = (rarity: TalentRarity) => inTen[rarity] / runs / OPEN.filter((talent) => talent.rarity === rarity).length;
    for (let i = 1; i < rarities.length; i++) expect(perCard(rarities[i - 1])).toBeGreaterThan(perCard(rarities[i]));
  });
});

describe("锁定的天赋与解锁后的池子（22 §7.2）", () => {
  it("没解锁时锁定的天赋绝不出现在十连抽里", () => {
    for (let seed = 0; seed < 3000; seed++) {
      for (const talent of setupView(start(seed)).draw) expect(talent.locked ?? false, `seed ${seed} ${talent.id}`).toBe(false);
    }
  });

  it("解锁后会出现；池子 = 未锁定的 + 已解锁的，保持池内顺序", () => {
    const some = LOCKED.slice(0, 2);
    expect(drawPool(TALENTS, []).map((talent) => talent.id)).toEqual(OPEN.map((talent) => talent.id));
    const pool = drawPool(TALENTS, some);
    expect(pool.map((talent) => talent.id)).toEqual(TALENTS.filter((talent) => !talent.locked || some.includes(talent.id)).map((talent) => talent.id));
    const seen = new Set<string>();
    for (let seed = 0; seed < 4000; seed++) {
      const ids = setupView(start(seed, undefined, { unlockedTalents: some })).draw.map((talent) => talent.id);
      expect(ids).toEqual(referenceDraw(seed, pool));
      for (const id of ids) {
        if (LOCKED.includes(id)) {
          expect(some).toContain(id); // 只可能是已解锁的那几张
          seen.add(id);
        }
      }
    }
    expect([...seen].sort()).toEqual([...some].sort());
    // 全部解锁后：每一张锁定天赋都抽得到
    const all = new Set<string>();
    for (let seed = 0; seed < 6000; seed++) {
      for (const talent of setupView(start(seed, undefined, { unlockedTalents: LOCKED })).draw) if (talent.locked) all.add(talent.id);
    }
    expect(all.size).toBe(LOCKED.length);
  });

  it("unlockedTalents 存进状态时：只保留确实是锁定天赋的 id、去重、按池内顺序", () => {
    const messy = [LOCKED[1], "T_NOT_A_TALENT", OPEN[0].id, LOCKED[0], LOCKED[1]];
    expect(start(1, undefined, { unlockedTalents: messy }).unlockedTalents).toEqual([LOCKED[0], LOCKED[1]].sort((a, b) => poolIndex(a) - poolIndex(b)));
    expect(normalizeUnlocked(TALENTS, undefined)).toEqual([]);
    expect(normalizeUnlocked(TALENTS, LOCKED)).toEqual(LOCKED);
    expect(start(1, undefined, { unlockedTalents: [...LOCKED].reverse() }).unlockedTalents).toEqual(LOCKED);
  });

  it("经典模式没有十连抽：解锁与继承一律忽略", () => {
    const classic = createRun({ seed: 3, runId: "c", catalog, mode: "classic", classicEconomy: "MID", unlockedTalents: LOCKED, inheritedTalent: OPEN[0].id });
    expect(classic).toMatchObject({ unlockedTalents: [], inheritedTalent: null });
    expect(setupView(classic).draw.map((talent) => talent.id)).toEqual([...CLASSIC_TALENT_IDS]);
    expect(setupView(classic).inherited).toBeNull();
  });
});

describe("继承天赋（22 §6）", () => {
  it("第一张固定是它，其余九张照常抽（跳过与它相同的那张）", () => {
    let skipped = 0;
    for (let seed = 0; seed < 600; seed++) {
      const inherited = OPEN[seed % OPEN.length].id;
      const plain = setupView(start(seed)).draw.map((talent) => talent.id);
      const view = setupView(start(seed, undefined, { inheritedTalent: inherited }));
      const ids = view.draw.map((talent) => talent.id);
      expect(view.inherited).toBe(inherited);
      expect(ids[0]).toBe(inherited);
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10);
      expect(ids).toEqual(referenceDraw(seed, OPEN, inherited));
      // 其余九张就是“不继承时的抽取序列”里去掉它之后的前九张
      if (plain.includes(inherited)) {
        skipped++;
        // 不继承时本来就会抽到它：十张还是同样的十张，只是它被提到了第一张
        expect(ids.slice(1)).toEqual(plain.filter((id) => id !== inherited));
      } else {
        expect(ids.slice(1)).toEqual(plain.slice(0, 9));
      }
    }
    expect(skipped).toBeGreaterThan(50);
  });

  it("继承的天赋不在池里（未解锁或不存在）就当作没有；解锁了的锁定天赋可以继承", () => {
    expect(start(9, undefined, { inheritedTalent: "T_NOT_A_TALENT" }).inheritedTalent).toBeNull();
    expect(start(9, undefined, { inheritedTalent: LOCKED[0] }).inheritedTalent).toBeNull();
    expect(setupView(start(9, undefined, { inheritedTalent: LOCKED[0] })).draw).toEqual(setupView(start(9)).draw);
    const unlocked = start(9, undefined, { unlockedTalents: [LOCKED[0]], inheritedTalent: LOCKED[0] });
    expect(unlocked.inheritedTalent).toBe(LOCKED[0]);
    expect(setupView(unlocked).draw[0].id).toBe(LOCKED[0]);
    // 选中继承来的天赋开局
    const view = setupView(unlocked);
    const talents = view.draw.slice(0, 3).map((talent) => talent.id);
    const budget = startPreview(unlocked, talents, P(0, 0, 0, 0)).pointBudget;
    const run = asActive(act(unlocked, { type: "CONFIRM_SETUP", talents, points: evenPoints(budget) }));
    expect(run.profile.talents).toContain(LOCKED[0]);
    expect(run).toMatchObject({ unlockedTalents: [LOCKED[0]], inheritedTalent: LOCKED[0] });
  });
});

describe("选三张与分配点数（16 §1.2、22 §2）", () => {
  const setup = start(21);
  const view = setupView(setup);
  const ids = view.draw.map((talent) => talent.id);
  // 选三张不带 points 效果的，预算就是 20
  const plain = view.draw.filter((talent) => talent.effects.points === undefined).slice(0, 3).map((talent) => talent.id);
  const outsider = OPEN.find((talent) => !ids.includes(talent.id))?.id ?? "";
  const even = P(5, 5, 5, 5);

  it("天赋：必须恰好三张、互不相同、都来自这十张", () => {
    expect(outsider).not.toBe("");
    expect(plain).toHaveLength(3);
    const bad: unknown[] = [
      [], ids.slice(0, 2), ids.slice(0, 4), [ids[0], ids[0], ids[1]], [ids[0], ids[1], outsider],
      [ids[0], ids[1], "T_NOT_A_TALENT"], [ids[0], ids[1], LOCKED[0]], [ids[0], ids[1], 3], "abc", null,
    ];
    for (const talents of bad) {
      const result = tryAct(setup, { type: "CONFIRM_SETUP", talents: talents as string[], points: even });
      expect(result.ok ? "OK" : result.error.code, JSON.stringify(talents)).toBe("INVALID_ACTION");
      expect(result.state).toBe(setup);
    }
  });

  it("点数：每项 0–10 的整数，总和必须恰好等于可分配的总点数；不带点数也不行", () => {
    const bad: unknown[] = [
      undefined, null, {}, P(5, 5, 5, 4), P(5, 5, 5, 6), P(11, 3, 3, 3), P(-1, 7, 7, 7), P(5.5, 4.5, 5, 5),
      { family: 5, academics: 5, career: 5 }, { ...even, luck: 0 }, { family: "5", academics: 5, career: 5, wellbeing: 5 }, [5, 5, 5, 5],
    ];
    for (const points of bad) {
      const result = tryAct(setup, { type: "CONFIRM_SETUP", talents: plain, points: points as Points });
      expect(result.ok ? "OK" : result.error.code, JSON.stringify(points)).toBe("INVALID_ACTION");
      expect(result.state).toBe(setup);
    }
    for (const points of [even, P(10, 10, 0, 0), P(0, 0, 10, 10), P(2, 10, 4, 4), P(10, 4, 3, 3)]) {
      expect(tryAct(setup, { type: "CONFIRM_SETUP", talents: plain, points }).ok, JSON.stringify(points)).toBe(true);
    }
  });

  it("确认后：天赋按池内顺序存放，点数原样记下，经济档由家境点数推出，确认后不可更换", () => {
    const chosen = [plain[2], plain[0], plain[1]];
    const run = asActive(act(setup, { type: "CONFIRM_SETUP", talents: chosen, points: P(8, 6, 4, 2) }));
    expect(run.profile.talents).toEqual([...chosen].sort((a, b) => poolIndex(a) - poolIndex(b)));
    expect(run.profile).toMatchObject({ ...originFor(21), economy: "HIGH", points: P(8, 6, 4, 2) });
    expect(run).toMatchObject({ phase: "HIGH_SCHOOL_EVENT", stage: "HS", highSchoolNode: 1, mode: "standard", revision: 1 });
    expect(asActive(act(setup, { type: "CONFIRM_SETUP", talents: plain, points: P(8, 6, 4, 2) }))).toEqual(run);
    const again = tryAct(run, { type: "CONFIRM_SETUP", talents: plain, points: even });
    expect(again.ok ? "OK" : again.error.code).toBe("WRONG_PHASE");
  });

  it("经济档：家境 ≤3 为 LOW，4–7 为 MID，≥8 为 HIGH", () => {
    expect([0, 1, 2, 3].map(economyFromFamily)).toEqual(["LOW", "LOW", "LOW", "LOW"]);
    expect([4, 5, 6, 7].map(economyFromFamily)).toEqual(["MID", "MID", "MID", "MID"]);
    expect([8, 9, 10].map(economyFromFamily)).toEqual(["HIGH", "HIGH", "HIGH"]);
  });

  it("开局数值按 22 §2 的表：资金 20+4f、学业 8+2a、职业 2+2c、身心 40+6w；四项各 5 点约等于第一版的中档", () => {
    const none = sumTalentEffects([]);
    expect(startStatsFromPoints(P(5, 5, 5, 5), none)).toEqual({ money: 40, academics: 18, career: 12, wellbeing: 70 });
    expect(startStatsFromPoints(P(0, 0, 0, 0), none)).toEqual({ money: 20, academics: 8, career: 2, wellbeing: 40 });
    expect(startStatsFromPoints(P(10, 10, 10, 10), none)).toEqual({ money: 60, academics: 28, career: 22, wellbeing: 100 });
    // 天赋的 initial 加在上面，再截断
    const boosted = sumTalentEffects([{ effects: { initial: { money: 15, wellbeing: 10 } } }, { effects: { initial: { academics: -15, career: -15 } } }]);
    expect(startStatsFromPoints(P(10, 0, 0, 10), boosted)).toEqual({ money: 75, academics: 0, career: 0, wellbeing: 100 });
  });

  it("整局里：开局四属性、资助与准备度都按点数与天赋算", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const s = start(seed);
      const v = setupView(s);
      const chosen = [v.draw[seed % 10], v.draw[(seed + 3) % 10], v.draw[(seed + 6) % 10]].map((talent) => talent.id);
      const totals = totalsFor(chosen);
      const points = fitPoints(P(seed % 11, (seed * 3) % 11, (seed * 7) % 11, (seed * 5) % 11), pointBudget(totals));
      const run = asActive(act(s, { type: "CONFIRM_SETUP", talents: chosen, points }));
      expect(run.stats).toEqual(startStatsFromPoints(points, totals));
      expect(run.profile.economy).toBe(economyFromFamily(points.family));
      // 开局即确定的准备度加成 = 学业点数 + 天赋的 readiness
      expect(run.admission.talentBonus).toBe(points.academics + totals.readiness);
      expect(admissionPreview(run).readinessSoFar).toBe(Math.min(100, Math.max(0, v.baseReadiness + points.academics + totals.readiness)));
      expect(run.history).toEqual([]);
      const enrolled = asActive(play(run, basic, at("FOCUS")).state);
      const stipend = enrolled.history.find((entry) => entry.kind === "STIPEND");
      expect(stipend?.requestedDelta.money).toBe(Math.max(0, 5 + points.family + totals.stipend));
      const result = admissionResult(enrolled);
      expect(result?.readiness).toBe(Math.min(100, Math.max(0, v.baseReadiness + points.academics + totals.readiness + (result?.readinessBonus ?? 0))));
    }
  });
});

describe("分点预览（22 §2、§8）", () => {
  const setup = start(33);
  const draw = setupView(setup).draw;
  const plain = draw.filter((talent) => talent.effects.points === undefined).slice(0, 3).map((talent) => talent.id);

  it("给出预算、已用点数、是否合法、经济档、开局四属性、资助、开销与准备度", () => {
    const totals = totalsFor(plain);
    const preview = startPreview(setup, plain, P(2, 10, 4, 4));
    expect(preview).toEqual({
      pointBudget: 20,
      pointsUsed: 20,
      valid: true,
      economy: "LOW",
      stats: startStatsFromPoints(P(2, 10, 4, 4), totals),
      stipend: Math.max(0, 5 + 2 + totals.stipend),
      upkeep: Math.max(0, UPKEEP_DEFAULT + totals.upkeep),
      readiness: Math.min(100, Math.max(0, setupView(setup).baseReadiness + 10 + totals.readiness)),
    });
    // 预览与真正开局一致
    const run = asActive(act(setup, { type: "CONFIRM_SETUP", talents: plain, points: P(2, 10, 4, 4) }));
    expect(run.stats).toEqual(preview.stats);
    expect(run.profile.economy).toBe(preview.economy);
    expect(admissionPreview(run).readinessSoFar).toBe(preview.readiness);
  });

  it("边界：全 0 与全 10 都能预览但不合法（总和不等于预算）；没分完也不合法", () => {
    expect(startPreview(setup, plain, P(0, 0, 0, 0))).toMatchObject({ pointsUsed: 0, valid: false, economy: "LOW", stats: startStatsFromPoints(P(0, 0, 0, 0), totalsFor(plain)) });
    expect(startPreview(setup, plain, P(10, 10, 10, 10))).toMatchObject({ pointsUsed: 40, valid: false, economy: "HIGH" });
    expect(startPreview(setup, plain, P(5, 5, 5, 4)).valid).toBe(false);
    expect(startPreview(setup, plain, P(11, 3, 3, 3)).valid).toBe(false);
    expect(startPreview(setup, plain, P(5.5, 4.5, 5, 5)).valid).toBe(false);
    expect(startPreview(setup, plain, P(10, 10, 0, 0)).valid).toBe(true);
  });

  it("带 points 效果的天赋改变可分配的总点数；开局校验用的是同一个预算", () => {
    const withPoints = TALENTS.filter((talent) => talent.effects.points !== undefined);
    expect(withPoints.length).toBeGreaterThan(0);
    for (const talent of withPoints) {
      const unlocked = talent.locked ? [talent.id] : [];
      // 找一个抽到它的 seed
      let found: { state: ReturnType<typeof start>; talents: string[] } | null = null;
      for (let seed = 1; seed < 30000 && !found; seed++) {
        const state = start(seed, undefined, { unlockedTalents: unlocked });
        const ids = setupView(state).draw.map((item) => item.id);
        if (ids.includes(talent.id)) found = { state, talents: [talent.id, ...ids.filter((id) => id !== talent.id && findTalent(id)?.effects.points === undefined).slice(0, 2)] };
      }
      if (!found) throw new Error(`找不到抽到 ${talent.id} 的 seed`);
      const budget = 20 + (talent.effects.points ?? 0);
      expect(startPreview(found.state, found.talents, P(0, 0, 0, 0)).pointBudget).toBe(budget);
      expect(pointBudget(totalsFor(found.talents))).toBe(budget);
      // 按 20 点分配不再合法，按新的预算才合法
      if (budget !== 20) {
        const stale = tryAct(found.state, { type: "CONFIRM_SETUP", talents: found.talents, points: P(5, 5, 5, 5) });
        expect(stale.ok ? "OK" : stale.error.code).toBe("INVALID_ACTION");
      }
      const points = evenPoints(budget);
      expect(startPreview(found.state, found.talents, points)).toMatchObject({ pointsUsed: budget, valid: true });
      const run = asActive(act(found.state, { type: "CONFIRM_SETUP", talents: found.talents, points }));
      expect(run.profile.points).toEqual(points);
    }
    // 预算被限制在 0 到 40 之间
    expect(pointBudget(sumTalentEffects([{ effects: { points: 6 } }, { effects: { points: 6 } }, { effects: { points: 6 } }, { effects: { points: 6 } }]))).toBe(40);
    expect(pointBudget(sumTalentEffects([{ effects: { points: -6 } }, { effects: { points: -6 } }, { effects: { points: -6 } }, { effects: { points: -6 } }]))).toBe(0);
  });

  it("不认识的天赋 id 忽略不计；预览不改状态", () => {
    const before = JSON.stringify(setup);
    expect(startPreview(setup, [...plain, "T_NOT_A_TALENT"], P(5, 5, 5, 5))).toEqual(startPreview(setup, plain, P(5, 5, 5, 5)));
    expect(JSON.stringify(setup)).toBe(before);
  });
});

/** 找一个十连抽里含有指定天赋的 seed（锁定的先解锁），选它加另外两张不改预算的天赋。 */
function runWith(talentId: string): RunState {
  const unlocked = findTalent(talentId)?.locked ? [talentId] : [];
  for (let seed = 1; seed < 30000; seed++) {
    const setup = start(seed, undefined, { unlockedTalents: unlocked });
    const ids = setupView(setup).draw.map((talent) => talent.id);
    if (!ids.includes(talentId)) continue;
    const talents = [talentId, ...ids.filter((id) => id !== talentId).slice(0, 2)];
    const budget = startPreview(setup, talents, P(0, 0, 0, 0)).pointBudget;
    return act(setup, { type: "CONFIRM_SETUP", talents, points: evenPoints(budget) });
  }
  throw new Error(`找不到抽到 ${talentId} 的 seed`);
}

/** 走完整局（或走到中途结局），逐条核对每一次属性变化都按“本局天赋效果的合计”结算。 */
function verifyWholeRun(from: RunState, label: string): ActiveRun {
  const profile = asActive(from).profile;
  const totals = totalsFor(profile.talents);
  const family = profile.points?.family ?? 0;
  let state = from;
  const policy: Policy = {
    ...basic,
    graduate: (_state, routes, masters) => {
      const program = masters.find((option) => option.eligible);
      if (program) return { type: "ENTER_MASTERS", program: program.program };
      const open = routes.find((option) => option.available && option.route !== "TRANSITION");
      return { type: "CHOOSE_ROUTE", route: open ? open.route : "TRANSITION" };
    },
  };
  for (let guard = 0; guard < 200 && state.phase !== "ENDING"; guard++) {
    const before = asActive(state);
    if (before.phase === "FOCUS") {
      const view = focusView(before);
      expect(view?.upkeep, `${label} 必要开销`).toBe(Math.max(0, UPKEEP_DEFAULT + totals.upkeep));
      for (const option of view?.options ?? []) {
        const expected = planVector(option.plan.delta, totals.focus[option.plan.focus], totals.focusWellbeingRelief, before.stats.wellbeing, totals.efficiencyFloor);
        expect(option.requested, `${label} ${option.plan.id} 预览`).toEqual(expected.requested);
        expect(option.talentApplied).toBe(expected.talentApplied);
      }
    }
    if (before.phase === "ARC_EVENT" && (before.termIndex === 2 || before.termIndex === 3)) {
      const slot = before.termIndex === 2 ? "A" : "B";
      const weights = arcWeights({ focusCounts: before.focusCounts, stats: before.stats, economy: before.profile.economy, bonus: totals.arcWeight });
      expect(before.arcs[slot], `${label} 支线 ${slot}`).toBe(pickArc(before.seed, slot, weights, slot === "B" ? before.arcs.A : null));
    }
    state = play(state, policy, (s) => s.revision > before.revision).state;
    const after = asActive(state);
    for (const entry of after.history.slice(before.history.length)) {
      if (entry.kind === "STIPEND") {
        expect(entry.requestedDelta.money, `${label} 资助`).toBe(Math.max(0, 5 + family + totals.stipend));
      } else if (entry.kind === "UPKEEP") {
        expect(entry.upkeep?.cost, `${label} 必要开销`).toBe(Math.max(0, UPKEEP_DEFAULT + totals.upkeep));
      } else if (entry.kind === "GROWTH") {
        for (const key of ["money", "academics", "career", "wellbeing"] as const) {
          expect(entry.requestedDelta[key], `${label} 基础成长 ${key}`).toBe(TERM_GROWTH[key] + totals.growth[key]);
        }
      } else if (entry.kind === "LIFE_BASE") {
        // 毕业后每年的基础变化加上天赋的 lifeGrowth（docs/24 §4.2）
        const base = entry.track ? LIFE_TRACKS[entry.track].base.delta : null;
        if (!base) throw new Error(`${label} 毕业后缺少轨道`);
        for (const key of ["money", "academics", "career", "wellbeing"] as const) {
          expect(entry.requestedDelta[key], `${label} 毕业后基础 ${key}`).toBe(base[key] + totals.lifeGrowth[key]);
        }
      } else if (entry.kind === "FOCUS") {
        const plan = findPlan(entry.planId ?? "");
        if (!plan) throw new Error(`${label} 未知安排 ${String(entry.planId)}`);
        const expected = planVector(plan.delta, totals.focus[plan.focus], totals.focusWellbeingRelief, entry.beforeStats.wellbeing, totals.efficiencyFloor);
        expect(entry.requestedDelta, `${label} 安排 ${plan.id}`).toEqual(expected.requested);
        expect(entry.efficiency).toBe(expected.factor);
        expect(entry.focus).toBe(plan.focus);
      }
    }
    if (after.phase === "GRAD_PREVIEW" && before.phase !== "GRAD_PREVIEW") {
      const degree = after.stage === "MS" ? "MS" : "UG";
      const grad = after.graduations[degree];
      if (!grad) throw new Error("缺少毕业快照");
      expect(grad.probabilities, `${label} ${degree} 概率`).toEqual(
        probabilities({ degree, stats: grad.frozenStats, focusCounts: grad.frozenFocusCounts, flags: grad.frozenFlags, chance: totals.chance }),
      );
      const plain = probabilities({ degree, stats: grad.frozenStats, focusCounts: grad.frozenFocusCounts, flags: grad.frozenFlags });
      for (const item of graduationView(after)?.opportunities ?? []) {
        expect(item.breakdown.find((term) => term.label === "天赋加成")?.hundredths ?? 0).toBe(100 * totals.chance[item.id]);
        expect(item.eligible).toBe(plain[item.id] !== null); // 加成不改变资格
      }
    }
  }
  const end = asActive(state);
  expect(end.phase, label).toBe("ENDING");
  if (end.ending?.kind === "GRADUATION") expect(endingView(end)?.talents.map((talent) => talent.id)).toEqual(end.profile.talents);
  return end;
}

describe("天赋效果在整局里的作用点（16 §1.3、22 §7.2）", () => {
  it("池里每一张天赋（含锁定的）：选中它的一局里，资助、开销、安排、支线、基础成长、毕业概率都按合计结算", () => {
    const seenKeys = new Set<string>();
    for (const talent of TALENTS) {
      const run = runWith(talent.id);
      expect(asActive(run).profile.talents).toContain(talent.id);
      verifyWholeRun(run, talent.id);
      for (const key of Object.keys(talent.effects)) seenKeys.add(key);
    }
    // 真实内容覆盖了文档列出的全部效果键
    expect([...seenKeys].sort()).toEqual(
      ["arcWeight", "chance", "efficiencyFloor", "focus", "focusWellbeingRelief", "gpa", "growth", "initial", "lifeGrowth", "points", "readiness", "stipend", "upkeep"].sort(),
    );
  });

  it("效率下限：选了有下限的天赋后，再累也不低于下限", () => {
    const withFloor = TALENTS.filter((talent) => talent.effects.efficiencyFloor !== undefined);
    expect(withFloor.length).toBeGreaterThan(0);
    for (const talent of withFloor) {
      const focus = asActive(play(runWith(talent.id), basic, at("FOCUS")).state);
      const tired = { ...focus, stats: { ...focus.stats, wellbeing: 0 } };
      const floor = totalsFor(tired.profile.talents).efficiencyFloor;
      expect(floor).toBeGreaterThanOrEqual(talent.effects.efficiencyFloor ?? 0);
      expect(focusView(tired)?.efficiency.factor).toBe(floor);
      const after = asActive(act(tired, { type: "CHOOSE_PLAN", planId: focusView(tired)?.options[0].plan.id ?? "" }));
      expect(after.history[after.history.length - 1].efficiency).toBe(floor);
    }
  });

  it("开销类天赋改变事件预览里的预计结算", () => {
    const pricey = TALENTS.find((talent) => (talent.effects.upkeep ?? 0) > 0);
    const thrifty = TALENTS.find((talent) => (talent.effects.upkeep ?? 0) < 0);
    for (const talent of [pricey, thrifty]) {
      if (!talent) throw new Error("内容池里应当既有加开销也有减开销的天赋");
      const run = runWith(talent.id);
      const cost = Math.max(0, UPKEEP_DEFAULT + totalsFor(asActive(run).profile.talents).upkeep);
      const event = asActive(play(run, basic, at("CORE_EVENT")).state);
      expect(currentEvent(event)?.choices.every((choice) => choice.projected?.upkeep === cost)).toBe(true);
    }
  });
});
