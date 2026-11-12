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
    // schema.org is an identifier in the JSON-LD block, not something the app loads.
    const urls = (text.match(/https?:\/\/[^\s"'`)]+/g) || []).filter((u) => !u.startsWith('http://www.w3.org/') && u !== 'https://schema.org');
    assert.deepEqual(urls, [], `${f} references external URLs`);
  }
});

test('link previews: Open Graph, X card, canonical and JSON-LD are present', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:image:width', 'og:image:alt', 'og:url', 'og:type']) assert.match(html, new RegExp(`property="${tag}" content="[^"]+"`), tag);
  for (const tag of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.match(html, new RegExp(`name="${tag}" content="[^"]+"`), tag);
  assert.match(html, /<link rel="canonical" href="__SITE_URL__\/">/);
  // Every absolute URL uses the placeholder the deploy workflow replaces.
  assert.ok(!/content="\/|href="https?:/.test(html.replace(/https:\/\/schema\.org/g, '')), 'no hardcoded absolute or root URLs');
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(ld['@type'], 'WebApplication');
  const wf = await readFile(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(wf, /sed -i "s\|__SITE_URL__\|/);
  assert.match(wf, /cp -r .*\bsocial\b/);
  // 1200×630 PNG (width/height are at bytes 16–23 of the IHDR chunk).
  const png = await readFile(join(ROOT, 'social/og-image.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
