# 第四版：学期更细，毕业后再过五年

日期：2026-10-15。用户试玩第三版后的原话：

> 再多加一些有梗的结局和天赋 感觉时间有点少了 太快了这几个学期 事件太少了。
> 不要修仙模拟 就正常的人生就好了 但是细致一些 可以毕业之后模拟后几年的生活

所以第四版做三件事：

1. **学期更细**：每学期开学、期中各可能有一件突发小事；轨迹里穿插日常与寒假；每学期出一个期末 GPA；学年之间加暑假（有数值变化），出国前还有一个夏天。
2. **毕业后再过五年**：毕业确定去向（或中途结局）之后不马上结束，按轨道一年一年过五年——每年一个重心、几件里程碑和生活小事，可能换轨（被裁回国、读博退学转码、三次没抽中 H1B 去加拿大……），最后得到一个“五年后”的结局。
3. **更多有梗的结局和天赋**：中途结局 +10、去向结局 +10、五年后结局约 45 个、天赋 +21、成就 +22。

**不做**修仙、超自然、活到一百岁。只有正常人的生活。

本文与更早的文档冲突时以本文为准。玩家的操作不变：开局选天赋、分点，之后全部自动（`22`）。规则与内容版本都提升到 `4.0.0`；旧存档按“游戏更新了”处理。**经典模式完全不变**（没有暑假、日常、GPA、第二件突发小事和毕业后的五年），继续与 Python 参考实现逐学期对拍。

## 1. 流程与时间线

```text
高三 → 申请季 → 出国前的夏天 → 大一上 → 大一下 → 大一暑假 → 大二上 → … → 大三暑假 → 大四上 → 大四下
     → 本科毕业 →（硕一上 … 硕士毕业）→ 毕业第 1 年 → … → 毕业第 5 年 → 五年后
中途结局时：… → 某学期 → 中途结局 → 离校第 1 年 → … → 离校第 5 年 → 五年后
```

## 2. 学期更细（只在正式玩法）

### 2.1 突发小事：开学一件，期中一件

| 时机 | 概率 | 抽签 key |
|---|---|---|
| 开学：资助到账之后（原来的位置） | 0.70 | `happening:roll:{stage}:{term}`、`happening:pick:{stage}:{term}`（沿用） |
| 期中：主线槽事件结算之后、支线事件之前 | 0.45 | `happening:mid:roll:{stage}:{term}`、`happening:mid:pick:{stage}:{term}` |

- 候选：`scope` 适用于当前学段、本局没出现过、`when` 满足（按发生那一刻的状态判断，见 §6）。没有候选就不发生。
- 选取沿用 `pickIndex`（等概率）。记进历史，类型仍是 `HAPPENING`；开学还是期中由它在历史里的位置决定。
- 突发小事池扩到约 80 条（`docs/21`，id 允许三位数 `HAP_101`），新条目可以带 `when`（例如只在加州出现的地震演习）。

### 2.2 暑假（有数值变化，记进历史）

| 暑假 | 时机 | 第一件 | 第二件 |
|---|---|---|---|
| 出国前的夏天（`DEPARTURE`） | 选定学校之后、大一上开始之前 | 必有 | 0.6 |
| 本科暑假（`UG`） | 大一下、大二下、大三下期末结算之后（且这一学期没有触发中途结局） | 必有 | 0.4 |
| 硕士暑假（`MS`） | 两年制硕士的硕一下期末之后 | 必有 | 0.4 |

- 抽签：第二件是否发生 `summer:roll:{stage}:{term}:1`；第 k 件的选取 `summer:pick:{stage}:{term}:{k}`。出国前的夏天 `stage` 记 `HS`、`term` 记 0。
- 候选：`slot` 相符、本局没出现过、`when` 满足。按权重抽：`r = draw01 × 权重之和`，按数组顺序累加，取第一条累计值严格大于 r 的。
- 记进历史：`kind: "SUMMER"`，`summerId`，`stage` 与 `termIndex` 是刚结束的学期（出国前为 `HS`、0）。
- 暑假**不检查中途结局**，没有资助和必要开销。
- 内容：`src/content/summers.json`（`SummerEvent`）。

