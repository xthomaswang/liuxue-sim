# 执行引擎、数据接口与随机规则

本文件规定逻辑接口；具体数值读取 `03_SYSTEMS_AND_PROBABILITIES.md`，学校目录和分档读取 `11_SCHOOLS_AND_SOURCES.md`。实现应使用纯函数处理状态转移，让相同输入产生相同输出。不要把数值逻辑写在 UI 点击事件里。

## 1. 开局与随机数

### 随机的边界

只在以下位置使用随机：家庭档案的期待与特质、高中基础申请准备度、申请池/大学档次、同档三个学校offer、两条支线分配、本科毕业机会、硕士毕业机会。事件A/B的结果和四属性变化是确定的，高中选择另通过历史标记改变申请分布。

不在 React render、文本展开、窗口聚焦、按钮 hover 或读档时调用新的随机数。禁止 `Math.random()` 参与游戏规则。新一局可以用 `crypto.getRandomValues` 产生一个无符号 32 位 seed；种子回放则读取用户输入的同一 seed。

下面是约定实现；seed 是 0 到 4294967295 的整数，key 为 UTF-8 字符串。哈希不是密码学用途，只用于可复现的游戏抽取。

```ts
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function draw01(seed: number, key: string): number {
  return hash32(`${seed >>> 0}:${key}`) / 4294967296;
}
function pickIndex(seed: number, key: string, length: number): number {
  if (length <= 0) throw new Error("EMPTY_POOL");
  return Math.floor(draw01(seed, key) * length);
}
```

函数不会修改任何全局随机状态，因此未满足资格的机会和不同长度的剧情不会把后面的抽签序列错位。换一个决定可改变概率和支线权重，但不重抽同一路毕业机会的 roll。

### 家庭与大学

1. 创建 runId、seed 和版本快照。
2. 固定生成 `LOW/MID/HIGH` 三个经济档案，每档独立抽取一项家庭期待和一项特质；列表顺序固定，便于比较。
3. 计算并显示 `admission:readiness` 对应的基础申请准备度。玩家选家庭，再选个人愿望；确认后冻结家庭和特质，进入高中最后一年。
4. 依次处理 HS_01、HS_02。只结算事件effects与标记，不发资助、不选focus、不扣学期费用。当前四属性原样带入本科。
5. 按13用基础准备度与高中选择计算最终准备度及分布：`admission:pool` 判断U独立池，`admission:tier`抽有序档。结果只生成一次。
6. 同档三个学校offer用 `school:offer:0/1/2` 无放回抽取。细则见11/13。玩家只可三选一，不开放任意选校。
7. 名字可空，叙事回退“你”。姓名不进入随机key。选定学校后进入本科第一阶段；不能重置高中已改变的四属性。
8. 家庭/愿望/学校菜单总预算30–45秒，高中两事件合计不超过30秒。完整说明可折叠，不增加多屏介绍。

家庭数组固定顺序：期待 `[ACADEMIC,STABILITY,AUTONOMY]`；特质 `[FOCUSED,PRACTICAL,OUTGOING,FRUGAL,RESILIENT,REFLECTIVE]`。key 为 `family:<LOW|MID|HIGH>:expectation` 和 `family:<LOW|MID|HIGH>:trait`。三档允许抽到相同期待/特质，不为追求不同而偷偷重抽。

家庭经济不直接决定申请准备度；高中准备与策略通过13影响档次分布。高中最后一年只有两个决策，不增加考试、申请轮次或高中课表系统。申请准备度只保存在申请快照里，不变成大学阶段第五条状态。未来若改变档次规则，必须提升版本。

## 2. 事件数据

04、05、10、12的第一个且唯一的`json`代码块分别是本科主线、支线、硕士、高中事件数组。提取成四个静态JSON文件后加载，禁止游戏运行时解析Markdown。

