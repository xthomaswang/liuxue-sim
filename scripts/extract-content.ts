// 从 docs/*.md 提取游戏内容，生成 src/content 下的静态 JSON。
// 文案不手工重打：事件来自 04/05/10/12 各自唯一的 json 代码块，开局与结局文案来自 02/03/05/07 的表格与固定段落。
// 运行：node scripts/extract-content.ts   （游戏运行时只读生成的 JSON，不解析 Markdown）

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Row = string[];
interface Table {
  header: Row;
  rows: Row[];
}

const STAT_KEYS = ["money", "academics", "career", "wellbeing"] as const;

function readDoc(root: string, name: string): string {
  return readFileSync(join(root, "docs", name), "utf8");
}

function clean(cell: string): string {
  return cell.replace(/`/g, "").replace(/\*\*/g, "").trim();
}

function splitRow(line: string): Row {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.slice(1, -1).map(clean);
}

function parseTables(markdown: string): Table[] {
  const lines = markdown.split("\n");
  const tables: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = lines[i + 1]?.trim() ?? "";
    if (line.startsWith("|") && /^\|[\s:|-]+\|$/.test(next)) {
      const header = splitRow(line);
      const rows: Row[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitRow(lines[j].trim()));
        j++;
      }
      tables.push({ header, rows });
      i = j - 1;
    }
  }
  return tables;
}

function findTable(markdown: string, header: string[], doc: string): Table {
  const matches = parseTables(markdown).filter(
    (t) => t.header.length === header.length && t.header.every((cell, index) => cell === header[index]),
  );
  if (matches.length !== 1) {
    throw new Error(`${doc}: 期望恰好一张表头为 [${header.join(" | ")}] 的表，实际 ${matches.length} 张`);
  }
  return matches[0];
}

function must(match: RegExpExecArray | null, what: string): RegExpExecArray {
  if (!match) throw new Error(`未在文档中找到：${what}`);
  return match;
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of keys) {
    if (record[key] === undefined || record[key] === "") throw new Error(`${what} 缺少 ${key}`);
  }
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (extra.length > 0) throw new Error(`${what} 出现未预期的键：${extra.join(", ")}`);
}

// ---------- 事件 ----------

interface RawChoice {
  id: string;
  label: string;
  effects: Record<string, number>;
  setFlags: string[];
  shortResult: string;
  result: string;
}
interface RawEvent {
  id: string;
  kind: string;
  stage?: number;
  arc?: string;
  beat?: number;
  node?: number;
  title: string;
  summary: string;
  body: string;
  callbacks: Array<{ ifFlag: string; text: string; shortText: string }>;
  choices: RawChoice[];
}

function extractEvents(markdown: string, doc: string): RawEvent[] {
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw new Error(`${doc}: 期望恰好一个 json 代码块，实际 ${blocks.length} 个`);
  return JSON.parse(blocks[0][1]) as RawEvent[];
}

function normalizeEvent(event: RawEvent): RawEvent {
  // 固定键顺序，生成文件稳定可比对。
  const base = { id: event.id, kind: event.kind } as Record<string, unknown>;
  for (const key of ["stage", "arc", "beat", "node"] as const) {
    if (event[key] !== undefined) base[key] = event[key];
  }
  return {
    ...(base as { id: string; kind: string }),
    title: event.title,
    summary: event.summary,
    body: event.body,
    callbacks: event.callbacks.map((cb) => ({ ifFlag: cb.ifFlag, shortText: cb.shortText, text: cb.text })),
    choices: event.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      effects: Object.fromEntries(STAT_KEYS.map((key) => [key, choice.effects[key]])),
      setFlags: [...choice.setFlags],
      shortResult: choice.shortResult,
      result: choice.result,
    })),
  };
}

function validateEvents(all: RawEvent[]): void {
  const byId = new Map<string, RawEvent>();
  for (const event of all) {
    if (byId.has(event.id)) throw new Error(`事件 ID 重复：${event.id}`);
    byId.set(event.id, event);
  }
  if (all.length !== 32) throw new Error(`期望 32 个事件，实际 ${all.length}`);
  const flags = new Set<string>();
  for (const event of all) {
    if (!event.title || !event.summary || !event.body) throw new Error(`${event.id} 缺少 title/summary/body`);
    if (event.choices.map((c) => c.id).join(",") !== "A,B") throw new Error(`${event.id} 的选项必须是 A、B`);
    if (!event.choices.some((c) => c.effects.money >= 0)) throw new Error(`${event.id} 没有不花钱的选项`);
    for (const choice of event.choices) {
      const keys = Object.keys(choice.effects).sort().join(",");
      if (keys !== [...STAT_KEYS].sort().join(",")) throw new Error(`${event.id}_${choice.id} effects 键不完整`);
      const values = Object.values(choice.effects);
      if (!values.every((v) => Number.isInteger(v) && Math.abs(v) <= 8)) throw new Error(`${event.id}_${choice.id} 单项超界`);
      if (values.reduce((sum, v) => sum + Math.abs(v), 0) > 16) throw new Error(`${event.id}_${choice.id} 总量超界`);
      const flag = `${event.id}_${choice.id}`;
      if (choice.setFlags.length !== 1 || choice.setFlags[0] !== flag) throw new Error(`${flag} 的 setFlags 不合约定`);
      if (!choice.label || !choice.shortResult || !choice.result) throw new Error(`${flag} 缺少文案`);
      flags.add(flag);
    }
  }
  if (flags.size !== 64) throw new Error(`期望 64 个标记，实际 ${flags.size}`);
  for (const event of all) {
    for (const cb of event.callbacks) {
      if (!flags.has(cb.ifFlag) || !cb.text || !cb.shortText) throw new Error(`${event.id} 的回响无效：${cb.ifFlag}`);
      const previous = byId.get(cb.ifFlag.replace(/_[AB]$/, ""));
      if (!previous) throw new Error(`${event.id} 的回响指向未知事件`);
      const ok =
        event.kind === "arc"
          ? previous.arc === event.arc && (previous.beat ?? 9) < (event.beat ?? 0)
          : event.kind === "core"
            ? previous.kind === "core" && (previous.stage ?? 9) < (event.stage ?? 0)
            : event.kind === "masters"
              ? previous.kind === "core" || (previous.kind === "masters" && (previous.node ?? 9) < (event.node ?? 0))
              : previous.kind === "highschool" && (previous.node ?? 9) < (event.node ?? 0);
      if (!ok) throw new Error(`${event.id} 的回响 ${cb.ifFlag} 不在允许的先前事件范围内`);
    }
  }
  const text = JSON.stringify(all);
  const variables = text.match(/\{\{[^}]*\}\}/g);
  if (variables) throw new Error(`事件数据出现模板变量，当前实现未处理：${variables.join(", ")}`);
}

// ---------- 开局、数值名称与结局文案 ----------

function extractTexts(root: string): Json {
  const d02 = readDoc(root, "02_WORLD_AND_STARTS.md");
  const d03 = readDoc(root, "03_SYSTEMS_AND_PROBABILITIES.md");
  const d05 = readDoc(root, "05_BRANCH_STORIES.md");
  const d07 = readDoc(root, "07_ENDINGS.md");

  const economy: Record<string, Record<string, string>> = {};
  const expectation: Record<string, Record<string, string>> = {};
  for (const [kind, id, text] of findTable(d02, ["类别", "ID", "默认短文片段"], "02").rows) {
    const target = kind === "经济" ? economy : kind === "期待" ? expectation : null;
    if (!target) throw new Error(`02 卡片短文出现未知类别：${kind}`);
    target[id] = { cardText: text };
  }
  for (const [id, cardName, detail] of findTable(d02, ["ID", "卡片名称", "可直接使用的开局文案", "叙事边界"], "02").rows) {
    Object.assign(economy[id], { cardName, detail });
  }
  for (const [id, cardName, detail, hopes] of findTable(
    d02,
    ["ID", "卡片名称", "可直接使用的开局文案", "家人的希望与担心"],
    "02",
  ).rows) {
    Object.assign(expectation[id], { cardName, detail, hopes });
  }
  for (const [id, shortName] of findTable(
    d03,
    ["economy", "展示名称", "初始 money", "每学期资助", "初始 academics", "初始 career", "初始 wellbeing"],
    "03",
  ).rows) {
    Object.assign(economy[id], { shortName });
  }

  const trait: Record<string, Record<string, string>> = {};
  const traitLine = must(/六个 ID 与中文显示名固定为：([^\n]+)/.exec(d02), "02 特质显示名")[1];
  for (const match of traitLine.matchAll(/`([A-Z]+)`\s*([^、。`]+)/g)) trait[match[1]] = { name: match[2].trim() };
  for (const [id, tagline] of findTable(d03, ["trait", "名称", "完整规则效果"], "03").rows) {
    if (!trait[id]) throw new Error(`03 特质 ${id} 在 02 中没有显示名`);
    trait[id].tagline = tagline;
  }

  const aspiration: Record<string, Record<string, string>> = {};
  for (const [id, choice, response] of findTable(d02, ["ID", "选择文字", "开局回应"], "02").rows) {
    aspiration[id] = { choice, response };
  }

  const stat: Record<string, Record<string, string>> = {};
  for (const [id, name, meaning] of findTable(d03, ["ID", "展示名称", "含义"], "03").rows) stat[id] = { name, meaning };

  const focus: Record<string, Record<string, string>> = {};
  for (const [id, name] of findTable(d03, ["focus", "名称", "money", "academics", "career", "wellbeing"], "03").rows) {
    focus[id] = { name };
  }

  const efficiency: Record<string, string> = {};
  for (const [, multiplier, note] of findTable(d03, ["wellbeing", "乘数", "UI 说明"], "03").rows) {
    efficiency[String(Math.round(Number(multiplier) * 10))] = note;
  }

  const mastersProgram: Record<string, Record<string, string>> = {};
  for (const [id, name] of findTable(d03, ["方案 ID", "展示", "学期数 n", "一次性入学费用 fee", "主线事件顺序"], "03").rows) {
    mastersProgram[id] = { name };
  }

  const quotes = [...d02.matchAll(/^> (.+)$/gm)].map((m) => m[1].trim());
  if (quotes.length !== 2) throw new Error(`02 期望两段引用旁白，实际 ${quotes.length}`);
  const narration = {
    highSchoolShort: must(/高中开局默认短文：“([^”]+)”/.exec(d02), "02 高中开局默认短文")[1],
    highSchoolLong: quotes[0],
    enrollmentShort: must(/默认入学短文：“([^”]+)”/.exec(d02), "02 默认入学短文")[1],
    enrollmentLong: quotes[1],
  };

  const arcRecap: Record<string, string> = {};
  for (const [flag, sentence] of findTable(d05, ["完成标记", "回顾短句"], "05").rows) arcRecap[flag] = sentence;

  // --- 07 结局 ---
  const routeKey = (raw: string): string => raw.replace(/\s*\/\s*/g, "/").replace("任一入口", "ANY");
  const short: Record<string, string> = {};
  for (const [key, text] of findTable(d07, ["route / mode", "shortText"], "07").rows) short[routeKey(key)] = text;

  const stateShort: Record<string, string> = {};
  for (const match of d07.matchAll(/(DRAINED|STRETCHED|STEADY|NARROW|LIMITED|BUFFERED) 为“([^”]+)”/g)) {
    stateShort[match[1]] = match[2];
  }

  const section3 = must(/## 3\. [^\n]*\n([\s\S]*?)\n## 4\. /.exec(d07), "07 第 3 节")[1];
  const route: Record<string, { title: string; body: string }> = {};
  for (const part of section3.split(/^### /m).slice(1)) {
    const [heading, ...rest] = part.split("\n");
    const paragraphs = rest.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const title = must(/^\*\*标题：(.+?)\*\*$/.exec(paragraphs[0] ?? ""), `07 ${heading} 的标题`)[1];
    if (!paragraphs[1]) throw new Error(`07 ${heading} 缺少正文`);
    route[routeKey(heading.trim())] = { title, body: paragraphs[1] };
  }

  const bridge: Record<string, string> = {};
  for (const [key, text] of findTable(d07, ["educationPath", "必须显示的文字"], "07").rows) bridge[key] = text;

  const wellbeingState: Record<string, string> = {};
  for (const [, id, text] of findTable(d07, ["wellbeing", "状态 ID", "完整文案"], "07").rows) wellbeingState[id] = text;
  const moneyState: Record<string, string> = {};
  for (const [, id, text] of findTable(d07, ["money", "状态 ID", "完整文案"], "07").rows) moneyState[id] = text;

  const aspirationResponse: Record<string, Record<string, string>> = {};
  for (const [asp, routeId, text] of findTable(d07, ["aspiration", "route", "文案"], "07").rows) {
    (aspirationResponse[asp] ??= {})[routeId] = text;
  }
  const familyResponse: Record<string, Record<string, string>> = {};
  for (const [exp, group, text] of findTable(d07, ["expectation", "路线组", "文案"], "07").rows) {
    (familyResponse[exp] ??= {})[group] = text;
  }
  const epilogue: Record<string, string> = {};
  for (const [key, text] of findTable(d07, ["变体", "后记"], "07").rows) epilogue[routeKey(key)] = text;

  // --- 完整性检查 ---
  const ECON = ["LOW", "MID", "HIGH"];
  const EXPECT = ["ACADEMIC", "STABILITY", "AUTONOMY"];
  const TRAITS = ["FOCUSED", "PRACTICAL", "OUTGOING", "FRUGAL", "RESILIENT", "REFLECTIVE"];
  const ASPS = ["DISCOVERY", "INDEPENDENCE", "BELONGING"];
  const ROUTES6 = ["PHD/undergrad_direct", "PHD/masters_entry", "LOCAL_JOB", "HOME_JOB", "TRANSITION/SELF_CHOSEN", "TRANSITION/NO_OFFER"];
  requireKeys(economy, ECON, "economy");
  for (const id of ECON) requireKeys(economy[id], ["cardText", "cardName", "detail", "shortName"], `economy.${id}`);
  requireKeys(expectation, EXPECT, "expectation");
  for (const id of EXPECT) requireKeys(expectation[id], ["cardText", "cardName", "detail", "hopes"], `expectation.${id}`);
  requireKeys(trait, TRAITS, "trait");
  for (const id of TRAITS) requireKeys(trait[id], ["name", "tagline"], `trait.${id}`);
  requireKeys(aspiration, ASPS, "aspiration");
  requireKeys(stat, [...STAT_KEYS], "stat");
  requireKeys(focus, ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"], "focus");
  requireKeys(efficiency, ["10", "8", "6"], "efficiency");
  requireKeys(mastersProgram, ["MS_1Y", "MS_2Y"], "mastersProgram");
  requireKeys(short, ["PHD/ANY", "LOCAL_JOB", "HOME_JOB", "TRANSITION/SELF_CHOSEN", "TRANSITION/NO_OFFER"], "ending.short");
  requireKeys(stateShort, ["DRAINED", "STRETCHED", "STEADY", "NARROW", "LIMITED", "BUFFERED"], "ending.stateShort");
  requireKeys(route, ROUTES6, "ending.route");
  requireKeys(bridge, ["UG", "MS_1Y", "MS_2Y"], "ending.bridge");
  requireKeys(wellbeingState, ["DRAINED", "STRETCHED", "STEADY"], "ending.wellbeingState");
  requireKeys(moneyState, ["NARROW", "LIMITED", "BUFFERED"], "ending.moneyState");
  requireKeys(aspirationResponse, ASPS, "ending.aspirationResponse");
  for (const id of ASPS) requireKeys(aspirationResponse[id], ["PHD", "LOCAL_JOB", "HOME_JOB", "TRANSITION"], `aspirationResponse.${id}`);
  requireKeys(familyResponse, EXPECT, "ending.familyResponse");
  for (const id of EXPECT) requireKeys(familyResponse[id], ["RESEARCH", "WORK", "PAUSE"], `familyResponse.${id}`);
  requireKeys(epilogue, ROUTES6, "ending.epilogue");
  const recapFlags = ["RESEARCH", "INTERNSHIP", "FRIENDSHIP", "FAMILY", "REORIENTATION", "CREATIVE"].flatMap((arc) => [
    `ARC_${arc}_3_A`,
    `ARC_${arc}_3_B`,
  ]);
  requireKeys(arcRecap, recapFlags, "arcRecap");

  return {
    economy,
    expectation,
    trait,
    aspiration,
    stat,
    focus,
    efficiency,
    mastersProgram,
    narration,
    arcRecap,
    ending: { short, stateShort, route, bridge, wellbeingState, moneyState, aspirationResponse, familyResponse, epilogue },
  };
}

// ---------- 入口 ----------

export interface BuiltContent {
  files: Record<string, string>;
}

export function buildContent(root: string): BuiltContent {
  const sources: Array<[string, string, string]> = [
    ["highschool", "12_HIGH_SCHOOL_STORY.md", "highschool"],
    ["core", "04_MAIN_STORY.md", "core"],
    ["arcs", "05_BRANCH_STORIES.md", "arc"],
    ["masters", "10_MASTERS_STORY.md", "masters"],
  ];
  const files: Record<string, string> = {};
  const all: RawEvent[] = [];
  for (const [name, doc, kind] of sources) {
    const events = extractEvents(readDoc(root, doc), doc).map(normalizeEvent);
    if (!events.every((event) => event.kind === kind)) throw new Error(`${doc} 中出现 kind 不是 ${kind} 的事件`);
    all.push(...events);
    files[`src/content/events/${name}.json`] = `${JSON.stringify(events, null, 2)}\n`;
  }
  validateEvents(all);
  files["src/content/texts.json"] = `${JSON.stringify(extractTexts(root), null, 2)}\n`;
  return { files };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { files } = buildContent(root);
  for (const [relative, text] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    console.log(`写入 ${relative}（${text.length} 字符）`);
  }
}
