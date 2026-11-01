# 运行、配置与部署

本说明适用于默认的 v0.4.1 卡牌冒险。评审可以直接使用[正式H5](https://pandaai-hackathon-next-card.pages.dev/)，不需要安装或登录。

## 1. 从完整工程运行

需要 Node.js 24 和随附的 npm。版本文件 `.node-version` 与 CI/Cloudflare 配置一致。获取 `main` 的源码或解压工程包，在包含 `package.json` 的目录执行：

```sh
npm ci
npm run dev
```

打开终端打印的本地地址。当前 `dev` 命令带 `--host`：手机与电脑处于同一局域网、且允许该开发端口访问时，可打开终端显示的 Network 地址。正式评审更推荐 HTTPS 正式网址。

安装依赖需要访问 npm registry；运行网页不需要外部模型或行情服务账号。请通过 HTTP 开发/预览服务器打开，不能直接双击 `index.html`。

## 2. 发布构建与检查

源码ZIP和Git克隆都适用：

```sh
npm test
npm run build
npm run preview
```

Git检出目录/CI中使用 `npm run build:pages` 执行完整发布检查。该命令最后的仓库扫描通过Git枚举受跟踪和未忽略文件，因此无 `.git` 的源码ZIP使用上面三条命令；`npm run build` 仍包含类型检查和发布产物密钥扫描。

`build:pages` 依次执行单元/集成测试、TypeScript检查、Vite构建及产物/工程的密钥检查；成功后生成 `dist/`。`preview` 用HTTP服务器检查这份产物，地址以终端输出为准。最新验证基线为47个测试文件、514项，详见[验证记录](MVP-VERIFICATION.md)。

单项命令：`npm test`、`npm run lint`、`npm run build`、`npm run check:secrets`。GitHub Actions 在 PR 与 `main` 上执行同一发布检查。

## 3. 配置项

| 项目 | 默认运行是否需要 | 说明 |
|---|---|---|
| Node.js/npm | 本地构建需要 | Node.js 24；依赖由 `package-lock.json` 锁定 |
| `.env`、API密钥 | 不需要 | 前端无需任何秘密配置；请勿向浏览器注入Panda Data账号 |
| Python、Panda Data SDK | 不需要 | 仅数据维护者离线重新取数时使用 |
| 数据库、后端、LLM账户 | 不需要 | 当前应用为静态H5，画像和推荐在本机计算 |
| 游戏/观察存档 | 浏览器本地保存 | 无跨设备同步；预览域名和正式域名的存档各自独立 |

`public/data/adventure/` 已包含当前演示所需的派生数据，`public/art/adventure/` 已包含运行美术。数据不可用时页面会提示重试，订单与已锁定任务保留；不会用编造报价补位。

## 4. Cloudflare Pages

仓库已连接现有项目 `pandaai-hackathon-next-card`，无需新建项目。

| 配置 | 值 |
|---|---|
| GitHub仓库 | `wenan4/pandaai-hackathon-next-card` |
| 生产分支 | `main` |
| 正式网址 | https://pandaai-hackathon-next-card.pages.dev/ |
| 根目录 | 仓库根目录 |
| 构建命令 | `npm ci && npm run build:pages` |
| 输出目录 | `dist` |
| Node.js | `.node-version` 为24，Pages `NODE_VERSION=24` |

分支推送生成预览；合并到 `main` 触发正式部署。构建失败时该提交不发布。仅 `dist/` 对外提供服务，开发凭据、Python环境、原始缓存和本地录屏不进入网站。评审期间保持该Pages项目及Git集成有效，发布后核对部署状态和正式网址。

## 5. 可选的离线数据维护

**这不是启动网站的前置步骤。** 如需重新获取/生成数据，使用Python 3.12环境，安装 `scripts/requirements.txt`；Panda Data账号只放在被忽略的本地 `.env`，模板见仓库 `.env.example`。不要把实际账号写进文档、日志、前端变量或提交包。

已有可信缓存时，可重建冒险派生数据：

```sh
python scripts/build_adventure_data.py --cache-dir <可信的本项目scripts/cache目录>
```

原始缓存未包含在提交包中；维护者需自行取得数据访问权限。脚本对已冻结文件做一致性检查，具体数据接口、窗口与重建约束见[冒险数据说明](adventure-data.md)。仅运行现有H5无需执行上述命令。

## 6. 常见问题

- **首页等待或资源加载失败**：使用页面“重新加载”或浏览器刷新；检查网络。若数据目录加载失败，使用“重试数据”。
- **异常/旧版本存档**：按恢复页重试；可主动下载本地备份，确认后再清除。不要用手工编辑存档来演示真实结果。
- **正式站看不到预览站进度**：两个域名的浏览器存储彼此独立；正式站可从新旅程开始。
- **为什么没有人物画像**：进入时选了“只玩游戏”，或撤销/到期清理了观察；游戏进度与观察是两件事。新旅程可选择生成观察。
- **找不到旧版**：显式使用 `?legacy=1`；旧版评委面板为 `?legacy=1&judge=1`。旧说明已归档。
