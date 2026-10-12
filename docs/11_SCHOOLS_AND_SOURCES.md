# 全国学校目录、游戏分档与来源

核查日期：2026-10-11（America/New_York）。排名版次固定为 **2027 U.S. News Best Colleges**；发布年份与榜单版次分别保存。

**本文交付全国目录的导入规范、分档规则、官方来源和已核实排名样例，尚未交付全国学校数据库。** 编码阶段需要实际下载目录、核对字段、解析校区、生成版本文件并通过本文验收。不能将下列少量样例硬编码成全部学校，也不能把导入方案写成“全国数据已经齐备”。

## 1. 玩家如何获得学校

玩家先完成家庭与个人背景选择，再完成一次简化的申请准备。系统依据 `13_ADMISSIONS_AND_TEMPO.md` 的申请规则确定一个学校池，从该池抽出 **3 所互不重复的真实学校 offer**，玩家只能在这 3 所中选 1 所。目录可以在资料页搜索，但不能在正式开局中直接点选任意学校。

学校在首版承担背景、城市标签与人生回顾作用。`S/A/B/C/D/U` 不直接增加入学后的 `money`、`academics`、`career`、`wellbeing`，不为工作、博士或硕士机会追加概率。学校分档不能代替玩家后续的选择，也不生成“名校人生一定更好”的结局判断。

抽档与抽校的职责分开：13 定义申请数值怎样产生各档概率；本文定义一所真实学校如何进入某个池，以及如何从池内抽出学校。

## 2. “全国”的可验收边界

