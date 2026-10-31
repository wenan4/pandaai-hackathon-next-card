# 下一张牌 · 晨光小城（v0.4.1 MVP）

阳光童话风格的手机卡牌冒险：打出组合、获得新牌、安排途中补给与历史派生契约，随后用实际研究操作认识自己的信息使用方式，并进入有依据的下一步练习。

此分支提供已通过本地完整流程验证的 v0.4.1 MVP。新版默认入口为首页；`?legacy=1` 保留 v0.3，旧版评委面板用 `?legacy=1&judge=1`。两个版本的存档独立。新评委面板在旅程中的顶部导航打开，包含两条模拟路径与合法分叉。

- 在线试玩：[Cloudflare Pages 预览](https://codex-v04-mvp.pandaai-hackathon-next-card.pages.dev/)
- 开发与审查：[PR #13](https://github.com/wenan4/pandaai-hackathon-next-card/pull/13)

- 修订规格：[PRD v0.4.1](docs/PRD-v0.4.md)，§17 明确知识、研究过程、兴趣、学习需求和任务后画像更新。
- 实际验证：[MVP 验证记录](docs/MVP-VERIFICATION.md)。未通过浏览器验证的能力不作为完成声明。
- 演示流程与本地视频：[4分45秒功能演示说明](docs/DEMO-WALKTHROUGH.md)，包含实际操作、模拟分叉及数据核对，不作为真人试玩。
- 美术与生成提示：[美术来源](docs/adventure-art.md)。本次生成原创插画，用户已指定明亮、亲切的大众视觉方向。
- 数据口径：[冒险数据说明](docs/adventure-data.md)。只发布派生数据，前端不需要 Panda Data 账号。
- 安装与运行：`npm ci`、`npm run dev`；发布检查：`npm run build:pages`。

页面已收到但入口、界面或样式未能加载时，会显示加载阶段与“重新加载”入口。等待较久仍可继续等待，恢复后自动进入页面；重试保留当前地址与原有进度，旧版入口同样适用。首次网络请求连页面都未收到时，仍由浏览器报告连接错误。

本地存档损坏、版本不兼容或浏览器拒绝读取时，会进入恢复页，提供重试、主动下载原始备份，以及确认清除后开始新旅程。不会自动覆盖异常记录；已确认过期的观察仍按原期限清理。正常存档可直接继续，新旧版清除记录的范围相互独立。

游戏中的金币与契约只用于虚构冒险；报告限定于具体任务与本局观察，不构成稳定人格识别、现实风险等级或投资建议。MVP 无需登录。

快速体验：先打完城门教学战并选择奖励，进入第一处营地；点击“查看当前线索”，即可使用资金安排台或历史对照台，不必先通关。任务中可以切换自主、提示或分步帮助，提交后可直接进入下一任务；已看过的案例标为复习。战斗选牌预览按当前公开状态显示效果，不揭示将抽到的牌。

战斗中点击牌区计数可查看手牌、抽牌、弃牌、消耗区和完整牌组的组成，分组清单不代表抽取顺序。临时与永久保留分别标明；过载结算后的回合恢复值与当前剩余能量分开显示。

路线卡列出敌人的生命、奖励和开局三步。战斗中可点击“查看节奏”，比较本回合结束与后两次敌人行动，按实际规则计入后期攻击增长；护盾不随攻击加成增加。查看不会推进战斗或改变已选卡牌，提前结束战斗时尚未执行的计划也不会发生。

奖励牌先点选比较，确认后才加入，也可直接不拿。商店与免费整备会显示本次实际取得的物品、生命变化和花费，同名牌升级后序号保持稳定；免费休息按当前缺血显示恢复量，满血时不可误用。战斗结束而报价尚未到达时，会分别说明结局和结算进度，报价未通过校验也可重试原订单。

推荐会分别说明理由和当前可用内容：本局账本、机制示例、未标已见片段、复习或继续原题。完成任务后可查看推荐为何变化或维持；案例目录故障可在任务内重试，已锁定的判断与先验保留。

研究提交后直接定位到结果，逐项对照本人选择和计算依据。资金安排说明具体采购及资金差额，历史任务分别反馈同期比较、两段差异和样本边界；改选资金答案后旧结果失效，已看过的答案仍保留为暴露记录。只玩模式也有相同的即时反馈，不保存研究观察。

结果区的主要操作跟随当前推荐：继续调整资金计划，或进入可用的历史研究；修改目标后入口随之更新，已锁题、未见片段、复习与目录重试分别处理。观察模式可在报告中独立回看最近一次资金核查，对照当时保存的原试算与修订计划，不会因后来做了历史任务而消失，也不会重新取价改写旧结果。

评委演示：从顶部“评委面板”打开两条模拟路径、不同研究表现对照，或改变关键经营选择后分叉；也可分别修改事前与当下的模拟感受和行动，查看哪些结论改变。所有模拟均标明来源，可恢复真实旅程。数据说明披露四个历史案例、关联窗口和后验选案限制。

## 以下为保留的 v0.3 文档

> 听到一个说法，先决定翻哪张牌。

PandaAI「苏客松」赛道作品。三轮翻牌短决策，从用户怎样找证据、用证据，形成有行为依据的画像，并当场给出一关个性化研究任务。

纯前端 H5，手机竖屏优先。**无账号系统，无需登录，无测试账号。** 评审时不需要 Panda Data 账号：前端只读仓库里预生成的静态 JSON。页面里的代币是虚拟的，内容是研究练习，不构成投资建议。

- v0.3 入口：本站地址后加 `?legacy=1`；旧版评委面板加 `?legacy=1&judge=1`
- 项目说明：[docs/PROJECT.md](docs/PROJECT.md)
- 第三方组件、AI 工具与赛前成果：[docs/CREDITS.md](docs/CREDITS.md)
- 结构化结果与接入构想：[docs/structured-output.md](docs/structured-output.md)、[docs/pandaai-integration.md](docs/pandaai-integration.md)
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
