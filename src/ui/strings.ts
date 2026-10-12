// 界面文案。剧情、开局与结局正文来自 src/content（由 docs 提取）；这里只有界面自己的说明、按钮与标签。

import { TEXTS } from "../content";
import type {
  Economy,
  Focus,
  OfferTier,
  Outcome,
  StatKey,
  Strategy,
  TierBasis,
  Trait,
} from "../engine";

export const APP_TITLE = "留学人生模拟器";

export const STAT_ORDER: StatKey[] = ["money", "academics", "career", "wellbeing"];
/** 变化预览里用的短名；完整名称取 TEXTS.stat。 */
export const STAT_SHORT: Record<StatKey, string> = {
  money: "资金",
  academics: "学业",
  career: "职业",
  wellbeing: "身心",
};

export const FOCUS_ORDER: Focus[] = ["STUDY", "CAREER", "CAMPUS", "WORK", "REST"];
/** 投入次数概览用的短名（docs/07 第 8 节的叫法）。 */
export const FOCUS_SHORT: Record<Focus, string> = {
  STUDY: "学习",
  CAREER: "职业准备",
  CAMPUS: "校园生活",
  WORK: "校内兼职",
  REST: "休息整理",
};

const focusName = (focus: Focus): string => TEXTS.focus[focus].name;

/** 特质的规则说明（docs/03 第 2.3 节），写成玩家看得懂的一句话。 */
export const TRAIT_RULE: Record<Trait, string> = {
  FOCUSED: `选择“${focusName("STUDY")}”时，学业额外 +2。`,
  PRACTICAL: `选择“${focusName("CAREER")}”时，职业额外 +2。`,
  OUTGOING: `选择“${focusName("CAMPUS")}”时，职业额外 +2。`,
  FRUGAL: "每学期的必要开销从 12 降到 11。",
  RESILIENT: "投入重心带来的身心消耗少扣 2。",
  REFLECTIVE: `选择“${focusName("REST")}”时，学业额外 +1、身心额外 +3。`,
};

