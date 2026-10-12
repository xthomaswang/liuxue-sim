// 界面文案（docs/22 第 8 节：只选天赋和分点，其余自动模拟、分段输出）。
// 剧情、天赋、成就与结局正文来自 src/content 和引擎的视图；这里只有界面自己的标签与按钮。

import type { OfferTier, Outcome, Points, StatKey, TalentRarity } from "../engine";

export const APP_TITLE = "留学人生模拟器";

export const STAT_ORDER: StatKey[] = ["money", "academics", "career", "wellbeing"];
export const STAT_SHORT: Record<StatKey, string> = {
  money: "资金",
  academics: "学业",
  career: "职业",
  wellbeing: "身心",
};

export const POINT_ORDER: Array<keyof Points> = ["family", "academics", "career", "wellbeing"];
export const POINT_NAME: Record<keyof Points, string> = {
  family: "家境",
  academics: "学业",
  career: "职业",
  wellbeing: "身心",
};

export const TIER_ORDER: OfferTier[] = ["S", "A", "B", "C", "D", "U"];
export const TIER_NAME: Record<OfferTier, string> = {
  S: "S 档",
  A: "A 档",
  B: "B 档",
  C: "C 档",
  D: "D 档",
  U: "未分档",
};

/** 图册里天赋的排列顺序：稀有的在前。 */
export const RARITY_ORDER: TalentRarity[] = ["SSR", "SR", "R", "N"];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  OFFERED: "取得机会",
  NOT_OFFERED: "这次没有取得",
  INELIGIBLE: "准备尚不足",
};

export const SCREEN_TITLE = {
  HOME: APP_TITLE,
  TALENTS: "天赋抽卡",
  ALLOCATE: "分配点数",
  TIMELINE: "人生轨迹",
  SUMMARY: "人生总结",
  GALLERY: "图册",
} as const;

export const S = {
  // 通用
  saved: "已保存",
  unsaved: "当前未保存",
  unsavedHint: "本机存储写不进去。可以继续玩，但关掉页面后进度可能丢失。",
  home: "首页",
  sampleBanner: "样本目录（开发用，非正式学校数据）",
  loading: "正在读取存档…",

  // 首页
  homeLead: "抽三张天赋，分好二十点，剩下的交给这一生自己去过。",
  startRun: "立即重开",
  continueRun: "继续上次",
  viewLast: "上一局的总结",
  galleryOpen: "图册",
  seedLabel: "指定种子",
  seedApply: "用它开局",
  seedInvalid: "请输入 0 到 4294967295 之间的整数。",

  // 天赋
  talentLead: (pick: number) => `十连抽，选 ${pick} 张`,
  talentCount: (chosen: number, pick: number) => `已选 ${chosen} / ${pick}`,
  talentEmpty: "天赋数据暂不可用。",
  inherited: "继承",
  next: "下一步",

  // 分点
  pointsLeft: (left: number) => `剩余点数 ${left}`,
  randomAllocate: "随机分配",
  back: "返回",
  beginLife: "开始人生",
  previewStats: "开局",
  previewAccount: (stipend: number, upkeep: number, readiness: number) =>
    `每学期资助 ${stipend} · 必要开销 ${upkeep} · 申请准备度 ${readiness}`,
  familyPrefix: "家里：",
  aspirationPrefix: "愿望：",
  minus: "−",
  plus: "＋",
  minusLabel: (name: string) => `${name}减一点`,
  plusLabel: (name: string) => `${name}加一点`,

  // 人生轨迹
  timelineEmpty: "点“继续”，看这一生怎么过。",
  revealNext: "继续",
  autoPlay: "自动播放",
  autoPause: "暂停",
  skipToEnd: "直接看结局",
  toSummary: "人生总结",

  // 人生总结
  flavorLead: "后来，人们叫你",
  cardHeading: "结局卡",
  cardDrawLine: (label: string, percent: number, roll: string, success: boolean) =>
    `${label}：概率 ${percent}%，抽签值 ${roll}，${success ? "命中" : "未命中"}`,
  epilogueHeading: "五年后",
  finalStats: "最终",
  schoolPrefix: "学校",
  talentsHeading: "天赋",
  pointsHeading: "点数",
  opportunitiesHeading: "毕业时的机会",
  probability: (percent: number) => `概率 ${percent}%`,
  rewardsHeading: "本局收获",
  rewardsNone: "这一局没有新的成就，也没有解锁新天赋。",
  rewardTalent: (name: string, rarity: string) => `解锁了新天赋：${name}（${rarity}）`,
  inheritHeading: "选一张，下次还能抽到（可不选）",
  inheritChosen: "已选",
  playAgain: "再次重开",
  copySeed: "复制种子",
  copied: "已复制",
  copyFailed: "复制失败，请手动记下",
  seedLine: (seed: number) => `本局种子 ${seed}`,

  // 图册
  galleryProgress: (achievements: string, talents: string, endings: string) =>
    `成就 ${achievements} · 天赋 ${talents} · 结局 ${endings}`,
  galleryJump: "跳到",
  galleryEndings: "结局",
  galleryTiers: "主线等级",
  galleryHidden: "隐藏结局",
  galleryEarly: "中途结局",
  galleryFlavors: "去向结局",
  galleryAchievements: "成就",
  galleryTalents: "天赋",
  galleryLocked: "未解锁",
  galleryUnmet: "未达成",
  galleryUnknown: "？？？",
  galleryCount: (count: number, seed: number) => `${count} 次 · 首次种子 ${seed}`,
  fraction: (got: number, total: number) => `${got} / ${total}`,
  galleryClose: "返回",

  // 问题页
  saveProblemTitle: "存档读不出来",
  saveProblemCorrupt: "这份存档已经损坏，无法确认它对应一局真实走过的历史。",
  saveOutdatedTitle: "游戏更新了",
  saveProblemVersion: "玩法有更新，上一版没看完的那一局不能接着看了。",
  saveOutdatedNote: "回首页重新开一局就行；图册里已有的进度不受影响。",
  saveOutdatedConfirm: "好的，回首页",
  saveProblemNote: "不会用它拼出一局看似正常的进度。丢掉它之后可以重新开一局；图册里的进度不受影响。",
  saveProblemDiscard: "丢掉这份存档",
  catalogProblemTitle: "学校数据暂不可用",
  catalogProblemLead: "每个档次至少要有 3 所学校才能开局。当前各池数量：",
  catalogProblemNote: "这是数据配置问题，不是你的申请结果。",
  fatalTitle: "出了点问题",
  fatalLead: "游戏遇到了没预料到的错误。可以回到首页重新开一局。",
} as const;
