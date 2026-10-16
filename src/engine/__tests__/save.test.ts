// 存档：序列化、重放校验、损坏与版本不兼容（docs/06 §4、docs/08 D），以及引擎纯度。
// 主要用正式玩法（standard）的整局；经典模式另有一组读回用例。

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TALENTS } from "../../content";
import { makeSampleCatalog } from "../../../tests/helpers/sampleCatalog";
import { CONTENT_VERSION, RULES_VERSION } from "../constants";
import { loadSave, replay, serializeSave, setupView } from "../index";
import type { Action, EngineContext, RunState, SaveEnvelope } from "../index";
import { invariantProblem, stableStringify } from "../save";
import { act, asActive, asSetup, classicPolicy, ctx, nextAction, start, startClassic } from "./helpers";
import type { Policy } from "./helpers";

const policy: Policy = {
  plan: (view, state) => view.options[state.termIndex % view.options.length].plan.id,
  event: (view) => (view.event.id.length % 2 === 0 ? "A" : "B"),
};

interface Step {
  state: RunState;
  log: Action[];
}

/** 走完一局，保留每一步之后的状态与截至那一步的操作记录。 */
function trail(from: RunState, p: Policy = policy): Step[] {
  const steps: Step[] = [];
  let state = from;
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

/** 正式玩法里一局可能中途结束；找一个按这套策略能走到毕业的 seed，和一个中途结束的 seed。 */
function seedWhere(predicate: (steps: Step[]) => boolean): number {
  for (let seed = 1; seed < 500; seed++) if (predicate(trail(start(seed)))) return seed;
  throw new Error("找不到满足条件的 seed");
}
const endingKind = (list: Step[]) => {
  const state = list[list.length - 1].state;
  return state.phase === "ENDING" ? state.ending?.kind : undefined;
};
const SEED = seedWhere((list) => endingKind(list) === "GRADUATION");
const EARLY_SEED = seedWhere((list) => endingKind(list) === "EARLY" && list.some(({ state }) => state.phase === "FOCUS" && state.termIndex >= 2));
const steps = trail(start(SEED));
const last = steps[steps.length - 1];
const find = (predicate: (state: RunState) => boolean): Step => {
  const step = steps.find((item) => predicate(item.state));
  if (!step) throw new Error("这一局里没有满足条件的状态");
  return step;
};
/** 本科第 5 学期的支线事件之前：两条支线都已分配，前面已有若干学期的历史。 */
const sample = find((state) => state.phase === "ARC_EVENT" && state.termIndex === 5);
const midway = find((state) => state.phase === "FOCUS" && state.termIndex === 6);
const tamper = (text: string, edit: (envelope: SaveEnvelope) => void): string => {
  const envelope = JSON.parse(text) as SaveEnvelope;
  edit(envelope);
  return JSON.stringify(envelope);
};

describe("序列化与读回", () => {
  it("一局里每一步之后的存档都能读回，且与原状态深度相等", () => {
    expect(last.state.phase).toBe("ENDING");
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
    // 覆盖了开局、高中、选校、学期内各阶段、毕业、毕业后的五年与结局；第二版没有学期小结
    expect([...phases].sort()).toEqual(
      ["SETUP", "HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "GRAD_PREVIEW", "GRAD_RESULTS", "LIFE", "ENDING"].sort(),
    );
  });

  it("存档格式：带格式名、版本、模式、状态与完整操作记录", () => {
    const envelope = JSON.parse(serializeSave(sample.state, sample.log)) as SaveEnvelope;
    expect(envelope.format).toBe("liuxue-sim-save");
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.log).toHaveLength(sample.state.revision);
    expect(envelope.state).toMatchObject({ seed: SEED, mode: "standard", rulesVersion: RULES_VERSION, contentVersion: CONTENT_VERSION });
    expect(RULES_VERSION).toBe("4.0.0");
    expect(CONTENT_VERSION).toBe("4.0.0");
    // 开局的输入随存档保存：分点、已解锁的天赋、继承的天赋
    expect(asActive(envelope.state).profile.points).toEqual(asActive(sample.state).profile.points);
    expect(envelope.state).toMatchObject({ unlockedTalents: [], inheritedTalent: null });
    expect(envelope.state.catalogSha256).toBe(ctx.catalog.catalogSha256);
    // 出身、十张天赋、每学期的安排、主线槽事件和突发小事都不存进状态，读档后由 seed 重新推出
    expect(Object.keys(envelope.state)).not.toEqual(expect.arrayContaining(["draw", "slate", "origin"]));
  });

  it("重放：同 seed 同操作得到完全相同的状态（出身、安排、事件、突发小事、学校、支线、毕业 roll 都不变）", () => {
    const again = replay({ seed: SEED, runId: last.state.runId, log: last.log }, ctx);
    expect(again).toEqual(last.state);
    expect(replay({ seed: SEED, runId: midway.state.runId, log: midway.log }, ctx)).toEqual(midway.state);
    // 读档后继续走，与不读档直接走的结果一致（刷新不会重发资助、重扣费用、重抽安排或突发小事）
    const loaded = loadSave(serializeSave(midway.state, midway.log), ctx);
    if (!loaded.ok) throw new Error("读档失败");
    let resumed = loaded.state;
    for (const action of last.log.slice(midway.log.length)) resumed = act(resumed, action);
    expect(resumed).toEqual(last.state);
  });

  it("重放遇到非法操作会抛错", () => {
    const bad: Action[] = [{ type: "CHOOSE_PLAN", planId: "REST" }];
    expect(() => replay({ seed: SEED, runId: "x", log: bad }, ctx)).toThrow("REPLAY_REJECTED");
  });

  it("中途结束的局也能逐步读回；结局之后没有毕业快照", () => {
    const early = trail(start(EARLY_SEED));
    const end = early[early.length - 1];
    expect(asActive(end.state).ending).toMatchObject({ kind: "EARLY", route: null });
    for (const { state, log } of early) {
      const loaded = loadSave(serializeSave(state, log), ctx);
      expect(loaded.ok, `${state.phase} revision ${state.revision}`).toBe(true);
      if (loaded.ok) expect(loaded.state).toEqual(JSON.parse(JSON.stringify(state)));
    }
    expect(replay({ seed: EARLY_SEED, runId: end.state.runId, log: end.log }, ctx)).toEqual(end.state);
    // 改掉中途结局的 id、把它改成毕业结局、或者抹掉结局记录，都会被发现
    const text = serializeSave(end.state, end.log);
    for (const edit of [
      (e: SaveEnvelope) => { const record = asActive(e.state).ending; if (record) record.early = "E_NOT_AN_ENDING"; },
      (e: SaveEnvelope) => { const record = asActive(e.state).ending; if (record) record.kind = "GRADUATION"; },
      (e: SaveEnvelope) => { const record = asActive(e.state).ending; if (record) record.card.tier = record.card.tier === "EX" ? "N" : "EX"; },
      (e: SaveEnvelope) => { const record = asActive(e.state).ending; if (record) record.card.flavor = { id: "F_X", name: "x", roast: "y", text: "z" }; },
      (e: SaveEnvelope) => { (asActive(e.state) as { phase: string }).phase = "FOCUS"; },
    ]) {
      const result = loadSave(tamper(text, edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("CORRUPT");
    }
  });

  it("已解锁的天赋与继承的天赋是开局的输入：随存档保存，读档重放时原样带回", () => {
    const locked = TALENTS.filter((talent) => talent.locked).map((talent) => talent.id);
    expect(locked.length).toBeGreaterThan(0);
    const setup = start(SEED, ctx, { unlockedTalents: locked, inheritedTalent: locked[0] });
    expect(setupView(setup).draw[0].id).toBe(locked[0]);
    const withInputs = trail(setup, { ...policy, talents: (view) => view.draw.slice(0, 3).map((talent) => talent.id) });
    const end = withInputs[withInputs.length - 1];
    expect(asActive(end.state).profile.talents).toContain(locked[0]);
    for (const { state, log } of withInputs) {
      expect(state).toMatchObject({ unlockedTalents: locked, inheritedTalent: locked[0] });
      const loaded = loadSave(serializeSave(state, log), ctx);
      expect(loaded.ok, `${state.phase} revision ${state.revision}`).toBe(true);
    }
    // 把这两样输入改掉：十连抽对不上了（选中的天赋不在抽取结果里），或者列表本身不合规
    const text = serializeSave(end.state, end.log);
    for (const edit of [
      (e: SaveEnvelope) => { e.state.inheritedTalent = null; },
      (e: SaveEnvelope) => { e.state.unlockedTalents = []; },
      (e: SaveEnvelope) => { e.state.unlockedTalents = [...locked].reverse(); },
      (e: SaveEnvelope) => { e.state.unlockedTalents = [TALENTS.find((talent) => !talent.locked)?.id ?? ""]; },
      (e: SaveEnvelope) => { e.state.inheritedTalent = "T_NOT_A_TALENT"; },
    ]) {
      const result = loadSave(tamper(text, edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("CORRUPT");
    }
  });

  it("经典模式的局也能逐步读回（重放时带上模式与经济档）", () => {
    const classic = trail(startClassic(7, "LOW"), classicPolicy({ talent: "T_FRUGAL", focus: (state) => (state.termIndex % 2 ? "WORK" : "STUDY"), event: "A" }));
    expect(classic[classic.length - 1].state.phase).toBe("ENDING");
    for (const { state, log } of classic) {
      const loaded = loadSave(serializeSave(state, log), ctx);
      expect(loaded.ok, `${state.phase} revision ${state.revision}`).toBe(true);
      if (loaded.ok) expect(loaded.state).toEqual(JSON.parse(JSON.stringify(state)));
    }
    const end = classic[classic.length - 1];
    expect(replay({ seed: 7, runId: end.state.runId, log: end.log, mode: "classic", classicEconomy: "LOW" }, ctx)).toEqual(end.state);
    // 经典模式没有分点、解锁与继承，也没有中途结局
    expect(end.state).toMatchObject({ unlockedTalents: [], inheritedTalent: null });
    expect(asActive(end.state).profile.points).toBeNull();
    expect(asActive(end.state).ending?.kind).toBe("GRADUATION");
    // 用 standard 模式重放经典模式的操作记录会被拒绝（开局没有分点）
    expect(() => replay({ seed: 7, runId: end.state.runId, log: end.log }, ctx)).toThrow("REPLAY_REJECTED");
  });
});

describe("损坏的存档明确报错，不拼接历史", () => {
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

  it("改动任何一个数值、标记、天赋、出身、学校、支线或操作记录都会被发现", () => {
    const run = asActive(sample.state);
    const draw = setupView(asSetup(steps[0].state)).draw.map((talent) => talent.id);
    const unpicked = draw.find((id) => !run.profile.talents.includes(id)) ?? "";
    const edits: Array<(envelope: SaveEnvelope) => void> = [
      (e) => { asActive(e.state).stats.money += 1; },
      (e) => { const r = asActive(e.state); r.stats.academics = r.stats.academics === 100 ? 99 : 100; },
      (e) => { asActive(e.state).focusCounts.STUDY += 1; },
      (e) => { asActive(e.state).flags.pop(); },
      // 换成另一张确实抽到过、但没选的天赋
      (e) => { asActive(e.state).profile.talents[0] = unpicked; },
      (e) => { asActive(e.state).profile.talents.reverse(); },
      (e) => { const r = asActive(e.state); r.profile.economy = r.profile.economy === "HIGH" ? "LOW" : "HIGH"; },
      // 分点：挪一点、改成非法值、或者去掉
      (e) => { const points = asActive(e.state).profile.points; if (points) { const give = points.academics > 0 ? "academics" : "career"; const take = points.wellbeing < 10 ? "wellbeing" : "family"; points[give] -= 1; points[take] += 1; } },
      (e) => { const points = asActive(e.state).profile.points; if (points) points.career = 11; },
      (e) => { asActive(e.state).profile.points = null; },
      (e) => { const r = asActive(e.state); r.profile.aspiration = r.profile.aspiration === "DISCOVERY" ? "BELONGING" : "DISCOVERY"; },
      (e) => { const r = asActive(e.state); r.arcs.A = r.arcs.A === "FAMILY" ? "CREATIVE" : "FAMILY"; },
      (e) => { const r = asActive(e.state); r.school = (r.offers ?? []).find((offer) => offer.unitid !== r.school?.unitid) ?? null; },
      (e) => { const r = asActive(e.state); r.admission.tier = r.admission.tier === "S" ? "A" : "S"; },
      (e) => { asActive(e.state).admission.talentBonus += 5; },
      (e) => { asActive(e.state).history[3].appliedDelta.money += 5; },
      (e) => { const entry = asActive(e.state).history.find((item) => item.kind === "FOCUS"); if (entry) entry.planId = "NOT_A_PLAN"; },
      (e) => { e.state.seed += 1; },
      (e) => { e.log.pop(); },
      (e) => { e.log.push({ type: "REVEAL_GRADUATION" }); },
      (e) => { e.log[5] = { type: "CHOOSE_PLAN", planId: "REST" }; },
      (e) => { e.state.revision += 1; },
      (e) => { asActive(e.state).stats.wellbeing = 101; },
      (e) => { asActive(e.state).stats.wellbeing = 1.5; },
      (e) => { asActive(e.state).flags.push("NOT_A_FLAG"); },
      (e) => { asActive(e.state).profile.talents.push(unpicked); },
      (e) => { asActive(e.state).profile.talents = ["T_NOT_A_TALENT", "T_ALSO_NOT", "T_NOPE"]; },
    ];
    expect(unpicked).not.toBe("");
    edits.forEach((edit, index) => {
      const result = loadSave(tamper(text, edit), ctx);
      expect(result.ok, `第 ${index + 1} 种改动`).toBe(false);
      if (!result.ok) expect(result.reason, `第 ${index + 1} 种改动`).toBe("CORRUPT");
    });
  });

  it("把正式玩法的存档改成经典模式（或反过来）会被发现", () => {
    const flipped = loadSave(tamper(text, (e) => { e.state.mode = "classic"; }), ctx);
    expect(flipped.ok ? "OK" : flipped.reason).toBe("CORRUPT");
    const bogus = loadSave(tamper(text, (e) => { (e.state as { mode: string }).mode = "easy"; }), ctx);
    expect(bogus.ok ? "OK" : bogus.reason).toBe("CORRUPT");
  });

  it("终局存档：改结局卡或去向也会被发现", () => {
    const ending = serializeSave(last.state, last.log);
    expect(loadSave(ending, ctx).ok).toBe(true);
    for (const edit of [
      (e: SaveEnvelope) => { const end = asActive(e.state).ending; if (end) end.card.tier = end.card.tier === "EX" ? "N" : "EX"; },
      (e: SaveEnvelope) => { const end = asActive(e.state).ending; if (end) end.card.hidden = [{ id: "H08", name: "x", roast: "y", facts: [] }]; },
      (e: SaveEnvelope) => { const grad = asActive(e.state).graduations.UG; if (grad?.outcomes) grad.outcomes.PHD = grad.outcomes.PHD === "OFFERED" ? "NOT_OFFERED" : "OFFERED"; },
      (e: SaveEnvelope) => { const grad = asActive(e.state).graduations.UG; if (grad?.rolls) grad.rolls.HOME_JOB = 0.123; },
    ]) {
      const result = loadSave(tamper(ending, edit), ctx);
      expect(result.ok ? "OK" : result.reason).toBe("CORRUPT");
    }
  });
});

describe("版本不兼容", () => {
  const text = serializeSave(sample.state, sample.log);

  it("规则、内容或存档格式版本不同 → VERSION_MISMATCH，不静默转换；第一版的存档因此不再可读", () => {
    for (const edit of [
      (e: SaveEnvelope) => { e.state.rulesVersion = "1.1.0"; },
      (e: SaveEnvelope) => { e.state.contentVersion = "1.1.0"; },
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
    const early = steps.filter(({ state }) => state.phase === "SETUP" || state.phase === "HIGH_SCHOOL_EVENT");
    expect(early).toHaveLength(3);
    for (const step of early) {
      const result = loadSave(serializeSave(step.state, step.log), newCtx);
      expect(result.ok ? "OK" : result.reason).toBe("VERSION_MISMATCH");
      if (!result.ok) expect(result.detail).toContain("学校目录");
    }
  });

  it("学校目录已更新：offer 已冻结的局可以继续，学校与机会不变", () => {
    const later = steps.filter(({ state }) => state.phase !== "SETUP" && state.phase !== "HIGH_SCHOOL_EVENT");
    expect(later.length).toBeGreaterThan(20); // 这一局走到了毕业
    for (const step of later) {
      const result = loadSave(serializeSave(step.state, step.log), newCtx);
      expect(result.ok, `${step.state.phase}`).toBe(true);
      if (result.ok) expect(result.state).toEqual(step.state);
    }
    // 在新目录下继续走到终局，与原目录下的结果完全一致（之后不再读取目录）
    const loaded = loadSave(serializeSave(midway.state, midway.log), newCtx);
    if (!loaded.ok) throw new Error("读档失败");
    let resumed = loaded.state;
    for (const action of last.log.slice(midway.log.length)) resumed = act(resumed, action, newCtx);
    expect(resumed).toEqual(last.state);
    expect(asActive(resumed).school).toEqual(asActive(midway.state).school);
    expect(asActive(resumed).catalogVersion).toBe("sample-test-v0");
  });

  it("目录已更新时无法重放，但结构与不变量仍会检查", () => {
    const edits: Array<(envelope: SaveEnvelope) => void> = [
      (e) => { asActive(e.state).stats.money = 101; },
      (e) => { asActive(e.state).stats.wellbeing = -1; },
      (e) => { asActive(e.state).flags.push(asActive(e.state).flags[0]); },
      (e) => { asActive(e.state).flags.push("CORE_08_V2_A", "CORE_08_V2_B"); },
      (e) => { asActive(e.state).focusCounts.REST += 3; },
      (e) => { const r = asActive(e.state); r.offers = [(r.offers ?? [])[0], (r.offers ?? [])[0], (r.offers ?? [])[1]]; },
      (e) => { asActive(e.state).school = { ...(asActive(e.state).school ?? updated.schools[0]), unitid: "1" }; },
      (e) => { asActive(e.state).arcs.B = asActive(e.state).arcs.A; },
      (e) => { (asActive(e.state) as { phase: string }).phase = "TERM_REVIEW"; },
      (e) => { asActive(e.state).profile.talents.pop(); },
      (e) => { asActive(e.state).profile.talents[0] = "T_NOT_A_TALENT"; },
      (e) => { (e.state as { mode: string }).mode = "easy"; },
      (e) => { const points = asActive(e.state).profile.points; if (points) points.family = -1; },
      (e) => { const r = asActive(e.state); r.profile.economy = r.profile.economy === "HIGH" ? "LOW" : "HIGH"; },
      (e) => { e.state.unlockedTalents = ["T_NOT_A_TALENT"]; },
      (e) => { e.log.pop(); },
    ];
    edits.forEach((edit, index) => {
      const result = loadSave(tamper(text, edit), newCtx);
      expect(result.ok ? "OK" : result.reason, `第 ${index + 1} 种改动`).toBe("CORRUPT");
    });
  });

  it("目录不变时重开同一个 seed，抽到的三所学校相同", () => {
    const a = find((state) => state.phase === "SCHOOL_OFFERS");
    const b = trail(start(SEED)).find(({ state }) => state.phase === "SCHOOL_OFFERS");
    expect(asActive(a.state).offers).toEqual(asActive(b?.state ?? start(0)).offers);
  });
});

describe("不变量检查覆盖一局中的每个合法状态", () => {
  it("真实走出来的状态全部通过（两种模式）", () => {
    for (const seed of [1, 2, 3, 13, 99, SEED, EARLY_SEED]) {
      for (const { state } of trail(start(seed))) {
        expect(invariantProblem(JSON.parse(JSON.stringify(state))), `standard seed ${seed} ${state.phase}`).toBeNull();
      }
      const classic = trail(startClassic(seed, (["LOW", "MID", "HIGH"] as const)[seed % 3]), classicPolicy({ focus: "CAMPUS", event: "B" }));
      for (const { state } of classic) {
        expect(invariantProblem(JSON.parse(JSON.stringify(state))), `classic seed ${seed} ${state.phase}`).toBeNull();
      }
    }
  });

  it("SETUP 状态：经典模式必须带经济档，正式玩法不能带", () => {
    expect(invariantProblem(JSON.parse(JSON.stringify(start(5))))).toBeNull();
    expect(invariantProblem(JSON.parse(JSON.stringify(startClassic(5, "LOW"))))).toBeNull();
    expect(invariantProblem({ ...start(5), classicEconomy: "LOW" })).not.toBeNull();
    const { classicEconomy: _dropped, ...withoutEconomy } = startClassic(5, "LOW");
    expect(invariantProblem(withoutEconomy)).not.toBeNull();
    // 两样跨局输入必须在；经典模式不能带
    const { unlockedTalents: _u, ...withoutUnlocked } = start(5);
    expect(invariantProblem(withoutUnlocked)).not.toBeNull();
    const locked = TALENTS.filter((talent) => talent.locked).map((talent) => talent.id);
    expect(invariantProblem({ ...startClassic(5, "LOW"), unlockedTalents: locked.slice(0, 1) })).not.toBeNull();
    expect(invariantProblem({ ...start(5), inheritedTalent: locked[0] })).not.toBeNull(); // 还没解锁的天赋不能继承
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
