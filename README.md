# 下一张牌 · Next Card

> 听到一个说法，先决定翻哪张牌。

PandaAI「苏客松」赛道作品。三轮翻牌短决策，从用户怎样找证据、用证据，形成有行为依据的画像，并当场给出一关个性化研究任务。

纯前端 H5，手机竖屏优先。**无账号系统，无需测试账号。** 页面里的筹码是虚拟的，内容是研究练习，不构成投资建议。

## 环境要求

- Node.js ≥ 20（开发用 24）
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

GitHub Pages，用 GitHub Actions 部署（`.github/workflows/deploy.yml`）：推送 `main` 后跑测试和构建（含 `dist/` 密钥扫描），通过后发布 `dist/`。PR 上由 `.github/workflows/ci.yml` 跑同样的检查，但不部署。

- 线上地址：<https://wenan4.github.io/pandaai-hackathon-next-card/>
- 评委面板：<https://wenan4.github.io/pandaai-hackathon-next-card/?judge=1>

> 以上地址是 GitHub Pages 的默认地址。要等首次部署成功后，才能确认在手机上实际可以打开。

仓库是私有的，但 Pages 站点公开，评委不需要访问仓库。启用 Pages 只需做一次：仓库 Settings → Pages → Source 选 **GitHub Actions**。私有仓库的 Pages 需要账号是 GitHub Pro 或团队套餐。

`vite.config.ts` 里 `base: "./"`，资源和数据都按相对路径加载，换成 Cloudflare Pages 等根路径托管也不用改代码。