```ts
type StatKey = "money" | "academics" | "career" | "wellbeing";
type Stats = Record<StatKey, number>;
type Focus = "STUDY" | "CAREER" | "CAMPUS" | "WORK" | "REST";
type ArcId = "RESEARCH" | "INTERNSHIP" | "FRIENDSHIP"
  | "FAMILY" | "REORIENTATION" | "CREATIVE";
type Degree = "UG" | "MS";
type Opportunity = "PHD" | "LOCAL_JOB" | "HOME_JOB";
type FinalRoute = Opportunity | "TRANSITION";
type Callback = { ifFlag: string; text: string; shortText: string };
type Choice = {
  id: "A" | "B";
  label: string;
  effects: Stats;
  setFlags: [string];
  shortResult: string;
  result: string;
};
type EventBase = {
  id: string; title: string; summary: string; body: string;
  callbacks: Callback[]; choices: [Choice, Choice];
};
type StoryEvent = EventBase & (
  | {kind:"core"; stage:number}
  | {kind:"arc"; arc:ArcId; beat:1|2|3}
  | {kind:"masters"; node:1|2|3|4}
  | {kind:"highschool"; node:1|2}
);
```

默认呈现 `summary`，完整正文放在“展开细节”。匹配的 callbacks 按数组顺序筛选，默认只展示**最后一条**匹配的 `shortText`；展开后展示所有匹配的 `text`。匹配集在事件出现时固定，不受当前选项提交后的新标记影响。

选择后立即展示 `shortResult` 与实际变化，下一步骤可马上操作。`result` 是展开阅读版本，不应和 shortResult 默认同时显示。无需逐字动画、结果弹窗、连续点三次确认或倒计时。

允许模板变量只有 `{{school.name}}`、`{{school.city}}`、`{{player.name}}`。用字符串替换和文本渲染，不用 HTML 注入或 `eval`。缺失 school.city 时显示“这座城市”；未知变量视为内容错误，开发时直接报告。

负资金选项按当前资金判断可用性。事件至少有一个不花钱选项；其他属性可以降到零。设置历史标记时只允许该选项对应的唯一标记，不保存互相重复的 `hasResearchExperience` 等派生布尔值。

## 3. 支线安排

本科支线槽 A 在 S2/S4/S6 推进，槽 B 在 S3/S5/S7 推进。A 在 S2 主线选项结算后首次分配；B 在 S3 主线选项结算后分配，并排除 A。各支线第一幕都能独立成立，不要求某个前置 flag。

权重读取“本学期投入＋主线事件已结算、支线尚未结算”的状态，计算如下：

| 支线 | 权重 |
|---|---|
| RESEARCH | `1 + 2*STUDY次数 + floor(academics/25)` |
| INTERNSHIP | `1 + 2*CAREER次数 + floor(career/25)` |
| FRIENDSHIP | `1 + 2*CAMPUS次数 + (trait==OUTGOING ? 2 : 0)` |
| FAMILY | `1 + (economy==LOW ? 1 : 0)` |
| REORIENTATION | `1 + 2*REST次数 + (wellbeing<40 ? 2 : 0)` |
| CREATIVE | `1 + CAMPUS次数 + CAREER次数 + (trait==REFLECTIVE ? 1 : 0)` |

家庭期待不影响权重，遵守其“仅叙事”承诺。所有权重均为正数，不存在因为数值不够而永远没有支线的状态。

候选固定顺序：RESEARCH、INTERNSHIP、FRIENDSHIP、FAMILY、REORIENTATION、CREATIVE。取 `r=draw01(seed,"arc:A")*总权重`，按顺序累计，取第一个累计值严格大于 r 的项；B 使用 `arc:B`。浮点极端情况下最后一项作兜底。分配后立即保存，不在第二/三幕重新抽取。

人物可以在主线和两条支线中同时出现；支线自己只读取自己的先前标记，不要求另一条支线发生。硕士不分配新支线、不重演已完成支线。

## 4. 状态与存档

建议状态至少包含：

