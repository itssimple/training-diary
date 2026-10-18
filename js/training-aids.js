// Pure helpers for gym-floor maths: plate loading, warm-up ramps and progression hints.
// Suggestions only: nothing here changes a plan unless the user applies it.

import { setKind } from './model.js';

const roundTo = (v, step) => Math.round(v / step) * step;
const r2 = (v) => Math.round(v * 1000) / 1000;

/**
 * Plates per side for a barbell total. Greedy with the available plate sizes (unlimited pairs).
 * Returns { perSide: [{ plateKg, count }], loadedKg, remainderKg, belowBar }.
 */
export function platesPerSide(totalKg, barKg = 20, platesKg = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  if (!Number.isFinite(totalKg) || totalKg <= 0) return { perSide: [], loadedKg: barKg, remainderKg: 0, belowBar: true };
  if (totalKg < barKg) return { perSide: [], loadedKg: barKg, remainderKg: r2(totalKg - barKg), belowBar: true };
  let side = r2((totalKg - barKg) / 2);
  const perSide = [];
  for (const p of [...platesKg].filter((x) => x > 0).sort((a, b) => b - a)) {
    const n = Math.floor(r2(side / p) + 1e-9);
    if (n > 0) { perSide.push({ plateKg: p, count: n }); side = r2(side - n * p); }
  }
  const loadedKg = r2(barKg + 2 * perSide.reduce((a, x) => a + x.plateKg * x.count, 0));
  return { perSide, loadedKg, remainderKg: r2(totalKg - loadedKg), belowBar: false };
}

/**
 * Warm-up ramp towards a working weight. Barbell lifts start with the empty bar.
 * Returns [{ weightKg, reps }], lightest first. Empty when the work weight is too light to need one.
 */
export function warmupPlan(workKg, { barbell = false, barKg = 20, stepKg = 2.5 } = {}) {
  if (!Number.isFinite(workKg) || workKg <= 0) return [];
  const min = barbell ? barKg : stepKg;
  if (workKg <= min * 1.25) return [];
  const steps = workKg >= 60 ? [[0.4, 8], [0.6, 5], [0.8, 3]] : [[0.5, 8], [0.75, 4]];
  const out = barbell && workKg >= barKg * 2 ? [{ weightKg: barKg, reps: 10 }] : [];
  for (const [pct, reps] of steps) {
    const w = Math.max(min, roundTo(workKg * pct, stepKg));
    if (w >= workKg) continue;
    if (out.some((x) => x.weightKg === w)) continue;
    out.push({ weightKg: w, reps });
  }
  return out.sort((a, b) => a.weightKg - b.weightKg);
}

/** Default weight increment for an exercise (kg). */
export function incrementFor(exercise) {
  if (Number.isFinite(exercise?.incrementKg) && exercise.incrementKg > 0) return exercise.incrementKg;
  return exercise?.weightMode === 'perHand' ? 2 : 2.5;
}

/**
 * Double-progression hint: if last time every working set reached the top of this entry's
 * planned rep range at one weight, suggest the next weight step. Returns null otherwise.
 * Requires a rep range in the plan; without one there is no clear "top" to reach.
 */
export function progressionHint(entry, lastPerf, incrementKg = 2.5) {
  const plans = (entry.sets || []).filter((s) => setKind(s) !== 'warmup').map((s) => s.planned).filter(Boolean);
  const top = plans.find((p) => Number.isFinite(p.repsMax))?.repsMax;
  if (!Number.isFinite(top) || !lastPerf?.sets?.length) return null;
  const sets = lastPerf.sets.filter((s) => Number.isFinite(s.reps));
  if (!sets.length || sets.length < Math.min(plans.length, lastPerf.sets.length)) return null;
  const weights = [...new Set(sets.map((s) => s.weightKg).filter(Number.isFinite))];
  if (weights.length !== 1) return null;
  if (!sets.every((s) => s.reps >= top)) return null;
  const lower = !!entry.exercise?.lowerIsBetter;
  const from = weights[0];
  const to = lower ? Math.max(0, r2(from - incrementKg)) : r2(from + incrementKg);
  if (to === from) return null;
  return { fromKg: from, toKg: to, topReps: top, lowerIsBetter: lower };
}
