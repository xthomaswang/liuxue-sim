// 第四版内容自查（docs/24）：暑假、日常、GPA 说法、毕业后各轨道、中途结局与去向结局的格式、长度、数值范围、
// 条件键与引用。只读 JSON，不依赖引擎代码，写内容的人随时可以跑：
//   node scripts/check-v4-content.ts            格式错误算失败，覆盖不全只提示
//   node scripts/check-v4-content.ts --strict   覆盖不全（中途结局、天赋在毕业后的作用）也算失败

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const errors: string[] = [];
const warnings: string[] = [];

type Obj = Record<string, unknown>;
const read = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));
const chars = (text: unknown): number => (typeof text === "string" ? [...text].length : -1);
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const STAT_KEYS = ["money", "academics", "career", "wellbeing"];
const FOCUSES = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
const TRACKS = ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION", "DROPOUT"];
const GRADES = ["N", "R", "SR", "SSR"];
const CONDITION_KEYS = [
  "stage", "termMin", "termMax", "statMin", "statMax", "countMin", "countMax", "pointsMin", "pointsMax", "flagsAll",
  "talentsAny", "shortfallStreak", "zeroWellbeingStreak", "schoolStates", "schoolTiers", "aspirations", "transitionMode",
  "tiers", "focusAny", "tracks", "yearMin", "yearMax", "lifeFlagsAll", "lifeFlagsAny", "lifeFlagsNone", "talentsNone",
  "flavors", "earlies", "routes", "degrees", "economies",
];
const CANONICAL_FLAGS = [
  "H1B", "H1B_OUT", "GREEN_CARD", "CANADA", "LAID_OFF", "PROMOTED", "JOB_HOP", "BURNOUT", "DATING", "MARRIED", "BREAKUP",
  "KID", "HOUSE", "PET", "CIVIL_SERVANT", "RETURNED", "STARTUP", "STARTUP_EXIT", "FIRE", "SIDE_HUSTLE", "INFLUENCER",
  "REAPPLIED", "PHD_QUAL", "PAPER", "PHD_DONE", "PHD_QUIT", "FACULTY",
];
const BANNED = ["修仙", "飞升", "渡劫", "筑基", "金丹", "元婴", "灵根", "丹田", "长生不老"];

const talents = (read("src/content/talents.json") as Obj[]).map((t) => String(t.id));
const earlyEndings = read("src/content/earlyEndings.json") as Obj[];
const earlyIds = earlyEndings.map((e) => String(e.id));
const flavors = read("src/content/endingFlavors.json") as Obj[];
const flavorIds = flavors.map((f) => String(f.id));

/** 条件里用到的引用，最后统一核对。 */
const usedLifeFlags = new Map<string, string>();
const setLifeFlags = new Set<string>();
const referencedTalents = new Map<string, Set<string>>(); // 天赋 → 出现在哪些文件
const referencedEarly = new Set<string>();

function checkStats(map: unknown, limit: number, what: string, sumMin: number, sumMax: number): void {
  if (!isObj(map)) {
    errors.push(`${what}：缺少四属性`);
    return;
  }
  for (const key of STAT_KEYS) {
    const value = map[key];
    if (!isInt(value) || Math.abs(value) > limit) errors.push(`${what}.${key} 应为绝对值 ≤ ${limit} 的整数（现在是 ${String(value)}）`);
  }
  for (const key of Object.keys(map)) if (!STAT_KEYS.includes(key)) errors.push(`${what} 出现未知属性 ${key}`);
  const sum = STAT_KEYS.reduce((total, key) => total + Math.abs(Number(map[key]) || 0), 0);
  if (sum < sumMin || sum > sumMax) errors.push(`${what} 四项绝对值之和应在 ${sumMin}–${sumMax}（现在 ${sum}）`);
}

function checkText(text: unknown, max: number, what: string, period = true): void {
  const n = chars(text);
  if (n <= 0) errors.push(`${what}：文字为空`);
  else if (n > max) errors.push(`${what}：超过 ${max} 个字（${n}）`);
  if (typeof text === "string") {
    if (period && !/[。！？…）」”]$/.test(text)) errors.push(`${what}：要以句号（或！？）结尾`);
    for (const word of BANNED) if (text.includes(word)) errors.push(`${what}：出现了不做的题材“${word}”`);
    if (/\d+\s*(资金|学业|职业|身心)/.test(text) || /(资金|学业|职业|身心)\s*[+＋-]\s*\d/.test(text)) {
      warnings.push(`${what}：文字里好像写了数值（数值由界面显示）`);
    }
  }
}

