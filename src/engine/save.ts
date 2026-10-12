// 存档的序列化、重放与读档校验（docs/06 第 4 节、docs/08 D）。
// 读档时不信任存下来的数值：目录未变就从 seed 把整段操作重放一遍，结果必须与存档逐字段一致；
// 损坏或不兼容的存档明确报错，不拼接出一局看似正常的历史。

import { ALL_EVENTS } from "../content";
import {
  ALL_TIERS, ARC_ORDER, ASPIRATION_ORDER, CONTENT_VERSION, ECONOMY_ORDER, EXPECTATION_ORDER, FOCUS_ORDER, OFFER_COUNT,
  RULES_VERSION, SAVE_FORMAT, STAT_KEYS, STAT_MAX, STAT_MIN, TRAIT_ORDER, UG_TERMS,
} from "./constants";
import { applyAction, createRun } from "./reducer";
import { totalFocus } from "./rules";
import type { Action, ActiveRun, EngineContext, LoadResult, Phase, RunState, SaveEnvelope } from "./types";

const PHASES: readonly Phase[] = [
  "SETUP", "HIGH_SCHOOL_EVENT", "SCHOOL_OFFERS", "FOCUS", "CORE_EVENT", "ARC_EVENT", "TERM_REVIEW", "GRAD_PREVIEW",
  "GRAD_RESULTS", "ENDING",
];
const KNOWN_FLAGS: ReadonlySet<string> = new Set(ALL_EVENTS.flatMap((event) => event.choices.flatMap((choice) => choice.setFlags)));
const EVENT_IDS: readonly string[] = ALL_EVENTS.map((event) => event.id);

/** 键排序后的 JSON，用于深度比较；值为 undefined 的键等同于不存在。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function serializeSave(state: RunState, log: Action[]): string {
  const envelope: SaveEnvelope = { format: SAVE_FORMAT, schemaVersion: 1, state, log };
  return JSON.stringify(envelope);
}

/** 从 seed 重放整段操作，返回最终状态；任何一步被拒绝则抛错。 */
export function replay(args: { seed: number; runId: string; log: Action[] }, ctx: EngineContext): RunState {
  let state: RunState = createRun({ seed: args.seed, runId: args.runId, catalog: ctx.catalog });
  args.log.forEach((action, index) => {
    const result = applyAction(state, { ...action, revision: state.revision }, ctx);
    if (!result.ok) throw new Error(`REPLAY_REJECTED: 第 ${index + 1} 步 ${String(action?.type)} 被拒绝（${result.error.code}）`);
    state = result.state;
  });
  return state;
}

// ---------- 结构与不变量校验（目录已更新、无法重放时使用） ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isStat = (value: unknown): boolean => isInt(value) && value >= STAT_MIN && value <= STAT_MAX;

function statsProblem(value: unknown, where: string): string | null {
  if (!isRecord(value)) return `${where} 不是对象`;
  for (const key of STAT_KEYS) if (!isStat(value[key])) return `${where}.${key} 不是 0–100 的整数`;
  return null;
}

function schoolProblem(value: unknown, where: string): string | null {
  if (!isRecord(value)) return `${where} 不是学校记录`;
  for (const key of ["unitid", "name", "city", "state"] as const) {
    if (typeof value[key] !== "string") return `${where}.${key} 缺失`;
  }
  if (!ALL_TIERS.includes(value.tier as never)) return `${where}.tier 无效`;
  return null;
}

