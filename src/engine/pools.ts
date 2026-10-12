// 引擎读取内容池的唯一入口（docs/17–21 生成的天赋、学期安排、变体事件、随机事件、突发小事）。
// 经典模式需要的六张特质天赋与五张基础安排在这里有内置定义（数值即 docs/03 第 2.3 节与第 3 节），
// 内容池里有同 id 的条目时用池里的；这样经典模式的数值不依赖内容池是否已经写好。

import { CORE_EVENTS, CORE_VARIANTS, HAPPENINGS, PLANS, RANDOM_EVENTS, TALENTS, TEXTS } from "../content";
import { CLASSIC_TALENT_IDS, FOCUS_BASE, FOCUS_ORDER } from "./constants";
import type { Focus, Happening, PlanCard, StoryEvent, Talent, TalentEffects, Trait } from "./types";

const CLASSIC_TRAITS: Readonly<Record<string, Trait>> = {
  T_FOCUSED: "FOCUSED",
  T_PRACTICAL: "PRACTICAL",
  T_OUTGOING: "OUTGOING",
  T_FRUGAL: "FRUGAL",
  T_RESILIENT: "RESILIENT",
  T_REFLECTIVE: "REFLECTIVE",
};

/** 第一版六种特质的效果（03 §2.3；支线权重见 06 §3）。 */
export const CLASSIC_TALENT_EFFECTS: Readonly<Record<string, TalentEffects>> = {
  T_FOCUSED: { focus: { STUDY: { academics: 2 } } },
  T_PRACTICAL: { focus: { CAREER: { career: 2 } } },
  T_OUTGOING: { focus: { CAMPUS: { career: 2 } }, arcWeight: { FRIENDSHIP: 2 } },
  T_FRUGAL: { upkeep: -1 },
  T_RESILIENT: { focusWellbeingRelief: 2 },
  T_REFLECTIVE: { focus: { REST: { academics: 1, wellbeing: 3 } }, arcWeight: { CREATIVE: 1 } },
};

function builtinTalent(id: string): Talent | undefined {
  const trait = CLASSIC_TRAITS[id];
  if (!trait) return undefined;
  return { id, name: TEXTS.trait[trait].name, rarity: "N", text: TEXTS.trait[trait].tagline, effects: CLASSIC_TALENT_EFFECTS[id] };
}

export function talentPool(): readonly Talent[] {
  return TALENTS;
}

export function findTalent(id: string): Talent | undefined {
  return TALENTS.find((talent) => talent.id === id) ?? builtinTalent(id);
}

/** 经典模式可选的六张特质天赋，固定顺序。 */
export function classicTalents(): Talent[] {
  return CLASSIC_TALENT_IDS.map((id) => {
    const talent = findTalent(id);
    if (!talent) throw new Error(`CLASSIC_TALENT_MISSING: ${id}`);
    return talent;
  });
}

/** 天赋在池内的位置，用来把选中的天赋按池内顺序存放；内置的特质天赋排在池内条目之后。 */
export function talentOrder(id: string): number {
  const index = TALENTS.findIndex((talent) => talent.id === id);
  return index >= 0 ? index : TALENTS.length + CLASSIC_TALENT_IDS.indexOf(id);
}

export function planPool(): readonly PlanCard[] {
  return PLANS;
}

/** 五张基础安排：id 就是类别名，向量与 03 §3 的表相同。 */
export function basePlan(focus: Focus): PlanCard {
  return (
    PLANS.find((plan) => plan.id === focus) ?? { id: focus, focus, name: TEXTS.focus[focus].name, base: true, delta: { ...FOCUS_BASE[focus] } }
  );
}

export function basePlans(): PlanCard[] {
  return FOCUS_ORDER.map(basePlan);
}

export function findPlan(id: string): PlanCard | undefined {
  return PLANS.find((plan) => plan.id === id) ?? ((FOCUS_ORDER as readonly string[]).includes(id) ? basePlan(id as Focus) : undefined);
}

export function happeningPool(): readonly Happening[] {
  return HAPPENINGS;
}

export function findHappening(id: string): Happening | undefined {
  return HAPPENINGS.find((item) => item.id === id);
}

export function randomEventPool(): readonly StoryEvent[] {
  return RANDOM_EVENTS;
}

/** 某个主线节点的候选：原来的 CORE_0n 加上同一节点的变体，按 id 排序。 */
export function nodeCandidates(term: number): StoryEvent[] {
  return [...CORE_EVENTS, ...CORE_VARIANTS]
    .filter((event) => event.kind === "core" && event.stage === term)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
