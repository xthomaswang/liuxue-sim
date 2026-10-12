# 随机事件池

规则见 `16_V2_GAMEPLAY.md`。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 本科第 2–7 学期的主线槽有 45% 的机会换成这里的一张，一局内不重复。所以每张都要放在任何年级都成立：不写“大一”“毕业前”这类固定时间，也不依赖别的事件发生过。
- 题材是留学日常里的小取舍，每张两个选项，各有得失；不承诺录取、工作或签证，有薪的事都是校内岗位。
- 只写标题、摘要、选项与短结果，不写长正文与长结果（提取时长文回退为短文）。`callbacks` 一律留空。
- 字数：标题不超过 10 个字，摘要 30–55 个字，选项不超过 16 个字，短结果 15–30 个字。
- 数值：四项都写；单项绝对值不超过 8，四项绝对值之和不超过 16；每张至少一个选项不花钱；全池花钱的选项不超过 6 个。
- id 为 `RANDOM_01` 起的两位编号，`kind` 为 `random`，`scope` 为 `UG`；每个选项的唯一标记是 `<事件ID>_<A|B>`。

## 事件数据

```json
[
  {
    "id": "RANDOM_01",
    "kind": "random",
    "scope": "UG",
    "title": "室友的闹钟",
    "summary": "室友的闹钟每天清晨连响五遍，人却不起。你可以当面商量作息，也可以买副耳塞自己解决。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "当面商量，约好作息",
        "effects": {
          "money": 0,
          "academics": 0,
          "career": 3,
          "wellbeing": 4
        },
        "setFlags": [
          "RANDOM_01_A"
        ],
        "shortResult": "你们约好闹钟只响一遍，谈话比想象中顺利。"
      },
      {
        "id": "B",
        "label": "买副耳塞，自己解决",
        "effects": {
          "money": -2,
          "academics": 2,
          "career": 0,
          "wellbeing": 5
        },
        "setFlags": [
          "RANDOM_01_B"
        ],
        "shortResult": "耳塞很管用，你睡得安稳，这事也没再提起。"
      }
    ]
  },
  {
    "id": "RANDOM_02",
    "kind": "random",
    "scope": "UG",
    "title": "二手自行车",
    "summary": "有毕业生在群里低价转让一辆自行车。买下来去哪儿都快一些；不买，就继续走路和等校车。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "买下来，省下路上的时间",
        "effects": {
          "money": -5,
          "academics": 3,
          "career": 0,
          "wellbeing": 4
        },
        "setFlags": [
          "RANDOM_02_A"
        ],
        "shortResult": "车链子有点响，但去图书馆只要五分钟了。"
      },
      {
        "id": "B",
        "label": "继续走路，把钱留着",
        "effects": {
          "money": 0,
          "academics": 3,
          "career": 0,
          "wellbeing": 3
        },
        "setFlags": [
          "RANDOM_02_B"
        ],
        "shortResult": "你照旧走路上课，路上听完了好几期播客。"
      }
    ]
  },
  {
    "id": "RANDOM_03",
    "kind": "random",
    "scope": "UG",
    "title": "划水的组员",
    "summary": "小组作业快到期，有位组员一直没交自己那部分。你可以替他补上，也可以找他把话说清楚。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "自己补上，先保住成绩",
        "effects": {
          "money": 0,
          "academics": 6,
          "career": 0,
          "wellbeing": -5
        },
        "setFlags": [
          "RANDOM_03_A"
        ],
        "shortResult": "作业按时交了，你为此多熬了两个晚上。"
      },
      {
        "id": "B",
        "label": "找他谈，重新分工",
        "effects": {
          "money": 0,
          "academics": 2,
          "career": 5,
          "wellbeing": -3
        },
        "setFlags": [
          "RANDOM_03_B"
        ],
        "shortResult": "他交来一版能用的，你也学会了怎么开口催人。"
      }
    ]
  },
  {
    "id": "RANDOM_04",
    "kind": "random",
    "scope": "UG",
    "title": "同学想借钱",
    "summary": "一位同学周转不开，想向你借一笔钱，说下个月还。你手头也不宽裕，拒绝又不太好开口。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "借给他，约好归还日期",
        "effects": {
          "money": -4,
          "academics": 0,
          "career": 1,
          "wellbeing": 3
        },
        "setFlags": [
          "RANDOM_04_A"
        ],
        "shortResult": "你借了，并把归还的日期写进了备忘录。"
      },
      {
        "id": "B",
        "label": "说明难处，帮他想办法",
        "effects": {
          "money": 0,
          "academics": 1,
          "career": 3,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_04_B"
        ],
        "shortResult": "你陪他查了学校的紧急补助，开口拒绝时仍有些别扭。"
      }
    ]
  },
  {
    "id": "RANDOM_05",
    "kind": "random",
    "scope": "UG",
    "title": "两门课撞了",
    "summary": "两门想上的课排在同一时段：一门偏方法训练，一门请业内的人来讲实际项目。只能选一门。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "选方法课，把基础打牢",
        "effects": {
          "money": 0,
          "academics": 7,
          "career": 0,
          "wellbeing": -3
        },
        "setFlags": [
          "RANDOM_05_A"
        ],
        "shortResult": "作业很多，但你第一次看懂了那些公式的来历。"
      },
      {
        "id": "B",
        "label": "选项目课，听实际做法",
        "effects": {
          "money": 0,
          "academics": 1,
          "career": 6,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_05_B"
        ],
        "shortResult": "每周都有人来讲真实项目，你记了一整本问题。"
      }
    ]
  },
  {
    "id": "RANDOM_06",
    "kind": "random",
    "scope": "UG",
    "title": "宿舍停电",
    "summary": "晚上整栋宿舍楼停电，明天还有作业要交。你可以去图书馆熬夜赶完，也可以早点睡、明早再说。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去图书馆赶完作业",
        "effects": {
          "money": 0,
          "academics": 6,
          "career": 0,
          "wellbeing": -5
        },
        "setFlags": [
          "RANDOM_06_A"
        ],
        "shortResult": "作业赶完了，走回宿舍时天已经亮了。"
      },
      {
        "id": "B",
        "label": "早点睡，明早再赶",
        "effects": {
          "money": 0,
          "academics": -2,
          "career": 0,
          "wellbeing": 6
        },
        "setFlags": [
          "RANDOM_06_B"
        ],
        "shortResult": "你睡了个整觉，早上交了一份不太完整的作业。"
      }
    ]
  },
  {
    "id": "RANDOM_07",
    "kind": "random",
    "scope": "UG",
    "title": "志愿者缺人",
    "summary": "校园开放日缺志愿者，负责的同学想拉你去带一天参观队伍。那天你本来打算留给自己。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去带队，认识些新面孔",
        "effects": {
          "money": 0,
          "academics": 0,
          "career": 5,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_07_A"
        ],
        "shortResult": "你带了三拨访客，嗓子哑了，也记住了几个名字。"
      },
      {
        "id": "B",
        "label": "婉拒，把这天留给自己",
        "effects": {
          "money": 0,
          "academics": 2,
          "career": 0,
          "wellbeing": 5
        },
        "setFlags": [
          "RANDOM_07_B"
        ],
        "shortResult": "你睡到自然醒，把积压的衣服和邮件都处理完了。"
      }
    ]
  },
  {
    "id": "RANDOM_08",
    "kind": "random",
    "scope": "UG",
    "title": "校内黑客松",
    "summary": "周末有一场校内黑客松，可以临时组队做个小作品。参加要连熬两晚，而下周一还有测验。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "组队参加，做个小作品",
        "effects": {
          "money": 0,
          "academics": -2,
          "career": 8,
          "wellbeing": -5
        },
        "setFlags": [
          "RANDOM_08_A"
        ],
        "shortResult": "作品勉强能跑，展示时你讲清了自己做的部分。"
      },
      {
        "id": "B",
        "label": "不参加，安心准备测验",
        "effects": {
          "money": 0,
          "academics": 6,
          "career": 0,
          "wellbeing": -1
        },
        "setFlags": [
          "RANDOM_08_B"
        ],
        "shortResult": "测验考得不错，朋友圈里全是别人的作品照片。"
      }
    ]
  },
  {
    "id": "RANDOM_09",
    "kind": "random",
    "scope": "UG",
    "title": "每周的视频",
    "summary": "家里想每周固定视频一次，时间正好撞上你平时自习的晚上，时差让别的时段都不太方便。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "答应下来，每周视频",
        "effects": {
          "money": 0,
          "academics": -2,
          "career": 0,
          "wellbeing": 6
        },
        "setFlags": [
          "RANDOM_09_A"
        ],
        "shortResult": "每周听听家里的琐事，自习少了一晚，心里踏实些。"
      },
      {
        "id": "B",
        "label": "改成隔周，平时留言",
        "effects": {
          "money": 0,
          "academics": 4,
          "career": 0,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_09_B"
        ],
        "shortResult": "你们约好隔周视频，平时用语音留言补上。"
      }
    ]
  },
  {
    "id": "RANDOM_10",
    "kind": "random",
    "scope": "UG",
    "title": "周末顶班",
    "summary": "校内学生服务点临时缺人，排班负责人周岚问你能否顶一个周末的班。那两天你原本约了人复习。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去顶班，赚这笔报酬",
        "effects": {
          "money": 6,
          "academics": 0,
          "career": 2,
          "wellbeing": -4
        },
        "setFlags": [
          "RANDOM_10_A"
        ],
        "shortResult": "你站了两天柜台，领到报酬，复习只好往后挪。"
      },
      {
        "id": "B",
        "label": "按原计划复习",
        "effects": {
          "money": 0,
          "academics": 6,
          "career": 0,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_10_B"
        ],
        "shortResult": "你们把半学期的笔记过了一遍，周岚另找了人。"
      }
    ]
  },
  {
    "id": "RANDOM_11",
    "kind": "random",
    "scope": "UG",
    "title": "长假留校",
    "summary": "长假里校园空了大半，食堂只开一个窗口。有同学组织留校的人一起做顿饭，每人摊一点钱。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去凑一桌，摊钱买菜",
        "effects": {
          "money": -3,
          "academics": 0,
          "career": 1,
          "wellbeing": 7
        },
        "setFlags": [
          "RANDOM_11_A"
        ],
        "shortResult": "十几个人挤在公共厨房，你带的菜最先被吃完。"
      },
      {
        "id": "B",
        "label": "一个人安静过完假期",
        "effects": {
          "money": 0,
          "academics": 4,
          "career": 0,
          "wellbeing": 3
        },
        "setFlags": [
          "RANDOM_11_B"
        ],
        "shortResult": "你把拖了很久的阅读补完，也睡了几个懒觉。"
      }
    ]
  },
  {
    "id": "RANDOM_12",
    "kind": "random",
    "scope": "UG",
    "title": "食堂涨价",
    "summary": "学校食堂的套餐又涨价了。你可以开始自己做饭，省钱但费时间；也可以照旧在食堂解决。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "自己做饭，省下餐费",
        "effects": {
          "money": 4,
          "academics": -3,
          "career": 0,
          "wellbeing": 1
        },
        "setFlags": [
          "RANDOM_12_A"
        ],
        "shortResult": "你学会了三道菜，周日下午都花在了备餐上。"
      },
      {
        "id": "B",
        "label": "照旧吃食堂，省时间",
        "effects": {
          "money": -3,
          "academics": 3,
          "career": 0,
          "wellbeing": 1
        },
        "setFlags": [
          "RANDOM_12_B"
        ],
        "shortResult": "你多付了饭钱，省下的时间都用来赶作业。"
      }
    ]
  },
  {
    "id": "RANDOM_13",
    "kind": "random",
    "scope": "UG",
    "title": "老同学路过",
    "summary": "老同学路过这座城市，想让你带着逛两天。可这周你正好有一份报告要收尾，时间只够顾一头。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "陪他逛两天",
        "effects": {
          "money": -3,
          "academics": -2,
          "career": 0,
          "wellbeing": 7
        },
        "setFlags": [
          "RANDOM_13_A"
        ],
        "shortResult": "你们把攻略上的地方走了一遍，报告交得有点赶。"
      },
      {
        "id": "B",
        "label": "只约一顿饭，先赶报告",
        "effects": {
          "money": 0,
          "academics": 5,
          "career": 0,
          "wellbeing": -1
        },
        "setFlags": [
          "RANDOM_13_B"
        ],
        "shortResult": "你们吃了顿饭，他自己去逛，你把报告改完了。"
      }
    ]
  },
  {
    "id": "RANDOM_14",
    "kind": "random",
    "scope": "UG",
    "title": "临时搬宿舍",
    "summary": "宿舍楼要检修，学校让你这周内搬到另一栋。可以请一天假一次搬完，也可以每天课后搬一点。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "请一天假，一次搬完",
        "effects": {
          "money": 0,
          "academics": -3,
          "career": 0,
          "wellbeing": 5
        },
        "setFlags": [
          "RANDOM_14_A"
        ],
        "shortResult": "一天搬完，新房间收拾好了，落下的课还得补。"
      },
      {
        "id": "B",
        "label": "每天搬一点，不耽误课",
        "effects": {
          "money": 0,
          "academics": 3,
          "career": 0,
          "wellbeing": -4
        },
        "setFlags": [
          "RANDOM_14_B"
        ],
        "shortResult": "课一节没落，箱子却搬了整整一个星期。"
      }
    ]
  },
  {
    "id": "RANDOM_15",
    "kind": "random",
    "scope": "UG",
    "title": "讲座撞上截止",
    "summary": "系里请来一位你很想听的讲者，时间却和一份作业的截止撞在一起。回放要过几天才会放出来。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "去听讲座，作业熬夜补",
        "effects": {
          "money": 0,
          "academics": 2,
          "career": 5,
          "wellbeing": -5
        },
        "setFlags": [
          "RANDOM_15_A"
        ],
        "shortResult": "你当面问到了想问的问题，作业是凌晨交的。"
      },
      {
        "id": "B",
        "label": "先交作业，过几天看回放",
        "effects": {
          "money": 0,
          "academics": 5,
          "career": 0,
          "wellbeing": -1
        },
        "setFlags": [
          "RANDOM_15_B"
        ],
        "shortResult": "作业从容交了，回放里听不到会后的闲聊。"
      }
    ]
  },
  {
    "id": "RANDOM_16",
    "kind": "random",
    "scope": "UG",
    "title": "语言伙伴",
    "summary": "国际学生办公室在招语言伙伴：每周和一位本地同学互相练对方的语言，要占掉一个固定的晚上。",
    "callbacks": [],
    "choices": [
      {
        "id": "A",
        "label": "报名，每周去聊一次",
        "effects": {
          "money": 0,
          "academics": 2,
          "career": 4,
          "wellbeing": -2
        },
        "setFlags": [
          "RANDOM_16_A"
        ],
        "shortResult": "你的口语顺了不少，那个晚上总是回来得很晚。"
      },
      {
        "id": "B",
        "label": "把晚上留给自己",
        "effects": {
          "money": 0,
          "academics": 2,
          "career": 0,
          "wellbeing": 4
        },
        "setFlags": [
          "RANDOM_16_B"
        ],
        "shortResult": "你守住了一个空闲的晚上，用来散步和整理。"
      }
    ]
  }
]
```
