// 存档：序列化、重放校验、损坏与版本不兼容（docs/06 §4、docs/08 D），以及引擎纯度。

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { CONTENT_VERSION, RULES_VERSION } from "../constants";
import { loadSave, replay, serializeSave } from "../index";
import type { Action, EngineContext, RunState, SaveEnvelope } from "../index";
import { invariantProblem, stableStringify } from "../save";
import { act, asActive, ctx, nextAction, start } from "./helpers";
import type { Policy } from "./helpers";

const policy: Policy = {
  economy: "LOW",
  aspiration: "INDEPENDENCE",
  name: "测试",
  focus: (_view, state) => (["WORK", "STUDY", "CAREER", "REST"] as const)[state.termIndex % 4],
  event: (view) => (view.event.id.length % 2 === 0 ? "A" : "B"),
};

/** 走完一局，保留每一步之后的状态与截至那一步的操作记录。 */
function trail(seed: number, p: Policy = policy): Array<{ state: RunState; log: Action[] }> {
  const steps: Array<{ state: RunState; log: Action[] }> = [];
  let state = start(seed);
  const log: Action[] = [];
  steps.push({ state, log: [] });
  for (let guard = 0; guard < 200; guard++) {
    const action = nextAction(state, p);
    if (!action) break;
    state = act(state, action);
    log.push(action);
    steps.push({ state, log: [...log] });
  }
  return steps;
}

const steps = trail(13);
const tamper = (text: string, edit: (envelope: SaveEnvelope) => void): string => {
  const envelope = JSON.parse(text) as SaveEnvelope;
  edit(envelope);
  return JSON.stringify(envelope);
};

describe("序列化与读回", () => {
  it("一局里每一步之后的存档都能读回，且与原状态深度相等", () => {
    expect(steps[steps.length - 1].state.phase).toBe("ENDING");
    const phases = new Set<string>();
    for (const { state, log } of steps) {
      phases.add(state.phase);
      const text = serializeSave(state, log);
      const loaded = loadSave(text, ctx);
      expect(loaded.ok, `${state.phase} revision ${state.revision}`).toBe(true);
      if (loaded.ok) {
        expect(loaded.state).toEqual(JSON.parse(JSON.stringify(state)));
        expect(loaded.log).toEqual(log);
        expect(stableStringify(loaded.state)).toBe(stableStringify(state));
      }
    }
    // 覆盖了高中、选校、学期内各阶段、毕业与结局
    for (const phase of ["SETUP", "HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "TERM_REVIEW", "GRAD_PREVIEW", "GRAD_RESULTS", "ENDING"]) {
      expect(phases.has(phase), phase).toBe(true);
    }
  });

  it("存档格式：带格式名、版本、状态与完整操作记录", () => {
    const { state, log } = steps[10];
    const envelope = JSON.parse(serializeSave(state, log)) as SaveEnvelope;
    expect(envelope.format).toBe("liuxue-sim-save");
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.log).toHaveLength(state.revision);
    expect(envelope.state.seed).toBe(13);
    expect(envelope.state.rulesVersion).toBe(RULES_VERSION);
    expect(envelope.state.contentVersion).toBe(CONTENT_VERSION);
    expect(envelope.state.catalogSha256).toBe(ctx.catalog.catalogSha256);
  });

  it("重放：同 seed 同操作得到完全相同的状态（学校、支线、毕业 roll 都不变）", () => {
    const last = steps[steps.length - 1];
    const again = replay({ seed: 13, runId: last.state.runId, log: last.log }, ctx);
    expect(again).toEqual(last.state);
    const midway = steps[28];
    expect(replay({ seed: 13, runId: midway.state.runId, log: midway.log }, ctx)).toEqual(midway.state);
    // 读档后继续走，与不读档直接走的结果一致（刷新不会重发资助、重扣费用或重抽）
    const loaded = loadSave(serializeSave(midway.state, midway.log), ctx);
    if (!loaded.ok) throw new Error("读档失败");
    let resumed = loaded.state;
    for (const action of last.log.slice(midway.log.length)) resumed = act(resumed, action);
    expect(resumed).toEqual(last.state);
  });

  it("重放遇到非法操作会抛错", () => {
    const bad: Action[] = [{ type: "CHOOSE_FOCUS", focus: "REST" }];
    expect(() => replay({ seed: 13, runId: "x", log: bad }, ctx)).toThrow("REPLAY_REJECTED");
  });
});

