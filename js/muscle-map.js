// Original front/back body diagram that highlights worked muscles. Pure string output (SVG),
// so it renders offline, scales to any size and follows the theme through CSS variables.
// Region names match MUSCLES in model.js.

// Each region: [view, svg element markup]. Left side is drawn; the right side is mirrored.
const L = {
  'Front delts': [['front', '<ellipse cx="38" cy="54" rx="7" ry="9"/>']],
  'Side delts': [['front', '<ellipse cx="31" cy="52" rx="5" ry="8"/>'], ['back', '<ellipse cx="31" cy="52" rx="5" ry="8"/>']],
  Chest: [['front', '<path d="M44 46 Q52 43 59 45 L59 64 Q51 67 44 62 Q41 54 44 46Z"/>']],
  Biceps: [['front', '<ellipse cx="31" cy="76" rx="5.5" ry="11"/>']],
  Forearms: [['front', '<path d="M25 92 Q30 90 32 94 L29 120 Q26 121 24 119 Z"/>'], ['back', '<path d="M25 92 Q30 90 32 94 L29 120 Q26 121 24 119 Z"/>']],
  Abs: [['front', '<rect x="52" y="67" width="7.5" height="9" rx="2"/><rect x="52" y="78" width="7.5" height="9" rx="2"/><rect x="52" y="89" width="7.5" height="11" rx="2"/>']],
  Obliques: [['front', '<path d="M44 68 L50 70 L50 102 L44 98 Q42 84 44 68Z"/>']],
  Quads: [['front', '<path d="M43 118 Q49 116 53.5 120 L53.5 168 Q49 173 45 168 Q41 142 43 118Z"/>']],
  Adductors: [['front', '<path d="M54.5 121 Q58 122 59.5 125 L59.5 150 Q57 157 54.5 160Z"/>']],
  Traps: [['front', '<path d="M53 38 L59.5 37 L59.5 42 L47 46Z"/>'], ['back', '<path d="M59.5 34 L59.5 76 L52 60 L44 46 Q52 41 59.5 34Z"/>']],
  'Rear delts': [['back', '<ellipse cx="38" cy="54" rx="7" ry="8"/>']],
  'Upper back': [['back', '<path d="M45 56 L52 61 L54 74 L45 72Z"/>']],
  Lats: [['back', '<path d="M42 62 L45 74 L55 78 L57 102 L46 96 Q40 80 42 62Z"/>']],
  'Lower back': [['back', '<rect x="53" y="94" width="6.5" height="18" rx="2"/>']],
  Triceps: [['back', '<ellipse cx="31" cy="76" rx="5.5" ry="11"/>']],
  Glutes: [['back', '<path d="M44 114 Q52 110 59.5 114 L59.5 134 Q51 138 44 132 Q42 122 44 114Z"/>']],
  Hamstrings: [['back', '<path d="M44 138 Q51 136 57 140 L56 170 Q50 174 45 170 Q42 154 44 138Z"/>']],
  Calves: [['back', '<path d="M45 182 Q51 178 56 182 L55 210 Q50 214 46 210 Q43 196 45 182Z"/>']],
};

const SILHOUETTE = [
  '<circle cx="60" cy="18" r="12"/>',
  '<rect x="54" y="28" width="12" height="10" rx="3"/>',
  '<path d="M40 42 Q60 34 80 42 L86 56 L82 112 Q60 118 38 112 L34 56Z"/>',
  '<path d="M36 44 L26 50 L20 122 L28 124 L36 70Z"/>',
  '<path d="M84 44 L94 50 L100 122 L92 124 L84 70Z"/>',
  '<path d="M39 110 L60 114 L58 236 L44 236 Q38 170 39 110Z"/>',
  '<path d="M81 110 L60 114 L62 236 L76 236 Q82 170 81 110Z"/>',
].join('');

function regionsFor(view, cls, names) {
  let out = '';
  for (const name of names) {
    for (const [v, markup] of L[name] || []) {
      if (v !== view) continue;
      const label = `<title>${name}</title>`;
      out += `<g class="${cls}" data-muscle="${name}">${label}${markup}</g>`;
      out += `<g class="${cls}" data-muscle="${name}" transform="translate(120 0) scale(-1 1)">${label}${markup}</g>`;
    }
  }
  return out;
}

function figure(view, primary, secondary) {
  const all = Object.keys(L).filter((n) => L[n].some(([v]) => v === view));
  const rest = all.filter((n) => !primary.includes(n) && !secondary.includes(n));
  return `<svg class="mm-figure" viewBox="0 0 120 240" role="img" aria-label="${view === 'front' ? 'Front' : 'Back'} view">`
    + `<g class="mm-body">${SILHOUETTE}</g>`
    + regionsFor(view, 'mm-idle', rest)
    + regionsFor(view, 'mm-secondary', secondary)
    + regionsFor(view, 'mm-primary', primary)
    + `<text x="60" y="239" text-anchor="middle" class="mm-label">${view === 'front' ? 'Front' : 'Back'}</text>`
    + '</svg>';
}

/** Muscles shown on the map, split into primary and secondary (first listed muscle is primary when none are marked). */
export function musclesFor(ex) {
  const muscles = (ex?.muscles || []).filter((m) => L[m]);
  let primary = (ex?.primaryMuscles || []).filter((m) => L[m]);
  if (!primary.length && muscles.length) primary = [muscles[0]];
  const secondary = muscles.filter((m) => !primary.includes(m));
  return { primary, secondary };
}

/** SVG markup for front and back figures. */
export function muscleMapSvg(ex) {
  const { primary, secondary } = musclesFor(ex);
  const desc = primary.length || secondary.length
    ? `Primary: ${primary.join(', ') || 'none'}. Secondary: ${secondary.join(', ') || 'none'}.`
    : 'No muscle groups recorded.';
  return `<div class="muscle-map" role="group" aria-label="Muscle map. ${desc}">${figure('front', primary, secondary)}${figure('back', primary, secondary)}</div>`;
}

export const MAPPED_MUSCLES = Object.keys(L);
