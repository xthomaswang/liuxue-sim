// 引擎输出给界面的固定中文叫法与小工具。文案长段落都在 src/content，这里只有短标签。

import { ARC_NAMES } from "../content";
import { UG_TERM_NAMES } from "./constants";
import type { Degree, FinalRoute, Focus, Opportunity, RuntimeSchool, Stage, StoryEvent } from "./types";

export const OPPORTUNITY_NAMES: Readonly<Record<Opportunity, string>> = {
  PHD: "博士项目",
  LOCAL_JOB: "留美工作",
  HOME_JOB: "回国工作",
};

export const ROUTE_NAMES: Readonly<Record<FinalRoute, string>> = { ...OPPORTUNITY_NAMES, TRANSITION: "过渡期" };

/** 人生回顾里投入概览的叫法（docs/07 §8）。 */
export const FOCUS_SUMMARY_NAMES: Readonly<Record<Focus, string>> = {
  STUDY: "学习",
  CAREER: "职业准备",
  CAMPUS: "校园生活",
  WORK: "校内兼职",
  REST: "休息整理",
};

export const FOCUS_OUTCOME_SENTENCES: Readonly<Record<Focus, string>> = {
  STUDY: "你把这学期的时间留给了学习。",
  CAREER: "你把这学期的时间用来为工作做准备。",
  CAMPUS: "你把这学期的时间放进了校园生活。",
  WORK: "你这学期在校内兼职，补贴了一部分开销。",
  REST: "你给这学期留出了休息和整理的时间。",
};

export const DEGREE_NAMES: Readonly<Record<Degree, string>> = { UG: "本科", MS: "硕士" };

export function schoolDisplayName(school: RuntimeSchool): string {
  return school.nameZh ?? school.name;
}

/** 某个学段某一学期的标题，如 “本科 · 一年级秋”“硕士 · 第 2 学期”“高中”。 */
export function termTitle(stage: Stage, termIndex: number): string {
  if (stage === "HS") return "高中";
  if (stage === "UG") return `本科 · ${UG_TERM_NAMES[termIndex - 1] ?? `第 ${termIndex} 学期`}`;
  return `硕士 · 第 ${termIndex} 学期`;
}

export function eventKindLabel(event: StoryEvent): string {
  switch (event.kind) {
    case "highschool":
      return "高中";
    case "core":
      return "主线";
    case "arc":
      return `支线 · ${ARC_NAMES[event.arc]} 第 ${event.beat} 幕`;
    case "masters":
      return "硕士";
  }
}

/** 超过 max 个 Unicode 码点时截取并加省略号。 */
export function truncateCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max).join("")}…` : text;
}

/** 只允许 {{school.name}}、{{school.city}}、{{player.name}} 三个变量；未知变量视为内容错误。纯字符串替换。 */
export function renderTemplate(template: string, school: RuntimeSchool | null, playerName: string): string {
  return template.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_whole, name: string) => {
    if (name === "school.name") {
      if (!school) throw new Error("TEMPLATE_WITHOUT_SCHOOL: 选校之前不能使用学校变量");
      return schoolDisplayName(school);
    }
    if (name === "school.city") {
      if (!school) throw new Error("TEMPLATE_WITHOUT_SCHOOL: 选校之前不能使用学校变量");
      return school.city.trim() === "" ? "这座城市" : school.city;
    }
    if (name === "player.name") return playerName.trim() === "" ? "你" : playerName;
    throw new Error(`UNKNOWN_TEMPLATE_VARIABLE: ${name}`);
  });
}

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const FULLWIDTH_PUNCTUATION = "\\u3000-\\u303F\\uFF00-\\uFFEF";
const CJK_GAP = new RegExp(`([${CJK}${FULLWIDTH_PUNCTUATION}])[ \\t]+(?=[${CJK}])`, "gu");

/**
 * 模板是按英文校名写的（“来到 {{school.name}}。”），换成中文名后会多出空格。
 * 这里只去掉“中日韩文字或全角标点”与“中日韩文字”之间的空白；英文校名、英文城市与数字两侧的空格保持原样。
 */
export function tidyCjkSpacing(text: string): string {
  return text.replace(CJK_GAP, "$1");
}