function checkWhen(when: unknown, what: string, file: string): void {
  if (!isObj(when)) {
    errors.push(`${what}.when 必须是对象（无条件写 {}）`);
    return;
  }
  for (const key of Object.keys(when)) if (!CONDITION_KEYS.includes(key)) errors.push(`${what}.when 出现未知的键 ${key}`);
  for (const key of ["lifeFlagsAll", "lifeFlagsAny", "lifeFlagsNone"]) {
    const list = when[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0) errors.push(`${what}.when.${key} 应为非空数组`);
    else for (const flag of list) usedLifeFlags.set(String(flag), what);
  }
  for (const key of ["talentsAny", "talentsNone"]) {
    const list = when[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0) errors.push(`${what}.when.${key} 应为非空数组`);
    else
      for (const id of list) {
        if (!talents.includes(String(id))) errors.push(`${what}.when.${key} 引用了不存在的天赋 ${String(id)}`);
        if (!referencedTalents.has(String(id))) referencedTalents.set(String(id), new Set());
        referencedTalents.get(String(id))?.add(file);
      }
  }
  if (when.earlies !== undefined) {
    if (!Array.isArray(when.earlies)) errors.push(`${what}.when.earlies 应为数组`);
    else
      for (const id of when.earlies) {
        if (!earlyIds.includes(String(id))) errors.push(`${what}.when.earlies 引用了不存在的中途结局 ${String(id)}`);
        referencedEarly.add(String(id));
      }
  }
  if (when.flavors !== undefined) {
    if (!Array.isArray(when.flavors)) errors.push(`${what}.when.flavors 应为数组`);
    else for (const id of when.flavors) if (!flavorIds.includes(String(id))) errors.push(`${what}.when.flavors 引用了不存在的去向结局 ${String(id)}`);
  }
  if (when.tracks !== undefined) {
    if (!Array.isArray(when.tracks) || !when.tracks.every((t) => TRACKS.includes(String(t)))) errors.push(`${what}.when.tracks 只能是 ${TRACKS.join("/")}`);
  }
  if (when.focusAny !== undefined) {
    if (!Array.isArray(when.focusAny) || !when.focusAny.every((f) => FOCUSES.includes(String(f)))) errors.push(`${what}.when.focusAny 只能是 ${FOCUSES.join("/")}`);
  }
  for (const key of ["yearMin", "yearMax"]) {
    if (when[key] !== undefined && (!isInt(when[key]) || (when[key] as number) < 1 || (when[key] as number) > 5)) errors.push(`${what}.when.${key} 应为 1–5`);
  }
  if (isInt(when.yearMin) && isInt(when.yearMax) && when.yearMin > when.yearMax) errors.push(`${what}.when 的 yearMin 大于 yearMax`);
}

function checkIds(items: Obj[], pattern: RegExp, what: string, seen: Set<string>): void {
  for (const item of items) {
    const id = String(item.id);
    if (!pattern.test(id)) errors.push(`${what} ${id}：id 应匹配 ${pattern}`);
    if (seen.has(id)) errors.push(`${what} ${id}：id 重复`);
    seen.add(id);
  }
}

function checkWeight(value: unknown, what: string): void {
  if (!isInt(value) || value < 1 || value > 10) errors.push(`${what}.weight 应为 1–10 的整数`);
}

// ---------- 暑假 ----------
{
  const items = read("src/content/summers.json") as Obj[];
  const seen = new Set<string>();
  checkIds(items, /^SU_[A-Z0-9_]+$/, "暑假", seen);
  for (const item of items) {
    const what = `暑假 ${String(item.id)}`;
    if (!["DEPARTURE", "UG", "MS"].includes(String(item.slot))) errors.push(`${what}：slot 只能是 DEPARTURE/UG/MS`);
    checkText(item.text, 40, what);
    checkStats(item.effects, 5, `${what}.effects`, 1, 8);
    checkWhen(item.when, what, "summers.json");
    checkWeight(item.weight, what);
  }
  const count = (slot: string) => items.filter((item) => item.slot === slot).length;
  for (const [slot, min] of [["DEPARTURE", 10], ["UG", 30], ["MS", 8]] as const) {
    if (count(slot) < min) warnings.push(`暑假 ${slot} 只有 ${count(slot)} 条，至少要 ${min} 条`);
  }
  const sums = STAT_KEYS.map((key) => items.reduce((total, item) => total + (Number((item.effects as Obj)?.[key]) || 0), 0) / Math.max(1, items.length));
  warnings.push(`暑假平均数值：${STAT_KEYS.map((key, i) => `${key} ${sums[i].toFixed(2)}`).join("，")}（资金与身心最好在 ±0.8 以内）`);
}

