// 纯展示用的小工具：把引擎给的数值排成文字，不做任何规则判断。

import type { Delta, RuntimeSchool, StatKey, Stats, TermLedger, TierOdds } from "../engine";
import { RANK_CATEGORY_NAME, S, STAT_ORDER, TIER_BASIS_NOTE, TIER_NAME } from "./strings";

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export interface DeltaItem {
  key: StatKey;
  applied: number;
  requested: number;
  clipped: boolean;
}

/** 只列出名义或实际有变化的属性。 */
export function deltaItems(delta: Delta): DeltaItem[] {
  return STAT_ORDER.filter((key) => delta.requested[key] !== 0 || delta.applied[key] !== 0).map((key) => ({
    key,
    applied: delta.applied[key],
    requested: delta.requested[key],
    clipped: delta.applied[key] !== delta.requested[key],
  }));
}

export function asDelta(requested: Stats, applied: Stats): Delta {
  return { requested, applied };
}

/** 把上学期的必要开销、短缺压力与基础成长合成一行。 */
export function settlementDelta(ledger: TermLedger): Delta {
  const zero = (): Stats => ({ money: 0, academics: 0, career: 0, wellbeing: 0 });
  const total: Delta = { requested: zero(), applied: zero() };
  for (const line of ledger.lines) {
    if (line.kind !== "UPKEEP" && line.kind !== "GROWTH") continue;
    for (const key of STAT_ORDER) {
      total.requested[key] += line.delta.requested[key];
      total.applied[key] += line.delta.applied[key];
    }
  }
  return total;
}

/** 如 “S 档 约 17.6%”“未分档 约 10.0%”“D 档 0%”。 */
export function oddsText(odds: TierOdds): string {
  const approximate = /^\d/.test(odds.label) && odds.label !== "0%";
  return `${TIER_NAME[odds.tier]} ${approximate ? `${S.about} ` : ""}${odds.label}`;
}

export function rollText(roll: number): string {
  return roll.toFixed(4);
}

export function schoolTitle(school: RuntimeSchool): string {
  return school.nameZh ?? school.name;
}

export function schoolPlace(school: RuntimeSchool): string {
  return `${school.city}, ${school.state}`;
}

/** 学校分档依据的一行小字。 */
export function tierBasisText(school: RuntimeSchool): string {
  const basis = TIER_BASIS_NOTE[school.tierBasis];
  if (school.tierBasis !== "VERIFIED_2027" || !school.rank) return basis;
  const { rankMin, rankMax, tied, category } = school.rank;
  const rank = `${rankMin === rankMax ? `#${rankMin}` : `#${rankMin}–${rankMax}`}${tied ? " 并列" : ""}`;
  return S.rankLine(basis, rank, RANK_CATEGORY_NAME[category] ?? category);
}
