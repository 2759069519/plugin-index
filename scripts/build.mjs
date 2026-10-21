#!/usr/bin/env node
// dsh-plugin-index 构建脚本：校验 data/plugins/*.json → 生成 data/index.json + site/
// 零依赖，Node >= 18。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(ROOT, 'data', 'plugins');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'schema', 'plugin.schema.json'), 'utf8'));

const CATEGORIES = SCHEMA.properties.category.items.enum;
const INSTALL_KINDS = SCHEMA.properties.install.properties.preferred.enum;
const TRUST_NPM = SCHEMA.properties.trust.properties.npm.enum;

const errors = [];
const warnings = [];

/* ---------- 轻量校验 ---------- */
function check(cond, path, msg) {
  if (!cond) errors.push(`${path}: ${msg}`);
}

function validate(p, i) {
  const at = `plugins[${i}] ${p.name || p.repo || '?'}`;
  for (const f of SCHEMA.required) check(p[f] !== undefined, at, `缺少必填字段 ${f}`);
  check(/^([a-z0-9-]+(\.[a-z0-9-]+)+|dsh-external\/[a-z0-9-]+|github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.test(p.id || ''), at, `id 不合规: ${p.id}`);
  check(/^https:\/\/github\.com\//.test(p.repo || ''), at, 'repo 必须是 GitHub 链接');
  check(Array.isArray(p.category) && p.category.length > 0, at, 'category 不能为空');
  for (const c of p.category || []) check(CATEGORIES.includes(c), at, `未知分类 ${c}`);
  check(typeof p.summary === 'string' && p.summary.length <= 120, at, 'summary 必须是 <=120 字的字符串');
  check(INSTALL_KINDS.includes(p.install?.preferred), at, `install.preferred 非法: ${p.install?.preferred}`);
  check(typeof p.install?.spec === 'string' && p.install.spec.length > 0, at, 'install.spec 不能为空');
  if (p.trust?.npm) check(TRUST_NPM.includes(p.trust.npm), at, `trust.npm 非法: ${p.trust.npm}`);
  check(typeof p.stats?.stars === 'number' && typeof p.stats?.forks === 'number', at, 'stats.stars/forks 必须是数字');
  check(!Number.isNaN(Date.parse(p.stats?.pushedAt)), at, 'stats.pushedAt 必须是合法时间');
  check(/^\d{4}-\d{2}-\d{2}$/.test(p.curatedAt || ''), at, 'curatedAt 必须是 YYYY-MM-DD');
  for (const row of p.compat || []) check(row.dsh && row.plugin, at, 'compat 行缺少 dsh 或 plugin');

  // 语义一致性：install.spec 不得含命令前缀（dsh plugin add 语义）
  if (/\bdsh\s+plugin\b/.test(p.install?.spec || '')) errors.push(`${at}: install.spec 不应包含 "dsh plugin" 前缀，只写被 add 的目标`);
  if (/\bdsh\s+plugin\b/.test(p.install?.command || '') === false) warnings.push(`${at}: install.command 未含 "dsh plugin" —— 确认是否为非标准安装方式`);
  if (p.trust?.npm === 'forbidden' && !(p.install.forbidden || []).includes('npm')) warnings.push(`${at}: trust.npm=forbidden 但 install.forbidden 未列 npm`);
  if (!p.manifest) warnings.push(`${at}: 未发现 manifest，可能不是真插件`);
}

/* ---------- 读取 ---------- */
if (!existsSync(PLUGIN_DIR)) { console.error(`缺少目录 ${PLUGIN_DIR}`); process.exit(1); }
const files = readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.json')).sort();
const plugins = files.map(f => {
  const p = JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8'));
  p.__file = f;
  return p;
});

const seenId = new Map();
plugins.forEach((p, i) => {
  validate(p, i);
  if (seenId.has(p.id)) errors.push(`id 重复: ${p.id} (${seenId.get(p.id)} 与 ${p.__file})`);
  seenId.set(p.id, p.__file);
});

if (errors.length) {
  console.error('✗ 校验失败:\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
if (warnings.length) console.warn('⚠ 提示:\n' + warnings.map(w => '  - ' + w).join('\n'));

/* ---------- 索引 ---------- */
const sortKey = p => [p.featured ? 0 : 1, -p.stats.stars];
plugins.sort((a, b) => {
  const [af, as] = sortKey(a), [bf, bs] = sortKey(b);
  return af - bf || as - bs || a.name.localeCompare(b.name);
});

const index = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  count: plugins.length,
  categories: CATEGORIES,
  usage: {
    install: '安装规格（install.spec）语义为「被 add 的目标」，不含 dsh plugin add 前缀；完整命令见 install.command。',
    trust: 'trust.npm=forbidden 表示作者明确禁止 npm 渠道（存在第三方篡改包），务必按 install 字段安装。',
    compat: 'compat 为 README 声明的宿主版本 → 插件版本 pin 矩阵，旧宿主请按矩阵装精确版本。',
    source: '所有字段取自插件仓库 manifest / README / GitHub API，不含主观评分。'
  },
  plugins: plugins.map(p => { const { __file, ...rest } = p; return rest; })
};

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'index.json'), JSON.stringify(index, null, 2) + '\n');
mkdirSync(join(ROOT, 'site', 'api'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'api', 'plugins.json'), JSON.stringify(index, null, 2) + '\n');

/* ---------- 静态站 ---------- */
const dataJson = JSON.stringify(index).replace(/</g, '\\u003c');
const html = renderSite(index, dataJson);
mkdirSync(join(ROOT, 'site'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'index.html'), html);

console.log(`✓ 已收录 ${index.count} 个插件`);
console.log('  data/index.json      (索引)');
console.log('  site/api/plugins.json (静态 API)');
console.log('  site/index.html      (可检索页面)');

/* ---------- 模板 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderSite(idx, data) {
  const catZh = {
    'model-provider': '模型接入', sidebar: '侧边栏', ui: '界面', terminal: '终端',
    workflow: '工作流', tool: '工具', 'developer-tools': '开发工具', media: '媒体',
    data: '数据', theme: '主题', integration: '集成扩展', desktop: '桌面端', other: '其它'
  };
  const cards = idx.plugins.map(p => {
    const trustBadge = p.trust?.npm === 'forbidden'
      ? '<span class="badge warn">npm 渠道禁用</span>'
      : p.trust?.npm === 'official' ? '<span class="badge ok">npm 官方发布</span>' : '';
    const compatRows = (p.compat || []).map(r =>
      `<tr><td>${esc(r.dsh)}</td><td><code>${esc(r.plugin)}</code></td><td>${r.command ? `<code class="cmd" data-copy="${esc(r.command)}">${esc(r.command)}</code>` : '—'}</td></tr>`
    ).join('');
    return `
    <article class="card" data-name="${esc((p.name + ' ' + (p.displayName || '') + ' ' + p.summary + ' ' + (p.tags || []).join(' ')).toLowerCase())}" data-cat="${esc(p.category.join(' '))}">
      <header class="card-head">
        <div>
          <h2><a href="${esc(p.repo)}" target="_blank" rel="noopener">${esc(p.displayName || p.name)}</a></h2>
          <p class="slug">${esc(p.name)} · ${esc(p.author || '')}</p>
        </div>
        <div class="stars"><b>${p.stats.stars.toLocaleString('en-US')}</b><span>★</span></div>
      </header>
      <div class="meta">
        <span class="badge">${esc((p.category[0] && catZh[p.category[0]]) || p.category[0])}</span>
        <span class="badge ghost">${esc(p.language || '—')}</span>
        <span class="badge ghost">${esc(p.license || '无 License')}</span>
        <span class="badge ghost">v${esc(p.version || '?')}</span>
        ${trustBadge}
      </div>
      <p class="summary">${esc(p.summary)}</p>
      <div class="tags">${(p.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}</div>
      <div class="install">
        <span class="label">推荐安装 · ${esc(p.install.preferred)}</span>
        <code class="cmd" data-copy="${esc(p.install.command || p.install.spec)}">${esc(p.install.command || p.install.spec)}</code>
      </div>
      ${p.install.notes ? `<p class="note">${esc(p.install.notes)}</p>` : ''}
      ${compatRows ? `<details><summary>兼容矩阵（${(p.compat || []).length} 条）</summary>
        <table class="compat"><thead><tr><th>你的 dsh</th><th>插件版本</th><th>命令</th></tr></thead><tbody>${compatRows}</tbody></table>
      </details>` : ''}
      <footer class="card-foot">
        <span>更新于 ${esc((p.stats.pushedAt || '').slice(0, 10))}</span>
        <a href="${esc(p.repo)}" target="_blank" rel="noopener">仓库 ↗</a>
      </footer>
    </article>`;
  }).join('');

  const cats = idx.categories
    .filter(c => idx.plugins.some(p => p.category.includes(c)))
    .map(c => `<button class="chip" data-filter="${esc(c)}">${esc(catZh[c] || c)}</button>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 插件索引 · ${idx.count} 个已收录</title>
<meta name="description" content="DeepSeek Harness (dsh) 插件索引：可信安装源、版本兼容矩阵与中文检索。">
<style>
:root{--paper:#f6f3ec;--ink:#1c1814;--ink-soft:#5b544c;--red:#d64524;--line:#d9d3c7;--card:#fffdf8}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;line-height:1.6}
.mono,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
a{color:inherit}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}
header.hero{border-bottom:2px solid var(--ink);padding:34px 0 22px}
.kicker{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--red);font-weight:700}
h1{font-size:clamp(30px,5.2vw,58px);line-height:1.02;margin:10px 0 8px;letter-spacing:-.02em;font-weight:800}
h1 em{font-style:normal;color:var(--red)}
.lede{max-width:56ch;color:var(--ink-soft);font-size:15px;margin:0}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--paper);z-index:5}
input[type=search]{flex:1 1 260px;min-width:0;padding:11px 13px;border:2px solid var(--ink);background:var(--card);font-size:14px;border-radius:0;outline:none}
input[type=search]:focus{border-color:var(--red)}
.chip,.chip-all{border:1px solid var(--ink);background:transparent;padding:7px 12px;font-size:13px;cursor:pointer;border-radius:0}
.chip[aria-pressed=true],.chip-all[aria-pressed=true]{background:var(--ink);color:var(--paper)}
.count{margin-left:auto;font-size:12px;color:var(--ink-soft)}
main{padding:26px 0 60px}
.grid{display:grid;grid-template-columns:1fr;gap:0}
.card{background:var(--card);border:1px solid var(--line);border-top:2px solid var(--ink);padding:20px;display:flex;flex-direction:column;gap:12px}
.card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
h2{font-size:21px;margin:0;letter-spacing:-.01em}
h2 a{text-decoration:none}
h2 a:hover{color:var(--red)}
.slug{margin:2px 0 0;font-size:12px;color:var(--ink-soft);font-family:ui-monospace,monospace}
.stars{text-align:right;line-height:1.1}
.stars b{font-size:18px;display:block}
.stars span{font-size:11px;color:var(--red)}
.meta{display:flex;flex-wrap:wrap;gap:6px}
.badge{font-size:11px;padding:2px 7px;border:1px solid var(--ink);letter-spacing:.02em}
.badge.ghost{border-color:var(--line);color:var(--ink-soft)}
.badge.warn{background:var(--red);border-color:var(--red);color:#fff}
.badge.ok{border-color:#2f6b3a;color:#2f6b3a}
.summary{margin:0;font-size:14.5px}
.tags{display:flex;flex-wrap:wrap;gap:8px;font-size:11.5px;color:var(--ink-soft);font-family:ui-monospace,monospace}
.install{background:#efe9dd;border-left:3px solid var(--red);padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.install .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--red);font-weight:700}
code.cmd{font-size:12.5px;word-break:break-all;cursor:copy;display:block}
code.cmd:hover{color:var(--red)}
.note{margin:0;font-size:12.5px;color:var(--ink-soft);border-top:1px dashed var(--line);padding-top:8px}
details summary{cursor:pointer;font-size:13px;color:var(--red);font-weight:600}
table.compat{width:100%;border-collapse:collapse;margin-top:10px;font-size:12.5px}
table.compat th,table.compat td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
table.compat th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)}
.card-foot{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);border-top:1px solid var(--line);padding-top:10px;margin-top:auto}
.card-foot a{color:var(--red);text-decoration:none}
.empty{padding:60px 0;text-align:center;color:var(--ink-soft)}
footer.page{border-top:2px solid var(--ink);padding:22px 0 50px;font-size:12.5px;color:var(--ink-soft)}
footer.page code{background:#efe9dd;padding:1px 5px}
@media(min-width:760px){.grid{grid-template-columns:repeat(2,1fr)}.card{margin:-1px 0 0 -1px}}
@media(min-width:1100px){.grid{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <div class="kicker">DeepSeek Harness · Plugin Index</div>
  <h1>dsh 插件索引<em>.</em></h1>
  <p class="lede">只记录事实：可信安装源、宿主版本兼容矩阵、中文说明。字段取自插件仓库的 manifest、README 与 GitHub API，不做主观评分。</p>
</div></header>

<div class="wrap toolbar">
  <input type="search" id="q" placeholder="搜索插件名 / 功能 / 标签…" aria-label="搜索">
  <button class="chip-all" data-filter="" aria-pressed="true">全部</button>
  ${cats}
  <span class="count" id="count">${idx.count} 个插件</span>
</div>

<main class="wrap">
  <div class="grid" id="grid">${cards}</div>
  <p class="empty" id="empty" hidden>没有匹配的插件。</p>
</main>

<footer class="page"><div class="wrap">
  数据源 <code>data/index.json</code> · 生成于 ${esc(idx.generatedAt.slice(0, 16).replace('T', ' '))} UTC · 收录新插件：往 <code>data/plugins/</code> 加一个 JSON 后跑 <code>node scripts/build.mjs</code>
</div></footer>

<script type="application/json" id="index-data">${data}</script>
<script>
(function(){
  var q = document.getElementById('q');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  var activeCat = '';

  function apply(){
    var kw = q.value.trim().toLowerCase();
    var n = 0;
    cards.forEach(function(c){
      var okKw = !kw || c.dataset.name.indexOf(kw) !== -1;
      var okCat = !activeCat || (' ' + c.dataset.cat + ' ').indexOf(' ' + activeCat + ' ') !== -1;
      var show = okKw && okCat;
      c.hidden = !show;
      if (show) n++;
    });
    countEl.textContent = n + ' / ' + cards.length + ' 个插件';
    emptyEl.hidden = n !== 0;
  }
  q.addEventListener('input', apply);
  chips.forEach(function(b){
    b.addEventListener('click', function(){
      activeCat = b.dataset.filter;
      chips.forEach(function(x){ x.setAttribute('aria-pressed', String(x === b)); });
      apply();
    });
  });
  document.querySelectorAll('code.cmd').forEach(function(el){
    el.title = '点击复制';
    el.addEventListener('click', function(){
      var t = el.dataset.copy || el.textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function(){
        var old = el.textContent; el.textContent = '✓ 已复制'; setTimeout(function(){ el.textContent = old; }, 1200);
      }).catch(function(){});
    });
  });
})();
</script>
</body>
</html>`;
}
