// 内容一致性：src/content 下的生成文件必须与 docs 里的原文逐字同步，且结局卡数据结构完整。
// docs 改了却没重跑 `npm run content:extract`，或有人手改了生成文件，这里都会失败。

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContent } from "../scripts/extract-content.ts";
import {
  ALL_EVENTS, CORE_VARIANTS, ENDING_CARDS, EVENT_BY_ID, HAPPENINGS, ORIGINAL_EVENTS, PLANS, RANDOM_EVENTS, TALENTS, TEXTS,
} from "../src/content";

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
    expect(TALENTS.length).toBeGreaterThanOrEqual(20);
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