### 2.3 日常（只是文字，不进历史）

轨迹现挑，不改状态、不影响任何数值或判定。内容：`src/content/daily.json`（`DailyLine`）。

- 每个本科或硕士学期：
  - 下学期（偶数学期）开头：0.7 的概率一条 `WINTER`（寒假刚过）。抽签 `daily:roll:{stage}:{term}:winter`，选取 `daily:{stage}:{term}:winter`。
  - 每学期两条：从 `TERM` 加上本学期对应季节（奇数学期 `FALL`、偶数学期 `SPRING`）里挑，选取 `daily:{stage}:{term}:0`、`daily:{stage}:{term}:1`。
- 一局之内不重复。候选按权重抽（同 §2.2）。`when` 的上下文取**学期末**：期末四属性、本学期的安排类别（`focusAny`）、累计安排次数、标记等（§6）。
- 中途结局所在的那个学期照样有日常。

### 2.4 期末 GPA（只在轨迹里）

每个结算完的本科或硕士学期（历史里有它的 `UPKEEP`）算一个 GPA：

```text
A = 期末学业（基础成长之后），W = 期末身心
gpa = 1.96 + 0.018 × A
    + 本学期安排：学习 +0.10，求职 −0.05，校园 0，打工 −0.20，休息 +0.03
    + 身心：W < 15 → −0.30；15 ≤ W < 30 → −0.12
    + 三张天赋 gpa 之和 / 100
    + (draw01(seed, "gpa:{stage}:{term}") − 0.5) × 0.90
保留两位小数（四舍五入），截断到 0.80–4.00
```

- 这一行的说法来自 `src/content/gpa.json`：按 `min` 从高到低取第一档 `gpa ≥ min`，`pickIndex(seed, "gpa:text:{stage}:{term}", texts.length)` 挑一句，`{gpa}` 换成两位小数。
- 本科毕业、硕士毕业那一段开头各加一行平均 GPA（各学期 GPA 的算术平均，两位小数）。
- 常数按模拟调过（最初写的是 1.90 + 0.021 × A、学习 +0.15、打工 −0.12、噪声 0.40：期末学业顶到 100 的学期有一成多，4.00 太多，低分又几乎出不来）。以后再调也保持这个形状。

## 3. 人物年龄

| 段 | 年龄 |
|---|---|
| 高三、申请季 | 17 |
| 出国前的夏天 | 18 |
| 本科第 t 学期 | 18 + ⌊(t−1)/2⌋（大一 18 … 大四 21） |
| 本科第 t 学期之后的暑假 | 18 + t/2（大一暑假 19 … 大三暑假 21） |
| 本科毕业 | 22 |
| 硕士第 t 学期 | 22 + ⌊(t−1)/2⌋；硕士暑假 23；硕士毕业 22 + 年制 |
| 中途结局 | 所在学期的年龄 |
| 毕业后第 k 年 | 离校年龄 + k；五年后 = 离校年龄 + 5 |

离校年龄 `startAge`：本科毕业 22；硕士毕业 22 + 年制；中途结局为所在学期的年龄。

## 4. 毕业后的五年（只在正式玩法）

### 4.1 进入

- **毕业**：`CHOOSE_ROUTE` 结算出 `ending`（结局卡、去向结局照旧）之后，不再进入 `ENDING`，而是进入 `LIFE`：轨道 = 去向（`PHD`／`LOCAL_JOB`／`HOME_JOB`／`TRANSITION`）。
- **中途结局**：期末命中中途结局、写好 `ending`（EARLY）之后同样进入 `LIFE`：轨道 = 该中途结局的 `lifeTrack`，缺省 `DROPOUT`。
- 进入时：`stage = "LIFE"`，`termIndex = 0`，`phase = "LIFE"`，`life = { track, tracks: [track], year: 0, startAge, startStats: 当时四属性, flags: [], focusCounts: 全 0, outcome: null }`。结局卡在离校那一刻就定了，之后不再改。

