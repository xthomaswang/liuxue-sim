# 学期安排池

规则见 `16_V2_GAMEPLAY.md`。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 共 20 张：五个类别（`STUDY / CAREER / CAMPUS / WORK / REST`）各 1 张基础安排加 3 张变体。数组按类别分组，每组基础安排在前；数组顺序即池内顺序，每学期按这个顺序抽取，**不要随意调换顺序**，新增的变体加在本类别末尾。
- 基础安排的 `id` 等于类别名、带 `base: true`，名字与数值必须和 `03` 第 3 节的表逐项相同（经典模式只用这五张），脚本会校验。
- 变体的 `id` 形如 `STUDY_LIBRARY`，名字是一件具体的事，不超过 12 个字。数值围绕本类别的基础安排小幅变化、各有侧重，不能有一张全面更好：
  - STUDY：学业 8～13、职业 0～3、身心 -9～-4、资金 0。
  - CAREER：职业 8～12、学业 0～3、身心 -8～-4、资金 0。
  - CAMPUS：学业 1～4、职业 2～6、身心 +3～+8、资金 0 或 -2～-4。
  - WORK：资金 +9～+14、学业 0～2、职业 1～4、身心 -9～-5。
  - REST：身心 +11～+17、学业 0～2、职业 0、资金 0 或 -3～-5。（脚本对安排的每一项数值有 ±17 的上限。）
- 只有 CAMPUS 与 REST 可以有花钱的变体（各至多一张，回报略高）；STUDY、CAREER、WORK 一律不花钱。这样任何学期给出的四个安排里至少有两个不花钱，不会卡死。
- 打工类只写校内学生岗位，不暗示校外受雇。

```json
[
  { "id": "STUDY", "focus": "STUDY", "name": "把时间留给学习", "base": true, "delta": { "money": 0, "academics": 11, "career": 1, "wellbeing": -7 } },
  { "id": "STUDY_LIBRARY", "focus": "STUDY", "name": "泡图书馆赶进度", "delta": { "money": 0, "academics": 13, "career": 0, "wellbeing": -9 } },
  { "id": "STUDY_GROUP", "focus": "STUDY", "name": "组队刷题互相讲", "delta": { "money": 0, "academics": 9, "career": 3, "wellbeing": -5 } },
  { "id": "STUDY_SEMINAR", "focus": "STUDY", "name": "旁听研究生讨论课", "delta": { "money": 0, "academics": 10, "career": 2, "wellbeing": -6 } },

  { "id": "CAREER", "focus": "CAREER", "name": "为工作做准备", "base": true, "delta": { "money": 0, "academics": 2, "career": 10, "wellbeing": -6 } },
  { "id": "CAREER_MOCK", "focus": "CAREER", "name": "改简历加模拟面试", "delta": { "money": 0, "academics": 0, "career": 12, "wellbeing": -8 } },
  { "id": "CAREER_FAIR", "focus": "CAREER", "name": "跑招聘会递简历", "delta": { "money": 0, "academics": 1, "career": 9, "wellbeing": -4 } },
  { "id": "CAREER_PROJECT", "focus": "CAREER", "name": "做个能展示的小项目", "delta": { "money": 0, "academics": 3, "career": 8, "wellbeing": -6 } },

  { "id": "CAMPUS", "focus": "CAMPUS", "name": "参与校园生活", "base": true, "delta": { "money": 0, "academics": 3, "career": 4, "wellbeing": 6 } },
  { "id": "CAMPUS_CLUB", "focus": "CAMPUS", "name": "社团招新去摆摊", "delta": { "money": 0, "academics": 1, "career": 6, "wellbeing": 5 } },
  { "id": "CAMPUS_LECTURE", "focus": "CAMPUS", "name": "蹭讲座和读书会", "delta": { "money": 0, "academics": 4, "career": 2, "wellbeing": 6 } },
  { "id": "CAMPUS_OUTING", "focus": "CAMPUS", "name": "跟社团周末出游", "delta": { "money": -3, "academics": 2, "career": 5, "wellbeing": 8 } },

  { "id": "WORK", "focus": "WORK", "name": "校内兼职补贴开销", "base": true, "delta": { "money": 12, "academics": 1, "career": 3, "wellbeing": -7 } },
  { "id": "WORK_DESK", "focus": "WORK", "name": "图书馆前台值班", "delta": { "money": 9, "academics": 2, "career": 1, "wellbeing": -5 } },
  { "id": "WORK_DINING", "focus": "WORK", "name": "食堂晚班", "delta": { "money": 14, "academics": 0, "career": 2, "wellbeing": -9 } },
  { "id": "WORK_GRADER", "focus": "WORK", "name": "帮课程批作业", "delta": { "money": 10, "academics": 2, "career": 4, "wellbeing": -7 } },

  { "id": "REST", "focus": "REST", "name": "留时间休息整理", "base": true, "delta": { "money": 0, "academics": 1, "career": 0, "wellbeing": 15 } },
  { "id": "REST_SLEEP", "focus": "REST", "name": "狠狠补觉", "delta": { "money": 0, "academics": 0, "career": 0, "wellbeing": 16 } },
  { "id": "REST_ROUTINE", "focus": "REST", "name": "散步做饭写日记", "delta": { "money": 0, "academics": 2, "career": 0, "wellbeing": 12 } },
  { "id": "REST_TRIP", "focus": "REST", "name": "攒个长周末出门", "delta": { "money": -4, "academics": 1, "career": 0, "wellbeing": 17 } }
]
```