// ---------- 日常 ----------
{
  const items = read("src/content/daily.json") as Obj[];
  const seen = new Set<string>();
  checkIds(items, /^D_[A-Z0-9_]+$/, "日常", seen);
  for (const item of items) {
    const what = `日常 ${String(item.id)}`;
    if (!["TERM", "FALL", "SPRING", "WINTER"].includes(String(item.slot))) errors.push(`${what}：slot 只能是 TERM/FALL/SPRING/WINTER`);
    checkText(item.text, 40, what);
    checkWhen(item.when, what, "daily.json");
    checkWeight(item.weight, what);
    if ("effects" in item) errors.push(`${what}：日常没有数值变化，不要写 effects`);
  }
  const count = (slot: string) => items.filter((item) => item.slot === slot).length;
  for (const [slot, min] of [["TERM", 60], ["FALL", 15], ["SPRING", 15], ["WINTER", 15]] as const) {
    if (count(slot) < min) warnings.push(`日常 ${slot} 只有 ${count(slot)} 条，至少要 ${min} 条`);
  }
}

// ---------- GPA 说法 ----------
{
  const bands = read("src/content/gpa.json") as Obj[];
  let previous = Infinity;
  for (const band of bands) {
    const min = Number(band.min);
    if (!(min < previous)) errors.push(`GPA 档 ${min}：min 要从高到低排`);
    previous = min;
    if (!Array.isArray(band.texts) || band.texts.length < 2) errors.push(`GPA 档 ${min}：至少两句`);
    else
      for (const text of band.texts) {
        checkText(text, 30, `GPA 档 ${min}`);
        if (!String(text).includes("{gpa}")) errors.push(`GPA 档 ${min}：每句都要有 {gpa}`);
      }
  }
  if (bands.length === 0 || Number(bands[bands.length - 1].min) > 0.8) errors.push("GPA 最后一档的 min 要 ≤ 0.8，覆盖所有分数");
}

// ---------- 毕业后各轨道 ----------
const lifeIds = new Set<string>();
const outcomesByTrack = new Map<string, Obj[]>();
function checkLifeEvents(list: unknown, kind: "milestones" | "events", prefix: string, what: string, file: string, track: string): void {
  if (!Array.isArray(list)) {
    errors.push(`${what}.${kind} 必须是数组`);
    return;
  }
  checkIds(list as Obj[], new RegExp(`^${prefix}_[A-Z0-9_]+$`), what, lifeIds);
  for (const item of list as Obj[]) {
    const at = `${what} ${String(item.id)}`;
    checkText(item.text, 40, at);
    if (kind === "milestones") {
      checkStats(item.delta, 12, `${at}.delta`, 0, 30);
      if (!isInt(item.chancePermille) || item.chancePermille < 1 || item.chancePermille > 1000) errors.push(`${at}.chancePermille 应为 1–1000`);
      if ("weight" in item) errors.push(`${at}：里程碑不用 weight`);
    } else {
      checkStats(item.delta, 8, `${at}.delta`, 1, 12);
      checkWeight(item.weight, at);
      if ("chancePermille" in item || "repeatable" in item) errors.push(`${at}：生活小事不用 chancePermille／repeatable`);
    }
    checkWhen(item.when, at, file);
    if (item.setFlags !== undefined) {
      if (!Array.isArray(item.setFlags) || item.setFlags.length === 0) errors.push(`${at}.setFlags 应为非空数组`);
      else
        for (const flag of item.setFlags) {
          if (!/^[A-Z][A-Z0-9_]*$/.test(String(flag))) errors.push(`${at}.setFlags 的 ${String(flag)} 应为大写`);
          setLifeFlags.add(String(flag));
        }
    }
    if (item.setTrack !== undefined) {
      if (!TRACKS.includes(String(item.setTrack))) errors.push(`${at}.setTrack 只能是 ${TRACKS.join("/")}`);
      if (item.setTrack === track) errors.push(`${at}.setTrack 与本轨道相同`);
    }
  }
}

