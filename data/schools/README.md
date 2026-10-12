# 学校目录（精选，不是全国目录）

游戏开局发的三所大学 offer 从这里抽。**这是一份精选目录**：U.S. News 综合大学 1–200 名、约前 50 名的文理学院、十几所专门院校，再加上有 2027 版已核实名次的地区类学校。它不覆盖全美院校，`docs/11` 里“全国目录”的验收条款不适用于这份数据。

实时数字以 `manifest.json` 和 `coverage-report.json` 为准。2026-10-11 最近一次构建：291 所，S 30 / A 44 / B 94 / C 54 / D 52 / U 17，状态 `VALIDATED`。

## 哪些档位是核实过的，哪些不是

每所学校的档位都带一个依据（`tier.basis`，运行时快照里叫 `tierBasis`）：

| 依据 | 含义 | 是否带名次 |
|---|---|---|
| `VERIFIED_2027` | 有一条能被脚本重新抓取并匹配原文的 2027 版 U.S. News 名次证据，按 v2 表映射成档位 | 带（类别、名次、是否并列、来源 URL） |
| `APPROXIMATE` | **模型依据近几版榜单整理的大致区间，没有逐校核实**，可能与 2027 版实际名次不符 | 不带 |
| `UNRANKED_SPECIAL` | 艺术、音乐、工程等专门院校，按“不进综合大学／文理学院总榜”处理，进 U 池；**同样没有逐校核实** | 不带 |

最近一次构建里三者分别是 67 / 207 / 17 所。2027 版有大约两成学校调整了排名类别，所以 `APPROXIMATE` 的学校里难免有类别或区间已经变了的；发现后补一条证据即可，证据永远优先于大致档位。

## 文件

| 文件 | 性质 | 内容 |
|---|---|---|
| `curated-schools.json` | 手工维护的输入 | 精选名单：`unitid`、`ipedsName`、`group`（NU/LAC/REGIONAL/SPECIAL）、`approxTier`、`note` |
| `school-aliases.json` | 手工维护的输入 | 中文校名；`reviewStatus` 是 `MODEL_CURATED_PENDING_HUMAN_REVIEW`，即模型整理、尚未人工审核 |
| `eligibility-overrides.json` | 手工维护的输入 | 带学校官方依据的资格修正（目前 1 条：The Citadel） |
| `evidence/*.json` | 输入 | 2027 版名次证据，每条带来源 URL 与页面原文引文 |
| `evidence-verification.json` | 缓存 | 每条证据的机械复核结果（HTTP 状态、页面 SHA-256、抓取时间、各项检查） |
| `catalog.json` | 产物 | 精选目录的完整记录（按 UNITID 字符串排序，输入不变时字节不变） |
| `manifest.json` | 产物 | 版本、状态、来源文件哈希、各类计数；`catalogSha256` 是 `catalog.json` 的 SHA-256 |
| `rank-evidence.json` | 产物 | 全部证据条目及其复核状态 |
| `coverage-report.json` | 产物 | 各池数量与 ≥3 检查、因资格被剔除的学校、名次超出范围的学校（`outOfScopeRank`）、连接失败、未通过的证据、档位出入、已知缺口 |
| `sources.json` | 产物 | IPEDS 文件与字典的哈希、发布状态依据、每个证据页面的抓取记录 |
| `../../src/content/schools/catalog.runtime.json` | 产物 | 游戏运行时读的精简快照（一行一所学校） |

原始 IPEDS 压缩包不在仓库里，放在 `~/Developer/ml_source/datasets/ipeds/2024/`。

## 数据来源与年份

- **目录年份 2024**：IPEDS `HD2024.zip`（Directory）与 `IC2024.zip`（Institutional Characteristics），2024-25 采集，各自的字典 `*_Dict.zip` 一并使用。下载时间与四个文件的 SHA-256 见 `sources.json`。
- `HD2025` / `IC2025` 在导入时官网返回 404，`docs/11` 说“2025 已可见”没有得到证实，所以用 2024。
- **发布状态 `PROVISIONAL`**：IC 字典首页写着 “(Provisional release 1)”；HD 字典只写 “(Release 1)”，没有 provisional/final 字样，按同批次的 IC 标注判定。NCES 的 Access Database 下载页也把 2024-25 标为 Provisional，作为旁证记录在 `sources.json`，不参与判定。两份字典都没有标注时会如实写 `UNVERIFIED`（对 `docs/11` 类型的有意扩展）。
- **排名版次 2027**（U.S. News Best Colleges，2026-09-22 发布）。

## 学校怎样进目录

