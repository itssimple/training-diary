// Static guard: the native DOM methods append/replaceChildren/prepend print null as the text
// "null". Views must pass possibly-null children through ui.js append() or h() instead.
// This has caused visible bugs twice, so every view is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../js/', import.meta.url));
const files = [...readdirSync(ROOT).filter((f) => f.endsWith('.js')).map((f) => join(ROOT, f)),
  ...readdirSync(join(ROOT, 'views')).map((f) => join(ROOT, 'views', f))].filter((f) => !f.endsWith('ui.js'));

/** Top-level argument strings of each native append-like call. */
function calls(src) {
  const out = [];
  const re = /\.(append|replaceChildren|prepend)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length; let depth = 1; let start = i; let str = null; const args = [];
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; }
      if (c === "'" || c === '"' || c === '`') { str = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { depth--; if (!depth) args.push(src.slice(start, i)); } else if (c === ',' && depth === 1) { args.push(src.slice(start, i)); start = i + 1; }
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, args: args.map((a) => a.trim()) });
  }
  return out;
}

const nullable = (a) => /:\s*null$/.test(a) || /^[^(]*\?\s*null\s*:/.test(a) || /^[^(]*&&/.test(a);

test('no possibly-null children passed to native append/replaceChildren/prepend', () => {
  const bad = [];
  for (const f of files) {
    for (const c of calls(readFileSync(f, 'utf8'))) {
      const hits = c.args.filter(nullable);
      if (hits.length) bad.push(`${f.slice(ROOT.length)}:${c.line} → ${hits.map((x) => x.slice(0, 60).replace(/\s+/g, ' ')).join(' | ')}`);
    }
  }
  assert.deepEqual(bad, [], 'use append(el, [...]) from ui.js for these calls');
});
