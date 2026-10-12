// 内容一致性：src/content 下的生成文件必须与 docs 里的原文逐字同步，且结局卡数据结构完整。
// docs 改了却没重跑 `npm run content:extract`，或有人手改了生成文件，这里都会失败。

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildContent } from "../scripts/extract-content.ts";
import { ALL_EVENTS, ENDING_CARDS, EVENT_BY_ID, TEXTS } from "../src/content";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("从 docs 提取的内容", () => {
  it("生成文件与当前文档逐字一致", () => {
    const { files } = buildContent(root);
    for (const [relative, expected] of Object.entries(files)) {
      expect(readFileSync(join(root, relative), "utf8"), relative).toBe(expected);
    }
  });

  it("共 32 个事件、64 个唯一标记，按类型数量正确", () => {
    expect(ALL_EVENTS).toHaveLength(32);
    expect(Object.keys(EVENT_BY_ID)).toHaveLength(32);
    const kinds = ALL_EVENTS.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ highschool: 2, core: 8, arc: 18, masters: 4 });
    const flags = ALL_EVENTS.flatMap((e) => e.choices.flatMap((c) => c.setFlags));
    expect(new Set(flags).size).toBe(64);
  });

  it("入学旁白只使用允许的模板变量", () => {
    const allowed = new Set(["{{school.name}}", "{{school.city}}", "{{player.name}}"]);
    const found = JSON.stringify(TEXTS).match(/\{\{[^}]*\}\}/g) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const variable of found) expect(allowed.has(variable), variable).toBe(true);
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