### 4.2 每一年：`LIVE_YEAR`

操作 `{ type: "LIVE_YEAR", focus }`，只在 `phase === "LIFE"` 合法。`year = life.year + 1`，`termIndex = year`，当前轨道 T，内容 `C = life/<T>.json`，公共内容 `K = life/COMMON.json`。

1. **基础**：从 `C.base.texts` 里挑一句（`pickIndex(seed, "life:base:{year}", 候选数)`，候选是这条轨道上还没用过的下标，用完了就全部），记 `LIFE_BASE`（`delta = C.base.delta` 加上三张天赋的 `lifeGrowth`，`track`、`textIndex`）。
2. **重心**：`C.plans` 里类别为 `focus` 的那张，记 `LIFE_PLAN`（`delta`、`focus`、`track`），`life.focusCounts[focus] += 1`。
3. **里程碑**：先 `C.milestones` 再 `K.milestones`，按数组顺序逐条：不可重复的已经发生过就跳过；`when` 不满足就跳过（上下文用此刻的状态，§6）；`draw01(seed, "life:ms:{id}:{year}") < chancePermille/1000` 就发生：记 `LIFE_EVENT`（`milestone: true`），加上 `setFlags`（不重复），有 `setTrack` 就记下“明年换轨”（同一年多次以最后一次为准）。**每年最多 3 件**，满了就停。
4. **生活小事**：件数 = 1 + (`draw01(seed, "life:ev:roll:{year}")` < 0.5 ? 1 : 0)。第 k 件：候选是 `C.events` 与 `K.events` 里本局没出现过、`when` 满足的（每抽一件都按最新状态重算），按权重抽（`r = draw01(seed, "life:ev:pick:{year}:{k}") × 权重之和`，先 C 后 K 的数组顺序累加）。记 `LIFE_EVENT`（`milestone: false`），处理 `setFlags`、`setTrack` 同上。没有候选就少一件。
5. **年末**：`life.year = year`；有“明年换轨”且不同于 T：`life.track` 换过去，`life.tracks` 追加。
6. **第五年结束**：在**换轨之后**的轨道上挑结局：`life/<轨道>.json` 的 `outcomes` 里 `when` 满足的，按权重抽（`draw01(seed, "life:outcome")`）。每条轨道恰有一条无条件的兜底，所以不会为空。写 `life.outcome = { id, track }`，`phase = "ENDING"`。

`COMMON.json` 只有 `milestones` 和 `events`（跨轨道的人生大事：脱单、结婚、养宠物、天赋带来的事件……），没有 `base`、`plans`、`outcomes`。

### 4.3 角色怎样选每年的重心

沿用学期安排的权重（`22` §3.2），钱紧的门槛换成毕业后的：

```text
STUDY  2 + a/2
CAREER 2 + c/2
CAMPUS 2 + w/2
WORK   1 + (10 − f)/4 + (资金 < 20 ? 10 : 0) + (资金 < 10 ? 10 : 0)
REST   1 + (身心 < 25 ? 8 : 身心 < 45 ? 3 : 0)
r = draw01(seed, "auto:life:{year}") × 权重之和，按 STUDY、CAREER、CAMPUS、WORK、REST 顺序累加
```

### 4.4 轨道内容的格式（`src/content/life/<TRACK>.json`，`LifeTrackContent`）

