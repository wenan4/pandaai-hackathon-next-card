# Panda Data 可行性验证

> YOU-147 · 2026-10-31 实测 · `panda_data==1.0.5` · Python 3.12
> 复现：`.venv/bin/python scripts/pd_probe.py`（结果写到 `scripts/out/probe_report.json`，不入库）

## 结论速览

| 问题 | 结论 |
|---|---|
| 日线行情 | **可用**：`get_stock_daily`（原始）、`get_stock_daily_pre`（前复权）。PRD 里写的 `get_market_data` 已废弃，不要用。 |
| 宽基基准 | **可用**：`get_index_daily`，沪深300 / 中证500 / 中证1000 / 上证指数 / 创业板指 / 深证成指都有。 |
| 沪深300 成分 | **可用**：`get_index_weights(index_symbol, start_date, end_date)` 带日期，**每个交易日一份快照**，含权重。`get_index_weights_day` 无权限，用不到。 |
| 点时股票池 | **可用**：`get_stock_daily(indicator="000300")` 直接返回当日成分股的行情。2021-12-31 与 2026-10-30 的沪深300 有 91 只不同，说明是点时成分。 |
| 行业基准 | 申万行业指数（801xxx）**取不到**行情。**替代方案**：中证全指一级行业指数 `000986.SH`–`000995.SH`（能源 / 材料 / 工业 / 可选 / 消费 / 医药 / 金融地产 / 信息 / 通信 / 公用），日线可用。申万成分股可以用 `get_industry_constituents` 取到，必要时可以自己算等权行业基准。 |
| 前复权口径 | **以最新交易日为锚回算**：最新一天的复权价等于原始价。算收益没问题（比值不受锚点影响），但复权后的绝对价格不是当时的点时价格。 |
| 成交量 | 单位是**股**（成交额 ÷ (成交量 × 收盘价) ≈ 1.00）。前复权数据里的成交量**和原始值完全一致**，没有调整。 |
| 停牌 | 停牌日**有行**：`trade_status = 1`，`volume = 0`，价格沿用前值。正常交易日 `trade_status = 0`。 |
| 退市 | 退市股的历史行情保留到退市前一天，`get_stock_detail(status=0)` 能列出退市股。用点时成分股就能避免幸存者偏差。 |
| 单次跨度 | 起止不能超过 5 年（错误码 100008）。分两段请求后拼接，行数与交易日历完全一致。 |
| 速度与限流 | 一次请求 50 只股票 × 5 年前复权日线：2.6 秒，约 6 万行。单只循环约 2 秒一只，**要批量请求**。**有每分钟请求次数上限**：短时间内连续发几十个请求会报“每分钟请求次数超限”，`scripts/pd_common/data.py` 遇到时会等 61 秒再重试。 |
| 公开展示 | **尚未获得答复，暂按最保守方式处理**：前端只放归一化曲线（起点 = 100）和派生统计，不放原始行情表。 |
| QuantSkills | `quantskills/skill-quant-research` **存在**，GPL-3.0。同一组织下还有 `skill-pandadata-api` 等。只作参考，不要把代码拷进本仓库（GPL 传染）。 |

## 登录

```python
from pd_common.client import login   # scripts/pd_common/client.py
pd = login()                          # 读 .env 的 PANDA_USER / PANDA_PASS（或 DEFAULT_USERNAME / DEFAULT_PASSWORD）
```

- `init_token` 登录后，SDK 会在它认定的项目根目录写一个加密的 `user.json`，已加进 `.gitignore`。
- 脚本不读也不打印 token。`npm run check:secrets` 会扫描所有 git 跟踪的文件，看有没有 `.env` 里的值或 JWT。

## 接口清单

### 可用

