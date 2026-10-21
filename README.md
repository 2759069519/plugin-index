# 插件索引 · Plugin Index

**跨生态的插件索引：只写事实，不做评分。**

可信安装源 · 宿主版本兼容矩阵 · 中文检索。数据是一份可被程序消费的 JSON，同时产出一个可检索的静态页。

![ecosystems](https://img.shields.io/badge/ecosystems-dsh%20%2B%2013%20slots-1c1814)
![plugins](https://img.shields.io/badge/plugins-2-d64524)
![deps](https://img.shields.io/badge/dependencies-0-2f6b3a)
![node](https://img.shields.io/badge/node-%E2%89%A518-5b544c)

---

## 为什么需要它

生态里不缺清单，缺的是**能让人装对**的清单。以下四件事决定了一个插件会不会被装错，而现有 awesome 列表与插件市场普遍没处理：

| 事实 | 装错的后果 | 本库的做法 |
|---|---|---|
| 清单规范不统一（如 dsh 同时存在 `catalog/dsh-plugin.json` 与 `dsh.plugin.json`） | 机器无法判断「这是不是真插件」 | 逐条探测清单，记 `host.manifestPath / manifestFormat`，探不到就写 `null` 并标为待复核 |
| GitHub topic 存在大量噪声（`dsh-plugin` topic 有 2 万+ 仓库，连服务器面板都在里面） | 搜索结果不可信 | topic 只用于**发现候选**；收录门槛是「有清单 + README 给出安装方式」 |
| 部分插件被第三方重新打包发布到 npm（作者明确禁止） | 装到改动过的代码 | `channels[].trust = forbidden` + `install.forbidden`，并把原因写进条目 |
| 旧宿主必须 pin 精确版本，`latest` 会前移 | 旧宿主装最新版直接用不了 | `compat[]` 把 README 的兼容表结构化，页面直接给出「你的版本该装哪个」 |

## 两层分类

`ecosystem`（装进什么）与 `category`（解决什么）正交：

```
dsh        × sidebar          → DeepSeek Harness 的侧边栏工作台
dsh        × model-provider   → DeepSeek Harness 的模型接入
vscode     × ui               → VS Code 的界面增强
obsidian   × knowledge        → Obsidian 的知识管理
```

新增一个生态**只改一个 enum**，不动 schema 结构、不动页面。完整清单与新增步骤见 [docs/CATEGORY.md](docs/CATEGORY.md)。

## 目录结构

```
plugin-index/
├── schema/plugin.schema.json   条目 Schema：字段与取值的唯一约定
├── docs/CATEGORY.md            分类法：生态清单 / 功能分类 / 收录门槛 / 供应链口径
├── data/plugins/*.json         一个插件一个文件（便于 PR 共建，避免冲突）
├── data/index.json             构建产物：合并后的完整索引
├── scripts/build.mjs           校验 + 合并 + 生成页面（零依赖）
├── scripts/refresh.mjs         从平台 API 刷新 stars / version / 清单声明
├── site/index.html             可检索静态页（数据内嵌，可直接托管）
└── site/api/plugins.json       静态 API（内容同 index.json）
```

## 用法

```bash
node scripts/build.mjs                              # 校验并重建索引与页面
GITHUB_TOKEN=xxx node scripts/refresh.mjs            # 只看上游变化（dry-run）
GITHUB_TOKEN=xxx node scripts/refresh.mjs --write    # 写回后再 build 一次
python3 -m http.server -d site 8000                 # 本地预览 http://localhost:8000
```

只有 Node ≥ 18，没有任何依赖。校验器会拦住分类越界、`id` 前缀与生态不符、`install.spec` 混入命令前缀这类错误。

推送到仓库后，`.github/workflows/refresh.yml` 每天 03:17 UTC 自动刷新元数据并提交 diff —— 生态的版本变动会以提交历史的形式留下痕迹。

## 三个必须守住的字段

| 字段 | 唯一语义 | 常见错误 |
|---|---|---|
| `install.spec` | **被安装的目标**（包名/仓库/文件/目录），不含任何命令前缀 | 写成 `dsh plugin add xxx`，导致其他生态的消费方拼出错误命令 |
| `install.command` | 完整可执行命令，给人复制 | 与 spec 混用，AI 拿到后重复加前缀 |
| `channels[].trust` | 该渠道上的东西**是不是作者自己发布的** | 当成质量评分；未确认时臆测为 `official`（应用 `unknown`） |

## 收录一个插件

1. 复制 `data/plugins/` 里任一文件作模板；
2. 事实只从三处取：**插件清单文件**、**README 安装章节**、**平台 API**。取不到就写 `null` / 空数组，不推测；
3. `node scripts/build.mjs` 校验；
4. `GITHUB_TOKEN=xxx node scripts/refresh.mjs --write` 对齐 stars / version。

## 已收录

| 插件 | 生态 | 主分类 | 推荐安装 | 渠道提示 | Stars |
|---|---|---|---|---|---|
| [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) | dsh | 模型接入 | Release 包 | **npm 禁用**（同名包为第三方篡改） | 32.9k |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | dsh | 侧边栏 | npm `@0.28.0` | 官方发布 | 4.4k |

## 生态路线图

- [x] `dsh` — DeepSeek Harness（清单探测已实现两套规范）
- [ ] `mcp` — 天然跨客户端，优先级最高；清单探测分支已写好
- [ ] `claude-code` — `.claude-plugin/plugin.json`
- [ ] `vscode` — `package.json` 的 `contributes` / `engines.vscode`
- [ ] `chrome-extension` / `obsidian` — `manifest.json`（MV3 / 社区插件格式）
- [ ] `n8n`、`raycast`、`figma`、`blender`、`browser-userscript`
- [ ] 页面按「我的宿主版本」过滤，只显示可装版本
- [ ] 条目增加 `deprecated` / `archived` 状态位，跟进上游停更

## License

本索引的条目文本以 CC0 提供；各插件的内容、名称与商标归其作者所有。
