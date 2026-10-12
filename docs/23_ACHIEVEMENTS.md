# 成就清单与判定条件

规则见 `22_V3_AUTOSIM.md` §7。名称与说明在 `src/content/achievements.json`；下表是引擎里每条成就的判定条件，两处必须一致。

- “结局时”的属性取本局最后的四属性；“毕业结局”指走到毕业并确定去向的结局（不含中途结局）。
- 类别次数取本局累计的投入次数（本科加硕士）。
- 判定顺序：先判定除 `A_TALENTS_ALL` 以外的全部成就，得到“本局新成就数”；再按 `22` §7.2 抽天赋解锁；最后判定 `A_TALENTS_ALL`（它不反过来影响解锁概率）。
- 已经得到过的成就不再算作“新成就”。

| id | 名称 | 档次 | 条件 |
|---|---|---|---|
| `A_FIRST` | 落地 | N | 任意结局 |
| `A_PHD` | 继续读 | N | 毕业结局且去向为 `PHD` |
| `A_LOCAL` | 留下来 | N | 去向为 `LOCAL_JOB` |
| `A_HOME` | 回家 | N | 去向为 `HOME_JOB` |
| `A_GAP` | 留白 | N | 去向为 `TRANSITION` |
| `A_MASTERS` | 再读一轮 | R | 毕业结局且最终检查点是硕士 |
| `A_EARLY` | 提前离场 | N | 中途结局 |
| `A_ALL_OFFERS` | 全都要 | SR | 最终检查点三路全部 `OFFERED` |
| `A_ALL_MISSED` | 全军覆没 | R | 最终检查点没有任何 `OFFERED`，且至少两路是 `NOT_OFFERED` |
| `A_ACADEMICS_100` | 学业拉满 | R | 结局时学业为 100 |
| `A_CAREER_100` | 职业拉满 | R | 结局时职业为 100 |
| `A_RICH` | 钱包鼓鼓 | R | 毕业结局且资金 ≥ 70 |
| `A_BROKE_GRAD` | 月光毕业 | N | 毕业结局且资金为 0 |
| `A_FULL_BATTERY` | 满电毕业 | R | 毕业结局且身心 ≥ 90 |
| `A_EMPTY_BATTERY` | 电量 0% | N | 毕业结局且身心为 0 |
| `A_NO_WORK` | 从不打工 | R | 毕业结局且打工类次数为 0 |
| `A_WORKER` | 打工皇帝 | R | 打工类次数 ≥ 4 |
| `A_GRINDER` | 卷到底 | R | 学习类次数 ≥ 5 |
| `A_SLACKER` | 躺平大师 | R | 休息类次数 ≥ 3 |
| `A_S_TIER` | 梦校 | SR | 学校档次为 S |
| `A_U_TIER` | 艺术人生 | R | 学校档次为 U |
| `A_MORTAL` | 凡人之躯 | SR | 三张天赋稀有度都是 N，且结局卡等级 ∈ {EX, UR, SSR, SR＋, SR} |
| `A_LUCKY_DRAW` | 欧皇 | SR | 本局十连抽的十张里有 SSR |
| `A_ALL_IN` | 偏科 | N | 某一项点数为 10 |
| `A_DUMP_STAT` | 放弃治疗 | R | 某一项点数为 0，且是毕业结局 |
| `A_EVEN` | 端水大师 | N | 四项点数相等 |
| `A_BUSY_LIFE` | 事儿真多 | R | 本局的突发小事 ≥ 7 条 |
| `A_TOP_TIER` | 见过大场面 | SSR | 结局卡等级 ∈ {EX, UR, SSR} |
| `A_BAD_END` | 翻车现场 | N | 结局卡等级为 BE |
| `A_DREAM` | 闹钟响了 | SSR | 结局卡带隐藏结局 H08 |
| `A_JACKPOT` | 欧皇本皇 | SSR | 中途结局为 `E_LOTTERY` |
| `A_RUNS_10` | 重开十次 | N | 计入本局后累计完成 ≥ 10 局 |
| `A_RUNS_50` | 轮回之人 | SR | 计入本局后累计完成 ≥ 50 局 |
| `A_TIERS_5` | 见多识广 | R | 计入本局后已解锁的主线等级 ≥ 5 种 |
| `A_TIERS_ALL` | 十档全收 | SSR | 计入本局后 10 种主线等级全部解锁 |
| `A_HIDDEN_6` | 隐藏收集者 | SR | 计入本局后已解锁的隐藏结局 ≥ 6 种 |
| `A_EARLY_4` | 花式退场 | SR | 计入本局后已解锁的中途结局 ≥ 4 种 |
| `A_TALENTS_ALL` | 天赋全开 | SSR | 计入本局的解锁结果后，锁定天赋全部解锁 |