for (const track of TRACKS) {
  const file = `src/content/life/${track}.json`;
  const what = `轨道 ${track}`;
  const content = read(file) as Obj;
  if (content.track !== track) errors.push(`${what}：track 字段应为 ${track}`);
  checkText(content.name, 6, `${what}.name`, false);
  const base = content.base as Obj;
  if (!isObj(base)) errors.push(`${what}：缺少 base`);
  else {
    checkStats(base.delta, 6, `${what}.base.delta`, 0, 24);
    if (!Array.isArray(base.texts) || base.texts.length < 6) errors.push(`${what}.base.texts 至少 6 句`);
    else base.texts.forEach((text, i) => checkText(text, 30, `${what}.base.texts[${i}]`));
  }
  const plans = content.plans as Obj[];
  if (!Array.isArray(plans) || plans.length !== 5) errors.push(`${what}.plans 应恰好 5 张`);
  else
    plans.forEach((plan, i) => {
      if (plan.focus !== FOCUSES[i]) errors.push(`${what}.plans[${i}] 的类别应为 ${FOCUSES[i]}`);
      checkText(plan.name, 8, `${what}.plans[${i}].name`, false);
      checkStats(plan.delta, 8, `${what}.plans[${i}].delta`, 1, 14);
    });
  checkLifeEvents(content.milestones, "milestones", `LM_${track}`, what, track, track);
  checkLifeEvents(content.events, "events", `LE_${track}`, what, track, track);
  const milestones = (content.milestones as unknown[]) ?? [];
  const events = (content.events as unknown[]) ?? [];
  if (milestones.length < 8) warnings.push(`${what}：里程碑只有 ${milestones.length} 条，至少要 8 条`);
  const eventMin = track === "DROPOUT" ? 20 : 24;
  if (events.length < eventMin) warnings.push(`${what}：生活小事只有 ${events.length} 条，至少要 ${eventMin} 条`);

  const outcomes = (content.outcomes as Obj[]) ?? [];
  outcomesByTrack.set(track, outcomes);
  checkIds(outcomes, new RegExp(`^LO_${track}_[A-Z0-9_]+$`), `${what} 结局`, lifeIds);
  for (const outcome of outcomes) {
    const at = `${what} 结局 ${String(outcome.id)}`;
    checkText(outcome.name, 8, `${at}.name`, false);
    checkText(outcome.roast, 24, `${at}.roast`);
    checkText(outcome.text, 70, `${at}.text`);
    checkText(outcome.hint, 24, `${at}.hint`);
    if (!GRADES.includes(String(outcome.grade))) errors.push(`${at}.grade 只能是 N/R/SR/SSR`);
    checkWhen(outcome.when, at, track);
    checkWeight(outcome.weight, at);
  }
  const fallbacks = outcomes.filter((outcome) => outcome.fallback === true);
  if (fallbacks.length !== 1) errors.push(`${what}：应恰好一条 fallback 结局（现在 ${fallbacks.length} 条）`);
  else if (isObj(fallbacks[0].when) && Object.keys(fallbacks[0].when).length > 0) errors.push(`${what}：fallback 结局不能有条件`);
  if (outcomes.length < 8) warnings.push(`${what}：五年后的结局只有 ${outcomes.length} 条，至少要 8 条`);
}
{
  const content = read("src/content/life/COMMON.json") as Obj;
  if (content.track !== "COMMON") errors.push("COMMON.json：track 字段应为 COMMON");
  for (const key of Object.keys(content)) if (!["track", "milestones", "events"].includes(key)) errors.push(`COMMON.json 只能有 track、milestones、events（多了 ${key}）`);
  checkLifeEvents(content.milestones, "milestones", "LM_COMMON", "公共", "COMMON", "COMMON");
  checkLifeEvents(content.events, "events", "LE_COMMON", "公共", "COMMON", "COMMON");
  if (((content.milestones as unknown[]) ?? []).length < 8) warnings.push("公共：里程碑至少要 8 条");
  if (((content.events as unknown[]) ?? []).length < 20) warnings.push("公共：生活小事至少要 20 条");
}