/** 返回第一条发现的问题；没有问题返回 null。 */
export function invariantProblem(state: unknown): string | null {
  if (!isRecord(state)) return "state 不是对象";
  if (!PHASES.includes(state.phase as Phase)) return "phase 无效";
  if (!isInt(state.seed) || state.seed < 0 || state.seed > 0xffffffff) return "seed 无效";
  if (typeof state.runId !== "string") return "runId 无效";
  if (!isInt(state.revision) || state.revision < 0) return "revision 无效";
  if (state.phase === "SETUP") return null;

  const run = state as unknown as ActiveRun;
  const profile = state.profile;
  if (!isRecord(profile)) return "profile 缺失";
  if (typeof profile.name !== "string") return "profile.name 无效";
  if (!ECONOMY_ORDER.includes(profile.economy as never)) return "profile.economy 无效";
  if (!EXPECTATION_ORDER.includes(profile.expectation as never)) return "profile.expectation 无效";
  if (!TRAIT_ORDER.includes(profile.trait as never)) return "profile.trait 无效";
  if (!ASPIRATION_ORDER.includes(profile.aspiration as never)) return "profile.aspiration 无效";

  const stats = statsProblem(state.stats, "stats");
  if (stats) return stats;

  const counts = state.focusCounts;
  if (!isRecord(counts)) return "focusCounts 缺失";
  for (const focus of FOCUS_ORDER) if (!isInt(counts[focus]) || (counts[focus] as number) < 0) return `focusCounts.${focus} 无效`;

  if (!Array.isArray(state.flags) || !state.flags.every((flag) => typeof flag === "string")) return "flags 无效";
  const flags = state.flags as string[];
  if (new Set(flags).size !== flags.length) return "flags 有重复";
  if (!flags.every((flag) => KNOWN_FLAGS.has(flag))) return "flags 含未知标记";
  for (const id of EVENT_IDS) if (flags.includes(`${id}_A`) && flags.includes(`${id}_B`)) return `${id} 同时有 A/B 标记`;

  const arcs = state.arcs;
  if (!isRecord(arcs)) return "arcs 缺失";
  for (const slot of ["A", "B"] as const) {
    if (arcs[slot] !== null && !ARC_ORDER.includes(arcs[slot] as never)) return `arcs.${slot} 无效`;
  }
  if (arcs.A !== null && arcs.A === arcs.B) return "两条支线相同";

  if (!["HS", "UG", "MS"].includes(state.stage as string)) return "stage 无效";
  if (!isInt(state.termIndex)) return "termIndex 无效";
  if (!(state.mastersYears === null || state.mastersYears === 1 || state.mastersYears === 2)) return "mastersYears 无效";
  if (!Array.isArray(state.history)) return "history 无效";
  for (const entry of state.history as unknown[]) {
    if (!isRecord(entry)) return "history 条目无效";
    for (const key of ["beforeStats", "requestedDelta", "appliedDelta", "afterStats"] as const) {
      if (!isRecord(entry[key])) return `history.${key} 缺失`;
    }
  }
  if (!isRecord(state.graduations)) return "graduations 缺失";
  if (!isRecord(state.admission) || !isInt((state.admission as Record<string, unknown>).baseReadiness)) return "admission 无效";

  // 学段与阶段的一致性
  const phase = run.phase;
  const stage = run.stage;
  const total = totalFocus(run.focusCounts);
  if (stage === "HS") {
    if (phase !== "HIGH_SCHOOL_EVENT" && phase !== "SCHOOL_OFFERS") return "高中阶段的 phase 无效";
    if (total !== 0 || run.termIndex !== 0) return "高中阶段不应有投入或学期";
    if (run.school !== null) return "高中阶段不应已有学校";
  } else {
    if (phase === "HIGH_SCHOOL_EVENT" || phase === "SCHOOL_OFFERS") return "phase 与学段不符";
    const school = schoolProblem(state.school, "school");
    if (school) return school;
    const termCount = stage === "UG" ? UG_TERMS : (run.mastersYears ?? 0) * 2;
    if (stage === "MS" && run.mastersYears === null) return "硕士阶段缺少学制";
    if (stage === "UG" && run.mastersYears !== null) return "本科阶段不应已有硕士学制";
    if (run.termIndex < 1 || run.termIndex > termCount) return "termIndex 越界";
    const before = stage === "UG" ? 0 : UG_TERMS;
    const expected = before + run.termIndex - (phase === "FOCUS" ? 1 : 0);
    if (total !== expected) return `投入次数 ${total} 与学段进度不符（应为 ${expected}）`;
    if ((phase === "GRAD_PREVIEW" || phase === "GRAD_RESULTS" || phase === "ENDING") && run.termIndex !== termCount) {
      return "毕业阶段的 termIndex 不在最后一学期";
    }
    if (stage === "MS" && !run.graduations.UG) return "硕士阶段缺少本科毕业快照";
  }
  if (phase !== "HIGH_SCHOOL_EVENT") {
    if (!Array.isArray(state.offers) || state.offers.length !== OFFER_COUNT) return "offers 无效";
    const ids = new Set<string>();
    for (const [index, offer] of (state.offers as unknown[]).entries()) {
      const problem = schoolProblem(offer, `offers[${index}]`);
      if (problem) return problem;
      ids.add((offer as Record<string, unknown>).unitid as string);
    }
    if (ids.size !== OFFER_COUNT) return "offers 有重复学校";
    if (new Set((state.offers as Array<Record<string, unknown>>).map((offer) => offer.tier)).size !== 1) return "offers 不同档";
    if (run.school && !ids.has(run.school.unitid)) return "所选学校不在 offers 中";
  }
  if (phase === "ENDING" && !isRecord(state.ending)) return "结局记录缺失";
  if (phase !== "ENDING" && state.ending !== null) return "尚未终局却已有结局记录";
  return null;
}