```ts
type Graduation = {
  degree: Degree;
  frozenStats: Stats;
  frozenFocusCounts: Record<Focus,number>;
  frozenFlags: string[];
  probabilities: Record<Opportunity,number|null>;
  rolls: Record<Opportunity,number> | null;
  outcomes: Record<Opportunity,"INELIGIBLE"|"OFFERED"|"NOT_OFFERED"> | null;
  resolution: FinalRoute | "MASTERS" | null;
};
type RunState = {
  schemaVersion: 1;
  rulesVersion: "1.0.0";
  contentVersion: "1.0.0";
  catalogVersion: string;
  catalogSha256: string;
  tierMappingVersion: string;
  rankEdition: number;
  runId: string;
  seed: number;
  revision: number;
  phase: "SETUP"|"HIGH_SCHOOL_EVENT"|"SCHOOL_OFFERS"|"FOCUS"|"CORE_EVENT"|"ARC_EVENT"|"TERM_REVIEW"
    |"GRAD_PREVIEW"|"GRAD_RESULTS"|"ENDING";
  degree: "HS"|Degree;
  termIndex: number;
  highSchoolNode: null|1|2;
  mastersYears: null|1|2;
  profile: {name:string;economy:string;expectation:string;trait:string;aspiration:string};
  schoolTier: string;
  offerUnitids: [string,string,string];
  schoolUnitid: string;
  school: {unitid:string;name:string;city:string;stateOrTerritory:string;tier:string};
  admission: {baseReadiness:number;readiness:number|null;strategy:"REACH"|"STEADY"|null;
    weights:number[]|null;poolRoll:number|null;tierRoll:number|null;tier:string|null};
  stats: Stats;
  focusCounts: Record<Focus,number>;
  flags: string[];
  arcs: {A:ArcId|null;B:ArcId|null};
  history: Array<Record<string,unknown>>;
  graduations: {UG:Graduation|null;MS:Graduation|null};
  finalRoute: FinalRoute|null;
};
```

SETUP与高中阶段尚未拥有学校，用单独union或nullable字段表示，不能伪造学校占位来通过类型检查。上面的RunState省略这种实现展开。高中degree=HS、termIndex=0，highSchoolNode推进1→2；学校确认后degree=UG、termIndex=1、highSchoolNode=null。毕业快照Degree仍只允许UG/MS。

history 每条至少保存 `degree,termIndex,actionId,revision,beforeStats,requestedDelta,appliedDelta,afterStats`；事件再记录 `eventId,choiceId`，学期结算另记录资助、必要开销和短缺。用真正应用的变化显示 UI，避免属性 99 时声称实际增加了 11。

学期投入计数整局累计，不在硕士入学时归零。UG 完成后总数 8；一年硕士后 10；两年硕士后 12。本科毕业快照仍保存原来的 8 次计数，不被硕士后来的值覆盖。

本机保存一个进行中存档，可保留最近一次结局供阅读。每次有效 reducer 操作后同步写入 localStorage；读取时校验版本和数据。不兼容或损坏的存档不静默转换成新局，提供重新开始操作；不要把个人输入或存档上传服务器。

## 5. 原子执行与 phase

有效操作必须同时满足当前 phase、当前事件 ID 和当前 revision。UI 防连击之外，reducer 也必须拒绝重复 actionId。一次选择的验证、更新数值、写 flag、前进 phase 和存档是一个原子事务。

高中先执行两次原子事件，再生成一次申请结果和三校offer；选校前不得调用beginTerm。大学/硕士每学期执行：

1. `beginTerm`：一次发放资助，进入 FOCUS。
2. `chooseFocus`：读取投入前身心，按 03 修正特质与低身心效率；更新一次计数，进入 CORE_EVENT。
3. `chooseCore`：UG 使用 CORE_01..08；MS 使用下节节点映射。按条件进入 ARC_EVENT，或直接 `finishTerm`。
4. `chooseArc`：仅 UG 指定阶段存在；结算后 `finishTerm`。
5. `finishTerm`：扣必要成本，处理短缺，再基础成长/消耗，生成 TERM_REVIEW。学期总结在同屏紧凑显示，不需阅读长篇流水账。
6. `nextTerm`：若还有学期，termIndex+1 并 beginTerm；否则冻结本学历毕业快照，进入 GRAD_PREVIEW。

重要：0 身心和 0 钱都不提前结束；低身心影响下一次投入收益的规则见03。资助、事件、学期结算分别截断属性，不先求总和。

## 6. 本科、硕士和博士分流

毕业预览显示本学历 PHD/LOCAL_JOB/HOME_JOB 的资格与概率。玩家点击一次“查看机会”，以固定 key 计算三项结果并保存，进入 GRAD_RESULTS：