| 字段 | 要求 |
|---|---|
| `track`、`name` | 名字不超过 6 个字，如“留美工作” |
| `base.delta` | 每项绝对值 ≤ 6；体现这条路一年的底色（工资、房租、学术成长、消耗） |
| `base.texts` | ≥ 6 句，每句 ≤ 30 字，句号结尾，不写数值 |
| `plans` | 恰好 5 张，顺序 STUDY、CAREER、CAMPUS、WORK、REST；`name` ≤ 8 字（显示为“这一年的重心：{name}。”）；`delta` 每项绝对值 ≤ 8、四项绝对值之和 ≤ 14。形状仿照学期安排：学习涨学业、求职涨职业、社交涨身心带一点职业、搞钱涨资金、休息回身心；前四类要有代价 |
| `milestones` | ≥ 8 条；id `LM_<TRACK>_<名>`；`text` ≤ 40 字；`delta` 每项绝对值 ≤ 12；`chancePermille` 1–1000；`when` 一般写 `yearMin`／`yearMax` |
| `events` | ≥ 24 条（`DROPOUT` ≥ 20 条通用 + 每个中途结局至少一条专属）；id `LE_<TRACK>_<名>`；`text` ≤ 40 字；`delta` 每项绝对值 ≤ 8，四项绝对值之和 1–12；`weight` 1–10 |
| `outcomes` | ≥ 8 条，其中恰好一条 `fallback: true` 且 `when: {}`；id `LO_<TRACK>_<名>`；`name` ≤ 8 字，`roast` ≤ 24 字，`text` ≤ 70 字，`hint` ≤ 24 字；`grade` 大致 3 N、3 R、2 SR、1 SSR；`weight` 1–10 |

`COMMON.json`：`{ "track": "COMMON", "milestones": [...], "events": [...] }`，id 用 `LM_COMMON_*`、`LE_COMMON_*`；里程碑 ≥ 8，事件 ≥ 20。

写完用 `node scripts/check-v4-content.ts` 自查（格式、长度、数值范围、条件键、引用的 id 是否存在）。

### 4.5 人生标记（`lifeFlags`）

下面这些标记有固定含义，成就与结局都会用到，**写内容时必须用这些名字表达这些事**；为了编排先后可以另加别的大写标记（必须在某处被 `setFlags` 设置过才能在条件里用）。

| 标记 | 含义 | 标记 | 含义 |
|---|---|---|---|
| `H1B` | 抽中 H1B | `H1B_OUT` | 连着三年没抽中（或身份到期） |
| `GREEN_CARD` | 拿到绿卡 | `CANADA` | 去了加拿大 |
| `LAID_OFF` | 被裁过 | `PROMOTED` | 升过职 |
| `JOB_HOP` | 跳过槽 | `BURNOUT` | 职业倦怠 |
| `DATING` | 有了对象 | `MARRIED` | 结婚 |
| `BREAKUP` | 分过手 | `KID` | 有了孩子 |
| `HOUSE` | 买了房 | `PET` | 养了宠物 |
| `CIVIL_SERVANT` | 考公上岸 | `RETURNED` | 从国外回国发展 |
| `STARTUP` | 创过业 | `STARTUP_EXIT` | 创业被收购 |
| `FIRE` | 财务自由、提前退休 | `SIDE_HUSTLE` | 有副业 |
| `INFLUENCER` | 成了博主 | `REAPPLIED` | 重新申请上学 |
| `PHD_QUAL` | 博士资格考通过 | `PAPER` | 发了好论文 |
| `PHD_DONE` | 博士毕业 | `PHD_QUIT` | 博士退学 |
| `FACULTY` | 拿到教职 | | |

### 4.6 天赋在毕业后的作用（内容必须严格按天赋说明实现）