/** 解析并校验存档：结构、版本，以及（目录未变时）从 seed 重放 log 后与 state 完全一致。 */
export function loadSave(text: string, ctx: EngineContext): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "CORRUPT", detail: "存档不是合法的 JSON。" };
  }
  if (!isRecord(parsed) || parsed.format !== SAVE_FORMAT) {
    return { ok: false, reason: "CORRUPT", detail: "不是本游戏的存档。" };
  }
  if (parsed.schemaVersion !== 1) {
    return { ok: false, reason: "VERSION_MISMATCH", detail: `存档格式版本 ${String(parsed.schemaVersion)} 与当前版本 1 不兼容。` };
  }
  const state = parsed.state;
  const log = parsed.log;
  if (!isRecord(state) || !Array.isArray(log)) return { ok: false, reason: "CORRUPT", detail: "存档缺少状态或操作记录。" };
  if (state.schemaVersion !== 1 || state.rulesVersion !== RULES_VERSION || state.contentVersion !== CONTENT_VERSION) {
    return {
      ok: false,
      reason: "VERSION_MISMATCH",
      detail: `存档来自规则 ${String(state.rulesVersion)} / 内容 ${String(state.contentVersion)}，当前是 ${RULES_VERSION} / ${CONTENT_VERSION}。`,
    };
  }
  const shape = invariantProblem(state);
  if (shape) return { ok: false, reason: "CORRUPT", detail: `存档数据不完整：${shape}。` };
  if (state.revision !== log.length) return { ok: false, reason: "CORRUPT", detail: "操作记录与存档进度不一致。" };
  if (!log.every((action) => isRecord(action) && typeof action.type === "string")) {
    return { ok: false, reason: "CORRUPT", detail: "操作记录格式无效。" };
  }
  const typedState = state as unknown as RunState;
  const typedLog = log as Action[];

  if (typedState.catalogSha256 !== ctx.catalog.catalogSha256) {
    // 目录已更新：还没抽出 offer 的局无法保证抽到同样的学校；已冻结 offer 的局可以继续，但无法重放。
    if (typedState.phase === "SETUP" || typedState.phase === "HIGH_SCHOOL_EVENT") {
      return { ok: false, reason: "VERSION_MISMATCH", detail: "学校目录已更新，这局还没有生成申请结果，需要重新开始。" };
    }
    return { ok: true, state: typedState, log: typedLog };
  }

  let replayed: RunState;
  try {
    replayed = replay({ seed: typedState.seed, runId: typedState.runId, log: typedLog }, ctx);
  } catch (error) {
    return { ok: false, reason: "CORRUPT", detail: `操作记录无法重放：${(error as Error).message}` };
  }
  if (stableStringify(replayed) !== stableStringify(typedState)) {
    return { ok: false, reason: "CORRUPT", detail: "存档里的数值与按操作记录重放的结果不一致。" };
  }
  return { ok: true, state: typedState, log: typedLog };
}