- 本科：`grad:UG:PHD`、`grad:UG:LOCAL_JOB`、`grad:UG:HOME_JOB`。
- 硕士：`grad:MS:PHD`、`grad:MS:LOCAL_JOB`、`grad:MS:HOME_JOB`。

有资格且 `roll01 < probabilityPercent/100` 才 OFFERED，等号不成功。三项可以同时成功。无资格也读取自己的 key，但状态 INELIGIBLE，不显示成“被拒”。

**硕士检查在本科结果揭晓后进行。** 两种工作均非 OFFERED，且满足 03 的学业和预算条件时，列出可选的 MS_1Y/MS_2Y。不能把“拒绝一个已有工作”当成“没找到工作”。有博士机会时可接受博士结束，也可在硕士条件满足时继续硕士。

接受硕士是独立的原子操作：

1. 重新校验本科结果和对应方案预算，但不重新抽签。
2. 本科 resolution 设为 MASTERS，并扣一次入学费用。
3. degree=MS，mastersYears=1 或 2，termIndex=1；保留学校背景、家庭、特质、愿望、数值、累计计数、flags 与完成支线。
4. 发放硕士第一期资助，进入 FOCUS。

学校名称只作为本科背景继续记录。硕士是去向未指定的美国项目，不默认为原校保证续录；硕士授课地点在正文中使用“新校园/项目/研究生课程”，不再抽三所院校或伪造真实项目名称。

| 硕士方案 | 学期序列 | 使用事件 |
|---|---|---|
| 1 年 | MS1、MS2 | MASTER_01、MASTER_04 |
| 2 年 | MS1、MS2、MS3、MS4 | MASTER_01、MASTER_02、MASTER_03、MASTER_04 |

不抽第三条支线、不重新抽家庭、不得再次进入硕士。硕士结算只允许选择已有博士/工作机会或 TRANSITION。博士 route=PHD 的文案按毕业快照的 degree 区分本科直博和硕士后入博；进入博士时游戏即结束。

## 7. 结局组装

07 定义所有结局模块及条件。默认结局采用精简模式，总正文目标 120–180 中文字，包含主去向、学历来源、最重要经历回响、身心与资金一句话；详细模块和数学分解可展开。

最终 route 必须是所选学历已 OFFERED 的机会，或 TRANSITION。是否主动过渡按该次机会结果推导。不能选择硕士阶段本科已过期的 offer；本科 snapshot 仅供回顾。

博士“结局”指成功进入博士项目。五年后文案只能描述研究/生活近况，不无条件声称已经拿到博士学位。最终文字不再做第二轮“人生成功”抽签。

## 8. 十分钟节奏约束

默认全部使用短文。最长两年硕士路线共有12次投入、20个事件，32次生活决策。包括高中、家庭与选校菜单的完整预算以13为唯一来源：约6分35秒–8分50秒，为十分钟上限保留余量。不是通过减少或隐去高中阶段来满足时间目标。

这是设计预算，不是实测时长。验收要求见09：默认路径实测包含硕士在内不超过10分钟。不能用强制倒计时替用户决策，也不能为了凑时长跳过事件结果。若测试超时，先缩短默认文案和重复确认，不增加自动替用户选择。

## 9. 必须验证的边界

- 同 seed 同内容版本的家庭、学校三选一、支线与毕业 roll 完全一致。
- 高中只结算2事件且不计为学期；高中数值带入UG；准备度不在毕业概率中再次使用。
- 同档学校不重复；全国池和同档池不够时不得跨档偷偷补位。
- UG8 次投入；MS增2或4次；毕业每个学历只抽一次。
- 本科没拿工作＋学业55门槛＋资助预算允许才可继续硕士；完整参数以03为准。
- MASTER_04 能在没经历02/03时成立；两个硕士成果 flag 互斥。
- 刷新、连点、返回按钮不会重复资助/收费/结局抽签。
- 任意资金局面都存在可选事件按钮；合法状态不会落入无内容的 phase。
- catalog/rules/content版本随存档冻结，更新数据后不改变进行中的学校和机会。