主目录以 **IPEDS 院校实体及 UNITID** 为锚点，College Scorecard 作辅助交叉核对。IPEDS 的统计覆盖围绕参与联邦学生资助项目的院校展开，不能据此声称涵盖美国境内每一个未报告机构；其目录、数据年份与发布状态必须随数据保存。[IPEDS 官方介绍](https://nces.ed.gov/ipeds)

首版的全国目标是：在所选官方目录快照中，覆盖美国境内、仍在运营、提供本科教育并可接收新本科生的实体院校；校区按官方 UNITID 分开。美国境内的地理过滤采用该版 IPEDS 字典定义，包含 50 州、DC 及官方目录收录的美国属地院校，排除美国大学的海外校区。英文校名、地点和学校事实不得由生成模型猜补。

### 2.1 目录层与 offer 层分离

导入时保留原始目录中每一行，先生成 `catalog`，再依据证据生成 `offerEligibility`。不符合故事前提的学校仍可在目录中留有记录，并明确为什么未进入 offer 池。

| 情况 | 目录状态 | offer 处理 |
|---|---|---|
| 正常运营、明确授予本科、常规入学且校园故事适用 | `ELIGIBLE` | 进入对应 S–D 或 U 池 |
| 只提供研究生教育 | `EXCLUDED` / `GRADUATE_ONLY` | 不进入本科开局 |
| 只提供两年制、没有本科授予或本科入学路径 | `EXCLUDED` / `NO_BACHELOR_PROGRAM` | 不进入本科开局；不能仅看校名含 Community 就排除 |
| 已关闭，或已有可靠证据停止接收新本科生 | `EXCLUDED` / `CLOSED_OR_NO_NEW_INTAKE` | 保留历史实体与证据，禁止发 offer |
| 必须满足本游戏尚未表达的特殊资格 | `EXCLUDED` / `SPECIAL_ELIGIBILITY_UNSUPPORTED` | 记录具体资格与官方依据，不能只凭校名推断 |
| 仅线上、没有本剧情要求的到校生活 | `EXCLUDED` / `ONLINE_ONLY_STORY_MISMATCH` | 留待另一种故事模式 |
| 学位、运营、招生或身份存在矛盾／关键值缺失 | `REVIEW_REQUIRED` | 暂不发 offer，进入待核清单 |
| 美国境外校区，或仅管理办公室 | `EXCLUDED` / `OUT_OF_SCOPE_ENTITY` | 不进入美国本科生活开局 |

“特殊资格未支持”必须逐校有证据并指出未支持什么，不能把宗教背景、族群服务使命或某种学校类型整体当作排除条件。目录本身不等于现实招生资格认证；这里的 offer 是游戏结果。

凡通过兼容性与数据验证、成为 `ELIGIBLE` 的学校，都必须有可达抽取路径。无排名、排名未核实、规模小、没有中文别名等情况，不能成为从全国目录中丢弃它的理由。`REVIEW_REQUIRED` 的学校则必须出现在覆盖报告里，不能算作“已支持”。

## 3. 可追溯的游戏分档

用户希望有常见的学校档次感。首版用 **一版明确来源的排名作粗映射**，而不宣称存在一套客观、全民认可的大学等级。以下阈值全是游戏设计参数，尤其跨类别与 Regional 映射不是社会共识。

U.S. News 的全国综合大学、全国文理学院及地区性类别属于不同的比较集合。2027 发布说明还指出部分学校调整了类别，因此导入时必须保存当年类别，不能拿旧类别套新名次。[U.S. News 官方发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html)

| 2027 排名类别 | S | A | B | C | D |
|---|---:|---:|---:|---:|---:|
| `NU`：National Universities | 1–20 | 21–50 | 51–100 | 101–200 | 201 及以后 |
| `LAC`：National Liberal Arts Colleges | 1–10 | 11–25 | 26–50 | 51–100 | 101 及以后 |
| `RU_*`：Regional Universities，按各区域独立名次 | 无 | 无 | 1–10 | 11–40 | 41 及以后 |
| `RC_*`：Regional Colleges，按各区域独立名次 | 无 | 无 | 1–5 | 6–20 | 21 及以后 |

`*` 分别为 `NORTH`、`SOUTH`、`MIDWEST`、`WEST`。这些只是 canonical category ID；必须核实来源确实使用对应类别，不能根据州或学校最高学位自行猜类别。

- 文理学院第 10 名与全国综合大学第 10 名不直接等同；它们可以映射到相同游戏池，但原类别、原排名与来源必须保留并可查看。
- Regional 的 B/C/D 映射只是首版配置，不是对教育质量或毕业生价值的评价。不得把其“地区第 1”显示为“全美第 1”。
- 不用专业榜、最佳公立榜、全球榜、创新榜或就业榜替代 Best Colleges 相应总类排名。例如某校计算机第一，不能据此写它全国综合第一。
- 并列名次保存 `tied: true`，按实际名次映射；不能人为打破并列后移动到另一档。
- 排名只公布区间时保存上下限。若整个区间落在同一档，可进入该档；若横跨边界，则进入 U 并写明 `RANK_RANGE_CROSSES_TIER`，不取中点伪造准确名次。
- 当年无可靠记录、来源冲突、类别未核实、榜单未排名时进入 **U：未分档**。U 不是 D 以下，不意味着差校，不能自动赋一个很大的排名。
- 不把上一年的有效排名静默沿用为 2027。旧记录保留在历史中，当年无法核实则 U。

### 3.1 U 池与有序档次的接口

采用 `13_ADMISSIONS_AND_TEMPO.md` 的相同 key 和概率：

1. `draw01(seed, "admission:pool") < 0.10` 时进入独立 U 池。
2. 剩余 90% 进入有序 S–D 流程，使用 `admission:tier` 和 13 中的申请准备度公式。
3. 若 13 给出条件概率 `qS…qD`，显示给玩家的最终概率必须是 `0.9 × qS … 0.9 × qD`，另显示 `U = 0.1`，总和为 1。
4. 家庭、准备度和策略不改变 U 的固定 10%，也不能把 U 当作“申请失败落入最低档”。它的解释是“从尚未按本游戏规则分档的真实学校中收到机会”。
5. 上述是游戏随机机制，不使用现实录取率，不声称预测真实申请结果。

全国发行配置中，S、A、B、C、D、U 每池至少 3 所 `ELIGIBLE` 学校，且每个S–D池在13至少一个合法准备度/策略组合中有大于0的概率。否则启动预检报 `CATALOG_POOL_TOO_SMALL` 或 `CATALOG_POOL_UNREACHABLE`。**不跨档补齐、不复制 offer、不把缺排名学校塞进 D，也不静默关闭 U。** 开发用小样本模式可以单独存在，但必须明显写明“样本目录”，不能通过全国发行验收。

## 4. 同档抽 3 所的确定性规则

学校唯一键为官方 `UNITID` 的十进制字符串，运行时字段名统一为 `unitid`。同一大学系统的不同校区若具有不同 UNITID，则是不同院校实体；不得拿系统总称替代校区。

```ts
type OfferTier = "S" | "A" | "B" | "C" | "D" | "U";

function sampleOffers(seed: number, tier: OfferTier, catalog: SchoolRecord[]) {
  const remaining = catalog
    .filter(s => s.offerEligibility.status === "ELIGIBLE" && s.tier.value === tier)
    .sort((a, b) => a.unitid < b.unitid ? -1 : a.unitid > b.unitid ? 1 : 0);

  if (remaining.length < 3) throw new Error("CATALOG_POOL_TOO_SMALL");
  const offers: SchoolRecord[] = [];
  for (let i = 0; i < 3; i++) {
    const u = draw01(seed, `school:offer:${i}`); // 06 的 [0, 1) 确定性函数
    const index = Math.floor(u * remaining.length);
    offers.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return offers;
}
```

三次均匀抽取、无放回。不要按名气、拼音、学费、学生人数或搜索热度追加权重。池内每所学校被包含在 3 个 offer 中的概率为 `3 / N`；任一具体学校最终进入 offer 的概率，是相应池概率再乘 `3 / N`。只要池概率为正且学校已入池，就具备可达路径。

存档必须保存 `catalogVersion`、`catalogSha256`、`tierMappingVersion`、`rankEdition`、`offerTier`、按展示顺序排列的 `offerUnitids`、玩家选中的 `schoolUnitid`。刷新、展开剧情、回顾页面、网络重试和主题切换均不得重抽。目录更新不改变已有局的学校；无法加载对应快照时明确报版本缺失，不能用新目录同名学校悄悄替换。

## 5. 编码用 catalog schema

下面是本游戏的 canonical schema，不是对外部 API 字段的未经核实声明。适配器负责依据所下载年份的官方字典，将原始字段映射到它。

```ts
type Verification = "VERIFIED" | "PARTIAL" | "UNVERIFIED" | "CONFLICT";
type EligibilityStatus = "ELIGIBLE" | "EXCLUDED" | "REVIEW_REQUIRED";
type RankCategory =
  | "NU" | "LAC"
  | "RU_NORTH" | "RU_SOUTH" | "RU_MIDWEST" | "RU_WEST"
  | "RC_NORTH" | "RC_SOUTH" | "RC_MIDWEST" | "RC_WEST";

interface EvidenceRef {
  sourceId: string;
  sourceUrl: string;
  sourceType: "IPEDS" | "SCORECARD" | "RANK_PUBLISHER" | "INSTITUTION_OFFICIAL";
  sourceYear: number | null;
  publishedAt: string | null;
  retrievedAt: string;
  verification: Verification;
  fieldOrLocator: string;
  rawValue: string | number | boolean | null;
}

interface SchoolRecord {
  unitid: string;
  officialName: string;
  name: string;                 // 剧情 {{school.name}}：已审核简称，否则 officialName
  nameZh: string | null;        // 没有可靠中文名时保持 null
  aliases: string[];
  city: string;                 // {{school.city}}，不能用熟悉的大城市替换实际校区城市
  stateOrTerritory: string;
  country: "US";
  website: string | null;
  campusLabel: string | null;
  parentSystemName: string | null;
  scorecardId: string | null;
  opeids: string[];              // 辅助映射，不作为 UNITID 的替代主键
  institutionFacts: {
    operating: boolean | null;
    offersBachelor: boolean | null;
    acceptsNewUndergraduates: boolean | null;
    inPersonUndergraduateExperience: boolean | null;
    specialEligibilitySupported: boolean | null;
    usLocation: boolean | null;
  };
  offerEligibility: {
    status: EligibilityStatus;
    reasonCodes: string[];
    explanation: string;
    ruleVersion: string;
    evidence: EvidenceRef[];
  };
  ranking: {
    publisher: "US_NEWS";
    edition: 2027;
    category: RankCategory | null;
    rankMin: number | null;
    rankMax: number | null;
    tied: boolean | null;
    status: "VERIFIED" | "UNRANKED" | "MISSING" | "CONFLICT";
    evidence: EvidenceRef[];
  };
  tier: {
    value: OfferTier;
    mappingVersion: "usnews-2027-game-v1";
    reason: string;
  };
  storyProfile: {
    campusTemplate: "GENERIC_US_CAMPUS";
    verifiedLocationTags: string[];
  };
  fieldEvidence: Record<string, EvidenceRef[]>;
  sourceSnapshotIds: string[];
}
```

关键值缺失保留 `null`，不得把它转换为 `false`、`0`、空排名或负面学校判断。提供博士学位不自动说明提供本科；最高学位字段单独不足以排除 graduate-only。`predominant degree` 也不等于唯一授予学位，不能只筛“主要本科”就丢掉同时授予本科的其他学校。

读取外部状态、学位层次、实体类型和缺失值代码时，适配器必须绑定字典版本。以下是输入来源职责：

| canonical 数据 | 首选来源 | 交叉核对与人工处理 |
|---|---|---|
| UNITID、英文实体名、校区所在城市／州 | 当年 IPEDS Directory / HD 文件及字典 | Scorecard、学校官网；系统名与校区分开 |
| 学位授予、本科教学、运营与实体状态 | 同版 IPEDS IC / Directory 相关数据和字典 | 有矛盾时核学校官网，不用模型填布尔值 |
| 新本科招生状态、特殊资格、校园模式 | IPEDS 能明确表达的证据，加学校招生官网 | 无法确认则 `REVIEW_REQUIRED`，不得猜测 |
| 排名类别、版次、名次或区间 | 排名发布者原页面／发布稿 | 学校官网直接公布的本校当年相应类别排名 |
| 中文名、简称与叙事标签 | 经过人工审核的映射文件 | 没有映射时显示官方英文名和通用校园模板 |

College Scorecard 的官方技术资料说明了 UNITID 与 OPEID 并非一一对应，数据覆盖也有具体边界；因此用它辅助实体核对，而不是按名称或 OPEID 随意合并学校。[College Scorecard 官方技术文档](https://collegescorecard.ed.gov/files/InstitutionDataDocumentation.pdf)

## 6. 导入、版本与 provenance

### 6.1 编码阶段应生成的文件

这些是待实现产物，不代表本设计包已经包含它们：

```text
data/schools/
  manifest.json
  catalog.json
  rank-evidence.json
  school-aliases.json
  eligibility-overrides.json
  coverage-report.json
  sources.json
```

原始文件及大体积解压缓存放开发工作目录或项目外数据缓存；可发行 `catalog.json` 只包含必要数据。不要把 API key 写进 manifest、请求日志、网页包或 Git，Scorecard 补充查询若用 key，只从本地 `.env` 或服务端环境读取。运行中的游戏只读已生成快照，不依赖每局联网调用官方 API。

### 6.2 推荐导入流程

1. 从 [IPEDS 官方完整数据文件入口](https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx?fromIpeds=true&gotoReportId=7) 选择同一年的 Directory 与 Institutional Characteristics 文件及对应字典。此次检索可见 2025 年 `HD2025`、`IC2025` 条目；**真正下载时重新确认可用文件、状态和字典**，不把本次网页检索当作已下载。该版若为 provisional，明确保存此状态，之后 final 作为新快照发布。
2. 保存原始 URL、文件名、下载时间、源数据年份、release status、字节数、SHA-256、字典 SHA-256 与导入器版本。不能只存“latest”。
3. 以 UNITID 载入完整实体目录，按官方当年字典解析状态、地点、学位与实体类别，保留原始值。输出重复 ID、缺失 ID、缺失地点、矛盾状态的报告。
4. 若使用 [College Scorecard 数据入口](https://collegescorecard.ed.gov/data/) 或 [官方 API 文档入口](https://collegescorecard.ed.gov/data/api-documentation/) 作补充，先取得官方字典并记录其版本，再实现字段适配。官方候选接口为 `https://api.data.gov/ed/collegescorecard/v1/schools`；本次未成功直读验证其 live response，编码阶段必须验证认证、分页、字段映射、总条数及响应结构，不能根据第三方镜像直接生成生产导入器。批量文件优先，避免逐校重复请求。
5. 按 UNITID 连接辅助资料。名称与别名只用于人工候选匹配，不能自动把“University of Washington”套到所有 UW 校区，也不能让整个大学系统继承一个校区的排名。
6. 导入 `rank-evidence.json`：每条包括学校实体、2027 类别、名次或区间、来源链接、文章发布日期、核查状态。官网公布的“公立第几”“专业第几”只能保留为辅助事实，不能误灌进总类排名。冲突记录降为待核，游戏 tier 为 U。
7. 为每所学校计算兼容性；未知不等于不合格。人工 override 必须附 `reason`、原始值、修正值、官方 URL、核查时间，禁止写一份无来源的排除名单。
8. 对所有 `ELIGIBLE` 学校按第 3 节派生 S–D 或 U。匹配不到当年排名仍可进入 U，不能因排名采集不完整而删除学校。
9. 生成覆盖报告和每池数量，执行第 10 节验收。只有全国快照通过后，才能把产品标记为全国目录模式。
10. 将 manifest 的 `releaseStatus` 从 `DRAFT` 改为 `VALIDATED`；新版本不覆写旧存档依赖的内容哈希。

### 6.3 manifest 的必需信息

```ts
interface CatalogManifest {
  schemaVersion: "1.0";
  catalogVersion: string;       // 例：us-undergrad-2026-10-11-v1，不代表本次已发布
  releaseStatus: "DRAFT" | "VALIDATED";
  mode: "NATIONAL" | "SAMPLE";
  directoryYear: number;
  directoryRelease: "PROVISIONAL" | "FINAL";
  rankEdition: 2027;
  tierMappingVersion: "usnews-2027-game-v1";
  eligibilityRuleVersion: string;
  importerVersion: string;
  catalogSha256: string;
  generatedAt: string;
  sources: Array<{
    id: string;
    publisher: string;
    url: string;
    filename: string;
    sha256: string;
    dictionarySha256: string | null;
    sourceYear: number | null;
    fetchedAt: string;
  }>;
  counts: {
    sourceRows: number;
    distinctEntities: number;
    eligible: number;
    excluded: number;
    reviewRequired: number;
    rankedVerified: number;
    unclassified: number;
    byTier: Record<OfferTier, number>;
  };
}
```

若下载失败、字段变化、来源返回 HTML 错误页或空列表，不得生成空目录后继续游戏。保留可用旧快照并报告导入失败；尚无有效快照时拒绝启动全国模式。

## 7. 本次已核实的 2027 排名样例

以下仅是 **rank evidence 样例**，不是完整 `SchoolRecord`，也不是可直接抽取的全国学校池。本文未批量核对这些实体的 UNITID、全部招生兼容性或当前目录字段；编码时须与主目录精确连接。除 UC 表格用原 National 列外，其余均按来源明确的类别记录。游戏档位是第 3 节规则计算结果。

| 官方学校名／来源中的校区名 | 类别 | 2027 名次 | 游戏档位 | 官方证据 |
|---|---|---:|---|---|
| Massachusetts Institute of Technology | NU | 1 | S | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Princeton University | NU | 2 | S | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Harvard University | NU | 3 | S | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Carnegie Mellon University | NU | 14 | S | [CMU 官方新闻，2026-09-22](https://www.cmu.edu/news/stories/archives/2026/september/carnegie-mellon-university-reaches-historic-high-at-no-14-in-us-news-rankings-takes-no-1-spot-for) |
| Rice University | NU | 16 | S | [Rice 官方新闻，2026-09-22](https://news.rice.edu/news/2026/rice-rises-no-16-us-news-rankings-engineering-business-programs-climb) |
| University of California, Berkeley | NU | 20 | S | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Los Angeles | NU | 20 | S | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, San Diego | NU | 29 | A | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Davis | NU | 34 | A | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Irvine | NU | 34 | A | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Santa Barbara | NU | 44 | A | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Merced | NU | 69 | B | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Riverside | NU | 80 | B | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| University of California, Santa Cruz | NU | 109 | C | [UC 官方 2027 National 列](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) |
| Williams College | LAC | 1 | S | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Amherst College | LAC | 2 | S | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Babson College | RU_NORTH | 1 | B | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Bentley University | RU_NORTH | 2 | B | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |
| Providence College | RU_NORTH | 3 | B | [U.S. News 发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) |

此表尚无足够 C、D、U 样例，也没有提供全国录取池，所以不能拿它直接满足“每池至少三校”的验收。UW、ASU 可以作为地点测试样例，但本文没有逐一核实它们的 2027 对应总类名次，不在此凭记忆填档。

## 8. 地点变量与原创故事适配

- 默认故事只依赖 `{{school.name}}` 与 `{{school.city}}`，其余地点使用图书馆、校园步道、共用厨房、课程合作空间等通用叙事。
- `{{school.name}}` 对应已选中 UNITID 的 `name`，不是玩家可以任意编辑的名校字符串；`{{school.city}}` 使用实际校区的城市字段，不能把附近知名城市偷换为实际地址。
- 不假定所有学校临海、有地铁、积雪、医学中心或大型研究园区。未核实的地点特色不用专有事实语气写入故事。
- 林遥、艾达、许闻溪、周岚及校内合作空间、作品页、研究活动均为原创角色与情境，不宣称任何真实学校有这些具体人物或同名项目。
- 校内排班、补贴与实践活动是抽象游戏情境。实习支线使用已获学校认可的课程合作实践；不把所有国际学生都能自由接受校外工作当作默认故事事实，也不制作现实签证或就业资格指南。
- 如果选中学校不授予硕士，后续“继续硕士”不应写成该校自动延长学籍。硕士阶段默认是另一段已获机会的教育经历，除非后续另有经验证的研究生学校选择模块，不绑定本科院校是否有对应研究生项目。
- 真实背景不增加专属主线数量。全国学校复用 04、05、10、12 的公共文字事件与同一套文字界面；不是每新增一所学校就新写一套剧情。

## 9. 来源核查记录与已知缺口

| 来源 | 本次核查到的内容 | 访问／核查状态 |
|---|---|---|
| [IPEDS 官方首页](https://nces.ed.gov/ipeds) | 搜索索引提供覆盖说明及 2026-07-28 的 Fall 2025 provisional 发布提示 | 官方域名索引可见；正文直读失败，未下载全国数据 |
| [IPEDS 完整文件入口](https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx?fromIpeds=true&gotoReportId=7) | 官方搜索索引显示 2025 Directory `HD2025`、`IC2025` 与字典入口 | 入口已定位；未下载、未解析、未检查每个字段 |
| [College Scorecard 官方技术 PDF](https://collegescorecard.ed.gov/files/InstitutionDataDocumentation.pdf) | 官方索引提供 September 2025 文档、UNITID/OPEID 关系及数据覆盖说明 | `PARTIAL`：只核到官方索引内容，未完整读取 PDF |
| [Scorecard 数据入口](https://collegescorecard.ed.gov/data/)／[API 文档](https://collegescorecard.ed.gov/data/api-documentation/) | 官方地址已定位 | 本次正文直读失败；未做 API live response 校验 |
| [U.S. News 2027 官方发布稿](https://www.prnewswire.com/news-releases/mit-claims-no-1-spot-in-us-news-2027-best-colleges-rankings-302885278.html) | 发布者为 U.S. News & World Report，2026-09-22；含 NU、LAC、Regional 样例及当年类别说明 | 原发布稿正文可读；并非第三方转述榜单 |
| [CMU 2027 排名新闻](https://www.cmu.edu/news/stories/archives/2026/september/carnegie-mellon-university-reaches-historic-high-at-no-14-in-us-news-rankings-takes-no-1-spot-for) | 全国第 14，2027 版次，2026-09-22 发布 | 已读正文 |
| [Rice 2027 排名新闻](https://news.rice.edu/news/2026/rice-rises-no-16-us-news-rankings-engineering-business-programs-climb) | 全国第 16，2026-09-22 发布，文章标题与内容对应本次 2027 榜单 | 已读正文 |
| [UC 2027 排名表](https://www.universityofcalifornia.edu/news/university-of-california-best-public-university-2027-us-news-best-colleges-rankings) | 9 所本科校区的 National 名次，已与 Public 列分开 | 已读正文表格 |
| [U.S. News 方法入口](https://www.usnews.com/education/best-colleges/articles/how-us-news-calculated-the-rankings) | 原官方方法页地址 | 本次正文直读失败，未把无法看到的细节写成已核 |

检索中出现的 `workers.dev` 代理镜像、第三方留学博客、论坛排名和自动接口索引均不作为生产事实来源。数据字典字段、全量记录数、UNITID 连接和逐校入学兼容性，需要在编码阶段完成；不能从这份设计文档推断它们已经核实。

## 10. 全国目录导入验收

### 数据覆盖与证据

1. 原始目录每条记录都有明确结果：进入规范化目录、合并为同一有证据的实体，或进入解析错误报告；不存在无日志丢行。原始行数、唯一实体数与错误／重复计数可核对。
2. 规范化目录的 `ELIGIBLE + EXCLUDED + REVIEW_REQUIRED = distinctEntities`；每个排除和待核记录都有 reason 与来源，不能用一个总数掩盖缺口。
3. 每个 `ELIGIBLE` 学校必须有有效 UNITID、非空官方名、真实地点、适配本科生活的证据和可用 S–D/U 池。缺中文翻译不阻止发行。
4. 全部排名条目都保存当年类别、2027 版次与可追踪官方 URL；专业榜与公立子榜不能冒充总类榜。没有名次时 `rankMin/rankMax = null`，tier 为 U。
5. 任何跨校区继承排名、名称模糊匹配冲突、旧榜冒用新榜都让构建失败或进入待核。禁止生成模型凭印象补 rank、UNITID 或学校地址。
6. 报告明确展示全国导入数、可玩数、排除数、待核数、各档数和当年已核排名数。在完成前不能宣传“覆盖美国所有学校无遗漏”。

### 分档与随机

7. NU 的 20/21、50/51、100/101、200/201；LAC 的 10/11、25/26、50/51、100/101；Regional 表中每个边界都有确定结果。并列不拆，跨档区间进 U。
8. S–D/U 每池至少 3 校；不足时明确报错。每个 `ELIGIBLE` 学校恰好属于一个池，且该池概率大于 0。不得出现只在目录可见却永远不被抽中的合格学校。
9. 同 seed、同目录哈希、同规则版本得到完全相同的 3 个 offer；改变原输入行顺序不改变结果，因为抽样前按 UNITID 字符串排序。
10. 任意抽样结果都恰好 3 个不同 UNITID，来自同一池，且均为 `ELIGIBLE`；刷新不能重抽。验证统计分布时可用固定 seeds 检查均匀性，但不能要求有限样本中每校都一定出现来“证明可达”。
11. U 概率固定 10%，S–D 显示概率总和固定 90%，总概率为 100%；申请准备度不会把 U 改成更低的顺位。
12. 相同入学后属性和经历，只替换学校 UNITID／tier，不改变 03 中的毕业概率或数值结果。

### 故事与发行

13. 全国随机抽样的学校都能渲染现有主线、支线和可选硕士线，没有未替换变量、虚构国名、强制海边场景或“本科院校自动提供硕士”的错误。
14. 生产包只读锁定快照；离线仍能完成一局。导入网络失败、空响应、错误 HTML 和字段变更不会影响已存在的有效目录。
15. `SAMPLE` 与 `NATIONAL` 模式、`DRAFT` 与 `VALIDATED` 状态明确区分。本文 19 条排名样例不能冒充一份通过全国验收的数据库。

全国目录与申请随机只增加开局的三张 offer 卡；不得引入逐校申请、真实文书、专业目录、排名筛选购物流程或每学期重新抽学校。完整一局含硕士仍遵守 10 分钟内的默认呈现目标。