| 天赋 | 毕业后的作用 | 怎么写 |
|---|---|---|
| `T_VISA_KOI` 签证锦鲤 | H1B 每次抽签中签率 70%（平常 30%） | `LOCAL_JOB` 里两条抽签里程碑：带 `talentsAny` 的 700‰ 排在前，带 `talentsNone` 的 300‰ |
| `T_CIVIL_GENE` 考公基因 | 考公上岸的概率是平常的 4 倍 | `HOME_JOB`、`TRANSITION`、`DROPOUT` 的考公里程碑：天赋版 320‰，平常 80‰（最初是 600‰／150‰，回国工作的局里四成考上，太单调） |
| `T_GOOD_LOOKING` 长得好看 | 脱单的概率翻倍 | `COMMON` 的脱单里程碑：天赋版是平常的两倍 |
| `T_NET_SENSE` 网感 | 当上博主的概率翻倍 | 当博主的里程碑：天赋版是平常的两倍 |
| `T_HACKATHON` 黑客松常客 | 创业的概率翻倍 | 创业的里程碑：天赋版是平常的两倍 |
| `T_PROF_KID` 教授家的孩子 | 拿到教职的概率翻倍 | `PHD` 的教职里程碑：天赋版是平常的两倍 |
| `T_LANDLORD` 拆二代 | 可以回家收租 | `HOME_JOB`、`TRANSITION`、`DROPOUT` 各有一条只给它的结局“回家收租”类 |
| `T_REBORN` 重生之我在留学 | 毕业后某年想起一支会涨的股票 | `COMMON` 里一条只给它的里程碑，资金 +12，一局一次 |
| `T_SYSTEM` 叮！系统绑定 | 毕业后偶尔接到系统任务 | `COMMON` 里几条只给它的“叮！”事件（权重高、数值小） |

`lifeGrowth`（毕业后每年基础变化的加成）由引擎直接加到 `LIFE_BASE` 上，内容不用管。

## 5. 中途结局、去向结局、结局卡

- 机制不变（`22` §4–5、`14`）。中途结局多一个可选字段 `lifeTrack`（缺省 `DROPOUT`），比如“家里叫你回去”走 `HOME_JOB`。
- 中途结局 +10 条、去向结局 +10 条（内容见各自文件）。中途结局的 `epilogue` 不再显示（被“五年后”取代），字段保留。
- 轨迹里中途结局那一行改成：“留学在这里提前结束——{名称}。{正文}”。

## 6. 条件键（新增）与上下文

`EndingCondition` 新增的键（`types.ts`）。上下文里没有对应信息时，带 `None` 的键视为满足，其余一律视为不满足。

| 键 | 含义 |
|---|---|
| `focusAny` | 本学期的安排类别在列表里（日常、期中小事、暑假） |
| `tracks` | 毕业后当前轨道在列表里 |
| `yearMin`／`yearMax` | 毕业后第几年（1 起，含两端） |
| `lifeFlagsAll`／`lifeFlagsAny`／`lifeFlagsNone` | 人生标记全有／有其一／全无 |
| `talentsNone` | 这些天赋一张都没有 |
| `flavors`／`earlies` | 当年的去向结局／中途结局 id 在列表里 |
| `routes` | 当年的毕业去向在列表里（中途结局没有） |
| `degrees` | 离开学校时的学段（读过硕士为 `MS`） |
| `economies` | 家境档在列表里 |

各处的上下文：

| 用在 | stage／term | 四属性 | 其它 |
|---|---|---|---|
| 开学小事 | 当前学期 | 此刻 | `focus` 为空 |
| 期中小事 | 当前学期 | 此刻 | `focus` = 本学期安排 |
| 暑假 | 刚结束的学期（出国前：`UG`、0） | 此刻 | `focus` = 刚结束那学期的安排（出国前为空） |
| 日常 | 当前学期 | 期末 | `focus` = 本学期安排 |
| 毕业后 | 离校时的学段与学期 | 此刻 | `track`、`year`、`lifeFlags`、`flavor`、`early`、`route`、`degree`、`transitionMode`、`tier`；安排次数取在校期间的累计 |

所有上下文都带：安排次数、点数、事件标记、天赋、历史、学校、愿望、家境档。

## 7. 轨迹

### 7.1 分段