| 接口 | 关键参数 | 返回字段 | 备注 |
|---|---|---|---|
| `get_stock_daily` | `symbol` 列表、`start_date` / `end_date`（YYYYMMDD）、`indicator`、`st`、`fields` | symbol, date, open, high, low, close, pre_close, volume, amount, limit_up, limit_down, name, trade_status | **按日期倒序返回**，用前先 `sort_values("date")` |
| `get_stock_daily_pre` | 同上 | 同上 + num_trades | 前复权，锚点是最新交易日 |
| `get_index_daily` | `symbol` 列表、起止日期 | symbol, date, open, high, low, close, pre_close, volume, amount | 倒序返回。代码格式：`六位.SH/SZ/CSI`、`H五位.SH/SZ`、`399xxx.SZ` |
| `get_index_weights` | `index_symbol`、起止日期 | index_symbol, stock_symbol, date, weight | 每个交易日一份快照 |
| `get_index_detail` | `status=1` | symbol, name, listed_date … | 1855 个在用指数，找基准代码用 |
| `get_industry_detail` | `level="L1"`，`reference="sws_2021"` | industry_code, industry_name | 申万一级 31 个 |
| `get_industry_constituents` | `industry_code`、`level`、`date` | stock_symbol, in_date, out_date, l1 / l2 / l3 code 和名称 | 只传 `level="L1"` 一次就能取到全市场 5232 只股票的归属。`out_date` 全为空，**只有当前分类，没有历史归属** |
| `get_adj_factor` | `symbol`、起止日期 | ex_date, announcement_date, ex_factor, ex_cum_factor | 识别送转和除权日用 |
| `get_st_list` | 起止日期 | symbol, date, is_st | 每股每日一行，全市场一年约 135 万行，按需带 `symbol` 过滤 |
| `get_suspended_list` | 起止日期 | symbol, date, is_suspended | 同上 |
| `get_stock_status_change` | 起止日期 | symbol, change_date, type, description | ST 戴帽 / 摘帽等事件 |
| `get_stock_detail` | `status`（1 在市 / 0 退市）、`date` | symbol, name, listed_date, de_listed_date, board_type … | |
| `get_trade_cal` | 起止日期、`is_trading_day=1` | nature_date, next_trade_date, pretrade_date, is_trade | 当天日期在 `nature_date`，**第一列是 `next_trade_date`，别取错** |
| `get_last_trade_date` | — | `"20261030"` | 数据更新到 2026-10-30 |

### 不可用或不要用

| 接口 | 问题 |
|---|---|
| `get_market_data` | 标注已废弃或未上线 |
| `get_index_weights_day` | API 访问权限不足（用 `get_index_weights` 代替） |
| `get_index_daily("801xxx.SI")` | 交易所前缀只能是 SH / SZ / CSI；换成 `.SH` / `.SZ` / `.CSI` 都返回 0 行 |
| `get_index_constituent` / `get_index_component` | 美股 / 港股，已废弃 |
| `get_stock_daily(..., st=False)` | 在中证1000上没有效果（指数本身就排除 ST）。判断 ST 用 `get_st_list` |

## 逐项结论（对应 issue 的待验证清单）

