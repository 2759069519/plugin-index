#!/usr/bin/env node
// 刷新索引条目里的易变字段：stars / forks / pushedAt / version / manifest 声明。
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
  console.error('缺少 GITHUB_TOKEN 环境变量（只读公开仓库也需要，用于提升限流额度）');
  process.exit(1);
}

const MANIFEST_CANDIDATES = ['catalog/dsh-plugin.json', 'dsh.plugin.json', 'package.json'];

async function gh(path, raw = false) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-plugin-index'
    }
  });
  if (!res.ok) return { error: res.status };
  return { data: raw ? await res.text() : await res.json() };
}

function parseManifest(text, path) {
  try {
    const j = JSON.parse(text);
    if (path === 'package.json') {
      const dsh = j.dsh || {};
      if (!dsh.bundle && !dsh.client) return null;
      return { format: 'package.json:dsh', id: null, version: j.version, engines: dsh.engines || {}, contributes: dsh };
    }
    if (path === 'dsh.plugin.json') {
      return { format: 'dsh.plugin.json', id: j.id || null, version: j.version, engines: (j.engines || {}), contributes: j.contributes || {} };
    }
    return { format: 'dsh-plugin-0.15', id: j.id || null, version: j.version, engines: (j.requires || {}), contributes: j.contributes || {}, manifestVersion: j.manifestVersion || null };
  } catch {
    return null;
  }
}

const files = readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.json')).sort();
let changed = 0;

for (const f of files) {
  const p = JSON.parse(readFileSync(join(PLUGIN_DIR, f), 'utf8'));
  if (ONLY && p.name !== ONLY) continue;
  const slug = p.repo.replace('https://github.com/', '');
  const repo = await gh(`/repos/${slug}`);
  if (repo.error) { console.warn(`! ${p.name}: repo 拉取失败 ${repo.error}`); continue; }
  const r = repo.data;

  const diffs = [];
  const next = JSON.parse(JSON.stringify(p));
  const setIf = (get, set, val, label) => {
    if (get !== val) { diffs.push(`${label}: ${JSON.stringify(get)} → ${JSON.stringify(val)}`); set(val); }
  };

  setIf(p.stats.stars, v => (next.stats.stars = v), r.stargazers_count, 'stars');
  setIf(p.stats.forks, v => (next.stats.forks = v), r.forks_count, 'forks');
  setIf(p.stats.pushedAt, v => (next.stats.pushedAt = v), r.pushed_at, 'pushedAt');
  setIf(p.stats.openIssues, v => (next.stats.openIssues = v), r.open_issues_count, 'openIssues');
  setIf(p.license, v => (next.license = v), r.license?.spdx_id || null, 'license');
  setIf(p.language, v => (next.language = v), r.language, 'language');

  // manifest 探测
  let found = null;
  for (const path of MANIFEST_CANDIDATES) {
    const res = await gh(`/repos/${slug}/contents/${path}`, true);
    if (res.error) continue;
    const m = parseManifest(res.data, path);
    if (m) { found = { path, ...m }; break; }
  }
  if (found) {
    setIf(p.version, v => (next.version = v), found.version, 'version');
    setIf(p.manifest?.path, v => (next.manifest = { ...(next.manifest || {}), path: found.path }), found.path, 'manifest.path');
    setIf(p.manifest?.format, v => (next.manifest = { ...(next.manifest || {}), format: found.format }), found.format, 'manifest.format');
    setIf(p.manifest?.id, v => (next.manifest = { ...(next.manifest || {}), id: found.id }), found.id, 'manifest.id');
    const eng = Object.keys(found.engines || {}).length ? found.engines : (p.manifest?.engines || {});
    if (JSON.stringify(eng) !== JSON.stringify(p.manifest?.engines || {})) {
      diffs.push(`engines: ${JSON.stringify(p.manifest?.engines || {})} → ${JSON.stringify(eng)}`);
      next.manifest = { ...(next.manifest || {}), engines: eng };
    }
  } else {
    console.warn(`! ${p.name}: 未找到可用 manifest`);
  }

  if (diffs.length) {
    changed++;
    console.log(`\n${p.name}`);
    diffs.forEach(d => console.log('  · ' + d));
    if (WRITE) writeFileSync(join(PLUGIN_DIR, f), JSON.stringify(next, null, 2) + '\n');
  } else {
    console.log(`${p.name}: 无变化`);
  }
}

console.log(`\n${changed ? `${changed} 个条目有变化${WRITE ? '（已写入）' : '（加 --write 写入）'}` : '全部为最新'}`);
if (changed && WRITE) console.log('接着跑 node scripts/build.mjs 重建索引与站点。');
