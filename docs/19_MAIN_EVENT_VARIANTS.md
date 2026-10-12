# 主线节点的变体事件

规则见 `16_V2_GAMEPLAY.md`。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 本科八个节点各两张变体：`CORE_0n_V2`、`CORE_0n_V3`。它们与 `04_MAIN_STORY.md` 里的 `CORE_0n` 是同一节点的候选，每局每个节点只出现其中一张，所以每张都独立成立，不引用别的事件，`callbacks` 一律为空。
- 每张承担所在节点的叙事任务（`01` 的“八个节点”表与 `02` 第 5 节）：S1 抵达与安顿；S2 看见实际成本、调整预期；S3 与别人一起做事；S4 暑假的投入与机会成本；S5 两边的生活与比较的压力；S6 把积累变成能展示的材料；S7 别人的消息、去留与对家人的说明；S8 告别与收尾。情境与原事件不同，不是同一件事的改写。
- 只写短文：标题不超过 10 个字，摘要 30–55 个字，选项不超过 16 个字，短结果 15–30 个字。不写 `body` 与 `result`，提取脚本会用摘要和短结果回填。
- 数值沿用 `00` 的边界：四项都列出，单项绝对值不超过 8，四项绝对值之和不超过 16，每张至少一个不花钱的选项。强度与同节点的原事件相当。16 张里花钱的选项只有 2 个。
- 两个选项都有可理解的动机；不承诺录取、工作或签证结果；有薪任务都是学校认可的校内岗位。出场的常驻人物自带一句身份说明，不默认玩家已经认识。

## 事件数据