1. 候选 = `curated-schools.json` 里的学校 ∪ 有 `VERIFIED` 证据的学校（后者不在名单里也算候选）。
2. 精选名单的每条都用 `unitid` 连接 HD2024，并要求 `ipedsName` 与该行的 `INSTNM` 完全一致。对不上的不收、写进报告，目录降为 `DRAFT`。**从不按校名模糊匹配，从不让一个校区继承另一个校区的名次**——同一大学系统的不同校区是不同的 UNITID。
3. 候选逐一过 IPEDS 资格规则，不合格的剔除并在 `coverage-report.json` 的 `removedSchools` 里写明原因。
4. 范围上限（见下一节）：已核实名次超出范围的学校不收，单列在 `outOfScopeRank`。
5. 分档：有 `VERIFIED` 证据 → 按真实名次映射；否则用名单里的大致档位；地区类学校没有证据就不收。同一学校的多条已核实证据互相矛盾时，名单内的回退到大致档位并记 `CONFLICT`，名单外的不收。证据与大致档位相差两档以上的列在 `tierDiscrepancies` 里供人工看一眼。

## 范围上限（`curated-scope-v2`）

用户定的范围是“U.S. News 综合大学 1–200 + 最好的一批文理学院 + 少量特殊学院”，所以：

- 有 2027 版已核实名次、且**综合大学（NU）名次大于 200** 的学校不进目录；
- 有 2027 版已核实名次、且**文理学院（LAC）名次大于 50** 的学校不进目录；
- 无论该校是否在精选名单里都适用——名单里的学校一旦被证据证明在范围之外，同样剔除，不回退到大致档位（Kent State、UT Arlington 就是这样剔除的）；
- 区间名次按下限 `rankMin` 判断（例如 195–205 仍在范围内）；
- 地区类（`RU_*` / `RC_*`）与专门院校不设上限；只有大致档位（`APPROXIMATE`）的学校不受影响。

被这条规则排除的学校列在 `coverage-report.json` 的 `outOfScopeRank`（UNITID、校名、类别、名次、证据 URL）。它们的证据仍以 `VERIFIED` 保留在 `rank-evidence.json` 里（`inCatalog: false`、`outOfScopeRank: true`），不算被拒证据，也不算资格剔除。最近一次构建有 14 所：综合大学 236–353 名的 10 所、文理学院 72–132 名的 4 所。

规则版本记在 `manifest.json` 的 `scopeRuleVersion`。v1 指此前没有上限的行为（有已核实证据就收）。

## 分档 v2（`usnews-2027-game-v2`）

全部是游戏参数，不是对学校质量的评价。

| 2027 类别 | S | A | B | C | D |
|---|---|---|---|---|---|
| 综合大学 `NU` | 1–20 | 21–50 | 51–100 | 101–150 | 151 及以后 |
| 文理学院 `LAC` | 1–10 | 11–25 | 26–50 | 51–100 | 101 及以后 |
| 地区大学 `RU_*`（各区域独立名次） | — | — | 1–10 | 11–40 | 41 及以后 |
| 地区学院 `RC_*`（各区域独立名次） | — | — | 1–5 | 6–20 | 21 及以后 |

并列按实际名次映射，不拆。名次是区间时，整个区间落在同一档才进该档，跨档边界的进 U（`RANK_RANGE_CROSSES_TIER`）。专门院校进 U。与 `docs/11` 的 v1 相比，只改了综合大学 C/D 的分界（200/201 → 150/151），因为目录范围只到 200 名上下。

## 证据怎样才算 `VERIFIED`（`quote-match-v2`）

构建脚本用 `scripts/schools/lib/text.ts` 重新抓取 `sourceUrl`，全部满足才通过：

- HTTP 2xx；
- 规范化后的页面正文包含 `quote`（有 `categoryQuote` 时也要包含）；
- 正文出现 “2027”；
- 能确认页面说的是这所学校：页面就在该校 IPEDS 登记官网的同一注册域下，或正文出现来源里的校名写法／IPEDS 校名；
- `quote` 里出现名次数字（区间则上下限都要出现）。

来源只认两类：U.S. News 在 PR Newswire 的新闻稿（`RANK_PUBLISHER`），以及 `.edu` 域名或与该校官网同域的页面（`INSTITUTION_OFFICIAL`）。usnews.com 本机抓不到，无法复核，所以不收；新闻媒体、博客、百科一律不收。版次不是 2027 的直接拒收。抓不到的页面（403/406 等）只能放弃，例如 Rice 的官方新闻页对 curl 返回 406，所以 Rice 目前仍是大致档位。

机械复核只能证明“页面上有这句话”，引文说的是不是综合总榜名次（而不是公立榜、专业榜）要靠采集时的判断，`rank-evidence.json` 里留着引文可以抽查。`coverage-report.json` 的 `evidence.warnings` 会提示同类别同名次但没标并列的情况。

## 资格规则 `eligibility-v1`

只读 IPEDS 字典编码字段，不看校名。适配器绑定字典：用到的每个变量必须存在、标题一致、取值代码与标签和代码里写的完全一致，数据里出现字典外取值也算失败——任何一项不符，构建在写文件之前中止。