1. **沪深300 成分**：可用。`get_index_weights` 带日期每天有快照；`get_stock_daily(indicator="000300")` 一次就能拿到当日全部成分股的行情。备选的 `get_industry_constituents` 和手选固定池都用不上。
2. **行业基准**：申万行业指数行情取不到。默认用中证全指一级行业指数 `000986.SH`–`000995.SH`；要和申万口径对齐时，用 `get_industry_constituents` 的成分（带 in / out 日期）自己算等权指数。命题里写明用的是哪种基准。
3. **前复权口径**：以最新交易日为锚。600519.SH 在 2026-10-30 的复权收盘价等于原始收盘价 1392.05，而 2022-01-04 的复权收盘价 1772.94 低于原始价 2051.23。区间收益可以直接用复权价算；来源页要写明“价格经前复权处理，绝对价位不是当时的成交价”。
4. **成交量口径**：单位是股；前复权数据里成交量没有调整。算量比用原始 `volume`，**要排除回看窗口内有送转除权的记录**（`get_adj_factor` 里 `ex_factor` 明显大于 1，比如 ≥ 1.1）：送转会让股本突增，产生假的“放量”。也可以用成交额 `amount` 复核，它不受送转影响。
5. **停牌 / 退市 / ST / 涨跌停**：
   - 停牌日 `trade_status = 1`、`volume = 0`：算 20 日均量时**跳过停牌日**；T+1 停牌就买不进，这条记录按“执行日停牌”排除。
   - 约 1.2% 的行 `trade_status` 为空（2020–2026 年沪深300 + 中证500 样本里约 2 万行），绝大多数有成交量。约定：为空且成交量 > 0 视为正常交易，否则视为停牌。
   - 涨停买不进：T+1 `open >= limit_up` 时视为买不进，按“开盘涨停”排除。例：2024-10-08 沪深300 里有 162 只开盘即涨停。
   - 跌停卖不出：T+20 `close <= limit_down` 时记录下来，按冻结规则处理（建议仍按收盘价计，并标注“退出日跌停”）。
   - ST：用 `get_st_list` 在信号日判断，ST 股排除，并记录排除数量。
   - 退市：按点时成分股取股票池，后来退市的股票也在样本里；退出日已经退市、取不到价格的，按“缺端点”排除并记录（不悄悄删除）。
6. **3 年历史 + 后续 250 个交易日**：可以。单次不超过 5 年，按年分段请求后拼接；2019-01-01 至 2026-10-30 分两段共 1897 行，和交易日历一致。
7. **速度和配额**：批量 50 只 × 5 年 2.6 秒。沪深300 全量 5 年约 15 秒，中证1000 约 1 分钟。拉一次缓存到 `scripts/cache/`（不入库）。没遇到限流。
8. **公开展示许可**：还没向 PandaAI 确认，**需要有人去答疑群或展位问**。在拿到答复前：前端只放归一化曲线和派生统计（收益率、回撤、样本数）；数据来源页可以写真实代码和区间，但不放原始 OHLCV 表。
9. **QuantSkills**：[`quantskills/skill-quant-research`](https://github.com/quantskills/skill-quant-research) 存在，GPL-3.0，最近一次更新是 2026-08-06。同组织下还有 [`skill-pandadata-api`](https://github.com/quantskills/skill-pandadata-api) 等 Pandadata 技能。我们的工程里不引入 GPL 代码，只在“PandaAI 接入构想”里引用。

## 各数据产物的取法

| 产物 | 标的 | 基准 | 接口 |
|---|---|---|---|
| 第一幕 R1–R3 `cases.json`（YOU-151） | 从 T 日的沪深300 或中证500 点时成分里筛选，筛选只用 T 日及以前的数据 | R1：**沪深300（`000300.SH`），筛选前就固定**；R3 的“行业无同等异动”用中证全指一级行业指数 | `get_index_weights` → `get_stock_daily_pre`（走势）+ `get_stock_daily`（量和涨跌停判断）+ `get_index_daily` |
| 任务 A 标的 D `taskA.json`（YOU-152） | 不同于 A / B / C 的一只沪深300 成分股 | 沪深300（与 R1 一致） | 同上；答案由 `src/engine/metrics.ts` 和对应的 Python 实现共同计算 |
| 任务 B 猎豹题 `taskB_cheetah.json`（YOU-153） | **点时中证800**（沪深300 + 中证500 每日成分的并集），保证样本量 | 基准组：同一股票池、同一分段、同样的持有窗口，但不按信号筛选 | `get_index_weights` 每日成分 → `get_stock_daily`（批量）+ `get_adj_factor` + `get_st_list` |

## 已知局限（要写进来源页）

- 前复权以最新日为锚，绝对价位不是点时价格；收益率不受影响。
- 成交量未按送转调整，靠排除送转窗口来规避。
- 行业基准用中证全指一级行业，和申万口径不完全一致；申万归属只有当前分类，回溯历史时用的是今天的行业划分。
- 公开展示许可还没确认，暂按最保守方式处理。
- 数据截至 2026-10-30。