describe("损坏的存档明确报错，不拼接历史", () => {
  const sample = steps[22]; // 本科第 5 学期结算后：两条支线都已分配
  const text = serializeSave(sample.state, sample.log);

  it("不是 JSON、不是本游戏的存档、缺字段", () => {
    for (const bad of ["", "{", "null", "[]", "42", JSON.stringify({ format: "other", schemaVersion: 1, state: {}, log: [] })]) {
      const result = loadSave(bad, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("CORRUPT");
    }
    const noLog = loadSave(tamper(text, (envelope) => delete (envelope as Partial<SaveEnvelope>).log), ctx);
    expect(noLog.ok ? "OK" : noLog.reason).toBe("CORRUPT");
    const noState = loadSave(tamper(text, (envelope) => delete (envelope as Partial<SaveEnvelope>).state), ctx);
    expect(noState.ok ? "OK" : noState.reason).toBe("CORRUPT");
  });

  it("改动任何一个数值、标记、学校、支线或毕业结果都会被发现", () => {
    const edits: Array<(envelope: SaveEnvelope) => void> = [
      (e) => { asActive(e.state).stats.money += 1; },
      (e) => { const run = asActive(e.state); run.stats.academics = run.stats.academics === 100 ? 99 : 100; },
      (e) => { asActive(e.state).focusCounts.STUDY += 1; },
      (e) => { asActive(e.state).flags.pop(); },
      (e) => { const run = asActive(e.state); run.profile.trait = run.profile.trait === "FRUGAL" ? "FOCUSED" : "FRUGAL"; },
      (e) => { asActive(e.state).profile.economy = "HIGH"; },
      (e) => { const run = asActive(e.state); run.arcs.A = run.arcs.A === "FAMILY" ? "CREATIVE" : "FAMILY"; },
      (e) => { const run = asActive(e.state); run.school = (run.offers ?? [])[2]; },
      (e) => { const run = asActive(e.state); run.admission.tier = run.admission.tier === "S" ? "A" : "S"; },
      (e) => { asActive(e.state).history[3].appliedDelta.money += 5; },
      (e) => { e.state.seed += 1; },
      (e) => { e.log.pop(); },
      (e) => { e.log.push({ type: "NEXT_TERM" }); },
      (e) => { e.log[5] = { type: "CHOOSE_FOCUS", focus: "REST" }; },
      (e) => { e.state.revision += 1; },
      (e) => { asActive(e.state).stats.wellbeing = 101; },
      (e) => { asActive(e.state).stats.wellbeing = 1.5; },
      (e) => { asActive(e.state).flags.push("NOT_A_FLAG"); },
    ];
    edits.forEach((edit, index) => {
      const result = loadSave(tamper(text, edit), ctx);
      expect(result.ok, `第 ${index + 1} 种改动`).toBe(false);
      if (!result.ok) expect(result.reason, `第 ${index + 1} 种改动`).toBe("CORRUPT");
    });
  });

  it("终局存档：改结局卡或去向也会被发现", () => {
    const last = steps[steps.length - 1];
    const ending = serializeSave(last.state, last.log);
    expect(loadSave(ending, ctx).ok).toBe(true);
    for (const edit of [
      (e: SaveEnvelope) => { const end = asActive(e.state).ending; if (end) end.card.tier = "EX"; },
      (e: SaveEnvelope) => { const end = asActive(e.state).ending; if (end) end.card.hidden = []; end?.card.hidden.push({ id: "H08", name: "x", roast: "y", facts: [] }); },
      (e: SaveEnvelope) => { const grad = asActive(e.state).graduations.UG; if (grad?.outcomes) grad.outcomes.PHD = grad.outcomes.PHD === "OFFERED" ? "NOT_OFFERED" : "OFFERED"; },
      (e: SaveEnvelope) => { const grad = asActive(e.state).graduations.UG; if (grad?.rolls) grad.rolls.HOME_JOB = 0; },
    ]) {
      const result = loadSave(tamper(ending, edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("CORRUPT");
    }
  });
});

describe("版本不兼容", () => {
  const sample = steps[22]; // 本科第 5 学期结算后：两条支线都已分配
  const text = serializeSave(sample.state, sample.log);

  it("规则、内容或存档格式版本不同 → VERSION_MISMATCH，不静默转换", () => {
    for (const edit of [
      (e: SaveEnvelope) => { e.state.rulesVersion = "0.9.0"; },
      (e: SaveEnvelope) => { e.state.contentVersion = "2.0.0"; },
      (e: SaveEnvelope) => { (e as { schemaVersion: number }).schemaVersion = 2; },
      (e: SaveEnvelope) => { (e.state as { schemaVersion: number }).schemaVersion = 2; },
    ]) {
      const result = loadSave(tamper(text, edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("VERSION_MISMATCH");
      if (!result.ok) expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  const updated = makeSampleCatalog(5);
  updated.catalogVersion = "sample-test-v1";
  updated.catalogSha256 = "1".repeat(64);
  const newCtx: EngineContext = { catalog: updated };

  it("学校目录已更新：还没生成申请结果的局需要重新开始", () => {
    for (const step of steps.filter(({ state }) => state.phase === "SETUP" || state.phase === "HIGH_SCHOOL_EVENT")) {
      const result = loadSave(serializeSave(step.state, step.log), newCtx);
      expect(result.ok ? "OK" : result.reason).toBe("VERSION_MISMATCH");
      if (!result.ok) expect(result.detail).toContain("学校目录");
    }
  });

  it("学校目录已更新：offer 已冻结的局可以继续，学校与机会不变", () => {
    const later = steps.filter(({ state }) => state.phase !== "SETUP" && state.phase !== "HIGH_SCHOOL_EVENT");
    expect(later.length).toBeGreaterThan(25);
    for (const step of later) {
      const result = loadSave(serializeSave(step.state, step.log), newCtx);
      expect(result.ok, `${step.state.phase}`).toBe(true);
      if (result.ok) expect(result.state).toEqual(step.state);
    }
    // 在新目录下继续走到终局，与原目录下的结果完全一致（之后不再读取目录）
    const midway = steps[25];
    const last = steps[steps.length - 1];
    const loaded = loadSave(serializeSave(midway.state, midway.log), newCtx);
    if (!loaded.ok) throw new Error("读档失败");
    let resumed = loaded.state;
    for (const action of last.log.slice(midway.log.length)) resumed = act(resumed, action, newCtx);
    expect(resumed).toEqual(last.state);
    expect(asActive(resumed).school).toEqual(asActive(midway.state).school);
    expect(asActive(resumed).catalogVersion).toBe("sample-test-v0");
  });

  it("目录已更新时无法重放，但结构与不变量仍会检查", () => {
    const base = serializeSave(sample.state, sample.log);
    const edits: Array<(envelope: SaveEnvelope) => void> = [
      (e) => { asActive(e.state).stats.money = 101; },
      (e) => { asActive(e.state).stats.wellbeing = -1; },
      (e) => { asActive(e.state).flags.push(asActive(e.state).flags[0]); },
      (e) => { asActive(e.state).flags.push("CORE_01_A", "CORE_01_B"); },
      (e) => { asActive(e.state).focusCounts.REST += 3; },
      (e) => { const run = asActive(e.state); run.offers = [(run.offers ?? [])[0], (run.offers ?? [])[0], (run.offers ?? [])[1]]; },
      (e) => { asActive(e.state).school = { ...(asActive(e.state).school ?? updated.schools[0]), unitid: "1" }; },
      (e) => { asActive(e.state).arcs.B = asActive(e.state).arcs.A; },
      (e) => { (asActive(e.state) as { phase: string }).phase = "NOWHERE"; },
      (e) => { e.log.pop(); },
    ];
    edits.forEach((edit, index) => {
      const result = loadSave(tamper(base, edit), newCtx);
      expect(result.ok ? "OK" : result.reason, `第 ${index + 1} 种改动`).toBe("CORRUPT");
    });
  });

  it("目录不变但进行到一半时，新开的局不会抽到别的学校", () => {
    const a = steps.find(({ state }) => state.phase === "SCHOOL_OFFERS");
    const b = trail(13).find(({ state }) => state.phase === "SCHOOL_OFFERS");
    expect(asActive(a?.state ?? start(0)).offers).toEqual(asActive(b?.state ?? start(0)).offers);
  });
});

describe("不变量检查覆盖一局中的每个合法状态", () => {
  it("真实走出来的状态全部通过", () => {
    for (const seed of [1, 2, 3, 13, 99]) {
      for (const { state } of trail(seed, { ...policy, economy: (["LOW", "MID", "HIGH"] as const)[seed % 3] })) {
        expect(invariantProblem(JSON.parse(JSON.stringify(state))), `seed ${seed} ${state.phase}`).toBeNull();
      }
    }
  });
});

describe("引擎纯度", () => {
  it("src/engine 的源码不使用 Math.random、Date、localStorage、React 或打包的目录", () => {
    const dir = new URL("../", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const name of files) {
      // 只检查代码：先去掉注释（注释里会提到这些被禁止的名字）。
      const source = readFileSync(new URL(name, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\s\/\/ .*$/gm, "");
      expect(source, `${name} 不应使用 Math.random`).not.toMatch(/Math\s*\.\s*random/);
      expect(source, `${name} 不应读取时钟`).not.toMatch(/\bDate\b|performance\.now/);
      expect(source, `${name} 不应碰存储`).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, `${name} 不应依赖界面或环境`).not.toMatch(/from\s+["']react|\bwindow\b|\bdocument\b|crypto\./);
      expect(source, `${name} 不应直接引用打包的学校目录`).not.toMatch(/\bCATALOG\b/);
    }
  });
});
