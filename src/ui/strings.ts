// 界面文案（docs/16 第 6 节：上面一小段描述，下面是选项，一律短）。
// 剧情、出身、天赋与结局正文来自 src/content；这里只有界面自己的标签、按钮与一句话说明。

import type { Focus, OfferTier, Outcome, StatKey, Strategy, TierBasis } from "../engine";

export const APP_TITLE = "留学人生模拟器";

export const STAT_ORDER: StatKey[] = ["money", "academics", "career", "wellbeing"];
export const STAT_SHORT: Record<StatKey, string> = {
  money: "资金",
  academics: "学业",
  career: "职业",
  wellbeing: "身心",
};

/** 安排所属的类别；毕业资格按类别累计次数。 */
export const FOCUS_SHORT: Record<Focus, string> = {
  STUDY: "学习",
  CAREER: "职业准备",
  CAMPUS: "校园生活",
  WORK: "校内兼职",
  REST: "休息整理",
};

export const STRATEGY_NAME: Record<Strategy, string> = { REACH: "冲刺", STEADY: "稳健" };

export const TIER_ORDER: OfferTier[] = ["S", "A", "B", "C", "D", "U"];
export const TIER_NAME: Record<OfferTier, string> = {
  S: "S 档",
  A: "A 档",
  B: "B 档",
  C: "C 档",
  D: "D 档",
  U: "未分档",
};

export const TIER_BASIS_NOTE: Record<TierBasis, string> = {
  VERIFIED_2027: "2027 版已核实名次",
  APPROXIMATE: "按近年榜单的大致区间分档",
  UNRANKED_SPECIAL: "专门院校，未分档",
};

export const RANK_CATEGORY_NAME: Record<string, string> = {
  NU: "全国综合大学",
  LAC: "全国文理学院",
  RU_NORTH: "北部地区性大学",
  RU_SOUTH: "南部地区性大学",
  RU_MIDWEST: "中西部地区性大学",
  RU_WEST: "西部地区性大学",
  RC_NORTH: "北部地区性学院",
  RC_SOUTH: "南部地区性学院",
  RC_MIDWEST: "中西部地区性学院",
  RC_WEST: "西部地区性学院",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  OFFERED: "取得机会",
  NOT_OFFERED: "这次没有取得",
  INELIGIBLE: "准备尚不足",
};

