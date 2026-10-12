// 内容一致性：src/content 下的生成文件必须与 docs 里的原文逐字同步，且结局卡数据结构完整。
// docs 改了却没重跑 `npm run content:extract`，或有人手改了生成文件，这里都会失败。

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContent } from "../scripts/extract-content.ts";
import {
  ACHIEVEMENTS, ALL_EVENTS, CORE_VARIANTS, EARLY_ENDINGS, ENDING_CARDS, ENDING_FLAVORS, EVENT_BY_ID, HAPPENINGS,
  ORIGINAL_EVENTS, PLANS, RANDOM_EVENTS, TALENTS, TEXTS,
} from "../src/content";
import type { EndingCondition } from "../src/engine/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("从 docs 提取的内容", () => {
  it("生成文件与当前文档逐字一致", () => {
    const { files } = buildContent(root);
    for (const [relative, expected] of Object.entries(files)) {
      expect(readFileSync(join(root, relative), "utf8"), relative).toBe(expected);
    }
  });

  it("第一版的 32 个事件、64 个唯一标记，按类型数量正确", () => {
    expect(ORIGINAL_EVENTS).toHaveLength(32);
    const kinds = ORIGINAL_EVENTS.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ highschool: 2, core: 8, arc: 18, masters: 4 });
    const flags = ORIGINAL_EVENTS.flatMap((e) => e.choices.flatMap((c) => c.setFlags));
    expect(new Set(flags).size).toBe(64);
  });

  it("全部事件的 id 与标记互不重复", () => {
    expect(Object.keys(EVENT_BY_ID)).toHaveLength(ALL_EVENTS.length);
    const flags = ALL_EVENTS.flatMap((e) => e.choices.flatMap((c) => c.setFlags));
    expect(new Set(flags).size).toBe(ALL_EVENTS.length * 2);
  });

  it("入学旁白只使用允许的模板变量", () => {
    const allowed = new Set(["{{school.name}}", "{{school.city}}", "{{player.name}}"]);
    const found = JSON.stringify(TEXTS).match(/\{\{[^}]*\}\}/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const variable of found) expect(allowed.has(variable), variable).toBe(true);
  });
});

describe("第二版内容（docs/16–21）", () => {
  it("每个本科节点至少有两张变体，随机事件与突发小事足够一局不重复", () => {
    for (let stage = 1; stage <= 8; stage++) {
      expect(CORE_VARIANTS.filter((e) => e.kind === "core" && e.stage === stage).length, `节点 ${stage}`).toBeGreaterThanOrEqual(2);
    }
    // 一局最多 6 个学期可能出随机事件；本科 8 学期 + 硕士 4 学期最多 12 条突发小事。
    expect(RANDOM_EVENTS.length).toBeGreaterThanOrEqual(6);
    for (const stage of ["UG", "MS"] as const) {
      const usable = HAPPENINGS.filter((h) => h.scope === "ANY" || h.scope === stage).length;
      expect(usable, stage).toBeGreaterThanOrEqual(stage === "UG" ? 8 : 4);
    }
  });

  it("天赋池足够十连抽，四种稀有度都有，六张固定天赋在池里", () => {
    expect(TALENTS.filter((t) => !t.locked).length).toBeGreaterThanOrEqual(20);
    expect(TALENTS.filter((t) => t.locked).length).toBeGreaterThanOrEqual(5);
    expect(new Set(TALENTS.map((t) => t.rarity))).toEqual(new Set(["N", "R", "SR", "SSR"]));
    for (const id of ["T_FOCUSED", "T_PRACTICAL", "T_OUTGOING", "T_FRUGAL", "T_RESILIENT", "T_REFLECTIVE"]) {
      expect(TALENTS.some((t) => t.id === id), id).toBe(true);
    }
  });

  it("学期安排：每个类别一张基础安排、至少两张可选，且只有校园与休息类会花钱", () => {
    for (const focus of ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"] as const) {
      const group = PLANS.filter((p) => p.focus === focus);
      expect(group.filter((p) => p.base).map((p) => p.id), focus).toEqual([focus]);
      expect(group.length, focus).toBeGreaterThanOrEqual(2);
    }
    for (const plan of PLANS.filter((p) => p.delta.money < 0)) expect(["CAMPUS", "REST"]).toContain(plan.focus);
  });

  it("突发小事按属性求和大致平衡", () => {
    for (const key of ["money", "academics", "career", "wellbeing"] as const) {
      const total = HAPPENINGS.reduce((sum, h) => sum + h.effects[key], 0);
      expect(Math.abs(total), key).toBeLessThanOrEqual(6);
    }
  });
});

