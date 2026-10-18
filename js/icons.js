// Original line icons (24×24 grid, stroke-based). Kept inline so they work offline with no requests.

const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  train: '<path d="M2.5 9.5v5M5.5 7v10M18.5 7v10M21.5 9.5v5M5.5 12h13"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4.5v4h4"/><path d="M12 7.5V12l3 2"/>',
  progress: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7.5 15 3.5-4 3 2.5 5-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.4 6.5l2.6 1.5M17 16l2.6 1.5M4.4 17.5 7 16M17 8l2.6-1.5"/><circle cx="12" cy="12" r="7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11"/><path d="M3.5 7.5H17"/><path d="m17 13 3.5 3.5L17 20"/><path d="M20.5 16.5H7"/>',
  skip: '<path d="m5 5 9 7-9 7z"/><path d="M18 5v14"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4h5v2.5"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h12l-2.5 4 2.5 4H5"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  forward: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  unlink: '<path d="M15.5 13.5 18.7 10.3a4 4 0 0 0-5.7-5.7L10 7.6"/><path d="M8.5 10.5 5.3 13.7a4 4 0 0 0 5.7 5.7l3-3"/><path d="M4 4l16 16"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 2.5h5M18.5 7l1.5-1.5"/>',
  run: '<circle cx="14.5" cy="4.5" r="2"/><path d="m10 21 2.5-5.5L10 12l3.5-4 2.5 3.5h3.5"/><path d="M13.5 8 9 9.5 6.5 13"/><path d="m12.5 15.5 3 2 1 3.5"/>',
  note: '<path d="M6 3.5h9l4 4V20.5H6z"/><path d="M14.5 3.5V8H19"/><path d="M9 12.5h7M9 16h5"/>',
  download: '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15.5V4.5"/><path d="m7 9 5-5 5 5"/><path d="M4.5 19.5h15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11"/><path d="M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  body: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8.5h14M12 8.5v6M9 21l3-6.5 3 6.5"/>',
  library: '<path d="M4.5 4.5h4v15h-4zM10 4.5h4v15h-4z"/><path d="m15.5 5.5 3.8-1 3.2 14.5-3.8 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5v.5"/>',
  warn: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17v.5"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h3.5"/>',
  offline: '<path d="M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/><path d="M3 3l18 18"/>',
};

export function iconSvg(name, cls = '') {
  const body = P[name] || P.info;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, cls);
  return t.content.firstChild;
}
