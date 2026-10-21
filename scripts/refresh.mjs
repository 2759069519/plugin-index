#!/usr/bin/env node
// 刷新索引条目里的易变字段：stars / forks / openIssues / pushedAt / version / 清单声明。
// 用法：GITHUB_TOKEN=xxx node scripts/refresh.mjs [--write] [--only <name>]
// 零依赖，Node >= 18（依赖 global fetch）。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = join(ROOT, 'data', 'plugins');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const WRITE = process.argv.includes('--write');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量（读公开仓库也需要，用于提升限流额度）');
  process.exit(1);
}

// 每个生态的清单候选路径，按优先级排列。新增生态在此登记（并同步 docs/CATEGORY.md）。
const MANIFESTS = {
  dsh: ['catalog/dsh-plugin.json', 'dsh.plugin.json', 'package.json'],
  vscode: ['package.json'],
  'chrome-extension': ['manifest.json'],
  obsidian: ['manifest.json'],
  raycast: ['package.json'],
  n8n: ['package.json'],
  mcp: ['server.json', 'package.json'],
  figma: ['manifest.json'],
  'claude-code': ['.claude-plugin/plugin.json', 'plugin.json']
};

async function gh(path, raw = false) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'plugin-index'
    }
  });
  if (!res.ok) return { error: res.status };
  return { data: raw ? await res.text() : await res.json() };
}

function parseManifest(text, path, ecosystem) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  switch (path) {
    case 'catalog/dsh-plugin.json':
      return {
        format: 'dsh-plugin-0.15', id: j.id || null, version: j.version,
        engines: j.requires?.dsh ? { dsh: j.requires.dsh } : {},
        contributes: j.contributes || {}
      };
    case 'dsh.plugin.json':
      return {
        format: 'dsh.plugin.json', id: j.id || null, version: j.version,
        engines: j.engines || {}, contributes: j.contributes || {}
      };
    case 'package.json': {
      if (ecosystem === 'dsh') {
        const dsh = j.dsh || {};
        if (!dsh.bundle && !dsh.client) return null;
        return { format: 'package.json:dsh', id: null, version: j.version, engines: j.engines || {}, contributes: dsh };
      }
      if (ecosystem === 'vscode') {
        if (!j.engines?.vscode && !j.contributes) return null;
        return { format: 'vscode-package-json', id: j.publisher && j.name ? `${j.publisher}.${j.name}` : null, version: j.version, engines: { vscode: j.engines?.vscode || '' }, contributes: j.contributes || {} };
      }
      if (ecosystem === 'n8n') {
        if (!j.n8n) return null;
        return { format: 'n8n-nodes-package', id: j.name || null, version: j.version, engines: { n8n: j.engines?.n8n || '' }, contributes: j.n8n };
      }
      if (ecosystem === 'mcp') {
        if (!j.mcp) return null;
        return { format: 'mcp-package-json', id: j.name || null, version: j.version, engines: {}, contributes: j.mcp };
      }
      return null;
    }
    case 'manifest.json':
      if (ecosystem === 'chrome-extension') {
        return { format: 'chrome-mv3', id: j.name || null, version: j.version, engines: { manifest_version: String(j.manifest_version || '') }, contributes: { permissions: j.permissions || [] } };
      }
      if (ecosystem === 'obsidian') {
        return { format: 'obsidian-manifest', id: j.id || null, version: j.version, engines: { minAppVersion: j.minAppVersion || '' }, contributes: {} };
      }
      if (ecosystem === 'figma') {
        return { format: 'figma-manifest', id: j.id || null, version: j.api || null, engines: {}, contributes: { editorType: j.editorType || [] } };
      }
      return null;
    case 'server.json':
      return { format: 'mcp-server-json', id: j.name || null, version: j.version, engines: {}, contributes: j.packages ? { packages: j.packages.length } : {} };
    case 'plugin.json':
      return { format: 'claude-plugin', id: j.name || null, version: j.version, engines: {}, contributes: j.commands || {} };
    default:
      return null;
  }
}

const files = readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.json')).sort();
let changed = 0;

for (const f of files) {
  const p = JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8'));
  if (ONLY && p.name !== ONLY) continue;
  const slug = p.repo.replace(/^https:\/\/(github|gitlab)\.com\//, '').replace(/\.git$/, '');
  const repo = await gh(`/repos/${slug}`);
  if (repo.error) { console.warn(`! ${p.name}: repo 拉取失败 ${repo.error}`); continue; }
  const r = repo.data;

  const diffs = [];
  const next = JSON.parse(JSON.stringify(p));
  const setIf = (cur, apply, val, label) => {
    if (JSON.stringify(cur) !== JSON.stringify(val)) { diffs.push(`${label}: ${JSON.stringify(cur)} → ${JSON.stringify(val)}`); apply(val); }
  };

  setIf(p.stats.stars, v => (next.stats.stars = v), r.stargazers_count, 'stars');
  setIf(p.stats.forks, v => (next.stats.forks = v), r.forks_count, 'forks');
  setIf(p.stats.openIssues, v => (next.stats.openIssues = v), r.open_issues_count, 'openIssues');
  setIf(p.stats.pushedAt, v => (next.stats.pushedAt = v), r.pushed_at, 'pushedAt');
  setIf(p.license, v => (next.license = v), r.license?.spdx_id || null, 'license');
  setIf(p.language, v => (next.language = v), r.language, 'language');

  // 清单探测
  let found = null;
  for (const path of MANIFESTS[p.ecosystem] || []) {
    const res = await gh(`/repos/${slug}/contents/${path}`, true);
    if (res.error) continue;
    const m = parseManifest(res.data, path, p.ecosystem);
    if (m) { found = { path, ...m }; break; }
  }

  if (found) {
    setIf(p.version, v => (next.version = v), found.version, 'version');
    setIf(p.host.manifestPath, v => (next.host.manifestPath = found.path), found.path, 'host.manifestPath');
    setIf(p.host.manifestFormat, v => (next.host.manifestFormat = found.format), found.format, 'host.manifestFormat');
    const engines = Object.keys(found.engines || {}).length ? found.engines : (p.host.engines || {});
    setIf(p.host.engines, v => (next.host.engines = v), engines, 'host.engines');
  } else {
    console.warn(`! ${p.name}: 未探测到清单（${(MANIFESTS[p.ecosystem] || []).join(' / ')}）`);
  }

  if (diffs.length) {
    changed++;
    console.log(`\n${p.name}  [${p.ecosystem}]`);
    diffs.forEach(d => console.log('  · ' + d));
    if (WRITE) writeFileSync(join(PLUGIN_DIR, f), JSON.stringify(next, null, 2) + '\n');
  } else {
    console.log(`${p.name}: 无变化`);
  }
}

console.log(`\n${changed ? `${changed} 个条目有变化${WRITE ? '（已写入）' : '（加 --write 写入）'}` : '全部为最新'}`);
if (changed && WRITE) console.log('接着跑 node scripts/build.mjs 重建索引与站点。');