```json
[
  {
    "id": "CORE_01_V2",
    "kind": "core",
    "stage": 1,
    "title": "第一趟采购",
    "summary": "宿舍里只有一张空床垫。同级生林遥拿着清单约你拼车去大卖场一次买齐，你也可以先在校内小店凑合几天。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "拼车去大卖场，一次买齐",
        "effects": {"money": -4, "academics": 0, "career": 2, "wellbeing": 6},
        "setFlags": ["CORE_01_V2_A"],
        "shortResult": "被褥和锅都齐了，回程路上还记住了几个名字。"
      },
      {
        "id": "B",
        "label": "先在校内小店凑合几天",
        "effects": {"money": 0, "academics": 4, "career": 0, "wellbeing": 2},
        "setFlags": ["CORE_01_V2_B"],
        "shortResult": "床铺简单了些，省下的半天把课程大纲读完了。"
      }
    ]
  },
  {
    "id": "CORE_01_V3",
    "kind": "core",
    "stage": 1,
    "title": "第一次自我介绍",
    "summary": "第一堂讨论课要轮流自我介绍。你准备的英文稿有点长，可以硬着头皮直接讲，也可以先请助教课后陪你练一遍。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "直接上去讲，磕绊也认了",
        "effects": {"money": 0, "academics": 1, "career": 5, "wellbeing": -2},
        "setFlags": ["CORE_01_V3_A"],
        "shortResult": "中间卡了两次，但全班都记住了你的名字。"
      },
      {
        "id": "B",
        "label": "课后先找助教练一遍",
        "effects": {"money": 0, "academics": 4, "career": 0, "wellbeing": 1},
        "setFlags": ["CORE_01_V3_B"],
        "shortResult": "助教帮你删掉一半稿子，下次开口有了底。"
      }
    ]
  },
  {
    "id": "CORE_02_V2",
    "kind": "core",
    "stage": 2,
    "title": "账单比想象的长",
    "summary": "第一年的账单比预想的长。下学年可以搬去更便宜但更远的住处，也可以留在原处，保住每天通勤的时间和力气。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "搬去更远的住处，省下房租",
        "effects": {"money": 7, "academics": -1, "career": 0, "wellbeing": -3},
        "setFlags": ["CORE_02_V2_A"],
        "shortResult": "房租降了，每天多出四十分钟的路。"
      },
      {
        "id": "B",
        "label": "留在原处，保住时间和力气",
        "effects": {"money": 0, "academics": 2, "career": 0, "wellbeing": 3},
        "setFlags": ["CORE_02_V2_B"],
        "shortResult": "开销没变，早上的时间和精力都保住了。"
      }
    ]
  },
  {
    "id": "CORE_02_V3",
    "kind": "core",
    "stage": 2,
    "title": "一门课的B",
    "summary": "第一年有一门课只拿了B。教授还剩最后一次答疑，朋友们约好考完去湖边露营，两件事正好在同一天。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去答疑，把错处问清楚",
        "effects": {"money": 0, "academics": 6, "career": 0, "wellbeing": -3},
        "setFlags": ["CORE_02_V3_A"],
        "shortResult": "你弄懂了丢分的地方，也错过了那顿烤肉。"
      },
      {
        "id": "B",
        "label": "去露营，先让自己缓一缓",
        "effects": {"money": -3, "academics": 0, "career": 1, "wellbeing": 7},
        "setFlags": ["CORE_02_V3_B"],
        "shortResult": "湖边很冷，回来后那个B没那么刺眼了。"
      }
    ]
  },
  {
    "id": "CORE_03_V2",
    "kind": "core",
    "stage": 3,
    "title": "电台缺一个人",
    "summary": "校园电台缺人手。本地同级生艾达·洛文问你，愿不愿意接下一期节目的策划，或者只在录制那天来帮忙。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "接下一期节目的策划",
        "effects": {"money": 0, "academics": 1, "career": 7, "wellbeing": -5},
        "setFlags": ["CORE_03_V2_A"],
        "shortResult": "节目按时播出，你学会了排流程，也熬了两晚。"
      },
      {
        "id": "B",
        "label": "只在录制那天来帮忙",
        "effects": {"money": 0, "academics": 0, "career": 2, "wellbeing": 3},
        "setFlags": ["CORE_03_V2_B"],
        "shortResult": "你搬了设备、递了水，轻松地认识了几个人。"
      }
    ]
  },
  {
    "id": "CORE_03_V3",
    "kind": "core",
    "stage": 3,
    "title": "没交的那一部分",
    "summary": "小组作业里有位组员迟迟不交他的部分。离截止只剩两天，你可以替他补上，也可以找他当面把分工说清楚。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "自己补上，先保证能交",
        "effects": {"money": 0, "academics": 6, "career": 0, "wellbeing": -4},
        "setFlags": ["CORE_03_V3_A"],
        "shortResult": "作业交上了，你多写了一整节，也憋了一肚子话。"
      },
      {
        "id": "B",
        "label": "找他当面把分工说清楚",
        "effects": {"money": 0, "academics": 1, "career": 5, "wellbeing": -3},
        "setFlags": ["CORE_03_V3_B"],
        "shortResult": "谈话有点尴尬，他补上了大半，你学会了开口。"
      }
    ]
  },
  {
    "id": "CORE_04_V2",
    "kind": "core",
    "stage": 4,
    "title": "三周的训练营",
    "summary": "暑假有个三周的学生项目训练营，免费但日程排得很满。你也可以把这个夏天留给自己，读几本书，学会做饭。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "报名训练营，逼自己做个项目",
        "effects": {"money": 0, "academics": 2, "career": 7, "wellbeing": -5},
        "setFlags": ["CORE_04_V2_A"],
        "shortResult": "你做出一个能演示的小项目，三周没睡过整觉。"
      },
      {
        "id": "B",
        "label": "把夏天留给自己，慢慢过",
        "effects": {"money": 0, "academics": 2, "career": 0, "wellbeing": 6},
        "setFlags": ["CORE_04_V2_B"],
        "shortResult": "你读完四本书，学会了三道菜，人也松了下来。"
      }
    ]
  },
  {
    "id": "CORE_04_V3",
    "kind": "core",
    "stage": 4,
    "title": "两个月的夜班",
    "summary": "有同学暑假离校，想请你顶两个月的校内夜班岗位。同级生林遥则约你一起做一本记录校园角落的小册子。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "顶下夜班，把钱攒起来",
        "effects": {"money": 8, "academics": 0, "career": 2, "wellbeing": -6},
        "setFlags": ["CORE_04_V3_A"],
        "shortResult": "存款厚了一截，生物钟整个暑假都是反的。"
      },
      {
        "id": "B",
        "label": "和林遥做小册子，不图钱",
        "effects": {"money": 0, "academics": 1, "career": 4, "wellbeing": 1},
        "setFlags": ["CORE_04_V3_B"],
        "shortResult": "小册子印了三十本，你第一次有了署名的作品。"
      }
    ]
  },
  {
    "id": "CORE_05_V2",
    "kind": "core",
    "stage": 5,
    "title": "别人的进度条",
    "summary": "老同学陆续晒出实习和比赛的消息。你可以马上跟着投一轮申请，也可以先关掉手机，把这学期手头的事做完。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "跟着投一轮，先不落下",
        "effects": {"money": 0, "academics": 0, "career": 6, "wellbeing": -4},
        "setFlags": ["CORE_05_V2_A"],
        "shortResult": "你投出了八份申请，心里踏实又有点空。"
      },
      {
        "id": "B",
        "label": "关掉手机，做完手头的事",
        "effects": {"money": 0, "academics": 4, "career": 0, "wellbeing": 1},
        "setFlags": ["CORE_05_V2_B"],
        "shortResult": "手头的报告交了，那些消息第二天再看也不迟。"
      }
    ]
  },
  {
    "id": "CORE_05_V3",
    "kind": "core",
    "stage": 5,
    "title": "隔着时差的家事",
    "summary": "家里有件事要一起商量，视频定在你的期中周、当地凌晨。你可以熬夜全程参加，也可以请家人会后讲给你听。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "熬夜参加，把话当面说完",
        "effects": {"money": 0, "academics": -2, "career": 1, "wellbeing": 4},
        "setFlags": ["CORE_05_V3_A"],
        "shortResult": "你困得发飘，但那件事里有了你的一票。"
      },
      {
        "id": "B",
        "label": "先顾考试，会后再听结论",
        "effects": {"money": 0, "academics": 4, "career": 0, "wellbeing": -2},
        "setFlags": ["CORE_05_V3_B"],
        "shortResult": "考试稳住了，听转述时心里有一点空。"
      }
    ]
  },
  {
    "id": "CORE_06_V2",
    "kind": "core",
    "stage": 6,
    "title": "推荐信找谁写",
    "summary": "下一步的申请需要推荐人。你可以去找只上过一门课的知名教授，也可以找名气普通、但看着你做了两年事的老师。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "找知名教授，先补一份作业",
        "effects": {"money": 0, "academics": 7, "career": 0, "wellbeing": -5},
        "setFlags": ["CORE_06_V2_A"],
        "shortResult": "教授说愿意先看看你的新作业，再决定写不写。"
      },
      {
        "id": "B",
        "label": "找熟悉你的老师，一起梳理",
        "effects": {"money": 0, "academics": 2, "career": 4, "wellbeing": -3},
        "setFlags": ["CORE_06_V2_B"],
        "shortResult": "老师翻出你两年前的作业，帮你理出一条线。"
      }
    ]
  },
  {
    "id": "CORE_06_V3",
    "kind": "core",
    "stage": 6,
    "title": "简历只能一页",
    "summary": "职业中心的老师说，你的简历写了两页却看不出重点。你可以逐行砍到一页，也可以趁机补一个能写进去的小项目。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "砍到一页，逐行重写",
        "effects": {"money": 0, "academics": 0, "career": 6, "wellbeing": -3},
        "setFlags": ["CORE_06_V3_A"],
        "shortResult": "两页变成一页，每一行都能讲出一件具体的事。"
      },
      {
        "id": "B",
        "label": "补做一个小项目再写",
        "effects": {"money": 0, "academics": 3, "career": 5, "wellbeing": -7},
        "setFlags": ["CORE_06_V3_B"],
        "shortResult": "项目赶出来了，简历多了一行，眼圈也深了。"
      }
    ]
  },
  {
    "id": "CORE_07_V2",
    "kind": "core",
    "stage": 7,
    "title": "那通电话",
    "summary": "家里来电话问毕业后的打算，你自己也还没有答案。可以把几条路和各自的风险摊开讲，也可以先说还在准备。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "把几条路和风险都讲出来",
        "effects": {"money": 0, "academics": 0, "career": 2, "wellbeing": 4},
        "setFlags": ["CORE_07_V2_A"],
        "shortResult": "电话打了一个小时，挂断后你反而想清楚了些。"
      },
      {
        "id": "B",
        "label": "先说还在准备，专心赶材料",
        "effects": {"money": 0, "academics": 3, "career": 4, "wellbeing": -4},
        "setFlags": ["CORE_07_V2_B"],
        "shortResult": "家里没再追问，你把那晚的时间给了材料。"
      }
    ]
  },
  {
    "id": "CORE_07_V3",
    "kind": "core",
    "stage": 7,
    "title": "最后一个名额",
    "summary": "室友收到了回音，整层楼都在讨论去向。职业中心的模拟面试还剩明早最后一个名额，而你昨晚刚熬过夜。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "抢下名额，明早去练",
        "effects": {"money": 0, "academics": 1, "career": 6, "wellbeing": -6},
        "setFlags": ["CORE_07_V3_A"],
        "shortResult": "面试官指出三个毛病，你记了满满一页。"
      },
      {
        "id": "B",
        "label": "让给别人，先补一觉",
        "effects": {"money": 0, "academics": 0, "career": 1, "wellbeing": 6},
        "setFlags": ["CORE_07_V3_B"],
        "shortResult": "你睡到中午，醒来发现事情并没有变糟。"
      }
    ]
  },
  {
    "id": "CORE_08_V2",
    "kind": "core",
    "stage": 8,
    "title": "带不走的一箱",
    "summary": "宿舍要清空了，还剩一箱书和旧物。你可以花一个周末去二手集市摆摊卖掉，也可以直接送给下一届新生。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去二手集市摆摊卖掉",
        "effects": {"money": 5, "academics": 0, "career": 2, "wellbeing": -3},
        "setFlags": ["CORE_08_V2_A"],
        "shortResult": "卖掉了大半，剩下的台灯最后还是送了人。"
      },
      {
        "id": "B",
        "label": "送给新生，附一张说明",
        "effects": {"money": 0, "academics": 0, "career": 1, "wellbeing": 6},
        "setFlags": ["CORE_08_V2_B"],
        "shortResult": "新生抱着箱子道谢，你想起自己刚来的那天。"
      }
    ]
  },
  {
    "id": "CORE_08_V3",
    "kind": "core",
    "stage": 8,
    "title": "还没说的谢谢",
    "summary": "离校前，你想起几位帮过你的人。剩下的时间只够认真做一件事：逐个去当面道谢，或者把这四年的总结写完。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "逐个去当面道谢",
        "effects": {"money": 0, "academics": 0, "career": 2, "wellbeing": 6},
        "setFlags": ["CORE_08_V3_A"],
        "shortResult": "三声谢谢都说出了口，有位老师红了眼眶。"
      },
      {
        "id": "B",
        "label": "把这四年的总结写完",
        "effects": {"money": 0, "academics": 5, "career": 3, "wellbeing": -3},
        "setFlags": ["CORE_08_V3_B"],
        "shortResult": "总结写了六页，你第一次看清这四年的轮廓。"
      }
    ]
  }
]
```
