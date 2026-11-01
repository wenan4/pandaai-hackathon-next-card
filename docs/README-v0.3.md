# v0.3 工程说明（归档）

本文件保留旧版迭代说明，不作为当前参赛版本的功能承诺。当前版本见 [仓库首页](../README.md) 与 [项目说明](PROJECT.md)。旧版仅通过 `?legacy=1` 访问。

> 听到一个说法，先决定翻哪张牌。

PandaAI「苏客松」赛道作品。三轮翻牌短决策，从用户怎样找证据、用证据，形成有行为依据的画像，并当场给出一关个性化研究任务。

纯前端 H5，手机竖屏优先。**无账号系统，无需登录，无测试账号。** 评审时不需要 Panda Data 账号：前端只读仓库里预生成的静态 JSON。页面里的代币是虚拟的，内容是研究练习，不构成投资建议。

- v0.3 入口：本站地址后加 `?legacy=1`；旧版评委面板加 `?legacy=1&judge=1`
- 项目说明：[docs/PROJECT.md](PROJECT-v0.3.md)
- 第三方组件、AI 工具与赛前成果：[docs/CREDITS.md](CREDITS.md)
- 结构化结果与接入构想：[docs/structured-output.md](structured-output.md)、[docs/pandaai-integration.md](pandaai-integration.md)
- 规则版本 `rules_version = v0.3`；PRD v0.3 在 Linear 项目文档里

## 环境要求

- Node.js 24（`.node-version` 与 CI、Cloudflare Pages 保持一致）
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

任务 B 的 `taskB_cheetah.json` 是“放量上涨之后”的统计，和第 3 轮同类，所以等第一幕三轮全部锁定后才请求；加载失败只影响任务 B 相关页面。

### 引擎

`src/engine/` 下都是纯函数：`evaluate`（画像与进度）、`recommend`（下一关）、`settle`（代币结算，与画像隔离，前两者不导入它）。第一幕与任务 A 的规则对齐 PRD v0.3：一次观察为 `partial`，任务证据单独保留；只有重复的独立局内证据或正确完成基础任务步骤才满足 S1/S2。帮助、反馈和重试历史不会因切换档位或重开任务清除。

### 当前范围

第一幕三轮、揭晓、人物卡 / 依据页 / 分享卡、行动习惯、任务 A、任务 B 猎豹题、画像更新、评委面板（含 9 项反例检查）和结构化结果导出都可用。未实现：第二幕、任务 B 的大象题和狐狸题、自我预期校准、分享卡导出图片、引擎输出改用契约类型。完整对照见 [docs/PROJECT.md](PROJECT-v0.3.md) 第 9 节。

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

使用 **Cloudflare Pages 原生 Git 集成**，已连接私有仓库 `wenan4/pandaai-hackathon-next-card`。`main` 更新自动发布生产版本，其他分支生成独立预览。GitHub Actions 只运行 CI；不再使用 GitHub Pages 的部署任务、权限或环境。

### 部署配置

在 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) 中管理现有 Pages 项目，无需重复创建。Cloudflare Workers & Pages 应用已获得本仓库访问权限；配置如下：

| 设置 | 值 |
|---|---|
| 项目名 | `pandaai-hackathon-next-card` |
| 生产分支 | `main` |
| 框架预设 | None |
| 根目录 | 仓库根目录 |
| 构建系统 | v3 |
| 构建命令 | `npm ci && npm run build:pages` |
| 输出目录 | `dist` |
| Node.js | 根目录 `.node-version` 指定的 24 |
| 环境变量（Production 和 Preview） | `NODE_VERSION=24` 与版本文件一致；`SKIP_DEPENDENCY_INSTALL=1`，由构建命令执行锁定依赖安装 |
| 分支控制 | 开启 `main` 自动生产部署；其他分支开启预览 |
| PR 评论 | 关闭；部署状态和预览地址从 Cloudflare 查看 |

`build:pages` 依次执行测试、类型检查、构建、产物密钥扫描和仓库密钥扫描；任何一步失败都会以非零状态结束，Pages 不会发布该提交。`.github/workflows/ci.yml` 在 PR 和 `main` 上运行相同检查。只有 `dist/` 会发布；不上传源码、文档、Python 环境或取数凭据。Cloudflare 无需 Panda Data 账号，也无需在 GitHub Secrets 中保存 Cloudflare API Token。

### 上线状态与验收

**已上线（2026-10-31）**：

- 正式体验：[下一张牌](https://pandaai-hackathon-next-card.pages.dev/)
- 评委面板：[改变选择并实时重算](https://pandaai-hackathon-next-card.pages.dev/?judge=1)

已在 360px 手机视口验证首页、第一轮、字体和静态数据加载，无横向溢出或浏览器报错。评委面板修改 R1 最终判断后，O1 与 O4 按规则重算并展示前后差异；未改动的行动对应代币余额保持不变。

生产部署与 PR 分支预览均已成功，且预览没有替换生产部署。后续在 Pages 的 Deployments 中查看每次构建状态和对应 Git 提交；PR／分支预览地址不得作为正式地址。

仓库保持私有，发布的 Pages 网站公开；无账号系统，无需测试账号。`vite.config.ts` 使用 `base: "./"`，资源和数据按相对路径加载，可直接部署在 Pages 根路径。

配置依据：[Git 集成](https://developers.cloudflare.com/pages/configuration/git-integration/)、[构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[构建环境与版本覆盖](https://developers.cloudflare.com/pages/configuration/build-image/)。
