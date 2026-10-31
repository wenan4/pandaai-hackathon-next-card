# contracts

事件、关卡配置、输出 JSON、数据文件头的 schema，由 [YOU-145](https://linear.app/youonlyattendonce/issue/YOU-145) 冻结。引擎、前端、数据脚本、评委面板四条线都从这里取接口，互相不用等。

**以 TypeScript（zod）定义为准**，JSON Schema 由它导出，示例 JSON 在 `examples/`。冻结后任何改动都要在 YOU-145 评论里说明并通知相关人，同时升版本号（见下）。

```ts
import { GameEventSchema, EventLogSchema, StructuredResultSchema, CasesVisibleSchema } from "../contracts";
```

## 目录

| 路径 | 内容 |
|---|---|
| `common.ts` | 公共枚举、版本常量、禁用词 |
| `events.ts` | 12 类事件，事件序列校验（`EventLogSchema`） |
| `rounds.ts` | 关卡配置（`RoundsConfigSchema`） |
| `outputs.ts` | `evaluate` / `habits` / `recommend` / `settle` 的输出，以及合成的 `StructuredResultSchema` |
| `data.ts` | `cases_visible`、`cases_reveal`、`taskA`、`taskB_{topic}` |
| `schema/*.schema.json` | 导出的 JSON Schema（不要手改） |
| `examples/` | 示例 JSON，全部有测试校验 |
| `contracts.test.ts` | 夹具通过、坏输入被拒、仓库里已有数据文件符合契约 |

## 版本

- `rules_version = v0.3`：规则表、命题、文案改版时一起升。旧版规则编号含义不可混用。
- `content_version`：每个事件都带，对应命题与文案版本。
- 数据文件头的 `schema = next-card/data@v0.3`。

## 事件

公共字段：`event_id`、`session_id`、`content_version`、`stage`、`round_id`。`round_id` 取 `R1–R6`、`taskA`、`taskB`，会话级事件取 `session`。

| `type` | `payload` | 允许的 `stage` |
|---|---|---|
| `initial_reaction` | `reaction`：`supports / refutes / insufficient` | `pre_reveal` |
| `card_flip` | `card`：`fox / elephant / leopard` | `pre_reveal` |
| `explain_open` | `card`、`content_id`、`kind`：`neutral / directional` | `pre_reveal`、`in_task` |
| `final_assessment` | `verdict` | `pre_reveal` |
| `decision` | `action`：`follow / skip / wait` | `pre_reveal` |
| `followup_answer` | `question`：`missing / basis / waiting`；`answer`：固定语义，含 `skipped` | `pre_reveal` |
| `self_note` | `note`：固定选项，不收集自由文字，不升级能力 | `post_reveal` |
| `assist_switch` | `task`、`step?`、`from`、`to`、`by`：`user / system` | `in_task` |
| `assist_exposure` | `task`、`step`、`content_id`、`kind`：`hint / demo / answer_feedback`、`attempt` | `in_task` |
| `task_step` | `task`、`step`、`content_id`、`attempt`、`phase`：`guess / submit`、`answer`、`actions` | `in_task` |
| `topic_select` | `topic`、`source` | `in_task` |
| `notice_ack` | `notice_version`（`round_id = session`，不参与画像） | `pre_reveal` |

`EventLogSchema` 另外检查：`event_id` 唯一、`stage` 与 `type` 匹配、一份序列只属于一个会话。揭晓后的 `final_assessment` 会被拒绝，避免揭晓后的补全被当成主动查证。

## 枚举

| 名称 | 取值 |
|---|---|
| 判断 `Verdict` | `supports` / `refutes` / `insufficient` |
| 下一步 `Action` | `follow`（跟）/ `skip`（不跟）/ `wait`（观望）。界面文案是配置，不进契约 |
| 观察状态 `ObsStatus` | `observed`（✅）/ `assisted`（🤝）/ `uncertain`（❔）/ `not_observed`（⚪） |
| 跨情境聚合 `Aggregate` | `partial` / `repeated` / `mixed` / `single` / `assisted` / `none` / `uncertain` |
| 协助档位 `AssistLevel` | `guide`（带我做）/ `hint`（给我提示）/ `solo`（我自己来） |
| 押注形态 `BetFamily` | `relative_strength`（R1、R4）/ `steady_trend`（R2、R5）/ `volume_surge`（R3、R6） |
| 主题 `Topic` | `fox` / `elephant` / `cheetah`；数据文件里的牌叫 `leopard`，对应主题 `cheetah`（`TOPIC_OF_CARD`） |
| 主题来源 `TopicSource` | `user` / `focus` / `bet` / `style` / `only_available` |
| 推荐路由 | `R-A2` / `R-A1` / `R-B` / `R-B-progress` |

`state = uncertain` 必须带 `uncertain_reason`，只有 `uncertain` 才有原因。

## 关卡配置

`RoundsConfigSchema`：每轮 `round_id`、所属幕、命题、命题方向、`evidence_verdict`、`key_card`、`named_card`、`bet_family`、各牌内容引用、解释文案版本与 `kind`、追问选项与触发条件。

- `named_card` 是说法直接点名的牌，物种统计排除它的首翻；R3 没有点名牌，为 `null`。
- `evidence_verdict` 由数据脚本按冻结口径产出，必须与 `cases_reveal` 里的 `source.evidence_verdict` 一致。
- 关键牌的普通解释不得标 `directional`。
- `bet_family_coverage` 必须与轮次实际出现次数一致。

## 输出

`StructuredResultSchema` 是给 PandaAI 的合成结果；各函数的输出也单独定义，输入互相隔离：

```
evaluate(events, config)  → { profile, progress }                         只读能力层事件
habits(events, config)    → { action_profile, backed_families, decision_chains, trading_view }
recommend(profile, progress, habits, availableTopics) → recommendation
settle(decisions, outcomes) → settlement                                  独立，其他函数不得引用
```

- `profile.observations`：O1–O3 按“能力项 + 情境 ID”各记一条，再给聚合结论，两条原始记录都保留，不平均、不加权。O4 记 N（可比较机会）、M（调整次数）及规则编号，三者必须自洽。
- O5 与局内情境共用帮助归因校验：`observed` 必须对应 `assistance=none`，`assisted` 必须有实际帮助暴露；不能把看过答案后的完成记为独立完成。
- `action_profile`、`backed_families`、`decision_chains`、`trading_view` 只来自 `decision` 与 `final_assessment`，不含任何松果或收益数字；不进入能力、物种或路线规则。
- `backed_families` 只允许被 `recommend` 用于任务 B 的默认主题（PRD §5.2 第 3 条）。
- `trading_view` 每条必须指回一个观察或习惯字段（`refers_to`）并带限定轮次。
- 面向用户的文案字段用 `SafeTextSchema`，含“正确 / 错误 / 高手 / 新手 / 冒险 / 保守 / 风险承受 / 你出手了”会被拒绝。契约只能拦住被序列化进输出的文案；模板本身由引擎测试再查一遍。

## 数据文件

可见部分和揭晓后部分是**两个不同的类型**：

- `CasesVisibleSchema`（`PreRevealDataSchema`）：strict。每轮只有命题、三张卡的归一化序列，窗口必须止于 T 日。里面出现 `after`、`symbol`、`name`、真实日期等多余字段都会被拒绝。文件头也只有 `schema / file / script_version / rules_version / note`。
- `CasesRevealSchema`（`PostRevealDataSchema`）：`after`（T 日起的后续走势、结算口径）和 `source`（标的、名称、真实日期、筛选核对、选案披露）。可以是整份 `cases_reveal.json`，也可以是按轮拆分的 `cases_reveal_R1.json` 等，前端只在对应轮次锁定后请求。

揭晓前前端只允许持有 `CasesVisible`。这只是防止界面误用未来数据的工程边界：静态站点里的文件用户都能在网络面板里读到，不能把它说成防作弊。

文件头必填项：脚本与版本、生成时间、数据截止日、实际调用的接口名、基准、复权和分红口径、归一化、筛选与采样规则、公开展示范围。`cases_reveal` 另有股票池、成交量口径、信号/执行/退出时间、筛选阈值、排除规则、样本数；`taskB` 另有信号定义与参数、主指标、执行、股票池快照与偏差、展示段/检验段边界、阈值与冻结时间、基线与不重叠规则、局限。

任务 B 即使已有样本，主指标缺失时也保留 `null`；对应分段的 `delta` 和 `meets_threshold` 必须为 `null`，整份文件的结论必须为 `insufficient_evidence`。没有样本时仍禁止用 0% 冒充统计。数据充分时的阈值判定由数据脚本负责。

基准组按同股票池、同分段、同持有窗口和完整性规则枚举，**不按信号筛选，也不只取不满足信号的样本**；信号组与基准组各自执行相同的不重叠规则。示例数字仍是人工占位，不能当作真实结果。

## JSON Schema

```bash
node scripts/export-json-schema.mjs           # 重新生成 contracts/schema/
node scripts/export-json-schema.mjs --check   # 只检查是否落后于 TS
```

导出的 JSON Schema 不包含 `superRefine` 里的跨字段校验（O4 的 N/M 与规则编号、完成状态与帮助归因、`ready_for_B = S1 && S2`、任务 B 的缺失指标与降级结论、事件序列的 `event_id` 唯一与阶段匹配等）。这些规则只在 zod 校验器里生效。Python 数据脚本如果要校验这些，需要用 TS 校验器，或者在脚本里自己重写。

## 与 PRD / 已有实现的差异

契约按 PRD v0.3 写。下面这些地方与 PRD 原文或 `main` 上现有实现不同，各自说明处理方式：

| 项 | PRD / 现有实现 | 契约 | 处理 |
|---|---|---|---|
| 下一步枚举 | `src/engine/types.ts` 用 `pass` | `skip` | 引擎对齐契约时改名；PRD 的“先不跟”在界面层 |
| 协助档位 | 引擎用 `self` | `solo` | 同上 |
| 第一反应 | 引擎有 `unsure` | 与最终判断共用 `supports / refutes / insufficient` | 同上；PRD §2 把“不确定”并入“证据不足” |
| `self_note` | 引擎 `payload.text` 自由文字 | `payload.note` 固定选项 | PRD §4.1：补一句不收集自由文字 |
| `assist_switch` | `{ level }` | `{ task, step?, from, to, by }` | 需要 `by` 区分用户明确选择与系统建议 |
| `assist_exposure.kind` | `feedback` | `answer_feedback` | 对齐 PRD 措辞 |
| `task_step` | 带 `correct`、`aligned`、`window_extended` | 带 `content_id`、`attempt`、`actions` | 是否正确、是否独立由事件序列与数据派生，不信提交时的字段 |
| `followup_answer.answer` | `string \| null` | 固定语义枚举，含 `skipped` | 跳过明确记录，不用 `null` |
| 主题来源 | 引擎 `o3d / style_default / chooser` | `focus / style / user / bet / only_available` | PRD §5.2 的来源标记 |
| 数据文件 `schema` 标记 | 现有产物是 `draft…` 临时标记 | `next-card/data@v0.3` | 校验器暂时两者都接受；脚本下次生成必须改写成正式值 |
| `taskA.json` 的 `generated_at` | 现有脚本未写 | 契约要求 | 校验器对 taskA 暂放宽为可选，脚本补上后改回必填 |

`main` 上的引擎、游戏壳和评委面板还没有改用这些类型，那是后续各 issue 的工作；本 PR 不改 `src/`。

## 不在契约内

- 引擎逻辑、数据脚本、界面：各自的 issue。
- 自我预期校准（`module = self_calibration`，九类 `cal_*` 事件）：由 YOU-178 另开契约，原事件、规则编号和字段含义不变。
- 展示文案：界面文案是配置，不进契约。
