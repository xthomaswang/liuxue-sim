# 突发小事池

规则见 `16_V2_GAMEPLAY.md`。本文件唯一的 `json` 代码块就是游戏数据，由 `scripts/extract-content.ts` 提取并校验。

## 写作约定

- 每学期开头有 60% 的机会发生一条，一局内不重复。没有选项，只是一行字加数值变化，显示在选安排的上方；不设置历史标记，不影响任何资格。
- 一句话，不超过 40 个字，以句号结尾；短、具体、可以有一点好笑。不写数值（数值由界面显示）。
- `scope`：`ANY` 任何学段都说得通，`UG` 只在本科出现，`MS` 只在硕士出现。
- 数值：四项都写；单项绝对值不超过 5，四项绝对值之和在 1–8。好事与坏事大约各半，另有几条有得有失；整个池子四项各自的总和保持在 -6 到 +6 之间，资金尤其要平衡。
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
  }
]
```
