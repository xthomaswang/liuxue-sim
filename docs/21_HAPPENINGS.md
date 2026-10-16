# 突发小事池

规则见 `16_V2_GAMEPLAY.md` §4；第四版的改动（期中的第二次机会、`when` 条件）见 `24_V4_LIFE.md` §2.1、§6。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 第四版起每学期有两次机会：开学（资助到账之后）0.70，期中（主线槽事件之后、支线事件之前）0.45。候选里等概率挑一条，一局内不重复。没有选项，只是一行字加数值变化，显示在人生轨迹里；不设置历史标记，不影响任何资格。经典模式没有突发小事。
- 一句话，不超过 40 个字，以句号结尾；短、具体、可以有一点好笑。不写数值（数值由界面显示）。同一条既可能在开学抽到，也可能在期中抽到，所以文字不要写死时间点（只在期中出现的写法见 `when`）。
- `id`：`HAP_` 加两位或三位数字（`HAP_80`、`HAP_101`）；新条目接着往后编，不改旧条目的 id 和顺序。
- `scope`：`ANY` 任何学段都说得通，`UG` 只在本科出现，`MS` 只在硕士出现。
- `when`（可选，键见 `24` §6）：按发生那一刻的状态判断，不满足就不进候选。常用的有 `schoolStates`（各州的梗）、`statMin`／`statMax`（钱紧、钱多、身心见底）、`economies`、`talentsAny`、`focusAny`。开学那次还没有本学期的安排，带 `focusAny` 的只会在期中出现；想让一条只在期中出现（例如有季节的天气），就把五类都写进 `focusAny`。带条件的只占少数（约四分之一），保证任何时候都有足够的候选。
- 数值：四项都写；单项绝对值不超过 5，四项绝对值之和在 1–8。好事与坏事大约各半，另有几条有得有失；整个池子（约 80 条）四项各自的总和保持在 -10 到 +10 之间，资金尤其要平衡。
- 不写重病、死亡、犯罪、歧视、签证事故这类沉重的事；不承诺录取或工作；不写要以玩家做过某件事为前提的句子（例如“上学期打工的工资”）。

## 数据

