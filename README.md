# dsh-plugin-index

DeepSeek Harness（dsh）插件索引。**只记录事实，不做打分**：可信安装源、宿主版本兼容矩阵、中文说明。

数据是一份可被程序消费的 JSON（[`data/index.json`](data/index.json)），同时产出一个可检索的静态页（[`site/index.html`](site/index.html)）。

---

## 为什么还要一个索引

生态里已经有 awesome 列表、[dshfind.com](https://dshfind.com/zh/plugins)、dsh-plugin-shop 这类市场，但它们都没处理下面四件事，而这四件恰恰最容易让人装错东西：

| 事实 | 后果 | 本索引的做法 |
|---|---|---|
| 插件清单有两套规范：完整版 `catalog/dsh-plugin.json`（`dsh-plugin` 0.15 schema）与简化版 `dsh.plugin.json` | 机器无法统一识别「这是不是真插件」 | 逐条探测 manifest，记录 `manifest.path / format / id / engines`；探不到就标 `manifest: null` |
| GitHub `dsh-plugin` topic 有 2 万+ 仓库，混入大量蹭标签项目 | 搜索噪声极高 | 以「能否解析到 manifest + README 是否给出安装方式」作为收录门槛 |
| 存在**作者明确禁止 npm 安装**的插件（npm 上有第三方篡改包） | 装到被改过的代码 | `trust.npm = forbidden` + `install.forbidden: ["npm"]`，并写明原因 |
| 旧宿主必须 pin 精确版本，`latest` 会前移 | 旧 dsh 装最新版直接不可用 | `compat[]` 把 README 的兼容矩阵结构化 |

## 目录结构

```
dsh-index/
├── schema/plugin.schema.json   # 条目 JSON Schema（字段与取值的唯一约定）
├── data/plugins/*.json         # 一个插件一个文件（便于 PR 共建，避免冲突）
├── data/index.json             # 构建产物：合并后的完整索引
├── scripts/build.mjs           # 校验 + 合并 + 生成静态页（零依赖）
├── scripts/refresh.mjs         # 从 GitHub API 刷新易变字段（stars/version/pushedAt）
└── site/
    ├── index.html              # 可检索静态页，数据内嵌，可直接托管
    └── api/plugins.json        # 静态 API（内容同 index.json）
```

## 用法

```bash
node scripts/build.mjs                      # 校验并重建 data/index.json 与 site/
GITHUB_TOKEN=xxx node scripts/refresh.mjs    # 查看上游变化（只读）
GITHUB_TOKEN=xxx node scripts/refresh.mjs --write   # 写回条目，再跑一次 build
```

零依赖，只要 Node ≥ 18。本地预览：`python3 -m http.server -d site 8000`。

## 字段语义（易踩坑的三个）

- **`install.spec`** —— 语义唯一：**被 `add` 的目标**，不含 `dsh plugin add` 前缀。完整可执行命令放在 `install.command`。这样既能直接喂给 dsh 的 AI，也能被其他工具拼接。
- **`trust.npm`** —— `official`（npm 包就是本仓库发布）/ `forbidden`（作者禁止，存在篡改包）/ `third-party` / `absent`（未发布 npm），不是质量评分，是渠道归属判定。
- **`compat[]`** —— 来自 README 兼容表的原文语义，`plugin: "none"` 表示该宿主版本无可用版本。旧宿主一律按矩阵装精确版本，不要用 `latest`。

## 收录一个新插件（30 秒）

1. 复制 `data/plugins/` 里任一文件为模板；
2. 从插件仓库的 manifest、README 安装章节、GitHub API 三处取事实填字段（**不推测**，拿不到就留 `null` 或空数组）；
3. `node scripts/build.mjs` —— 校验器会拦住分类越界、id 不合规、`spec` 混入命令前缀等问题；
4. `GITHUB_TOKEN=xxx node scripts/refresh.mjs --write` 让 stats 与 version 对齐上游。

## 已收录

| 插件 | 分类 | 推荐安装 | npm 渠道 | Star |
|---|---|---|---|---|
| [dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) | 模型接入 | release-tarball | **禁用**（第三方篡改包） | 32.8k |
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 侧边栏 | npm `@0.28.0` | 官方发布 | 4.4k |

## 待办 / 下一步

- [ ] 批量收录：用 topic 扫描 + manifest 探测，自动筛出「真插件」候选后再人工确认描述；
- [ ] 增加 `deprecated` / `archived` 状态位，跟进上游仓库是否停更；
- [ ] `refresh.mjs` 落地到 GitHub Actions，每日提交 diff（便于观察生态版本变动）；
- [ ] 页面加「按 dsh 版本过滤」——输入自己的 dsh 版本，只显示可装的插件与对应 pin 版本。

## License

本索引自身的条目文本以 CC0 提供；各插件内容与商标归其作者所有。
