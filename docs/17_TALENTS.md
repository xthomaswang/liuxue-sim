# 天赋池

规则见 `16_V2_GAMEPLAY.md`。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 共 36 张：N 14、R 12、SR 7、SSR 3。数组顺序即池内顺序，按稀有度从 N 到 SSR 排；十连抽按这个顺序做加权无放回抽样，所以**不要随意调换顺序**，新增的天赋加在同稀有度的末尾。
- 六张固定天赋 `T_FOCUSED`、`T_PRACTICAL`、`T_OUTGOING`、`T_FRUGAL`、`T_RESILIENT`、`T_REFLECTIVE` 是第一版的六种特质，效果必须与 `03` 第 2.3 节逐项相同（经典模式靠它与 Python 参考实现对拍），脚本会校验。
- `name` 不超过 8 个字，`text` 不超过 40 个字。`text` 必须如实写出 `effects` 的全部内容，数字对得上；不写机制里没有的东西（没有颜值、运气、寿命，不承诺录取、工作或签证）。
- `text` 里的固定说法：五类安排叫“学习类／求职类／校园类／打工类／休息类安排”；四属性叫“资金、学业、职业、身心”；三路机会叫“博士、留美工作、回国工作”；机会加成写“概率 +N 个百分点”；支线加成写“某某支线权重 +N”。
- 强度参考：N 是一个小效果，或有得有失；R 是一个扎实的效果；SR 是两个效果或一个强效果；SSR 是明显强的组合。N 里有 6 张带代价或纯负面的（拖延症、月光族、夜猫子、卷王、社恐、奶茶续命），玩家可以不选。
- `efficiencyFloor` 取的是下限：同时持有 8 和 10 时按 10 算，不相加。

