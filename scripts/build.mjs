#!/usr/bin/env node
// 插件索引构建：校验 data/plugins/*.json → 生成 data/index.json + site/
// 零依赖，Node >= 18。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(ROOT, 'data', 'plugins');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'schema', 'plugin.schema.json'), 'utf8'));

const ECOSYSTEMS = SCHEMA.properties.ecosystem.enum;
const CATEGORIES = SCHEMA.properties.category.items.enum;
const CHANNELS = SCHEMA.definitions.channelName.enum;

const errors = [];
const warnings = [];
const check = (cond, at, msg) => { if (!cond) errors.push(`${at}: ${msg}`); };

/* ---------------- 展示用常量（模板与校验共用） ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => n.toLocaleString('en-US');

const ECO_LABEL = {
  dsh: 'DeepSeek Harness', 'claude-code': 'Claude Code', codex: 'Codex CLI', vscode: 'VS Code',
  'chrome-extension': 'Chrome 扩展', obsidian: 'Obsidian', raycast: 'Raycast', neovim: 'Neovim',
  mcp: 'MCP', n8n: 'n8n', figma: 'Figma', blender: 'Blender',
  'browser-userscript': '用户脚本', other: '其它'
};
const CAT_LABEL = {
  'model-provider': '模型接入', sidebar: '侧边栏', ui: '界面', editor: '编辑器', terminal: '终端',
  workflow: '工作流', automation: '自动化', tool: '工具', 'developer-tools': '开发工具', media: '媒体',
  data: '数据', knowledge: '知识', search: '搜索', communication: '通讯', theme: '主题',
  desktop: '桌面端', integration: '集成扩展', security: '安全', other: '其它'
};
const CH_LABEL = {
  npm: 'npm', pypi: 'PyPI', github: 'GitHub', marketplace: '商店', release: 'Release',
  'release-tarball': 'Release 包', script: '安装脚本', container: '容器', 'local-dir': '本地目录'
};

/* ---------------- 校验 ---------------- */
function validate(p, i) {
  const at = `[${i + 1}] ${p.name || p.id || '?'}`;
  for (const f of SCHEMA.required) check(p[f] !== undefined, at, `缺少必填字段 ${f}`);
  check(p.schemaVersion === '2.0', at, `schemaVersion 必须是 2.0`);
  check(/^[a-z0-9-]+:[A-Za-z0-9_.@/-]+$/.test(p.id || ''), at, `id 必须形如 <ecosystem>:<localId>，当前 ${p.id}`);
  check((p.id || '').startsWith(`${p.ecosystem}:`), at, `id 前缀与 ecosystem 不一致`);
  check(ECOSYSTEMS.includes(p.ecosystem), at, `未知生态 ${p.ecosystem}（先在 schema 与 docs/CATEGORY.md 登记）`);
  check(/^https:\/\/(github|gitlab)\.com\//.test(p.repo || ''), at, 'repo 必须是 GitHub/GitLab 链接');
  check(Array.isArray(p.category) && p.category.length > 0, at, 'category 不能为空');
  for (const c of p.category || []) check(CATEGORIES.includes(c), at, `未知分类 ${c}（见 docs/CATEGORY.md）`);
  check(typeof p.summary === 'string' && p.summary.length <= 120, at, 'summary 必须是 <=120 字字符串');
  check(p.host && typeof p.host.name === 'string', at, 'host.name 必填');
  check(CHANNELS.includes(p.install?.preferred), at, `install.preferred 非法: ${p.install?.preferred}`);
  check(typeof p.install?.spec === 'string' && p.install.spec.trim().length > 0, at, 'install.spec 不能为空');
  for (const ch of p.channels || []) {
    check(CHANNELS.includes(ch.name), at, `channels 里未知渠道 ${ch.name}`);
    check(['official', 'forbidden', 'third-party', 'absent', 'unknown'].includes(ch.trust), at, `渠道 ${ch.name} 的 trust 非法`);
  }
  check(typeof p.stats?.stars === 'number' && typeof p.stats?.forks === 'number', at, 'stats.stars/forks 必须是数字');
  check(!Number.isNaN(Date.parse(p.stats?.pushedAt)), at, 'stats.pushedAt 非法');
  check(/^\d{4}-\d{2}-\d{2}$/.test(p.curatedAt || ''), at, 'curatedAt 必须是 YYYY-MM-DD');
  for (const row of p.compat || []) check(row.host && row.plugin, at, 'compat 行缺少 host 或 plugin');

  // 语义守则
  if (/\b(dsh\s+plugin|npm\s+(i|install)|pip\s+install)\b/.test(p.install?.spec || '')) {
    errors.push(`${at}: install.spec 必须是「被安装的目标」，不能含命令前缀（前缀放 install.command）`);
  }
  const forbiddenCh = (p.channels || []).filter(c => c.trust === 'forbidden').map(c => c.name);
  for (const f of p.install?.forbidden || []) {
    if (!forbiddenCh.includes(f)) warnings.push(`${at}: install.forbidden 含 ${f}，但 channels 里没有对应 trust=forbidden 的记录`);
  }
  for (const f of forbiddenCh) {
    if (!(p.install?.forbidden || []).includes(f)) warnings.push(`${at}: channels 标记 ${f} 为 forbidden，但 install.forbidden 未列`);
  }
  if (p.install?.preferred && forbiddenCh.includes(p.install.preferred)) errors.push(`${at}: preferred 渠道 ${p.install.preferred} 被标为 forbidden`);
  if (!p.host?.manifestPath) warnings.push(`${at}: 未找到清单文件，收录依据需人工复核`);
  return at;
}

/* ---------------- 读取 ---------------- */
if (!existsSync(PLUGIN_DIR)) { console.error(`缺少目录 ${PLUGIN_DIR}`); process.exit(1); }
const files = readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.json')).sort();
const plugins = files.map(f => {
  const p = JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8'));
  p.__file = f;
  return p;
});

const seen = new Map();
plugins.forEach((p, i) => {
  validate(p, i);
  if (seen.has(p.id)) errors.push(`id 重复: ${p.id}（${seen.get(p.id)} 与 ${p.__file}）`);
  seen.set(p.id, p.__file);
});

if (errors.length) {
  console.error('✗ 校验失败：\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
if (warnings.length) console.warn('⚠ 提示：\n' + warnings.map(w => '  - ' + w).join('\n'));

/* ---------------- 索引 ---------------- */
plugins.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.stats.stars - a.stats.stars || a.name.localeCompare(b.name));

const byEcosystem = {};
for (const p of plugins) byEcosystem[p.ecosystem] = (byEcosystem[p.ecosystem] || 0) + 1;
const byCategory = {};
for (const p of plugins) for (const c of p.category) byCategory[c] = (byCategory[c] || 0) + 1;

const index = {
  schemaVersion: '2.0',
  generatedAt: new Date().toISOString(),
  count: plugins.length,
  ecosystems: ECOSYSTEMS.map(id => ({ id, count: byEcosystem[id] || 0 })).filter(e => e.count > 0),
  categories: CATEGORIES.map(id => ({ id, count: byCategory[id] || 0 })).filter(c => c.count > 0),
  fieldSemantics: {
    id: '<ecosystem>:<localId>，跨生态唯一；前缀与 ecosystem 必须一致',
    'install.spec': '唯一语义 = 被安装的目标（包名/仓库/文件/目录），不含命令前缀，便于 AI 与工具直接拼接',
    'install.command': '完整可执行命令，给人复制',
    'channels[].trust': '渠道归属判定：official / forbidden / third-party / absent / unknown，不是质量评分',
    compat: '宿主版本 → 插件版本 pin 矩阵；plugin = "none" 表示该宿主版本无可用版本',
    ecosystemMeta: '生态特有字段的存放位，不污染通用字段'
  },
  plugins: plugins.map(({ __file, ...rest }) => rest)
};

writeFileSync(join(ROOT, 'data', 'index.json'), JSON.stringify(index, null, 2) + '\n');
mkdirSync(join(ROOT, 'site', 'api'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'api', 'plugins.json'), JSON.stringify(index, null, 2) + '\n');
writeFileSync(join(ROOT, 'site', 'index.html'), renderSite(index));

const ecoLine = Object.entries(byEcosystem).map(([k, v]) => `${k} ${v}`).join(' · ');
console.log(`✓ 收录 ${index.count} 个插件（${ecoLine}）`);
console.log('  data/index.json       索引');
console.log('  site/api/plugins.json 静态 API');
console.log('  site/index.html       可检索页面');

/* ---------------- 页面 ---------------- */
function renderSite(idx) {
  const ecoCount = idx.ecosystems.reduce((a, e) => a + e.count, 0);

  const ecoTabs = [
    `<button class="eco-tab" data-eco="" aria-pressed="true">全部<em>${ecoCount}</em></button>`,
    ...idx.ecosystems.map(e => `<button class="eco-tab" data-eco="${esc(e.id)}" aria-pressed="false">${esc(ECO_LABEL[e.id] || e.id)}<em>${e.count}</em></button>`)
  ].join('');

  const catChips = [
    `<button class="chip" data-cat="" aria-pressed="true">全部功能</button>`,
    ...idx.categories.map(c => `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="false">${esc(CAT_LABEL[c.id] || c.id)}<i>${c.count}</i></button>`)
  ].join('');

  const cards = idx.plugins.map((p, i) => {
    const no = String(i + 1).padStart(2, '0');
    const trustBadges = (p.channels || [])
      .filter(c => c.trust === 'forbidden' || c.trust === 'third-party')
      .map(c => `<span class="badge danger">${esc(CH_LABEL[c.name] || c.name)} 渠道${c.trust === 'forbidden' ? '禁用' : '非官方'}</span>`)
      .join('');
    const officialBadge = (p.channels || []).some(c => c.name === p.install.preferred && c.trust === 'official')
      ? `<span class="badge okay">${esc(CH_LABEL[p.install.preferred] || p.install.preferred)} 官方</span>` : '';

    const compatRows = (p.compat || []).map(r => `<tr>
        <td class="mono">${esc(r.host)}</td>
        <td><code${r.plugin === 'none' ? ' class="none"' : ''}>${esc(r.plugin)}</code></td>
        <td>${r.command ? `<code class="cmd" data-copy="${esc(r.command)}" title="点击复制">${esc(r.command)}</code>` : '<span class="dim">—</span>'}</td>
      </tr>`).join('');

    return `
  <article class="card" data-eco="${esc(p.ecosystem)}"
    data-cat="${esc(p.category.join(' '))}"
    data-search="${esc([p.name, p.displayName, p.summary, p.summaryEn, p.author, (p.tags || []).join(' '), p.category.join(' '), ECO_LABEL[p.ecosystem] || ''].join(' ').toLowerCase())}">
    <div class="card-no mono">${no}</div>
    <header class="card-head">
      <div class="head-main">
        <span class="eco-mark">${esc(p.ecosystem)}</span>
        <h2><a href="${esc(p.repo)}" target="_blank" rel="noopener">${esc(p.displayName || p.name)}</a></h2>
        <p class="slug mono">${esc(p.name)} · ${esc(p.author || '—')}${p.version ? ' · v' + esc(p.version) : ''}</p>
      </div>
      <div class="score">
        <b>${num(p.stats.stars)}</b>
        <span>stars</span>
      </div>
    </header>

    <div class="meta">
      ${p.category.map(c => `<span class="badge">${esc(CAT_LABEL[c] || c)}</span>`).join('')}
      <span class="badge ghost">${esc(p.language || '—')}</span>
      <span class="badge ghost">${esc(p.license || 'no license')}</span>
      ${officialBadge}${trustBadges}
    </div>

    <p class="summary">${esc(p.summary)}</p>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    <div class="tags">${(p.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}</div>

    <div class="install">
      <span class="label">推荐安装 · ${esc(CH_LABEL[p.install.preferred] || p.install.preferred)}</span>
      <code class="cmd big" data-copy="${esc(p.install.command || p.install.spec)}" title="点击复制">${esc(p.install.command || p.install.spec)}</code>
      <span class="hostline mono">→ ${esc(p.host.name)}${p.host.manifestPath ? ' · ' + esc(p.host.manifestPath) : ''}</span>
    </div>
    ${p.install.notes ? `<p class="note">${esc(p.install.notes)}</p>` : ''}

    ${compatRows ? `<details><summary>兼容矩阵 <i>${(p.compat || []).length}</i> 条 · 旧宿主按此 pin 版本</summary>
      <table class="compat"><thead><tr><th>宿主版本</th><th>插件版本</th><th>命令</th></tr></thead><tbody>${compatRows}</tbody></table>
    </details>` : ''}

    <footer class="card-foot">
      <span class="mono">更新 ${esc((p.stats.pushedAt || '').slice(0, 10))} · ${num(p.stats.forks)} forks${p.stats.openIssues !== undefined ? ' · ' + num(p.stats.openIssues) + ' issues' : ''}</span>
      <a href="${esc(p.repo)}" target="_blank" rel="noopener">仓库 ↗</a>
    </footer>
  </article>`;
  }).join('');

  const dataJson = JSON.stringify(idx).replace(/</g, '\\u003c');
  const stamp = idx.generatedAt.slice(0, 16).replace('T', ' ');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>插件索引 · ${idx.count} 个插件 / ${idx.ecosystems.length} 个生态</title>
<meta name="description" content="跨生态插件索引：可信安装源、宿主版本兼容矩阵、中文说明。数据取自插件自身的 manifest、README 与平台 API。">
<style>
:root{
  --paper:#f6f3ec; --paper-2:#efe9dd; --card:#fffdf8;
  --ink:#1c1814; --ink-2:#5b544c; --ink-3:#8b8377;
  --red:#d64524; --line:#d9d3c7; --line-2:#c9c2b4;
  --ok:#2f6b3a;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  line-height:1.65;font-size:15px;}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-variant-ligatures:none}
a{color:inherit;text-decoration:none}
.wrap{max-width:1240px;margin:0 auto;padding:0 22px}

/* masthead */
.masthead{border-bottom:2px solid var(--ink);padding:26px 0 0}
.mast-top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:22px;flex-wrap:wrap}
.brand{max-width:60ch}
.kicker{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:var(--red);font-weight:700}
h1{margin:12px 0 10px;font-size:clamp(34px,6vw,72px);line-height:.96;letter-spacing:-.028em;font-weight:800}
h1 em{font-style:normal;color:var(--red)}
.lede{margin:0;color:var(--ink-2);font-size:14.5px;max-width:52ch}
.tally{display:flex;gap:0;border:2px solid var(--ink);background:var(--card)}
.tally div{padding:12px 18px;border-right:1px solid var(--line)}
.tally div:last-child{border-right:0}
.tally b{display:block;font-size:24px;line-height:1;letter-spacing:-.02em}
.tally span{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2)}

/* eco tabs */
.ecos{display:flex;overflow-x:auto;border-top:1px solid var(--line);scrollbar-width:thin}
.eco-tab{flex:0 0 auto;border:0;border-right:1px solid var(--line);background:transparent;color:var(--ink);
  padding:13px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap}
.eco-tab em{font-style:normal;font-size:11px;color:var(--ink-3);font-family:ui-monospace,monospace}
.eco-tab:hover{background:var(--paper-2)}
.eco-tab[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.eco-tab[aria-pressed=true] em{color:#b9b0a1}

/* toolbar */
.toolbar{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line);padding:14px 0}
.toolbar .wrap{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search{flex:1 1 280px;min-width:0;position:relative}
.search input{width:100%;padding:11px 14px 11px 34px;border:2px solid var(--ink);background:var(--card);
  font-size:14px;border-radius:0;outline:none;color:var(--ink);font-family:inherit}
.search input:focus{border-color:var(--red)}
.search::before{content:"⌕";position:absolute;left:11px;top:50%;transform:translateY(-52%);font-size:17px;color:var(--ink-3)}
.chip{border:1px solid var(--line-2);background:transparent;padding:7px 11px;font-size:12.5px;cursor:pointer;
  border-radius:0;color:var(--ink-2);display:inline-flex;align-items:center;gap:6px;font-family:inherit}
.chip i{font-style:normal;font-size:10.5px;color:var(--ink-3);font-family:ui-monospace,monospace}
.chip:hover{border-color:var(--ink);color:var(--ink)}
.chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.chip[aria-pressed=true] i{color:#b9b0a1}
.result{margin-left:auto;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);font-family:ui-monospace,monospace}

/* grid */
main{padding:0 0 10px}
.grid{display:grid;grid-template-columns:1fr;border-left:1px solid var(--line)}
.card{position:relative;background:var(--card);border-right:1px solid var(--line);border-bottom:1px solid var(--line);
  border-top:2px solid var(--ink);padding:22px 20px 18px;display:flex;flex-direction:column;gap:13px;min-width:0}
.card-no{position:absolute;top:8px;right:12px;font-size:10.5px;color:var(--ink-3);letter-spacing:.14em}
.card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
.eco-mark{display:inline-block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--red);
  font-family:ui-monospace,monospace;border-bottom:1px solid var(--red);padding-bottom:2px;margin-bottom:8px}
h2{margin:0;font-size:22px;line-height:1.15;letter-spacing:-.015em;font-weight:750}
h2 a:hover{color:var(--red)}
.slug{margin:5px 0 0;font-size:11.5px;color:var(--ink-2);word-break:break-all}
.score{text-align:right;flex:0 0 auto;padding-right:26px}
.score b{display:block;font-size:19px;line-height:1;letter-spacing:-.02em}
.score span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.meta{display:flex;flex-wrap:wrap;gap:5px}
.badge{font-size:11px;padding:2px 7px;border:1px solid var(--ink);line-height:1.5}
.badge.ghost{border-color:var(--line-2);color:var(--ink-2)}
.badge.danger{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}
.badge.okay{border-color:var(--ok);color:var(--ok)}
.summary{margin:0;font-size:14.5px}
.desc{margin:0;font-size:13px;color:var(--ink-2);border-top:1px dashed var(--line);padding-top:10px}
.tags{display:flex;flex-wrap:wrap;gap:7px;font-size:11px;color:var(--ink-3);font-family:ui-monospace,monospace}
.install{background:var(--paper-2);border-left:3px solid var(--red);padding:11px 12px;display:flex;flex-direction:column;gap:5px}
.install .label{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--red);font-weight:700}
code.cmd{font-size:12px;word-break:break-all;cursor:copy;display:block;color:var(--ink)}
code.cmd:hover{color:var(--red)}
code.cmd.big{font-size:12.5px;font-weight:600}
code.none{color:var(--red);font-weight:600}
.hostline{font-size:10.5px;color:var(--ink-3);word-break:break-all}
.note{margin:0;font-size:12.5px;color:var(--ink-2)}
details{border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-size:12.5px;font-weight:650;color:var(--red);list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"＋ ";font-weight:700}
details[open] summary::before{content:"－ "}
summary i{font-style:normal;color:var(--ink-3);font-family:ui-monospace,monospace;font-size:11px}
table.compat{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
table.compat th,table.compat td{border-bottom:1px solid var(--line);padding:7px 8px 7px 0;text-align:left;vertical-align:top}
table.compat th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
table.compat td:first-child{width:30%;color:var(--ink-2)}
.dim{color:var(--ink-3)}
.card-foot{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ink-3);
  border-top:1px solid var(--line);padding-top:10px;margin-top:auto;flex-wrap:wrap}
.card-foot a{color:var(--red);font-weight:600}

/* empty */
.empty{display:none;padding:70px 0;text-align:center;color:var(--ink-2);border-bottom:1px solid var(--line)}
.empty.on{display:block}
.empty b{display:block;font-size:20px;color:var(--ink);margin-bottom:6px}

/* notes block */
.notes{border-top:2px solid var(--ink);margin-top:0;padding:26px 0 8px}
.notes-grid{display:grid;grid-template-columns:1fr;gap:22px}
.notes h3{margin:0 0 8px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--red)}
.notes p,.notes li{font-size:13px;color:var(--ink-2);margin:0 0 6px}
.notes ol{margin:0;padding-left:18px}
.notes code{background:var(--paper-2);padding:1px 5px;font-size:12px}
footer.page{border-top:1px solid var(--line);padding:20px 0 44px;font-size:11.5px;color:var(--ink-3);font-family:ui-monospace,monospace}

@media(min-width:720px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .notes-grid{grid-template-columns:repeat(3,1fr)}
}
@media(min-width:1120px){
  .grid{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:520px){
  .tally{width:100%}.tally div{flex:1;padding:10px 12px}
  .score{padding-right:14px}
}
</style>
</head>
<body>

<header class="masthead">
  <div class="wrap mast-top">
    <div class="brand">
      <div class="kicker">Plugin Index · Cross-Ecosystem</div>
      <h1>插件索引<em>.</em></h1>
      <p class="lede">跨生态收录。只写事实：可信安装源、宿主版本兼容矩阵、中文说明；字段取自插件自身 manifest、README 与平台 API，不做主观评分。</p>
    </div>
    <div class="tally">
      <div><b>${idx.count}</b><span>插件</span></div>
      <div><b>${idx.ecosystems.length}</b><span>生态</span></div>
      <div><b>${idx.categories.length}</b><span>分类</span></div>
    </div>
  </div>
  <div class="wrap" style="padding:0">
    <nav class="ecos" id="ecos">${ecoTabs}</nav>
  </div>
</header>

<div class="toolbar">
  <div class="wrap">
    <label class="search"><input type="search" id="q" placeholder="搜插件名、功能、作者、标签…" aria-label="搜索插件"></label>
    ${catChips}
    <span class="result" id="result">${idx.count} / ${idx.count}</span>
  </div>
</div>

<main class="wrap">
  <div class="grid" id="grid">${cards}</div>
  <div class="empty" id="empty"><b>没有匹配的插件</b>换个关键词，或切回「全部」生态。</div>
</main>

<section class="notes">
  <div class="wrap notes-grid">
    <div>
      <h3>01 / 分类怎么读</h3>
      <p><b>生态</b>决定事实来源（清单规范、安装命令、市场）；<b>功能分类</b>跨生态通用，用来检索。</p>
      <p>所以同一个插件会有两层标签：<code>dsh</code> × <code>sidebar</code>。</p>
    </div>
    <div>
      <h3>02 / 安装前看三个字段</h3>
      <p><code>install.spec</code> 是被安装的目标，<code>install.command</code> 才可直接复制。</p>
      <p>红色徽章表示该渠道<b>非作者发布</b>；旧宿主按兼容矩阵 pin 精确版本，不要用 <code>latest</code>。</p>
    </div>
    <div>
      <h3>03 / 收录一个插件</h3>
      <ol>
        <li>复制 <code>data/plugins/</code> 任一文件</li>
        <li>从 manifest、README、API 三处取事实填写</li>
        <li><code>node scripts/build.mjs</code> 校验并重建</li>
      </ol>
    </div>
  </div>
</section>

<footer class="page"><div class="wrap">
  data/index.json · 生成于 ${esc(stamp)} UTC · 分类法见 docs/CATEGORY.md · 新增生态只改一个 enum
</div></footer>

<script type="application/json" id="index-data">${dataJson}</script>
<script>
(function(){
  var q = document.getElementById('q');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var resultEl = document.getElementById('result');
  var emptyEl = document.getElementById('empty');
  var ecoTabs = Array.prototype.slice.call(document.querySelectorAll('.eco-tab'));
  var catChips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var total = cards.length, eco = '', cat = '';

  function apply(){
    var kw = q.value.trim().toLowerCase();
    var n = 0;
    cards.forEach(function(c){
      var okKw = !kw || c.dataset.search.indexOf(kw) !== -1;
      var okEco = !eco || c.dataset.eco === eco;
      var okCat = !cat || (' ' + c.dataset.cat + ' ').indexOf(' ' + cat + ' ') !== -1;
      var show = okKw && okEco && okCat;
      c.hidden = !show;
      if (show) n++;
    });
    resultEl.textContent = n + ' / ' + total;
    emptyEl.classList.toggle('on', n === 0);
  }

  q.addEventListener('input', apply);

  ecoTabs.forEach(function(b){
    b.addEventListener('click', function(){
      eco = b.dataset.eco;
      ecoTabs.forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      apply();
    });
  });

  catChips.forEach(function(b){
    b.addEventListener('click', function(){
      cat = b.dataset.cat;
      catChips.forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      apply();
    });
  });

  document.querySelectorAll('code.cmd').forEach(function(el){
    el.addEventListener('click', function(){
      var t = el.dataset.copy || el.textContent;
      var done = function(){
        var old = el.textContent;
        el.textContent = '✓ 已复制到剪贴板';
        setTimeout(function(){ el.textContent = old; }, 1100);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(function(){});
      } else {
        var ta = document.createElement('textarea');
        ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch(e){}
        document.body.removeChild(ta);
      }
    });
  });
})();
</script>
</body>
</html>`;
}