| 事实 | 依据的字段 | 为 false 时 |
|---|---|---|
| `usLocation` | HD `STABBR` / `FIPS`：50 州、DC 与属地（AS/GU/MP/PR/VI）为 true；FM/MH/PW 是自由联系邦主权国家 | `OUT_OF_SCOPE_ENTITY` |
| `operating` | HD `ACT`、`CYACTIVE`、`CLOSEDAT`：A/N/R 且当年在办为 true；M/D/C 为 false；G（子校区随主校区上报）未知 | `CLOSED_OR_NO_NEW_INTAKE` |
| `offersBachelor` | IC `LEVEL5` 为主，HD `HLOFFER` / `UGOFFER` / `HDEGOFR1` / `DEGGRANT` / `INSTCAT` 交叉核对；没有 IC 行时 `HLOFFER` 低于学士可确定为 false | `GRADUATE_ONLY` 或 `NO_BACHELOR_PROGRAM` |
| `acceptsNewUndergraduates` | IC `FT_FTUG` / `PT_FTUG`：任一为 Yes 即 true，都为 No 即 false | `SPECIAL_ELIGIBILITY_UNSUPPORTED`（不招首次入学新生，游戏“高中毕业直接入学”的前提不成立） |
| `inPersonUndergraduateExperience` | IC `DISTNCED`（全部项目是否完全远程） | `ONLINE_ONLY_STORY_MISMATCH` |
| `specialEligibilitySupported` | HD `OBEREG=0`（U.S. Service schools）或 `OPENPUBL=0` 为 false | `SPECIAL_ELIGIBILITY_UNSUPPORTED` |

另外 HD `SECTOR=0`（管理办公室）直接 `OUT_OF_SCOPE_ENTITY`。缺失值（-1/-2）、HD 与 IC 矛盾、IC 没有对应行时，相应事实保持 `null`，状态是 `REVIEW_REQUIRED`，不会被当成 false，也不会进目录。

`specialEligibilitySupported = true` 只表示“规则没有识别出游戏未表达的特殊资格”。IPEDS 表达不了单一性别、特定信仰或军事化管理这类限制，需要在 `eligibility-overrides.json` 里逐校写明并附官方 URL 与页面原文；构建时用和排名证据相同的方式复核，复核不过的覆盖不生效。目前唯一一条是 The Citadel：它在新闻稿里是南部地区大学第 1，但官方自述为军事学院、学员团过军事化生活，按“军校排除”的范围剔除。

## 重新生成

```bash
npm run schools:build                      # 等价于 node scripts/schools/build-catalog.ts
node scripts/schools/build-catalog.ts --offline            # 不联网，只用复核缓存
node scripts/schools/build-catalog.ts --refresh-evidence   # 全部证据重新抓取
node scripts/schools/build-catalog.ts --ipeds-dir <目录>    # 或设置 LIUXUE_IPEDS_DIR
npx vitest run scripts/schools             # 管线测试
```

默认行为：缓存里已有结论的证据不重抓，只抓新增的和上次因网络失败的。往 `evidence/` 里加了证据文件或条目之后，要联网跑一次再提交——测试会检查已提交的产物能否由输入离线重现。`manifest.json` 的 `generatedAt` 只在目录内容变化时更新，所以重复运行不会产生无意义的 diff。输入解析失败时不写任何文件，已有的有效产物不会被空目录覆盖。

查一个页面能不能当证据：

```bash
node scripts/schools/fetch-text.ts "<url>" --grep "No\. ?\d+" --context 200
node scripts/schools/fetch-text.ts "<url>" --check "从上面输出里复制的一段连续原文"
```

## 中文校名

`school-aliases.json` 是模型按通行译名整理的，没有经过人工审核。没有通行译名或容易混淆的留 `null`，界面回退显示 IPEDS 的官方英文名。为避免歧义，Northwestern 写作“美国西北大学”、Northeastern 写作“美国东北大学”、Wesleyan 写作“维思大学”。城市名直接用 IPEDS 的 `CITY`，不替换成附近的大城市。

## 已知缺口

- `APPROXIMATE` 与 `UNRANKED_SPECIAL` 的档位没有逐校核实。
- 综合大学前 100 名里只有十来所有已核实证据（U.S. News 新闻稿前三、UC 系统页、CMU），其余都是大致档位；这部分证据的采集中途停了。
- 范围上限只能作用于有已核实名次的学校；`APPROXIMATE` 的学校如果在 2027 版里实际已经掉出 200 名（或文理学院 50 名），在补上证据之前仍会留在目录里。
- 资格规则识别不了 IPEDS 之外的入学限制，见上文关于人工覆盖的说明。
- 目录年份是 2024，发布状态是 provisional；NCES 发布 final 版或 2025 版后应作为新快照重新生成，并更换 `catalogVersion`。

## 与 docs/11 的出入

- 范围从全国目录改为精选目录：`mode` 是 `CURATED`，没有全国 U 池，`catalog.json` 只含入选学校，覆盖报告不再逐行交代原始目录的去向。
- 分档表是 v2（见上）。
- 记录比 `docs/11 §5` 多了 `group`、`curation`（是否在名单内、大致档位、备注）和 `tier.basis`。
- 多了一条范围上限规则（`curated-scope-v2`），`docs/11` 里没有对应条款。
- `directoryRelease` 多了一个 `UNVERIFIED` 取值。
