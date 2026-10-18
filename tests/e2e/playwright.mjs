// Locates Playwright without adding it as a project dependency: uses a local install if
// present, otherwise the globally installed package (npm root -g).
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    const entry = join(root, 'playwright', 'index.mjs');
    if (!existsSync(entry)) throw new Error('Playwright not found. Install it with: npm i -g playwright');
    const mod = await import(pathToFileURL(entry).href);
    return mod.default && mod.default.chromium ? mod.default : mod;
  }
}