```json
[
  { "id": "T_POCKET_MONEY", "name": "压岁钱没花", "rarity": "N", "text": "开局资金 +5。", "effects": { "initial": { "money": 5 } } },
  { "id": "T_EARLY_BIRD", "name": "早睡早起", "rarity": "N", "text": "开局身心 +6。", "effects": { "initial": { "wellbeing": 6 } } },
  { "id": "T_CLASS_REP", "name": "课代表", "rarity": "N", "text": "开局学业 +5。", "effects": { "initial": { "academics": 5 } } },
  { "id": "T_CLUB_VETERAN", "name": "社团老油条", "rarity": "N", "text": "开局职业 +5。", "effects": { "initial": { "career": 5 } } },
  { "id": "T_HOMESICK", "name": "恋家", "rarity": "N", "text": "更容易遇到家庭支线（家庭支线权重 +3）。", "effects": { "arcWeight": { "FAMILY": 3 } } },
  { "id": "T_WANDERER", "name": "三分钟热度", "rarity": "N", "text": "更容易遇到转向支线（转向支线权重 +3）。", "effects": { "arcWeight": { "REORIENTATION": 3 } } },
  { "id": "T_ENGLISH_CORNER", "name": "英语角常客", "rarity": "N", "text": "申请准备度 +3。", "effects": { "readiness": 3 } },
  { "id": "T_SECONDHAND", "name": "闲鱼卖家", "rarity": "N", "text": "打工类安排资金额外 +1。", "effects": { "focus": { "WORK": { "money": 1 } } } },
  { "id": "T_PROCRASTINATE", "name": "拖延症", "rarity": "N", "text": "学习类安排学业 -2。", "effects": { "focus": { "STUDY": { "academics": -2 } } } },
  { "id": "T_SPENDTHRIFT", "name": "月光族", "rarity": "N", "text": "每学期必要开销 +2。", "effects": { "upkeep": 2 } },
  { "id": "T_NIGHT_OWL", "name": "夜猫子", "rarity": "N", "text": "开局身心 -10，职业 +6。", "effects": { "initial": { "wellbeing": -10, "career": 6 } } },
  { "id": "T_JUANWANG", "name": "卷王", "rarity": "N", "text": "学习类安排学业额外 +3，身心多扣 3。", "effects": { "focus": { "STUDY": { "academics": 3, "wellbeing": -3 } } } },
  { "id": "T_SOCIAL_ANXIETY", "name": "社恐", "rarity": "N", "text": "校园类安排身心 -3，学习类安排学业额外 +1。", "effects": { "focus": { "CAMPUS": { "wellbeing": -3 }, "STUDY": { "academics": 1 } } } },
  { "id": "T_MILK_TEA", "name": "奶茶续命", "rarity": "N", "text": "每学期必要开销 +1，身心基础变化 +1。", "effects": { "upkeep": 1, "growth": { "wellbeing": 1 } } },

  { "id": "T_FOCUSED", "name": "专注", "rarity": "R", "text": "学习类安排学业额外 +2。", "effects": { "focus": { "STUDY": { "academics": 2 } } } },
  { "id": "T_PRACTICAL", "name": "务实", "rarity": "R", "text": "求职类安排职业额外 +2。", "effects": { "focus": { "CAREER": { "career": 2 } } } },
  { "id": "T_OUTGOING", "name": "善交际", "rarity": "R", "text": "校园类安排职业额外 +2，友情支线权重 +2。", "effects": { "focus": { "CAMPUS": { "career": 2 } }, "arcWeight": { "FRIENDSHIP": 2 } } },
  { "id": "T_FRUGAL", "name": "节省", "rarity": "R", "text": "每学期必要开销 -1。", "effects": { "upkeep": -1 } },
  { "id": "T_RESILIENT", "name": "复原", "rarity": "R", "text": "学期安排带来的身心消耗少扣 2。", "effects": { "focusWellbeingRelief": 2 } },
  { "id": "T_REFLECTIVE", "name": "善反思", "rarity": "R", "text": "休息类安排学业额外 +1、身心额外 +3，创作支线权重 +1。", "effects": { "focus": { "REST": { "academics": 1, "wellbeing": 3 } }, "arcWeight": { "CREATIVE": 1 } } },
  { "id": "T_SCHOLARSHIP", "name": "小额奖学金", "rarity": "R", "text": "每学期资助 +1。", "effects": { "stipend": 1 } },
  { "id": "T_TEST_TAKER", "name": "应试高手", "rarity": "R", "text": "申请准备度 +6。", "effects": { "readiness": 6 } },
  { "id": "T_PART_TIMER", "name": "打工战神", "rarity": "R", "text": "打工类安排资金额外 +2。", "effects": { "focus": { "WORK": { "money": 2 } } } },
  { "id": "T_FELLOW_TOWNSMEN", "name": "老乡会会长", "rarity": "R", "text": "回国工作机会的概率 +3 个百分点。", "effects": { "chance": { "HOME_JOB": 3 } } },
  { "id": "T_RED_ENVELOPE", "name": "临行大红包", "rarity": "R", "text": "开局资金 +10。", "effects": { "initial": { "money": 10 } } },
  { "id": "T_CURIOUS", "name": "十万个为什么", "rarity": "R", "text": "开局学业 +4，科研支线权重 +3。", "effects": { "initial": { "academics": 4 }, "arcWeight": { "RESEARCH": 3 } } },

  { "id": "T_TOUGH", "name": "熬夜不上脸", "rarity": "SR", "text": "再累，学习与职业积累也至少按 80% 计。", "effects": { "efficiencyFloor": 8 } },
  { "id": "T_HALF_RIDE", "name": "拿了半奖", "rarity": "SR", "text": "每学期资助 +2。", "effects": { "stipend": 2 } },
  { "id": "T_OLYMPIAD", "name": "竞赛金牌", "rarity": "SR", "text": "申请准备度 +10。", "effects": { "readiness": 10 } },
  { "id": "T_PHD_MATERIAL", "name": "天生读博料", "rarity": "SR", "text": "博士机会的概率 +5 个百分点。", "effects": { "chance": { "PHD": 5 } } },
  { "id": "T_INTERVIEW_ACE", "name": "面霸", "rarity": "SR", "text": "留美工作机会的概率 +5 个百分点，实习支线权重 +2。", "effects": { "chance": { "LOCAL_JOB": 5 }, "arcWeight": { "INTERNSHIP": 2 } } },
  { "id": "T_STEADY", "name": "日拱一卒", "rarity": "SR", "text": "每学期学业基础变化 +1。", "effects": { "growth": { "academics": 1 } } },
  { "id": "T_ZEN", "name": "佛系", "rarity": "SR", "text": "每学期身心基础变化 +1，安排的身心消耗少扣 1。", "effects": { "growth": { "wellbeing": 1 }, "focusWellbeingRelief": 1 } },

  { "id": "T_GOLD_MINE", "name": "家里有矿", "rarity": "SSR", "text": "开局资金 +15，每学期资助 +3。", "effects": { "initial": { "money": 15 }, "stipend": 3 } },
  { "id": "T_IRON_MAN", "name": "铁人", "rarity": "SSR", "text": "身心再低，积累也不打折；开局身心 +10。", "effects": { "efficiencyFloor": 10, "initial": { "wellbeing": 10 } } },
  { "id": "T_KOI", "name": "锦鲤", "rarity": "SSR", "text": "三路毕业机会的概率各 +5 个百分点，申请准备度 +8。", "effects": { "chance": { "PHD": 5, "LOCAL_JOB": 5, "HOME_JOB": 5 }, "readiness": 8 } }
]
```
