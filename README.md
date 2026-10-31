# 下一张牌 · Next Card

> 听到一个说法，先决定翻哪张牌。

PandaAI「苏客松」赛道作品。三轮翻牌短决策，从用户怎样找证据、用证据，形成有行为依据的画像，并当场给出一关个性化研究任务。

纯前端 H5，手机竖屏优先。**无账号系统，无需测试账号。** 页面里的筹码是虚拟的，内容是研究练习，不构成投资建议。

## 环境要求

- Node.js 24（`.node-version` 与 CI、Cloudflare Pages 保持一致）
- 离线取数：Python 3.11 / 3.12，以及 Panda Data 账号（只放本地 `.env`，不进仓库）

## 前端

```bash
npm install
npm run dev        # 带 --host，同一局域网的手机可直接访问终端里打印的地址
npm test           # Vitest
npm run lint       # TypeScript 类型检查
npm run build      # 类型检查 → 构建到 dist/ → 扫描 dist/ 里有没有密钥
```

评委面板：在地址后加 `?judge=1`。可选预设路径（甲 / 乙 / 乙′ / 乙″ / 丙，均为模拟）或当前体验记录，逐轮改字段后分叉重算，前后差异并列；结果由同一套引擎实时算出。

### 流程

开局告知 → 开场 → 三轮（第一判断 → 翻牌 ≤ 2 张 → 最终判断 + 你的下一步 → 追问 → 锁定 → 揭晓）→ 人物卡 / 依据页 / 分享卡 → 推荐的下一关（任务 A 或任务 B）→ 画像更新。

### 数据隔离

揭晓前只加载 `public/data/cases_visible.json`（只有 T 日及以前、相对日期、无代码和名称）。第 n 轮锁定后才请求 `cases_reveal_Rn.json`，且只请求这一轮；`src/data/cases.test.ts` 覆盖了这条规则。

### 引擎

`src/engine/` 下都是纯函数：`evaluate`（画像与进度）、`recommend`（下一关）、`settle`（代币结算，与画像隔离，前两者不导入它）。第一幕与任务 A 的规则对齐 PRD v0.3：一次观察为 `partial`，任务证据单独保留；只有重复的独立局内证据或正确完成基础任务步骤才满足 S1/S2。帮助、反馈和重试历史不会因切换档位或重开任务清除。

### 当前范围

第一幕三轮、任务 A、人物卡和评委改选面板可用。任务 B 尚无两段真实数据，入口明确显示“数据准备中”，不能提交或计为完成；第二幕、O5、行动习惯展示、其余 6 项面板反例和分享图片导出仍待后续实现。本 PR 是 M1 可玩版本，不代表完整赛题验收完成。

评委面板读取当前体验时会保留任务完成记录和帮助历史。分叉修改只作用于局内字段，和游戏共用同一个规则引擎。

## 离线取数

```bash
uv venv .venv --python 3.12
uv pip install -r scripts/requirements.txt
cp .env.example .env   # 填 PANDA_USER / PANDA_PASS
.venv/bin/python scripts/pd_probe.py
```

脚本产出的静态 JSON 写到 `public/data/`，前端只读这些文件，页面里不带任何密钥。

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

使用 **Cloudflare Pages 原生 Git 集成**。连接私有仓库 `wenan4/pandaai-hackathon-next-card` 后，`main` 更新自动发布生产版本，其他分支生成独立预览。GitHub Actions 只运行 CI；不再使用 GitHub Pages 的部署任务、权限或环境。

### 一次性接入

在 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) 创建 Pages 项目，选择导入 Git 仓库；若提示连接 GitHub，将 Cloudflare Workers & Pages 应用的仓库权限限定为本仓库。配置如下：

| 设置 | 值 |
|---|---|
| 项目名 | `pandaai-hackathon-next-card`（以创建成功后的名称为准） |
| 生产分支 | `main` |
| 框架预设 | None |
| 根目录 | 仓库根目录 |
| 构建系统 | v3 |
| 构建命令 | `npm ci && npm run build:pages` |
| 输出目录 | `dist` |
| Node.js | 根目录 `.node-version` 指定的 24 |
| 环境变量（Production 和 Preview） | `SKIP_DEPENDENCY_INSTALL=1`，由构建命令执行锁定依赖安装 |
| 分支控制 | 开启 `main` 自动生产部署；其他分支开启预览 |
| PR 评论 | 关闭；部署状态和预览地址从 Cloudflare 查看 |

`build:pages` 依次执行测试、类型检查、构建、产物密钥扫描和仓库密钥扫描；任何一步失败都会以非零状态结束，Pages 不会发布该提交。`.github/workflows/ci.yml` 在 PR 和 `main` 上运行相同检查。只有 `dist/` 会发布；不上传源码、文档、Python 环境或取数凭据。Cloudflare 无需 Panda Data 账号，也无需在 GitHub Secrets 中保存 Cloudflare API Token。

### 上线状态与验收

**尚未上线（2026-10-31）**：Cloudflare 插件连接已验证，但创建 Git 集成项目时返回 `8000011`（Pages Git installation 不可用），账号中尚无本项目。需完成或修复上述 GitHub 仓库授权，再创建项目。此处暂不提供未经验证的 `pages.dev` 地址。

首次部署成功后，在 Deployments 中确认生产部署对应 `main` 的提交，并验证手机首页、字体、静态 JSON 与 `?judge=1` 评委面板；再将实际正式地址和评委入口补入本节。PR／分支预览地址不得作为正式地址，预览部署不得覆盖生产版本。

仓库保持私有，发布的 Pages 网站公开；无账号系统，无需测试账号。`vite.config.ts` 使用 `base: "./"`，资源和数据按相对路径加载，可直接部署在 Pages 根路径。

配置依据：[Git 集成](https://developers.cloudflare.com/pages/configuration/git-integration/)、[构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[构建环境与版本覆盖](https://developers.cloudflare.com/pages/configuration/build-image/)。