| 段 id | 标签 | 年龄 | group | 内容 |
|---|---|---|---|---|
| `HS` | 高三 | 17 | SCHOOL | 两张高中事件 |
| `ADMISSION` | 申请季 | 17 | SCHOOL | 同第三版 |
| `SUMMER:HS:0` | 出国前的夏天 | 18 | SUMMER | 暑假的事 |
| `UG:t`、`MS:t` | 大一上 … | §3 | SCHOOL | 见 7.2 |
| `SUMMER:UG:t`、`SUMMER:MS:2` | 大一暑假、大二暑假、大三暑假、硕一暑假 | §3 | SUMMER | 暑假的事 |
| `GRAD:UG`、`GRAD:MS` | 本科毕业、硕士毕业 | §3 | SCHOOL | 平均 GPA 一行、三路机会、去向 |
| `EARLY` | 中途结局 | 当时 | SCHOOL | 一行（§5） |
| `LIFE:k` | 毕业第 k 年（中途结局时为“离校第 k 年”） | 离校年龄 + k | LIFE | 见 7.3 |
| `OUTCOME` | 五年后 | 离校年龄 + 5 | END | “五年后，你成了：{名称}。{描述}” |

没有毕业后五年的局（经典模式）照旧：去向结局那一段叫“后来”。

### 7.2 学期内的行序

`寒假（下学期才可能有）→ 开学小事 → 这学期的安排 → 日常 → 主线事件 → 期中小事 → 日常 → 支线事件 → 资金短缺 → 期末 GPA`（没有的行跳过）。

### 7.3 毕业后每一年的行序

`（第 1 年且是毕业：去向结局一行“毕业后，你成了：{名称}。{描述}”）→ 基础 → 这一年的重心：{名称}。→ 里程碑 → 生活小事 →（换轨时）“从明年起：{新轨道名}。”`

每行附带实际的四属性变化，每段带期末四属性，与第三版一样。

## 8. 人生总结

`SummaryView` 增加 `gpa`（在校各学期 GPA 的平均）与 `life`（`LifeSummary`）。有 `life` 时 `stats` 是五年后的四属性。界面顺序：

1. **五年后**：年龄、稀有度、结局名、吐槽、描述，走过的轨道（如“留美工作 → 回国工作”）。
2. **当年**：去向结局或中途结局（第三版的那一块）。
3. 结局标题与正文、结局卡（不变）。原来的“五年后”一段（`epilogue`）在有 `life` 时不再显示。
4. 事实：五年后的四属性，离开学校时的四属性，平均 GPA，学校，天赋，点数，三路机会。
5. 本局收获、继承天赋、再次重开（不变）。

## 9. 图册与跨局进度

- 进度仍是 `version: 2`，新增可选字段 `outcomes`（五年后的结局出现次数，结构同 `flavors`）；读到旧进度没有这一项按空处理，**不改版本号**，不清空任何人的图册。
- `settleRun` 多记一项五年后的结局；`snapshotOf` 带上 `outcomes`。
- 图册在“去向结局”之后加一栏“五年后”，按轨道分组（组名是轨道名），未解锁的显示 `hint`。结局总数包含它。

## 10. 成就（新增 22 条，`achievements.json` 与引擎判定一致）

“离校时”的属性取 `life.startStats`；原来写“结局时／毕业结局且”的属性类成就（`A_ACADEMICS_100`、`A_CAREER_100`、`A_RICH`、`A_BROKE_GRAD`、`A_FULL_BATTERY`、`A_EMPTY_BATTERY`）一律改用离校时的属性，意思不变。`A_BUSY_LIFE` 的门槛按新的突发小事频率调高（调到均衡分点下约 10% 的局能拿到），说明同步改。

