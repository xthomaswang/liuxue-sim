// 纯展示用的小工具：把引擎给的数值排成文字，不做任何规则判断。

import type { RuntimeSchool, Stats } from "../engine";
import { STAT_ORDER, STAT_SHORT, TIER_NAME } from "./strings";

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** 一行里实际发生的四属性变化，如 “学业+8 身心-4”；没有变化返回空串。 */
export function deltaText(delta: Stats | null): string {
  if (!delta) return "";
  return STAT_ORDER.filter((key) => delta[key] !== 0)
    .map((key) => `${STAT_SHORT[key]}${signed(delta[key])}`)
    .join(" ");
}

export function rollText(roll: number): string {
  return roll.toFixed(4);
}

/** 如 “卡内基梅隆大学（S 档）”；没有中文名时用英文名。 */
export function schoolText(school: RuntimeSchool): string {
  return `${school.nameZh ?? school.name}（${TIER_NAME[school.tier]}）`;
}
