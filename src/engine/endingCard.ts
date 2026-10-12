// 结局卡（docs/14）：主线等级、隐藏结局、完结状态。确认最终去向时算一次并冻结进存档。
// 输入全部取自作出最终选择的那个毕业检查点的冻结快照；不改任何属性或机会。

import { ENDING_CARDS } from "../content";
import {
  CARD, EPILOGUE, FLAG_CREATIVE_WORK, FLAG_MASTERS_REPORT, FLAG_RESEARCH_REPORT, OPPORTUNITY_ORDER,
} from "./constants";
import { draw01 } from "./rng";
import type { ConditionContext } from "./conditions";
import { pickFlavor } from "./early";
import type { EarlyHit } from "./early";
import type {
  ArcId, Degree, EndingCard, EndingStatusId, EndingTierId, EpilogueDraw, FinalRoute, Graduation, HiddenEndingId,
  HistoryEntry, Opportunity, Profile, RuntimeSchool, TransitionMode,
} from "./types";

export interface EndingCardInput {
  seed: number;
  /** 学校（去向结局的条件可能用到所在州与档次）；缺省为没有。 */
  school?: RuntimeSchool | null;
  profile: Profile;
  arcs: { A: ArcId | null; B: ArcId | null };
  history: readonly HistoryEntry[];
  graduations: { UG: Graduation | null; MS: Graduation | null };
  /** 最终选择发生的检查点。 */
  degree: Degree;
  route: FinalRoute;
  transitionMode: TransitionMode | null;
}

const FLAG_REORIENTATION_NEW_DIRECTION = "ARC_REORIENTATION_3_A";

function offeredSet(graduation: Graduation | null): Opportunity[] {
  if (!graduation?.outcomes) return [];
  return OPPORTUNITY_ORDER.filter((opportunity) => graduation.outcomes?.[opportunity] === "OFFERED");
}