describe("结局卡数据（docs/14）", () => {
  it("十档主线等级按固定顺序排列且字段齐全", () => {
    expect(ENDING_CARDS.tiers.map((t) => t.id)).toEqual(["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"]);
    for (const tier of ENDING_CARDS.tiers) {
      for (const field of [tier.label, tier.kind, tier.name, tier.roast, tier.condition]) expect(field.length).toBeGreaterThan(0);
    }
    expect(ENDING_CARDS.tiers.find((t) => t.id === "SR_PLUS")?.phdVariant?.name).toBeTruthy();
  });

  it("十二个隐藏结局按 H01–H12 排列且字段齐全", () => {
    expect(ENDING_CARDS.hidden.map((h) => h.id)).toEqual(Array.from({ length: 12 }, (_, i) => `H${String(i + 1).padStart(2, "0")}`));
    for (const hidden of ENDING_CARDS.hidden) {
      for (const field of [hidden.name, hidden.roast, hidden.condition, hidden.hint]) expect(field.length).toBeGreaterThan(0);
    }
  });

  it("卡面文案不出现原设计禁止的断言", () => {
    const text = JSON.stringify(ENDING_CARDS);
    for (const banned of ["教授", "绿卡", "永久身份", "博士学位", "工作许可"]) expect(text.includes(banned), banned).toBe(false);
    expect(Object.keys(ENDING_CARDS.status).sort()).toEqual(["HE", "OPEN", "TBC", "TE"]);
    expect(ENDING_CARDS.disclaimer).toContain("不是按人的价值排名");
  });
});

// ---------- 第三版：中途结局、去向结局、成就（docs/22、docs/23） ----------

const TIER_IDS = ["EX", "UR", "SSR", "SR_PLUS", "SR", "R_PLUS", "R", "N", "D", "BE"];
const STATS = ["money", "academics", "career", "wellbeing"];
const FOCUSES = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
const POINT_KEYS = ["family", "academics", "career", "wellbeing"];
const WHEN_KEYS = [
  "stage", "termMin", "termMax", "statMin", "statMax", "countMin", "countMax", "pointsMin", "pointsMax", "flagsAll",
  "talentsAny", "shortfallStreak", "zeroWellbeingStreak", "schoolStates", "schoolTiers", "aspirations", "transitionMode", "tiers",
];
const chars = (text: string) => [...text].length;

function checkWhen(when: EndingCondition, what: string, allowed: string[]) {
  const flags = new Set(ALL_EVENTS.flatMap((e) => e.choices.flatMap((c) => c.setFlags)));
  const talentIds = new Set(TALENTS.map((t) => t.id));
  for (const key of Object.keys(when)) expect(allowed, `${what}.when.${key}`).toContain(key);
  const range = (map: Record<string, number> | undefined, keys: string[], min: number, max: number, label: string) => {
    for (const [key, value] of Object.entries(map ?? {})) {
      expect(keys, `${what}.${label}.${key}`).toContain(key);
      expect(Number.isInteger(value) && value >= min && value <= max, `${what}.${label}.${key}=${value}`).toBe(true);
    }
  };
  range(when.statMin, STATS, 0, 100, "statMin");
  range(when.statMax, STATS, 0, 100, "statMax");
  range(when.countMin, FOCUSES, 0, 12, "countMin");
  range(when.countMax, FOCUSES, 0, 12, "countMax");
  range(when.pointsMin, POINT_KEYS, 0, 10, "pointsMin");
  range(when.pointsMax, POINT_KEYS, 0, 10, "pointsMax");
  for (const flag of when.flagsAll ?? []) expect(flags.has(flag), `${what} 的标记 ${flag}`).toBe(true);
  for (const id of when.talentsAny ?? []) expect(talentIds.has(id), `${what} 的天赋 ${id}`).toBe(true);
  for (const state of when.schoolStates ?? []) expect(state, `${what} 的州 ${state}`).toMatch(/^[A-Z]{2}$/);
  for (const tier of when.tiers ?? []) expect(TIER_IDS, `${what} 的等级 ${tier}`).toContain(tier);
  if (when.termMin !== undefined && when.termMax !== undefined) expect(when.termMin).toBeLessThanOrEqual(when.termMax);
}