| id | 名称 | 档次 | 条件 |
|---|---|---|---|
| `A_GPA_4` | 满绩 | R | 有一个学期期末 GPA 4.00 |
| `A_GPA_WARNING` | 学术警告 | R | 有一个学期期末 GPA 低于 2.00 |
| `A_DEANS_LIST` | 院长嘉许 | SR | 走到本科毕业，本科平均 GPA ≥ 3.50 |
| `A_FIVE_YEARS` | 五年之后 | N | 看到五年后的结局 |
| `A_GREEN_CARD` | 绿卡到手 | SR | 人生标记 `GREEN_CARD` |
| `A_H1B_OUT` | 三振出局 | R | 人生标记 `H1B_OUT` |
| `A_CANADA` | 润去枫叶国 | R | 人生标记 `CANADA` |
| `A_LAID_OFF` | 被优化 | N | 人生标记 `LAID_OFF` |
| `A_HOUSE` | 上车 | R | 人生标记 `HOUSE` |
| `A_MARRIED` | 成家 | N | 人生标记 `MARRIED` |
| `A_DR` | 终于是博士了 | SR | 人生标记 `PHD_DONE` |
| `A_PHD_QUIT` | 及时止损 | R | 人生标记 `PHD_QUIT` |
| `A_CIVIL` | 上岸 | R | 人生标记 `CIVIL_SERVANT` |
| `A_EXIT` | 提前退休 | SSR | 人生标记 `STARTUP_EXIT` 或 `FIRE` |
| `A_RETURNEE` | 海归 | N | 人生标记 `RETURNED` |
| `A_SWITCH` | 换条路走 | N | 五年里换过轨道（`life.tracks` ≥ 2 项） |
| `A_ZIGZAG` | 折腾人生 | SR | 五年里换过三次轨道（`life.tracks` ≥ 4 项） |
| `A_COMEBACK` | 东山再起 | SR | 中途结局之后，五年后的结局是 SR 或 SSR |
| `A_LIFE_SSR` | 人生赢家 | SSR | 五年后的结局是 SSR |
| `A_OUTCOMES_10` | 阅尽千帆 | SR | 累计见过 10 种五年后的结局（含本局） |
| `A_LIFE_BROKE` | 五年白干 | R | 五年后资金为 0 |
| `A_LIFE_ZEN` | 岁月静好 | R | 五年后身心 ≥ 90 |

## 11. 天赋（新增 21 张，`docs/17`）

新效果键：`gpa`（期末 GPA 加成，单位 0.01，绝对值 ≤ 30）、`lifeGrowth`（毕业后每年基础变化的加成，每项绝对值 ≤ 3）。天赋说明要如实写出毕业后的作用（§4.6），不承诺录取或工作。

