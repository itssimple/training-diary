// Renders social/og-image.png (1200×630), the preview image for links shared on
// Discord, X, Facebook, Slack, iMessage etc. Built from the app's own artwork.
// Usage: node tools/render-social.mjs   (needs Playwright; not a runtime dependency)
import { readFile, writeFile } from 'node:fs/promises';
import { loadPlaywright } from '../tests/e2e/playwright.mjs';
import { muscleMapSvg } from '../js/muscle-map.js';

const icon = await readFile(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const map = muscleMapSvg({ muscles: ['Quads', 'Glutes', 'Chest', 'Lats', 'Front delts', 'Hamstrings', 'Abs'], primaryMuscles: ['Quads', 'Chest', 'Lats'] });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #edf2ee;
    background: radial-gradient(circle at 85% 20%, #26341a 0, transparent 45%), linear-gradient(135deg, #1a221e, #0e1411); display: flex; padding: 64px 72px; gap: 40px; }
  .left { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 22px; }
  .brand svg { width: 104px; height: 104px; }
  h1 { font-size: 76px; font-weight: 800; letter-spacing: -1.5px; line-height: 1; }
  .tag { font-size: 38px; font-weight: 700; color: #b9f24c; line-height: 1.15; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: 28px; color: #c9d3cd; padding: 0; }
  li::before { content: "✓"; color: #b9f24c; font-weight: 800; margin-right: 14px; }
  .right { width: 360px; display: flex; align-items: center; }
  .muscle-map { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
  .mm-figure { width: 100%; height: auto; }
  .mm-body { fill: #2b3439; } .mm-idle { fill: #3a454c; } .mm-secondary { fill: #b9f24c; opacity: .45; } .mm-primary { fill: #b9f24c; } .mm-label { display: none; }
</style></head><body>
  <div class="left">
    <div class="brand">${icon.replace('<svg ', '<svg aria-hidden="true" ')}<h1>Training Diary</h1></div>
    <p class="tag">A private, offline workout diary</p>
    <ul><li>Log sets, supersets and cardio in seconds</li><li>Works at the gym without signal</li><li>Your data stays on your phone</li></ul>
  </div>
  <div class="right">${map}</div>
</body></html>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await writeFile(new URL('../social/og-image.png', import.meta.url), await page.screenshot({ type: 'png' }));
await browser.close();
console.log('wrote social/og-image.png');