describe("中途结局（docs/22 §4）", () => {
  it("id 唯一，字段齐全，长度在约定内，条件只用允许的键", () => {
    expect(new Set(EARLY_ENDINGS.map((e) => e.id)).size).toBe(EARLY_ENDINGS.length);
    const allowed = WHEN_KEYS.filter((key) => key !== "transitionMode" && key !== "tiers");
    for (const ending of EARLY_ENDINGS) {
      expect(ending.id).toMatch(/^E_[A-Z0-9_]+$/);
      expect(TIER_IDS, ending.id).toContain(ending.tier);
      expect(["HE", "TBC", "OPEN", "TE"], ending.id).toContain(ending.status);
      expect(chars(ending.name), `${ending.id}.name`).toBeGreaterThan(0);
      expect(chars(ending.name), `${ending.id}.name`).toBeLessThanOrEqual(8);
      expect(chars(ending.roast), `${ending.id}.roast`).toBeLessThanOrEqual(32);
      expect(chars(ending.title), `${ending.id}.title`).toBeLessThanOrEqual(12);
      expect(chars(ending.text), `${ending.id}.text`).toBeLessThanOrEqual(90);
      expect(chars(ending.epilogue), `${ending.id}.epilogue`).toBeLessThanOrEqual(80);
      for (const field of [ending.roast, ending.title, ending.text, ending.epilogue, ending.condition, ending.hint]) {
        expect(field.length, ending.id).toBeGreaterThan(0);
      }
      expect(Number.isInteger(ending.chancePermille) && ending.chancePermille >= 1 && ending.chancePermille <= 1000, ending.id).toBe(true);
      checkWhen(ending.when, ending.id, allowed);
    }
  });

  it("最初的七个中途结局都还在", () => {
    for (const id of ["E_LOTTERY", "E_BROKE", "E_BURNOUT", "E_PROBATION", "E_HEIR", "E_STARTUP", "E_INFLUENCER"]) {
      expect(EARLY_ENDINGS.some((e) => e.id === id), id).toBe(true);
    }
  });
});

describe("去向结局（docs/22 §5.2）", () => {
  it("id 唯一，字段齐全，每个去向恰好一条无条件的兜底", () => {
    expect(new Set(ENDING_FLAVORS.map((f) => f.id)).size).toBe(ENDING_FLAVORS.length);
    for (const flavor of ENDING_FLAVORS) {
      expect(flavor.id).toMatch(/^F_[A-Z0-9_]+$/);
      expect(["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"], flavor.id).toContain(flavor.route);
      expect(chars(flavor.name), `${flavor.id}.name`).toBeGreaterThan(0);
      expect(chars(flavor.name), `${flavor.id}.name`).toBeLessThanOrEqual(8);
      expect(chars(flavor.roast), `${flavor.id}.roast`).toBeLessThanOrEqual(32);
      expect(chars(flavor.text), `${flavor.id}.text`).toBeLessThanOrEqual(80);
      for (const field of [flavor.roast, flavor.text, flavor.hint]) expect(field.length, flavor.id).toBeGreaterThan(0);
      expect(Number.isInteger(flavor.weight) && flavor.weight >= 1 && flavor.weight <= 10, flavor.id).toBe(true);
      checkWhen(flavor.when, flavor.id, WHEN_KEYS.filter((key) => !["termMin", "termMax", "shortfallStreak", "zeroWellbeingStreak"].includes(key)));
    }
    for (const route of ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"]) {
      const fallbacks = ENDING_FLAVORS.filter((f) => f.route === route && f.fallback);
      expect(fallbacks, route).toHaveLength(1);
      expect(Object.keys(fallbacks[0].when), route).toHaveLength(0);
    }
    for (const flavor of ENDING_FLAVORS.filter((f) => !f.fallback)) {
      expect(Object.keys(flavor.when).length, `${flavor.id} 需要至少一个条件`).toBeGreaterThan(0);
    }
  });
});

describe("成就清单（docs/23）", () => {
  it("id 唯一，字段齐全，档次合法", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.id).toMatch(/^A_[A-Z0-9_]+$/);
      expect(["N", "R", "SR", "SSR"], achievement.id).toContain(achievement.grade);
      expect(achievement.name.length, achievement.id).toBeGreaterThan(0);
      expect(achievement.text.length, achievement.id).toBeGreaterThan(0);
    }
  });
});

