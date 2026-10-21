# 分类法 · Classification

索引库用**两个正交维度**描述一个插件，避免「dsh 的 UI 插件」和「VSCode 的 UI 插件」混在同一堆里：

```
ecosystem（装进哪个宿主）  ×  category（解决什么问题）
        dsh                        sidebar
        vscode                     model-provider
        obsidian                   automation
```

- **ecosystem 决定事实来源**：清单文件叫什么、manifest 规范是什么、安装命令长什么样、市场在哪。
- **category 决定检索体验**：跨生态用同一套功能词汇，用户搜「模型接入」时，dsh 与 VSCode 的同类插件都能命中。

新增生态只动第一维度，不需要改 schema 结构 —— 这正是本库为「综合」预留的扩展位。

---

## 一、生态（ecosystem）

| 标识 | 宿主 | 清单文件 | 安装形态 | 官方/主要市场 |
|---|---|---|---|---|
| `dsh` | DeepSeek Harness | `catalog/dsh-plugin.json`（dsh-plugin 0.15）或 `dsh.plugin.json` 或 `package.json` 的 `dsh` 字段 | `dsh plugin --profile <p> add <spec>` | npm、Releases、dshfind.com、dsh-plugin-shop |
| `claude-code` | Claude Code | `.claude-plugin/plugin.json` | `/plugin` 或 marketplace 注册 | 社区 marketplace |
| `codex` | OpenAI Codex CLI | 仓库内 config / prompts 目录 | 配置文件挂载 | 社区整理 |
| `vscode` | VS Code | `package.json`（`contributes` / `activationEvents`） | Marketplace 安装或 `.vsix` | VS Code Marketplace |
| `chrome-extension` | Chrome / Chromium | `manifest.json`（MV3） | Web Store 或加载已解压 | Chrome Web Store |
| `obsidian` | Obsidian | `manifest.json` + `community-plugins.json` | 社区插件市场或 BRAT | Obsidian 社区 |
| `raycast` | Raycast | `package.json`（`commands`） | `npm run dev` / Store | Raycast Store |
| `neovim` | Neovim | lua 插件 spec | lazy.nvim / packer | 无中心市场 |
| `mcp` | MCP 客户端（多宿主通用） | `server.json` / `package.json` 的 `mcp` | `npx` / `uvx` / 远端 SSE | MCP registry、Smithery 等 |
| `n8n` | n8n | 节点包 `package.json` 的 `n8n` | npm 包安装到 community nodes | n8n 社区节点 |
| `figma` | Figma | `manifest.json` | 插件市场或本地导入 | Figma Community |
| `blender` | Blender | `bl_info`（Python） | 安装 zip / 扩展市场 | Blender Extensions |
| `browser-userscript` | 浏览器（Tampermonkey 等） | `@match` / `@grant` 头部 | 直接安装 `.user.js` | Greasy Fork |
| `other` | 兜底 | — | — | — |

> `mcp` 单列而不挂到某个宿主下：MCP server 天然跨客户端，归到具体宿主会丢失可发现性。

**新增生态的步骤（4 步）**

1. 在 `schema/plugin.schema.json` 的 `ecosystem.enum` 里加标识（kebab-case，生态族名而非产品版本）；
2. 在上表补一行：清单文件、安装形态、市场；
3. 在 `scripts/refresh.mjs` 的 `MANIFEST_CANDIDATES` 里加该生态的清单路径与解析分支；
4. 先收录 2–3 个真实条目跑通，再批量。

---

## 二、功能分类（category）

单数、kebab-case。**一个插件可以有多个分类，首个是主分类**（决定卡片标题旁的主徽章）。

| 标识 | 中文 | 判定标准（能回答「它主要让什么变好」） |
|---|---|---|
| `model-provider` | 模型接入 | 新增模型来源/网关/路由，改变「能用哪些模型」 |
| `sidebar` | 侧边栏 | 占据侧边/底部固定区域，承载多面板 |
| `ui` | 界面 | 改变现有界面的布局、交互、展示密度 |
| `editor` | 编辑器 | 提供或增强文本/代码编辑能力 |
| `terminal` | 终端 | 提供终端、命令行、shell 交互 |
| `workflow` | 工作流 | 编排多步骤任务、计划、子代理协作 |
| `automation` | 自动化 | 触发式执行（定时、事件、监听），减少手动操作 |
| `tool` | 工具 | 向宿主注册可调用工具/命令，扩展「能做什么」 |
| `developer-tools` | 开发工具 | Git、调试、构建、测试、代码审查等开发链路 |
| `media` | 媒体 | 图像/音视频的生成、处理、预览 |
| `data` | 数据 | 数据库、数据集、统计与看板 |
| `knowledge` | 知识 | 笔记、记忆、知识库、检索增强 |
| `search` | 搜索 | 搜索/抓取/信息聚合 |
| `communication` | 通讯 | IM、通知、邮件、社交平台接入 |
| `theme` | 主题 | 纯视觉：配色、字体、玻璃质感等皮肤 |
| `desktop` | 桌面端 | 打包/宿主本身、托盘、快捷键壳 |
| `integration` | 集成扩展 | 对接外部服务/账号（云厂商、SaaS、协议） |
| `security` | 安全 | 权限、审计、密钥、沙箱 |
| `other` | 其它 | 确实无法归类时才用 |

**不要把这三样放进 category**：技术栈（TypeScript）、分发方式（npm）、目标人群（新手）。前者用 `language`，后者用 `channels`，第三项不记录。

---

## 三、收录门槛（判定「这是不是一个真插件」）

按顺序判定，任一步失败都要在条目里如实标注，而不是猜测：

1. **能找到清单**：仓库根目录或常见路径存在该生态的 manifest 文件 → 记 `host.manifestPath` / `manifestFormat`；找不到就写 `null`，并在 PR 说明里标注「未确认」。
2. **清单声明了入口**：如 dsh 的 `facets.host.entry`、VSCode 的 `main`、Chrome 的 `background.service_worker`。
3. **README 给出安装方式**：能落到具体命令或具体渠道。只有截图没有安装方式的不收。
4. **tag 不能作为证据**：GitHub 的 `dsh-plugin` topic 有 2 万+ 仓库，`1Panel` 之类非插件项目也在其中。topic 只用于**发现候选**，不作为收录依据。

## 四、供应链字段的填写口径

`channels[].trust` 描述的是「这个渠道上的东西是不是作者自己发布的」，不是好用程度：

| 取值 | 含义 | 典型判据 |
|---|---|---|
| `official` | 作者/组织自己发布 | README 直接引用该渠道链接与版本徽章 |
| `forbidden` | 作者明确禁止 | README 写「不要通过 X 安装」并说明原因 |
| `third-party` | 存在的同名包由他人打包 | 作者声明包被改动、非官方构建 |
| `absent` | 该渠道没有 | 如私有包未发布 npm |
| `unknown` | 未能确认 | 未找到证据时用这个，不要猜 |

`install.spec` 与 `install.command` 的分工必须守住：**spec 只写被安装的目标**（AI 与工具要能直接拼），command 才是给人复制的完整命令。混入 `dsh plugin add` 前缀会让其他生态的消费方拼出错误命令 —— `build.mjs` 会直接拦下这种写法。
