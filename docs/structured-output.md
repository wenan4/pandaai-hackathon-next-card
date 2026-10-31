# 结构化结果

人物卡页和评委面板都有“导出结构化结果”按钮，导出一份 JSON。它和页面上看到的人物卡、推荐来自同一次 `evaluate` / `recommend` / 行动习惯计算（`src/engine/result.ts`），没有第二份规则。

- 导出前会提示“包含你这一局的选择记录，请自行保管”；文件名只带时间。
- 不含姓名、手机号、设备信息，也不含会话编号（有测试检查）。
- 分享卡不含这些内容。

## 样例（模拟路径，不是真实试玩）

三份样例都由引擎生成，不手写；`src/engine/result.test.ts` 会检查它们与当前引擎输出逐字一致，规则改了样例必须重新生成：

```bash
GEN_EXAMPLES=1 npx vitest run src/engine/result.test.ts
```

| 文件 | 路径 | 首次推荐 |
|---|---|---|
| `docs/examples/result.yi.json` | 乙：两幕六轮，关键牌都看了，第 2、5 轮看完证据改了第一判断 | 任务 B 大象题（来源：常押形态、物种），我自己来 |
| `docs/examples/result.jia.json` | 甲：只玩第一幕，每轮先翻量价，没翻关键牌，第 3 轮“图没看懂” | 任务 A 两步，带我做，先猜后验 |
| `docs/examples/result.bing.json` | 丙：同乙，只把第 3 轮两张牌换个顺序 | 任务 B 大象题（来源只剩常押形态），物种为混合倾向 |

## 字段

| 字段 | 含义 | 可以怎么用 |
|---|---|---|
| `format`、`rules_version` | 输出格式与规则版本；不同版本的规则编号含义不可混用 | 读取方按版本解释 |
| `provenance` | `user_session`（本机真实体验）、`simulated_path`（模拟路径，带 `path_id`）或 `judge_fork`（评委在面板里改过字段的反事实，带 `fork_of` 基线），以及事件条数 | 区分真实、模拟与反事实，不把模拟或改过的记录当成用户数据 |
| `profile.observations.O1–O4` | 每项：`status`（observed / assisted / uncertain / not_observed）、`aggregation`、一句 `summary`、`instances`（情境、规则编号、是否在帮助下、对应事件编号） | 依据可追溯到事件；`assisted` 不能当独立能力 |
| `profile.task_observations` | 任务中的新情境：O1 / O2 来自任务 A，O5 来自任务 B | 与局内观察分开，不改写局内结果 |
| `profile.style` | 本局交易物种、每轮首翻、各牌计入次数 | 偏好，不是能力；可作为任务 B 默认主题的来源之一 |
| `profile.help_preference` | 默认协助档位及来源（用户选择 / 理解信号 / 解释次数） | 可直接作为产品里默认的协助档位 |
| `profile.flags.o3d` | 第 3 轮看过量价就对未来下判断 | 推荐猎豹题定向练习 |
| `progress` | K、S1、S2、已完成的任务 A 步骤、`taskB_done`、`ready_for_B` | 决定下一步该练什么 |
| `habits` | 判断与下一步同向 / 不同向的轮次、证据不足时的选择、跟过的押注形态（是否常押）、每轮决策链 | 只计数，不评高低；常押形态只影响任务 B 主题 |
| `recommendation` | 路由（R-A1 / R-A2 / R-B / R-B-progress）、任务、步骤、主题与来源（`topic_sources` 列出指向它的全部来源，`topic_conflict` 表示常押形态与物种指向不同主题）、协助档位、是否先猜后验、理由 | 直接决定用户的下一关 |
| `unknowns` | 这一局还不知道的事 | 提醒读取方不要过度解读 |

## 与契约的关系

`contracts/outputs.ts` 定义了 YOU-145 冻结的输出结构（`StructuredResultSchema`）。这里导出的是引擎当前的原生结构（`format = next-card/result@v0.3-native`），字段名还没有完全改成契约写法，差异列在 `contracts/README.md` 的“与 PRD / 已有实现的差异”里。数据文件已经通过契约校验；输出改用契约类型尚未完成。