export const S = {
  // 顶栏与通用
  saved: "已保存",
  unsaved: "当前未保存",
  unsavedHint: "本机存储写不进去。可以继续玩，但关掉页面后这一步可能丢失。",
  restart: "重新开始",
  reroll: "换一批",
  restartConfirmText: "放弃这一局并重新开始？",
  restartConfirmYes: "放弃并重开",
  restartConfirmNo: "继续这一局",
  sampleBanner: "样本目录（开发用，非正式学校数据）",
  loading: "正在读取存档…",
  clippedHigh: "已到上限",
  clippedLow: "已到下限",
  rejectedPrefix: "这一步没有生效：",
  insufficient: (need: number, have: number) => `资金不足：需要 ${need}，当前 ${have}`,
  shortfallWarning: (shortfall: number) => `选它期末会短缺 ${shortfall}`,

  // 状态行
  statusLast: "上一步",
  statusSettlement: "上学期结算",
  statusFinalSettlement: "最后一学期结算",
  settlementShortfall: (shortfall: number, stress: number) => `资金短缺 ${shortfall}，身心多扣 ${stress}。`,
  statusTerm: "本学期",
  stipendLine: (requested: number, applied: number) =>
    applied === requested ? `资助 +${requested}` : `资助 +${requested}（资金已到上限，到账 +${applied}）`,
  upkeepDue: (upkeep: number) => `期末必要开销 ${upkeep}`,
  statusHappening: "突发",
  statusEfficiency: "状态",

  // 开局
  originEyebrow: "你的出身 · 抽出来的，不能选",
  aspirationPrefix: "你的愿望：",
  originAccount: (stipend: number, upkeep: number) => `本科起每学期资助 ${stipend}，必要开销 ${upkeep}`,
  readinessLabel: (value: number) => `申请准备度 ${value}`,
  talentHeading: (pick: number) => `十连抽天赋，选 ${pick} 张`,
  talentCount: (chosen: number, pick: number) => `已选 ${chosen} / ${pick}`,
  talentEmpty: "天赋数据暂不可用。",
  start: "开始",
  seedLabel: "指定种子",
  seedApply: "用这个种子开局",
  seedInvalid: "请输入 0 到 4294967295 之间的整数。",
  galleryOpen: "留学人生图鉴",

  // 事件
  readinessBonus: (bonus: number) => `申请准备 +${bonus}`,
  about: "约",

  // 申请结果
  admissionLine: (readiness: number, base: number, talent: number, hs: number, strategy: string, tier: string) =>
    `申请准备度 ${readiness} = 基础 ${base} + 天赋 ${talent} + 高中准备 ${hs} · ${strategy}方案 · 抽中 ${tier}`,
  tierUNote: "“未分档”不是最低档，只是不在综合排名的分档里。",
  offersHeading: "三所同档学校发来 offer，选一所",
  offersNote: "学校只是背景，不改变之后的数值与机会。",
  rankLine: (basis: string, rank: string, category: string) => `${basis} ${rank}（${category}）`,

  // 选安排
  planHeading: "这学期把时间放在哪？",
  talentTag: "含天赋加成",
  efficiencyTag: (factor: number) => `按 ${factor * 10}% 计`,

  // 毕业机会
  gradPreviewLead: "三条路各判定一次，揭晓后不重抽。",
  gradResultsLead: "接下来去哪里，由你决定。",
  probability: (percent: number) => `概率 ${percent}%`,
  ineligible: "准备尚不足",
  requirementsHeading: "满足任一条即可：",
  reveal: "查看结果",
  mastersHeading: "继续读硕士",
  mastersNote: "读硕士会放弃本科这次的全部机会；已有工作机会时不开放。",
  mastersTerms: (terms: number) => `${terms} 个学期`,
  mastersBudget: (fee: number, reserve: number, money: number) => `入学费 ${fee} · 需预留 ${reserve} · 当前资金 ${money}`,
  mastersBlocked: "不可选：",
  mastersDone: "硕士之后不再提供续读。",

  // 结局
  opportunitiesHeading: "这次的机会",
  cardHeading: "结局卡",
  cardDrawLine: (label: string, percent: number, roll: string, success: boolean) =>
    `${label}：概率 ${percent}%，抽签值 ${roll}，${success ? "命中" : "未命中"}`,
  talentsHeading: "本局天赋",
  epilogueHeading: "五年后",
  lookBack: "回看这次经历",
  lookBackClose: "收起这次经历",
  youChose: (label: string) => `你选择了：${label}`,
  focusSummaryHeading: "投入",
  playAgain: "用新开局再玩一次",
  copySeed: "复制种子",
  copied: "已复制",
  copyFailed: "复制失败，请手动记下",
  replaySeed: "重玩相同种子",
  seedLine: (seed: number) => `本局种子 ${seed}`,

  // 图鉴
  galleryTitle: "留学人生图鉴",
  galleryLead: "本机累计解锁过的结局。只是收藏册，不加数值、不能重抽。",
  galleryTiers: "主线等级",
  galleryHidden: "隐藏结局",
  galleryLocked: "未解锁",
  galleryUnknown: "？？？",
  galleryCount: (count: number, seed: number) => `解锁 ${count} 次 · 首次种子 ${seed}`,
  galleryProgress: (got: number, total: number) => `${got} / ${total}`,
  galleryClose: "返回",

  // 问题页
  saveProblemTitle: "存档读不出来",
  saveProblemCorrupt: "这份存档已经损坏，无法确认它对应一局真实走过的历史。",
  saveOutdatedTitle: "游戏更新了",
  saveProblemVersion: "规则或内容有更新，旧版本的存档不能接着玩。",
  saveProblemNote: "不会用它拼出一局看似正常的进度。重新开始会覆盖这份存档。",
  saveOutdatedNote: "重新开一局就能继续；旧存档会被覆盖，图鉴里已解锁的结局还在。",
  catalogProblemTitle: "学校数据暂不可用",
  catalogProblemLead: "每个档次至少要有 3 所学校才能开局。当前各池数量：",
  catalogProblemNote: "这是数据配置问题，不是你的申请结果。",
  fatalTitle: "出了点问题",
  fatalLead: "游戏遇到了没预料到的错误。可以试着重新开始一局。",
} as const;
