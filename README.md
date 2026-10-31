# 下一张牌 · Next Card

> 听到一个说法，先决定翻哪张牌。

PandaAI「苏客松」赛道作品。三轮翻牌短决策，从用户怎样找证据、用证据，形成有行为依据的画像，并当场给出一关个性化研究任务。

纯前端 H5，手机竖屏优先。**无账号系统，无需登录，无测试账号。** 评审时不需要 Panda Data 账号：前端只读仓库里预生成的静态 JSON。页面里的代币是虚拟的，内容是研究练习，不构成投资建议。

- 在线地址：待部署后填写（YOU-146）；评委面板在地址后加 `?judge=1`
- 项目说明：[docs/PROJECT.md](docs/PROJECT.md)
- 第三方组件、AI 工具与赛前成果：[docs/CREDITS.md](docs/CREDITS.md)
- 结构化结果与接入构想：[docs/structured-output.md](docs/structured-output.md)、[docs/pandaai-integration.md](docs/pandaai-integration.md)
- 规则版本 `rules_version = v0.3`；PRD v0.3 在 Linear 项目文档里

## 环境要求

- Node.js ≥ 20（开发用 24）
- 离线取数：Python 3.11 / 3.12（**不要用 3.13**：`panda_data` 固定 numpy 1.26，3.13 没有预编译包），以及 Panda Data 账号（只放本地 `.env`，不进仓库）

## 前端

```bash
npm install
npm run dev        # 带 --host，同一局域网的手机可直接访问终端里打印的地址
npm test           # Vitest
npm run lint       # TypeScript 类型检查
npm run build      # 类型检查 → 构建到 dist/ → 扫描 dist/ 里有没有密钥
```

评委面板：在地址后加 `?judge=1`。可选预设路径（甲 / 乙 / 乙′ / 乙″ / 丙，均为模拟）或当前体验记录，逐轮改字段后分叉重算、可逐步撤销，前后差异并列；“反例检查”一键运行 PRD §9 的 9 项检查。结果由同一套引擎实时算出。

### 流程

开局告知 → 开场 → 三轮（第一判断 → 翻牌 ≤ 2 张 → 最终判断 + 你的下一步 → 追问 → 锁定 → 揭晓）→ 人物卡 / 依据页 / 分享卡 → 推荐的下一关（任务 A 或任务 B）→ 画像更新。

### 数据隔离

揭晓前只加载 `public/data/cases_visible.json`（只有 T 日及以前、相对日期、无代码和名称）。第 n 轮锁定后才请求 `cases_reveal_Rn.json`，且只请求这一轮；`src/data/cases.test.ts` 覆盖了这条规则。

### 引擎

`src/engine/` 下都是纯函数：`evaluate`（画像与进度）、`recommend`（下一关）、`settle`（代币结算，与画像隔离，前两者不导入它）。第一幕与任务 A 的规则对齐 PRD v0.3：一次观察为 `partial`，任务证据单独保留；只有重复的独立局内证据或正确完成基础任务步骤才满足 S1/S2。帮助、反馈和重试历史不会因切换档位或重开任务清除。

### 当前范围

第一幕三轮、揭晓、人物卡 / 依据页 / 分享卡、行动习惯、任务 A、任务 B 猎豹题、画像更新、评委面板（含 9 项反例检查）和结构化结果导出都可用。未实现：第二幕、任务 B 的大象题和狐狸题、自我预期校准、分享卡导出图片、引擎输出改用契约类型。完整对照见 [docs/PROJECT.md](docs/PROJECT.md) 第 9 节。

## 离线取数

```bash
uv venv .venv --python 3.12
uv pip install -r scripts/requirements.txt
cp .env.example .env   # 填 PANDA_USER / PANDA_PASS
.venv/bin/python scripts/pd_probe.py            # 接口可行性
.venv/bin/python scripts/build_cases.py         # 第一幕 R1–R3
.venv/bin/python scripts/build_taskA.py         # 任务 A 标的 D
.venv/bin/python scripts/build_taskB.py --topic cheetah   # 任务 B 猎豹题
.venv/bin/python scripts/check_taskB.py         # 任务 B 逐条口径检查
npm run test:py                                 # Python 测试
```

脚本产出的静态 JSON 写到 `public/data/`，前端只读这些文件，页面里不带任何密钥。所有数据文件都通过 `contracts/` 的 schema 校验（`src/data/contracts.test.ts`）。

## 目录

| 路径 | 内容 |
|---|---|
| `src/engine/` | 规则引擎与计算口径，纯函数，不依赖 DOM，可以直接在 Node 里测 |
| `src/ui/` | 游戏壳、组件、页面 |
| `src/panel/` | 评委面板（`?judge=1`） |
| `src/config/` | 关卡、规则表、文案，版本化配置 |
| `public/data/` | 离线生成的静态 JSON，只放获准公开的派生数据 |
| `contracts/` | 事件 / 关卡配置 / 输出 / 数据文件的 schema |
| `scripts/` | Python 离线取数和检查脚本，不进入前端打包 |
| `docs/` | PRD、数据可行性、项目说明 |

## 密钥检查

```bash
npm run check:secrets   # 扫描所有 git 跟踪的文件，看有没有 .env 里的真实值或 JWT
```

`npm run build` 结束时会自动扫描 `dist/`。

## 部署

`npm run build` 生成纯静态的 `dist/`（`base` 是 `./`，放在任意静态托管的任意子路径都能用，不需要服务端）。平台待仓库 owner 选定（Cloudflare Pages 或 GitHub Pages，YOU-146），上线后把链接写在这里。
