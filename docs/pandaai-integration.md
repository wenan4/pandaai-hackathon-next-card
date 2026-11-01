> 版本范围：以下为 v0.3 的输出/接入说明。当前 v0.4.1 参赛功能以 [项目说明](PROJECT.md) 为准；PandaAI 生产接口接入仍未实现。

# 接入 PandaAI 的构想

> 这是构想，**没有接入任何 PandaAI 生产接口**。下面每一项都标明“已实现 / 构想”。

## 放在哪里

把《下一张牌》作为 PandaAI 新用户引导的第一站：三轮之后，用户带着一份结构化结果进入产品。

## 结构化结果能决定什么

| 产品里的决定 | 用哪个字段 | 状态 |
|---|---|---|
| 默认协助档位（带我做 / 给我提示 / 我自己来） | `profile.help_preference.level` | 字段已实现；接入是构想 |
| 第一个研究任务练什么（对照、长窗口、两段检验） | `recommendation.route`、`recommendation.steps` | 已实现；接入是构想 |
| 推荐哪一组数据或主题 | `recommendation.topic`、`topic_source` | 已实现（目前只有猎豹题）；更多主题是构想 |
| 是否先让用户猜一次再看数据 | `recommendation.guess_first` | 已实现；接入是构想 |
| 哪些观察不能当作已掌握 | `observations.*.status = assisted / uncertain` | 已实现 |
| 任务完成后更新画像 | `profile.task_observations`、`progress` | 已实现（本地）；回写 PandaAI 账户是构想 |

## 数据流（构想）

1. 用户在 H5 里玩完三轮，结果只存在本机浏览器。
2. 用户同意后，把结构化结果（不含个人信息）交给 PandaAI 引导流程。
3. PandaAI 按 `recommendation` 打开对应的研究任务模板，用 Panda Data 换一组股票池或分段。
4. 任务完成后，按同一套规则更新 `task_observations`，不覆盖历史。

## 维护与扩展

- 规则在 `src/engine/` 里是纯函数，配置在 `src/config/`，规则改版时一起升 `rules_version`。
- 新增任务 B 主题只需数据文件（同一份 schema）和 `AVAILABLE_TOPICS`，判定函数与检查脚本复用。
- 输出带 `provenance`，真实体验和模拟路径不会混在一起。

## 不做的事

- 不判断现实风险承受能力，不给买卖建议。
- 不把一局的结果说成稳定人格；人物卡始终写明“本局”。