export const ECONOMY_NOTE: Record<Economy, string> = {
  LOW: "资金最紧，额外开销和学期末的必要开销都要算着来。",
  MID: "日常够用，但花钱的选择多了也会见底。",
  HIGH: "资金最宽，试错的余地更大。",
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
  unsavedHint: "本机存储暂时写不进去。可以继续玩，但关掉页面后这一步可能丢失。",
  restart: "重新开始",
  restartConfirmText: "放弃当前这一局并重新开始？已经走过的选择不会保留。",
  restartConfirmYes: "放弃并重开",
  restartConfirmNo: "继续这一局",
  sampleBanner: "样本目录（开发用，非正式学校数据）",
  loading: "正在读取存档…",
  expand: "展开细节",
  collapse: "收起",
  clippedHigh: "已到上限",
  clippedLow: "已到下限",
  noChange: "四项属性没有变化",
  rejectedPrefix: "这一步没有生效：",

  // 开局
  setupLead: "先选一个家庭起点和一个愿望，再开始高中最后一年。",
  setupEconomyNote: "三个起点的资金条件不同，资源难度也不同；家庭期待只影响故事里的对话。",
  familyHeading: "家庭起点",
  familyDetails: "家庭详情",
  familySelect: "选这个起点",
  familySelected: "已选择",
  traitLabel: "个人特质",
  initialStats: "初始属性",
  stipendLine: (stipend: number, upkeep: number) => `本科起每学期资助 ${stipend}，期末必要开销 ${upkeep}`,
  aspirationHeading: "个人愿望",
  aspirationNote: "只影响结局里的回应，不改变任何数值或概率。",
  nameLabel: "名字（可不填）",
  namePlaceholder: "留空则称呼“你”",
  readinessLabel: (value: number) => `申请准备度 ${value}`,
  readinessNote: "只用于这次大学申请",
  start: "开始高中最后一年",
  startHint: "请先选好家庭起点和个人愿望。",
  seedToggle: "用指定种子开局",
  seedCurrent: (seed: number) => `本局种子：${seed}`,
  seedInputLabel: "种子（0 到 4294967295 的整数）",
  seedApply: "用这个种子开局",
  seedInvalid: "请输入 0 到 4294967295 之间的整数。",
  seedNote: "同一个种子会得到同样的家庭档案、学校抽取与机会抽签。",
  galleryOpen: "留学人生图鉴",

  // 事件
  lastOutcomeHeading: "刚才",
  storyExpand: "展开故事",
  resultExpand: "展开这段结果",
  introExpand: "展开旁白",
  choicesHeading: "你的选择",
  cost: (amount: number) => `花费 ${amount}`,
  shortBy: (need: number, have: number) => `需要 ${need}，当前 ${have}`,
  projected: (money: number, upkeep: number) => `预计本学期结算后资金 ${money}（必要开销 ${upkeep}）`,
  projectedShortfall: (shortfall: number) => `还差 ${shortfall}，期末会因资金短缺额外消耗身心。`,
  readinessBonus: (bonus: number) => `本次申请准备 +${bonus}`,
  readinessAfter: (value: number) => `准备度将为 ${value}`,
  strategyLine: (name: string) => `${name}方案的各档概率`,
  about: "约",

  // 选校
  admissionHeading: "申请结果",
  readinessFinal: (readiness: number, base: number, bonus: number) =>
    `申请准备度 ${readiness}（基础 ${base} ＋ 高中准备 ${bonus}）`,
  strategyChosen: (name: string) => `${name}方案`,
  oddsHeading: "这次申请的各档概率",
  tierDrawn: (name: string) => `抽中的档次：${name}`,
  tierUNote: "“未分档”不是最低档：它表示这所学校不在综合排名的分档序列里。",
  tierDrawNote: "档次是按上面的概率抽出来的，不是对你的评价。",
  offersHeading: "你收到了三所同档学校的 offer，选一所入学",
  offersNote: "学校只作为这段人生的背景，不改变之后的数值与机会。",
  offerPick: "去这所学校",
  rankLine: (basis: string, rank: string, category: string) => `${basis} ${rank}（${category}）`,

  // 投入
  focusHeading: "这个学期，把重心放在哪里？",
  stipendArrived: (requested: number, applied: number) =>
    applied === requested ? `本学期资助 +${requested} 已到账` : `本学期资助 +${requested}，实际到账 +${applied}（资金已到上限）`,
  upkeepDue: (upkeep: number) => `期末必要开销 ${upkeep}`,
  traitTag: "含特质加成",
  efficiencyTag: (factor: number) => `学习与职业积累按 ${factor * 10}% 计`,

  // 学期小结
  termReviewHeading: "学期小结",
  shortfallLine: (shortfall: number, stress: number) =>
    `资金短缺 ${shortfall}：靠紧急缓冲撑过这学期，身心额外 -${stress}。`,
  endStats: "期末属性",
  nextTerm: "继续",
  toGraduation: "查看毕业机会",

  // 毕业机会
  gradPreviewLead: "三条路各自独立判定一次。结果揭晓后不会重抽。",
  frozenStats: "毕业时的属性",
  focusCounts: "投入次数",
  probability: (percent: number) => `概率 ${percent}%`,
  ineligible: "准备尚不足",
  requirementsHeading: "资格（满足任一条即可）",
  requirementsExpand: "需要什么资格",
  breakdownExpand: "概率怎么来的",
  breakdownTotal: (text: string) => `合计 ${text}`,
  clampedMin: "低于下限，按 8% 计。",
  clampedMax: "超过上限，按上限计。",
  reveal: "查看结果",
  rollLine: (roll: string, percent: number) => `抽签值 ${roll}，需要小于 ${(percent / 100).toFixed(2)}`,
  routesHeading: "接下来去哪里？",
  routesNote: "由你自己决定，不会自动替你选。",
  mastersHeading: "继续读硕士",
  mastersNote: "进入硕士会放弃本科这次的全部机会，之后不能再回头接受。已取得工作机会时，首版不开放硕士。",
  mastersTerms: (terms: number) => `共 ${terms} 个学期`,
  mastersBudget: (fee: number, stipend: number, upkeep: number, reserve: number, money: number) =>
    `入学费 ${fee} · 总资助 ${stipend} · 必要开销共 ${upkeep} · 至少需预留 ${reserve} · 当前资金 ${money}`,
  mastersPick: "选择这个方案",
  mastersBlocked: "暂不可选",
  mastersDone: "硕士之后不再提供续读。",

  // 结局
  keyOpportunities: "这次的机会",
  cardHeading: "结局卡",
  cardFactsExpand: "达成依据",
  cardHiddenHeading: "隐藏结局",
  cardDrawLine: (label: string, percent: number, roll: string, success: boolean) =>
    `${label}：概率 ${percent}%，抽签值 ${roll}，${success ? "命中" : "未命中"}`,
  fullExpand: "展开完整回顾",
  fullCollapse: "收起完整回顾",
  sectionBridge: "这一路",
  sectionNow: "毕业当下",
  sectionAspiration: "与开局愿望的对话",
  sectionFamily: "与家里的对话",
  sectionReview: "这几年记得的几件事",
  sectionEpilogue: "五年后的一页",
  sectionBreakdown: "这次机会如何形成",
  breakdownPointer: "三条路的资格、概率与结果在上面的“这次的机会”里，每一项都可以展开看概率的组成。",
  sectionUndergrad: "本科毕业时的选择",
  undergradNote: "这些机会已在进入硕士时放弃，现在不能再接受。",
  youChose: (label: string) => `你选择了：${label}`,
  reviewExpand: "展开当时的结果",
  focusSummaryHeading: "投入概览",
  lookBack: "回看这次经历",
  playAgain: "用新开局再玩一次",
  copySeed: "复制种子",
  copied: "已复制",
  copyFailed: "复制失败，请手动记下",
  replaySeed: "重玩相同种子",
  seedLine: (seed: number) => `本局种子 ${seed}`,

  // 图鉴
  galleryTitle: "留学人生图鉴",
  galleryLead: "本机累计解锁过的结局。只是一本收藏册：不加数值，不提供重抽。",
  galleryTiers: "主线等级",
  galleryHidden: "隐藏结局",
  galleryLocked: "未解锁",
  galleryUnknown: "？？？",
  galleryCount: (count: number, seed: number) => `解锁 ${count} 次 · 首次种子 ${seed}`,
  galleryProgress: (got: number, total: number) => `${got} / ${total}`,
  galleryClose: "返回",
  galleryCondition: "条件",

  // 问题页
  saveProblemTitle: "存档读不出来",
  saveProblemCorrupt: "这份存档已经损坏，无法确认它对应一局真实走过的历史。",
  saveProblemVersion: "这份存档来自不兼容的规则、内容或学校目录版本，不能在当前版本里继续。",
  saveProblemNote: "不会用它拼出一局看似正常的进度。可以重新开始一局；重新开始会覆盖这份存档。",
  saveProblemDetail: "技术细节",
  catalogProblemTitle: "学校数据暂不可用",
  catalogProblemLead: "每个档次至少要有 3 所学校才能开局。当前各池数量：",
  catalogProblemNote: "这是数据配置问题，不是你的申请结果。",
  fatalTitle: "出了点问题",
  fatalLead: "游戏遇到了没预料到的错误。可以试着重新开始一局。",
} as const;
