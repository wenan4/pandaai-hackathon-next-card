# 结构化结果

人物卡页和评委面板都可导出 JSON。结果通过 `contracts/outputs.ts` 的 `StructuredResultSchema` 校验，和界面共用画像、推荐及行动习惯计算。导出前提示内容范围；文件名只带时间。

不含姓名、手机号、设备信息或原始事件数组。`provenance.session_id` 是本局随机匿名编号，用于追溯事件依据；不要把它当成个人账号。分享 PNG 与这份 JSON 分开，PNG 只取物种和固定说明，不含匿名编号、观察状态或行动。

## 字段

| 字段 | 内容 |
|---|---|
| `rules_version` | 规则版本；不再使用临时 `v0.3-native` 格式 |
| `provenance` | `real_session` / `simulated_path` / `judge_fork`，本局编号与事件条数；模拟带 `path_id`，分叉带 `fork_of` |
| `style` | 本局物种、计入与排除的首翻、计数和限定语 |
| `observations` | O1–O3 的状态、聚合、局内与任务情境；O4 的机会数、调整数及依据；完成任务 B 后的 O5 |
| `help_preference` | 建议档位、用户明确选择、来源规则、解释次数 |
| `progress` | K、S1/S2、`taskA_completed_steps`、`taskB_done`、`ready_for_B` |
| `action_profile` / `backed_families` | 判断与行动的计数、所跟形态；不进能力或物种推断 |
| `decision_chains` / `trading_view` | 每轮决策链、指回观察/习惯的限定说明 |
| `recommendation` | 路由、任务、主题及来源、来源冲突、协助、理由和资源状态 |
| `unknowns` | 本局仍不知道的事 |
| `settlement` | 契约中的可选独立结算字段；不参与上述推断 |

O1–O3 的任务证据位于各观察的 `task_scenarios`，不会覆盖局内 `scenarios`。实际帮助使用写入 `assistance`；不能把看过答案后的完成当作独立完成。初始局没有完成的情境不伪造证据。

## 模拟样例

`docs/examples/result.yi.json`、`result.jia.json`、`result.bing.json` 由当前引擎生成，测试逐字核对。它们是三轮模拟路径，不是真实试玩。

```bash
GEN_EXAMPLES=1 npx vitest run src/engine/result.test.ts
```

另有 `contracts/examples/path-yi.events.json` 六轮冻结样例；`src/engine/contracts.integration.test.ts` 重放后与 `contracts/examples/result.path-yi.json` 全字段对照，不重写该标准答案。

## 展示投影

`evaluate`、`habits`、`recommend`、`settle` 返回正式契约结构。界面为展示摘要和逐条变化使用 `evaluateView / recommendView`，与公开结果共用计算；这类展示投影不会被当作正式 JSON 导出。
