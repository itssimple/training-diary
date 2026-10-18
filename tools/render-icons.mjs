// Renders the PNG app icons from the SVG sources using Playwright's Chromium.
// Usage: node tools/render-icons.mjs   (needs Playwright; not a runtime dependency)
import { readFile, writeFile } from 'node:fs/promises';
import { loadPlaywright } from '../tests/e2e/playwright.mjs';

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  ['icons/icon.svg', 'icons/icon-192.png', 192],
  ['icons/icon.svg', 'icons/icon-512.png', 512],
  ['icons/icon.svg', 'icons/favicon-32.png', 32],
  ['icons/icon-maskable.svg', 'icons/icon-maskable-512.png', 512],
  ['icons/icon-maskable.svg', 'icons/apple-touch-icon.png', 180],
];
for (const [src, out, size] of jobs) {
  const svg = await readFile(new URL(`../${src}`, import.meta.url), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(new URL(`../${out}`, import.meta.url), buf);
  console.log('wrote', out);
}
await browser.close();