| id | 名称 | 稀有度 | 锁定 | 效果 | 说明 |
|---|---|---|---|---|---|
| `T_LAOGANMA` | 老干妈护体 | N | | `initial.wellbeing 3`；`focus.REST.wellbeing 1` | 开局身心 +3，休息类安排身心额外 +1。 |
| `T_RICE_COOKER` | 带了电饭煲 | N | | `initial.money 3, wellbeing 2` | 开局资金 +3、身心 +2。 |
| `T_LIBRARY` | 图书馆钉子户 | N | | `gpa 10`；`focus.STUDY.wellbeing -1` | 期末 GPA +0.10，学习类安排身心多扣 1。 |
| `T_DEADLINE` | 死线战士 | N | | `focus.STUDY.wellbeing 2`；`gpa -10` | 学习类安排身心少扣 2，期末 GPA -0.10。 |
| `T_DRIVER` | 驾照一次过 | N | | `focus.WORK.money 1, wellbeing 1` | 打工类安排资金、身心各额外 +1。 |
| `T_ROOMMATE` | 神仙室友 | N | | `initial.wellbeing 4`；`focus.CAMPUS.wellbeing 1` | 开局身心 +4，校园类安排身心额外 +1。 |
| `T_HOTPOT` | 火锅局组局人 | N | | `focus.CAMPUS.career 1, money -1` | 校园类安排职业额外 +1、资金 -1。 |
| `T_COUPON` | 薅羊毛专家 | N | | `lifeGrowth.money 2` | 毕业后每年资金 +2。 |
| `T_GPA_HUNTER` | 绩点猎人 | R | | `gpa 25`；`focus.STUDY.academics 1` | 期末 GPA +0.25，学习类安排学业额外 +1。 |
| `T_LEETCODE` | 刷题机器 | R | | `chance.LOCAL_JOB 3`；`focus.CAREER.career 1` | 留美工作概率 +3 个百分点，求职类安排职业额外 +1。 |
| `T_CIVIL_GENE` | 考公基因 | R | | `chance.HOME_JOB 3` | 回国工作概率 +3 个百分点；毕业后考公上岸率 ×4。 |
| `T_GOOD_LOOKING` | 长得好看 | R | | `focus.CAMPUS.wellbeing 2` | 校园类安排身心额外 +2；毕业后脱单概率翻倍。 |
| `T_NET_SENSE` | 网感 | R | | `focus.CAMPUS.career 1` | 校园类安排职业额外 +1；毕业后当博主概率翻倍。 |
| `T_THICK_SKIN` | 脸皮厚 | R | | `focus.CAREER.wellbeing 2` | 求职类安排身心少扣 2。 |
| `T_VISA_KOI` | 签证锦鲤 | SR | 是 | `chance.LOCAL_JOB 3` | 留美工作概率 +3 个百分点；H1B 中签率 70%。 |
| `T_PROF_KID` | 教授家的孩子 | SR | | `readiness 5`；`chance.PHD 4` | 准备度 +5，博士概率 +4 个百分点；教职概率翻倍。 |
| `T_LANDLORD` | 拆二代 | SR | 是 | `initial.money 12`；`lifeGrowth.money 3` | 开局资金 +12，毕业后每年资金 +3，能回家收租。 |
| `T_HACKATHON` | 黑客松常客 | SR | | `focus.CAREER.career 2` | 求职类安排职业额外 +2；毕业后创业概率翻倍。 |
| `T_REBORN` | 重生之我在留学 | SSR | 是 | `points 3`；`gpa 20` | 点数 +3，期末 GPA +0.20；毕业后想起一支会涨的股票。 |
| `T_SYSTEM` | 叮！系统绑定 | SSR | 是 | `growth.academics 1, career 1, wellbeing 1` | 每学期学业、职业、身心各 +1；毕业后会接到系统任务。 |
| `T_MAIN_CHARACTER` | 主角光环 | SSR | 是 | `chance` 三路各 4；`lifeGrowth.career 2, wellbeing 2` | 三路机会各 +4 个百分点；毕业后每年职业、身心各 +2。 |

## 12. 内容口吻

沿用 `22` §4：留学生圈子里自嘲的梗与刻板印象，黑色幽默，短。毕业后的梗：H1B 抽签、绿卡排期、湾区房价、Costco、裁员潮、跳槽、35 岁焦虑、相亲角、彩礼、学区房、考公、躺平、润、副业刚需、小红书、博士延毕、导师画饼、青椒非升即走、转码、千老、海归滤镜、同学会、春节被问工资……

- 不写：修仙与超自然；重病、死亡；犯罪的细节或把危险行为写得诱人；歧视；露骨内容。签证与身份只写成日常的焦虑与梗（抽签、排期、被 check），不写遣返、拘押这类事故。
- 人物不分性别：“对象”“TA”。不点名真实的公司与个人（用“大厂”“某厂”）；日常消费品牌（Costco、Trader Joe's）可以作为生活梗出现。
- 每句写一件具体的事，不写数值（数值由界面显示）。

## 13. 验收

- 同样的 seed、天赋、点数（与跨局输入）得到完全相同的一生（含毕业后五年）；存档可从 seed 重放；关掉再打开回到同一局、同一进度。
- 任意合法开局都能走到“五年后”，不会卡住；经典模式与 Python 参考实现逐学期一致，且没有任何第四版内容。
- 均衡分点（四项各 5）：中途结局合计 28%–40%，单条不超过约 6%；学期 GPA 中位数 3.0–3.4；有学期拿到 4.00 的局 5%–25%；有学期低于 2.00 的局 2%–15%；五年里换过轨道的局 15%–45%。
- 全部暑假事件、日常、里程碑、生活小事、五年后的结局、新中途结局与去向结局都能在模拟里出现（带天赋条件的用固定天赋跑）；每条轨道里单个结局不超过该轨道局数的 30%（兜底除外，兜底不超过 35%）。
- 界面全流程仍只有开局两步需要玩家操作，没有可展开的长文。