// ---------- 中途结局、去向结局、突发小事里的条件 ----------
{
  const seen = new Set<string>();
  for (const ending of earlyEndings) {
    const what = `中途结局 ${String(ending.id)}`;
    if (seen.has(String(ending.id))) errors.push(`${what}：id 重复`);
    seen.add(String(ending.id));
    if (ending.lifeTrack !== undefined && !TRACKS.includes(String(ending.lifeTrack))) errors.push(`${what}.lifeTrack 只能是 ${TRACKS.join("/")}`);
    checkWhen(ending.when, what, "earlyEndings.json");
    for (const key of ["name", "roast", "title", "text", "epilogue", "condition", "hint"]) {
      if (typeof ending[key] !== "string" || chars(ending[key]) <= 0) errors.push(`${what}：缺少 ${key}`);
    }
  }
  const flavorSeen = new Set<string>();
  for (const flavor of flavors) {
    const what = `去向结局 ${String(flavor.id)}`;
    if (flavorSeen.has(String(flavor.id))) errors.push(`${what}：id 重复`);
    flavorSeen.add(String(flavor.id));
    checkWhen(flavor.when, what, "endingFlavors.json");
  }
  for (const route of ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"]) {
    const n = flavors.filter((flavor) => flavor.route === route && flavor.fallback === true).length;
    if (n !== 1) errors.push(`去向结局：${route} 应恰好一条 fallback（现在 ${n}）`);
  }
  const happenings = read("src/content/happenings.json") as Obj[];
  for (const item of happenings) if (item.when !== undefined) checkWhen(item.when, `突发小事 ${String(item.id)}`, "happenings.json");
}

// ---------- 交叉引用与覆盖 ----------
const unsetCanonical: string[] = [];
for (const [flag, where] of usedLifeFlags) {
  if (setLifeFlags.has(flag)) continue;
  // 固定表里的标记可能由另一位作者负责的文件来设置：没设置时先提示，--strict 时才算错。
  if (CANONICAL_FLAGS.includes(flag)) unsetCanonical.push(`人生标记 ${flag}（在 ${where} 的条件里）还没有任何事件设置它`);
  else errors.push(`人生标记 ${flag}（在 ${where} 的条件里）没有任何事件设置它`);
}
for (const flag of setLifeFlags) {
  if (!CANONICAL_FLAGS.includes(flag)) warnings.push(`人生标记 ${flag} 不在固定表里（编排用的可以，确认不是拼错）`);
}
const coverage: string[] = [...unsetCanonical];
for (const ending of earlyEndings) {
  const track = String(ending.lifeTrack ?? "DROPOUT");
  if (track === "DROPOUT" && !referencedEarly.has(String(ending.id))) coverage.push(`中途结局 ${String(ending.id)} 在毕业后的内容里还没有专属的一条（earlies）`);
}
const hooks: Array<[string, string[]]> = [
  ["T_VISA_KOI", ["LOCAL_JOB"]],
  ["T_CIVIL_GENE", ["HOME_JOB", "TRANSITION", "DROPOUT"]],
  ["T_GOOD_LOOKING", ["COMMON"]],
  ["T_NET_SENSE", []],
  ["T_HACKATHON", []],
  ["T_PROF_KID", ["PHD"]],
  ["T_LANDLORD", ["HOME_JOB", "TRANSITION", "DROPOUT"]],
  ["T_REBORN", ["COMMON"]],
  ["T_SYSTEM", ["COMMON"]],
];
for (const [talent, files] of hooks) {
  const found = referencedTalents.get(talent) ?? new Set<string>();
  if (found.size === 0) coverage.push(`天赋 ${talent} 在毕业后的内容里还没有实现（docs/24 §4.6）`);
  for (const file of files) if (!found.has(file)) coverage.push(`天赋 ${talent} 应该在 ${file} 里实现（docs/24 §4.6）`);
}
for (const [track, outcomes] of outcomesByTrack) {
  const grades = GRADES.map((grade) => `${grade} ${outcomes.filter((o) => o.grade === grade).length}`).join("、");
  warnings.push(`轨道 ${track} 结局稀有度：${grades}`);
}
if (strict) errors.push(...coverage);
else warnings.push(...coverage);

for (const warning of warnings) console.log(`提示：${warning}`);
for (const error of errors) console.log(`错误：${error}`);
console.log(errors.length === 0 ? `通过（${warnings.length} 条提示）` : `失败：${errors.length} 个错误`);
process.exit(errors.length === 0 ? 0 : 1);