```json
[
  {
    "id": "HAP_01",
    "scope": "ANY",
    "text": "二手课本里夹着前主人的全套笔记。",
    "effects": {
      "money": 0,
      "academics": 3,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_02",
    "scope": "ANY",
    "text": "宿管说暖气这周修不了，但可以借你一条毯子。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_03",
    "scope": "ANY",
    "text": "超市会员日，你囤的泡面够吃到期末。",
    "effects": {
      "money": 2,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_04",
    "scope": "ANY",
    "text": "手机屏幕摔裂了，换屏的报价让你沉默了一会儿。",
    "effects": {
      "money": -4,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_05",
    "scope": "ANY",
    "text": "学校退回了一笔多收的杂费。",
    "effects": {
      "money": 4,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_06",
    "scope": "ANY",
    "text": "汇率又跳了一下，这个月的生活费缩水了。",
    "effects": {
      "money": -3,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_07",
    "scope": "ANY",
    "text": "家里寄来的包裹到了，一半是吃的。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 5
    }
  },
  {
    "id": "HAP_08",
    "scope": "ANY",
    "text": "连下两周雨，鞋没有一双是干的。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_09",
    "scope": "ANY",
    "text": "图书馆靠窗的位子，这学期总是空着等你。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_10",
    "scope": "ANY",
    "text": "电脑在交作业前一晚蓝屏，你重写了三页。",
    "effects": {
      "money": 0,
      "academics": -2,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_11",
    "scope": "ANY",
    "text": "你帮同学改简历改到半夜，顺手把自己的也改了。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 3,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_12",
    "scope": "ANY",
    "text": "你投了一封校内岗位的申请邮件，发出去才发现称呼写错了人。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": -3,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_13",
    "scope": "ANY",
    "text": "食堂新来的师傅手不抖，打菜分量很足。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_14",
    "scope": "ANY",
    "text": "洗衣房的烘干机吞了你的硬币，还吞了一只袜子。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_15",
    "scope": "ANY",
    "text": "图书押金到期自动退回，你早忘了交过这笔钱。",
    "effects": {
      "money": 3,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_16",
    "scope": "ANY",
    "text": "公交月票涨价，通知贴在你从不看的那块公告栏上。",
    "effects": {
      "money": -2,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_17",
    "scope": "ANY",
    "text": "老师在课上念了你作业里的一段，没有点名。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_18",
    "scope": "ANY",
    "text": "你记错了截止日期，以为是周五，其实是周四。",
    "effects": {
      "money": 0,
      "academics": -3,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_19",
    "scope": "ANY",
    "text": "换季感冒躺了三天，顺便把想看的剧追完了。",
    "effects": {
      "money": 0,
      "academics": -2,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_20",
    "scope": "ANY",
    "text": "讲座散场，你和讲者多聊了五分钟。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 2,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_21",
    "scope": "UG",
    "text": "社团招新日，你抱回一堆传单和三支免费的笔。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 1,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_22",
    "scope": "UG",
    "text": "宿舍楼凌晨响了火警，全楼裹着被子在楼下站了半小时。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_23",
    "scope": "UG",
    "text": "通识课的小组里，有人主动包了你最怕的展示环节。",
    "effects": {
      "money": 0,
      "academics": 1,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_24",
    "scope": "UG",
    "text": "选课系统开放的那一刻崩了，你想上的课只剩候补。",
    "effects": {
      "money": 0,
      "academics": -2,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_25",
    "scope": "UG",
    "text": "室友回家过周末，给你留了半个冰箱的水果。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_26",
    "scope": "UG",
    "text": "期中周整层楼都在咳嗽，你也没躲过去。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_27",
    "scope": "UG",
    "text": "学院办了场校友分享，你记下两条从没想过的路。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 2,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_28",
    "scope": "UG",
    "text": "教材出了新版，旧版卖不掉，新版还得买。",
    "effects": {
      "money": -3,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_29",
    "scope": "MS",
    "text": "研究生休息室换了台新咖啡机，还是免费的。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_30",
    "scope": "MS",
    "text": "老师在你的报告页边写了句“思路不错”，你看了好几遍。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_31",
    "scope": "MS",
    "text": "同届有人已经定了去向，群里安静了一个下午。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_32",
    "scope": "MS",
    "text": "文献管理软件崩了，参考文献要一条条重新对。",
    "effects": {
      "money": 0,
      "academics": -2,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_33",
    "scope": "ANY",
    "text": "人民币汇率涨了一点，这个月的生活费多出了一顿火锅。",
    "effects": {
      "money": 2,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_34",
    "scope": "ANY",
    "text": "你牙疼去看了次牙医，账单比牙还疼。",
    "effects": {
      "money": -4,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_35",
    "scope": "ANY",
    "text": "你报名参加了心理学系的实验，填了一小时问卷，领到一张购物卡。",
    "effects": {
      "money": 2,
      "academics": 0,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_36",
    "scope": "ANY",
    "text": "你在图书馆帮教授找到一本放错架的书，教授记住了你的名字。",
    "effects": {
      "money": 0,
      "academics": 1,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_37",
    "scope": "ANY",
    "text": "楼上的邻居半夜练跳绳，你躺在床上替对方数数。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_38",
    "scope": "ANY",
    "text": "小组作业的组员突然退课了，剩下的部分平分给了你。",
    "effects": {
      "money": 0,
      "academics": 1,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_39",
    "scope": "ANY",
    "text": "学院活动剩下一大堆披萨，你抱回去吃了三天。",
    "effects": {
      "money": 2,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_40",
    "scope": "ANY",
    "text": "你半夜下单的东西到了，拆开以后完全想不起为什么要买。",
    "effects": {
      "money": -3,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_41",
    "scope": "ANY",
    "text": "你在路边捡到一把还能用的椅子，扛回去的照片被室友发进了群。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_42",
    "scope": "ANY",
    "text": "你发现学校给学生免费提供正版软件，一口气装了十几个。",
    "effects": {
      "money": 2,
      "academics": 1,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_43",
    "scope": "ANY",
    "text": "国内的朋友来美国玩，你请了三顿饭，当了一周导游。",
    "effects": {
      "money": -3,
      "academics": -1,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_44",
    "scope": "ANY",
    "text": "爸妈学会了发表情包，每天准时给你发一张早安图。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_45",
    "scope": "ANY",
    "text": "家里的狗在视频里认出了你，冲着屏幕叫了好久。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_46",
    "scope": "ANY",
    "text": "这门课的助教讲得比教授还清楚，你开始只去助教的辅导课。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": 0
    }
  },
  {
    "id": "HAP_47",
    "scope": "ANY",
    "text": "你在电梯里小声练自我介绍，被同电梯的校友听见了，对方递了张名片。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 2,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_48",
    "scope": "ANY",
    "text": "楼下新开了一家拉面馆，老板说的方言和你家一样。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_49",
    "scope": "ANY",
    "text": "你剪了个自以为很潮的发型，室友看了很久没说话。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_50",
    "scope": "UG",
    "text": "宿舍楼办了冰淇淋之夜，你吃完三个口味才想起在减肥。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    }
  },
  {
    "id": "HAP_51",
    "scope": "UG",
    "text": "宿舍公共厨房有人留了一锅咖喱，旁边贴着“随便吃”。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_52",
    "scope": "UG",
    "text": "室友开始在凌晨练吉他，曲目只有一首。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    }
  },
  {
    "id": "HAP_53",
    "scope": "UG",
    "text": "下学年的宿舍抽签，你抽到了离教学楼最远的那栋。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_54",
    "scope": "UG",
    "text": "宿舍的 RA 在走廊叫出了你的名字，还问你最近睡得好不好。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_55",
    "scope": "UG",
    "text": "你被拉去打了一场羽毛球，第二天浑身疼得下不了楼。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": 2
    }
  },
  {
    "id": "HAP_56",
    "scope": "MS",
    "text": "项目办公室发来提醒，你有一门必修课的学分算错了。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": -2
    }
  },
  {
    "id": "HAP_57",
    "scope": "MS",
    "text": "研究生会办了免费的职业照拍摄，你终于有了一张不是自拍的头像。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 1,
      "wellbeing": 1
    }
  },
  {
    "id": "HAP_58",
    "scope": "MS",
    "text": "同组的博士生请你帮忙跑数据，作为交换教了你一个新工具。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_59",
    "scope": "MS",
    "text": "系里报销了你去开会的路费，报销单你填了三遍。",
    "effects": {
      "money": 3,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    }
  },
  {
    "id": "HAP_60",
    "scope": "ANY",
    "text": "地震演习时你钻到桌下，顺手捡回了丢了一学期的耳机。",
    "effects": {
      "money": 2,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    },
    "when": {
      "schoolStates": [
        "CA"
      ]
    }
  },
  {
    "id": "HAP_61",
    "scope": "ANY",
    "text": "山火的烟飘到了学校，天空发橙，你关着窗在宿舍待了一周。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": -3
    },
    "when": {
      "schoolStates": [
        "CA"
      ]
    }
  },
  {
    "id": "HAP_62",
    "scope": "ANY",
    "text": "房东通知续租要涨价，而你的卧室其实是客厅隔出来的。",
    "effects": {
      "money": -4,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    },
    "when": {
      "schoolStates": [
        "NY"
      ]
    }
  },
  {
    "id": "HAP_63",
    "scope": "ANY",
    "text": "一场暴雪让学校停课一天，你在窗边看雪，把积压的觉全补上了。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": 3
    },
    "when": {
      "schoolStates": [
        "MA",
        "NH",
        "VT",
        "ME",
        "RI",
        "CT"
      ],
      "focusAny": [
        "STUDY",
        "CAREER",
        "CAMPUS",
        "WORK",
        "REST"
      ]
    }
  },
  {
    "id": "HAP_64",
    "scope": "ANY",
    "text": "风大得把你的伞吹翻了三次，你放弃了伞，也放弃了发型。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    },
    "when": {
      "schoolStates": [
        "IL"
      ]
    }
  },
  {
    "id": "HAP_65",
    "scope": "ANY",
    "text": "德州的天一天里从冬天变到夏天，你早上穿羽绒服，下午穿短袖，然后感冒了。",
    "effects": {
      "money": 0,
      "academics": -1,
      "career": 0,
      "wellbeing": -2
    },
    "when": {
      "schoolStates": [
        "TX"
      ],
      "focusAny": [
        "STUDY",
        "CAREER",
        "CAMPUS",
        "WORK",
        "REST"
      ]
    }
  },
  {
    "id": "HAP_66",
    "scope": "ANY",
    "text": "阴天连着阴天，你已经一个月没见过太阳，开始在网上搜维生素 D。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    },
    "when": {
      "schoolStates": [
        "WA",
        "OR"
      ],
      "focusAny": [
        "STUDY",
        "CAREER",
        "CAMPUS",
        "WORK",
        "REST"
      ]
    }
  },
  {
    "id": "HAP_67",
    "scope": "ANY",
    "text": "佛罗里达一年四季都是夏天，你在湖边晒太阳，对岸的鳄鱼也在晒。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 3
    },
    "when": {
      "schoolStates": [
        "FL"
      ]
    }
  },
  {
    "id": "HAP_68",
    "scope": "ANY",
    "text": "学校周围全是玉米地，外卖只有一家披萨店愿意送。",
    "effects": {
      "money": -1,
      "academics": 0,
      "career": 0,
      "wellbeing": -2
    },
    "when": {
      "schoolStates": [
        "IA",
        "IN",
        "NE",
        "KS",
        "OH",
        "MO"
      ]
    }
  },
  {
    "id": "HAP_69",
    "scope": "ANY",
    "text": "家里又偷偷转来一笔钱，附言只有一句：别饿着。",
    "effects": {
      "money": 5,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    },
    "when": {
      "statMax": {
        "money": 15
      }
    }
  },
  {
    "id": "HAP_70",
    "scope": "ANY",
    "text": "冰箱里能吃的都吃完了，最后一顿是番茄酱拌米饭。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": -3
    },
    "when": {
      "statMax": {
        "money": 20
      }
    }
  },
  {
    "id": "HAP_71",
    "scope": "ANY",
    "text": "朋友找你借钱应急，说下个月就还，你决定把它当成礼物。",
    "effects": {
      "money": -4,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    },
    "when": {
      "statMin": {
        "money": 70
      }
    }
  },
  {
    "id": "HAP_72",
    "scope": "ANY",
    "text": "室友看你脸色不对，拉你出去吃了顿火锅，没让你付钱。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": 0,
      "wellbeing": 4
    },
    "when": {
      "statMax": {
        "wellbeing": 25
      }
    }
  },
  {
    "id": "HAP_73",
    "scope": "ANY",
    "text": "你连着失眠了一周，白天上课像隔着一层玻璃。",
    "effects": {
      "money": 0,
      "academics": -2,
      "career": 0,
      "wellbeing": -2
    },
    "when": {
      "statMax": {
        "wellbeing": 25
      }
    }
  },
  {
    "id": "HAP_74",
    "scope": "ANY",
    "text": "你的车在教学楼下被贴了罚单，罚款够别人吃一周的饭。",
    "effects": {
      "money": -3,
      "academics": 0,
      "career": 0,
      "wellbeing": -1
    },
    "when": {
      "economies": [
        "HIGH"
      ]
    }
  },
  {
    "id": "HAP_75",
    "scope": "ANY",
    "text": "你申请的学校应急补助批下来了，邮件你截图存了三份。",
    "effects": {
      "money": 4,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    },
    "when": {
      "economies": [
        "LOW"
      ]
    }
  },
  {
    "id": "HAP_76",
    "scope": "ANY",
    "text": "你开车送同学去机场，回来时收到一大袋家乡特产当谢礼。",
    "effects": {
      "money": 1,
      "academics": 0,
      "career": 0,
      "wellbeing": 2
    },
    "when": {
      "talentsAny": [
        "T_DRIVER"
      ]
    }
  },
  {
    "id": "HAP_77",
    "scope": "ANY",
    "text": "室友把整理好的复习笔记发给了你，重点还标了颜色。",
    "effects": {
      "money": 0,
      "academics": 3,
      "career": 0,
      "wellbeing": 0
    },
    "when": {
      "talentsAny": [
        "T_ROOMMATE"
      ]
    }
  },
  {
    "id": "HAP_78",
    "scope": "ANY",
    "text": "期中前你连熬了两个通宵，考完在考场门口睡着了。",
    "effects": {
      "money": 0,
      "academics": 2,
      "career": 0,
      "wellbeing": -3
    },
    "when": {
      "focusAny": [
        "STUDY"
      ]
    }
  },
  {
    "id": "HAP_79",
    "scope": "ANY",
    "text": "面试官问你最大的缺点，你说太追求完美，对方笑出了声。",
    "effects": {
      "money": 0,
      "academics": 0,
      "career": -2,
      "wellbeing": -1
    },
    "when": {
      "focusAny": [
        "CAREER"
      ]
    }
  },
  {
    "id": "HAP_80",
    "scope": "ANY",
    "text": "打工时遇到一位大方的客人，小费抵得上半天的工资。",
    "effects": {
      "money": 3,
      "academics": 0,
      "career": 0,
      "wellbeing": 1
    },
    "when": {
      "focusAny": [
        "WORK"
      ]
    }
  }
]
```
