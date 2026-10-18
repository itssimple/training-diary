// Guards against the classic offline bugs: a file missing from the precache list,
// absolute paths that break under the GitHub Pages sub-path, and version drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../js/version.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function walk(dir) {
  const out = [];
  for (const d of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p));
    else out.push(p.split('\\').join('/'));
  }
  return out;
}

async function swAssets() {
  const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const block = /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1];
  return { sw, assets: [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]) };
}

test('every runtime file is precached by the service worker', async () => {
  const { assets } = await swAssets();
  const files = [
    'index.html', 'manifest.webmanifest',
    ...(await walk('js')), ...(await walk('css')), ...(await walk('icons')), ...(await walk('vendor')),
  ];
  const missing = files.filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], `add these to ASSETS in sw.js: ${missing.join(', ')}`);
  const extra = assets.filter((a) => a !== './' && !files.includes(a));
  assert.deepEqual(extra, [], `ASSETS lists files that do not exist: ${extra.join(', ')}`);
});

test('service worker cache version matches the app version', async () => {
  const { sw } = await swAssets();
  assert.equal(/const CACHE_VERSION = '([^']+)'/.exec(sw)[1], APP_VERSION);
});

test('no root-absolute URLs (GitHub Pages sub-path safety)', async () => {
  const files = ['index.html', 'manifest.webmanifest', 'sw.js', ...(await walk('js')), ...(await walk('css'))];
  for (const f of files) {
    const text = await readFile(join(ROOT, f), 'utf8');
    const bad = text.match(/(?:src|href)\s*[=:]\s*["'`]\/(?!\/)[^"'`]*/g) || [];
    assert.deepEqual(bad, [], `${relative(ROOT, join(ROOT, f))} uses root-absolute URLs`);
  }
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const k of ['start_url', 'scope', 'id']) assert.ok(!manifest[k].startsWith('/'), `manifest ${k} must be relative`);
  for (const i of manifest.icons) assert.ok(!i.src.startsWith('/'));
});

test('no external network dependencies at runtime', async () => {
  const files = ['index.html', 'manifest.webmanifest', 'sw.js', ...(await walk('js')), ...(await walk('css'))];
  for (const f of files) {
    const text = await readFile(join(ROOT, f), 'utf8');
    const urls = (text.match(/https?:\/\/[^\s"'`)]+/g) || []).filter((u) => !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(urls, [], `${f} references external URLs`);
  }
});
