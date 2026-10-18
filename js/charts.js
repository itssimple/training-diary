// Thin wrapper around the locally bundled Chart.js (vendor/chartjs). Loaded on demand so the
// rest of the app starts without it. Time axes use plain linear timestamps (no date adapter).

import { fmtDate } from './util.js';

let loading = null;

export function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/chartjs/chart.umd.min.js';
      s.onload = () => resolve(window.Chart);
      s.onerror = () => { loading = null; reject(new Error('Could not load the chart library.')); };
      document.head.append(s);
    });
  }
  return loading;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Line/bar chart of one series over time.
 * points: [{ x: timestamp, y: number, sessionId }]
 */
export async function timeChart(canvas, { points, label, unit, type = 'line', yFormat = (v) => v, onPointClick = null, reverseY = false, barWidthDays = null }) {
  const Chart = await loadChartJs();
  const accent = cssVar('--accent');
  const text = cssVar('--text-muted');
  const grid = cssVar('--border');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const xs = points.map((p) => p.x);
  const span = Math.max(...xs) - Math.min(...xs);
  const dateFmt = span > 300 * 86400000 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  return new Chart(canvas, {
    type,
    data: {
      datasets: [{
        label: `${label}${unit ? ` (${unit})` : ''}`,
        data: points,
        borderColor: accent,
        backgroundColor: type === 'bar' ? accent : `${accent}33`,
        pointBackgroundColor: accent,
        pointRadius: points.length > 40 ? 2 : 4,
        pointHoverRadius: 7,
        pointHitRadius: 14,
        borderWidth: 2.5,
        tension: 0.15,
        fill: false,
        barThickness: barWidthDays ? 'flex' : undefined,
        maxBarThickness: 28,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : { duration: 250 },
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(items[0].parsed.x, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
            label: (item) => `${label}: ${yFormat(item.parsed.y)}${unit ? ` ${unit}` : ''}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { color: text, maxTicksLimit: 6, callback: (v) => fmtDate(v, dateFmt) },
          grid: { color: grid, display: false },
          offset: type === 'bar',
          title: { display: true, text: 'Date', color: text },
        },
        y: {
          reverse: reverseY,
          beginAtZero: type === 'bar',
          ticks: { color: text, callback: (v) => yFormat(v), maxTicksLimit: 6 },
          grid: { color: grid },
          title: { display: true, text: `${label}${unit ? ` (${unit})` : ''}`, color: text },
        },
      },
      onClick: (evt, elements) => {
        if (onPointClick && elements.length) onPointClick(points[elements[0].index]);
      },
    },
  });
}