export function computeEndingCard(input: EndingCardInput): EndingCard {
  const { seed, profile, route, transitionMode, degree } = input;
  const checkpoint = input.graduations[degree];
  if (!checkpoint?.outcomes) throw new Error("ENDING_CARD_WITHOUT_REVEALED_CHECKPOINT");

  const A = checkpoint.frozenStats.academics;
  const C = checkpoint.frozenStats.career;
  const MONEY = checkpoint.frozenStats.money;
  const WB = checkpoint.frozenStats.wellbeing;
  const counts = checkpoint.frozenFocusCounts;
  const flags = checkpoint.frozenFlags;
  const hasR = flags.includes(FLAG_RESEARCH_REPORT);
  const hasMR = flags.includes(FLAG_MASTERS_REPORT);
  const offered = offeredSet(checkpoint);
  const n = offered.length;
  const allIneligible = OPPORTUNITY_ORDER.every((opportunity) => checkpoint.outcomes?.[opportunity] === "INELIGIBLE");
  const didMasters = degree === "MS";
  const ugOffered = offeredSet(input.graduations.UG);
  const shortfallTerms = input.history.filter((entry) => entry.kind === "UPKEEP" && (entry.upkeep?.shortfall ?? 0) > 0).length;
  const hasCreativeArc = input.arcs.A === "CREATIVE" || input.arcs.B === "CREATIVE";
  const noOffer = route === "TRANSITION" && transitionMode === "NO_OFFER";

  // 公开给玩家的抽签记录：身份抽签只要轮到它就列出（中没中都写）；
  // 隐藏结局的抽签只在命中时列出，没命中的不写，免得提前剧透还没解锁的隐藏结局。
  const draws: EpilogueDraw[] = [];
  const draw = (spec: { key: string; label: string }, percent: number, listWhenMissed: boolean): boolean => {
    const roll = draw01(seed, spec.key);
    const success = roll < percent / 100;
    if (success || listWhenMissed) draws.push({ key: spec.key, label: spec.label, probabilityPercent: percent, roll, success });
    return success;
  };

  // ---------- 主线等级：自上而下取第一个命中的 ----------
  let tier: EndingTierId;
  let phdVariant = false;
  const facts: string[] = [];
  const statusPercent = didMasters ? EPILOGUE.STATUS.percentMS : EPILOGUE.STATUS.percentUG;

  if (route === "PHD" && A >= CARD.EX_ACADEMICS_MIN && counts.STUDY >= CARD.EX_STUDY_MIN && (hasR || hasMR)) {
    tier = "EX";
    facts.push("接受了博士录取", `学业积累 ${A}`, `学习投入 ${counts.STUDY} 次`);
    facts.push(hasR ? "完成过科研支线的研究报告" : "完成了硕士研究报告");
  } else if (profile.economy === "HIGH" && MONEY >= CARD.UR_MONEY_MIN && n >= CARD.UR_OFFERS_MIN) {
    tier = "UR";
    facts.push("家庭资金较宽裕", `毕业时可动用资金 ${MONEY}`, `同时拿到 ${n} 个机会`);
  } else if (route === "LOCAL_JOB") {
    const qualified = C >= CARD.SSR_CAREER_MIN && WB >= CARD.SSR_WELLBEING_MIN;
    // 不满足前置条件时不读取身份抽签的结果。
    const won = qualified && draw(EPILOGUE.STATUS, statusPercent, true);
    facts.push("接受了留美工作", `职业积累 ${C}`, `身心状态 ${WB}`);
    if (won) {
      tier = "SSR";
      facts.push(`身份抽签中签（${statusPercent}%）`);
    } else {
      tier = "SR_PLUS";
      if (qualified) facts.push(`身份抽签未中（${statusPercent}%）`);
      else if (C < CARD.SSR_CAREER_MIN) facts.push(`职业积累未到 ${CARD.SSR_CAREER_MIN}，没有进入身份抽签`);
      else facts.push(`身心状态未到 ${CARD.SSR_WELLBEING_MIN}，没有进入身份抽签`);
    }
  } else if (route === "PHD") {
    tier = "SR_PLUS";
    phdVariant = true;
    facts.push("接受了博士录取", `学业积累 ${A}`, `学习投入 ${counts.STUDY} 次`);
    facts.push(hasR || hasMR ? "手里有完成的研究报告" : "还没有完成的研究报告");
  } else if (route === "HOME_JOB") {
    facts.push("接受了回国工作", `职业积累 ${C}`);
    if (C >= CARD.SR_CAREER_MIN) {
      tier = "SR";
    } else if (WB >= CARD.R_PLUS_WELLBEING_MIN && MONEY >= CARD.R_PLUS_MONEY_MIN) {
      tier = "R_PLUS";
      facts.push(`身心状态 ${WB}`, `可动用资金 ${MONEY}`);
    } else {
      tier = "R";
      facts.push(`身心状态 ${WB}`, `可动用资金 ${MONEY}`);
    }
  } else if (noOffer && (A < CARD.BE_ACADEMICS_BELOW || allIneligible)) {
    tier = "BE";
    facts.push("这一轮没有拿到任何机会");
    if (A < CARD.BE_ACADEMICS_BELOW) facts.push(`学业积累 ${A}，不足 ${CARD.BE_ACADEMICS_BELOW}`);
    if (allIneligible) facts.push("三条路都没有申请资格");
  } else if (
    noOffer &&
    (didMasters || MONEY < CARD.D_MONEY_BELOW || shortfallTerms >= CARD.D_SHORTFALL_TERMS_MIN)
  ) {
    tier = "D";
    facts.push("这一轮没有拿到任何机会");
    if (didMasters) facts.push("读过硕士，开销多了一段");
    if (MONEY < CARD.D_MONEY_BELOW) facts.push(`毕业时可动用资金 ${MONEY}`);
    if (shortfallTerms >= CARD.D_SHORTFALL_TERMS_MIN) facts.push(`有 ${shortfallTerms} 个学期出现过资金短缺`);
  } else {
    tier = "N";
    facts.push(noOffer ? "这一轮没有拿到机会，先进入过渡期" : "手里有机会，但主动进入了过渡期");
  }

  // ---------- 隐藏／特殊结局：命中的全部挂上 ----------
  const hiddenFacts: Partial<Record<HiddenEndingId, string[]>> = {};

  if (counts.CAMPUS >= CARD.H01_CAMPUS_MIN && WB >= CARD.H01_WELLBEING_MIN && draw(EPILOGUE.LOVE, EPILOGUE.LOVE.percent, false)) {
    hiddenFacts.H01 = [`校园生活投入 ${counts.CAMPUS} 次`, `身心状态 ${WB}`, `尾声抽签命中（${EPILOGUE.LOVE.percent}%）`];
  }
  if (offered.includes("LOCAL_JOB") && route === "HOME_JOB") {
    hiddenFacts.H02 = ["手里有留美工作机会", "最后接受了回国工作"];
  }
  if (flags.includes(FLAG_REORIENTATION_NEW_DIRECTION) && route !== "PHD") {
    hiddenFacts.H03 = ["在转向支线的最后写下了新的方向", "最终没有去读博"];
  }
  if (didMasters && (route === "HOME_JOB" || route === "TRANSITION")) {
    hiddenFacts.H04 = ["读过硕士，前后申请了三轮", route === "HOME_JOB" ? "最终回国工作" : "最终进入过渡期"];
  }
  if (flags.includes(FLAG_CREATIVE_WORK) && route !== "PHD") {
    hiddenFacts.H05 = ["在创作支线的最后公开了作品", "最终没有去读博"];
  }
  if (didMasters && ugOffered.length === 0 && route !== "TRANSITION") {
    hiddenFacts.H06 = ["本科毕业时一个机会都没有", "读完硕士后拿到并接受了机会"];
  }
  if (profile.aspiration === "DISCOVERY" && offered.includes("PHD") && (route === "LOCAL_JOB" || route === "HOME_JOB")) {
    hiddenFacts.H07 = ["开局愿望是继续研究", "博士机会到手", "最后接受了工作"];
  }
  if (draw(EPILOGUE.DREAM, EPILOGUE.DREAM.percent, false)) {
    hiddenFacts.H08 = [`尾声抽签命中（${EPILOGUE.DREAM.percent}%）`];
  }
  if (counts.REST >= CARD.H09_REST_MIN && counts.CAMPUS >= CARD.H09_CAMPUS_MIN) {
    hiddenFacts.H09 = [`休息整理 ${counts.REST} 次`, `校园生活 ${counts.CAMPUS} 次`];
  }
  if (hasCreativeArc && route === "TRANSITION" && draw(EPILOGUE.SUBSCRIPTION, EPILOGUE.SUBSCRIPTION.percent, false)) {
    hiddenFacts.H10 = ["走过创作支线", "毕业后进入过渡期", `尾声抽签命中（${EPILOGUE.SUBSCRIPTION.percent}%）`];
  }
  if (MONEY >= CARD.H11_MONEY_MIN && draw(EPILOGUE.SCAM, EPILOGUE.SCAM.percent, false)) {
    hiddenFacts.H11 = [`毕业时可动用资金 ${MONEY}`, `尾声抽签命中（${EPILOGUE.SCAM.percent}%）`];
  }
  const ordinaryTier = tier === "R" || tier === "R_PLUS" || tier === "N";
  const restPlusCampus = counts.REST + counts.CAMPUS;
  if (
    WB >= CARD.H12_WELLBEING_MIN &&
    (transitionMode === "SELF_CHOSEN" || (ordinaryTier && restPlusCampus >= CARD.H12_REST_PLUS_CAMPUS_MIN))
  ) {
    hiddenFacts.H12 =
      transitionMode === "SELF_CHOSEN"
        ? [`身心状态 ${WB}`, "主动放下了手里的机会"]
        : [`身心状态 ${WB}`, `休息与校园生活共 ${restPlusCampus} 次`];
  }

  const hidden = ENDING_CARDS.hidden
    .filter((entry) => hiddenFacts[entry.id] !== undefined)
    .map((entry) => ({ id: entry.id, name: entry.name, roast: entry.roast, facts: hiddenFacts[entry.id] ?? [] }));

  // ---------- 完结状态 ----------
  const happyTiers: EndingTierId[] = ["EX", "UR", "SSR", "SR", "R_PLUS", "R"];
  const status: EndingStatusId = hiddenFacts.H12
    ? "TE"
    : route === "TRANSITION" && transitionMode === "SELF_CHOSEN"
      ? "OPEN"
      : happyTiers.includes(tier)
        ? "HE"
        : "TBC";

  const content = ENDING_CARDS.tiers.find((entry) => entry.id === tier);
  if (!content) throw new Error(`ENDING_CARD_CONTENT_MISSING: ${tier}`);
  const variant = phdVariant && content.phdVariant ? content.phdVariant : content;
  const statusLabel = ENDING_CARDS.status[status];
  const combo = [content.label, ...hidden.filter((entry) => entry.id !== "H12").map((entry) => entry.id), statusLabel].join("＋");

  // 去向结局（docs/22 §5.2）：在等级、隐藏标签都定下来之后再起一个更具体的名字；不改变它们，也不改任何数值。
  const flavorContext: ConditionContext = {
    stage: degree,
    term: degree === "UG" ? 8 : Math.max(1, input.history.filter((entry) => entry.stage === "MS" && entry.kind === "GROWTH").length),
    stats: checkpoint.frozenStats,
    counts,
    points: profile.points,
    flags,
    talents: profile.talents,
    history: input.history,
    school: input.school ?? null,
    aspiration: profile.aspiration,
    transitionMode,
    tier,
  };
  const flavor = pickFlavor(seed, route, flavorContext);

  return {
    early: null,
    flavor: flavor ? { id: flavor.id, name: flavor.name, roast: flavor.roast, text: flavor.text } : null,
    tier,
    tierLabel: content.label,
    tierKind: content.kind,
    name: variant.name,
    roast: variant.roast,
    facts,
    hidden,
    status,
    statusLabel,
    combo,
    draws,
  };
}

/**
 * 中途结局的卡片（docs/22 第 4 节）：等级与完结状态取内容表，沿用该档的标签与类别，
 * 名称与吐槽用中途结局自己的；没有隐藏标签；组合写法照旧。
 */
export function earlyEndingCard(hit: EarlyHit): EndingCard {
  const content = ENDING_CARDS.tiers.find((entry) => entry.id === hit.ending.tier);
  if (!content) throw new Error(`ENDING_CARD_CONTENT_MISSING: ${hit.ending.tier}`);
  const statusLabel = ENDING_CARDS.status[hit.ending.status];
  if (!statusLabel) throw new Error(`ENDING_CARD_STATUS_MISSING: ${hit.ending.status}`);
  return {
    early: hit.ending.id,
    flavor: null,
    tier: hit.ending.tier,
    tierLabel: content.label,
    tierKind: content.kind,
    name: hit.ending.name,
    roast: hit.ending.roast,
    facts: [...hit.facts],
    hidden: [],
    status: hit.ending.status,
    statusLabel,
    combo: [content.label, statusLabel].join("＋"),
    draws: hit.draws.map((draw) => ({ ...draw })),
  };
}
