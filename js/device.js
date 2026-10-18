// Best-effort device features: sound, vibration and screen wake lock.
// All of these can be unavailable or blocked by the platform; the app works without them.
// Browsers suspend pages in the background, so alerts only play while the app is visible.

let ctx = null;

/** Must be called from a user gesture (e.g. ticking a set) so audio is allowed later. */
export function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio unsupported */ }
}

export function beep() {
  try {
    if (!ctx || ctx.state !== 'running') return false;
    const t = ctx.currentTime;
    [0, 0.22, 0.44].forEach((offset, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t + offset);
      g.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t + offset);
      o.stop(t + offset + 0.2);
    });
    return true;
  } catch {
    return false;
  }
}

export function vibrate(pattern = [200, 100, 200]) {
  try { return navigator.vibrate ? navigator.vibrate(pattern) : false; } catch { return false; }
}

let wakeLock = null;
let wantWakeLock = false;

async function acquire() {
  if (!wantWakeLock || !('wakeLock' in navigator) || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && wantWakeLock && !wakeLock) acquire(); });

export function keepScreenOn(on) {
  wantWakeLock = on;
  if (on) acquire();
  else if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

export const wakeLockSupported = () => 'wakeLock' in navigator;

/** True when running as an installed app (home screen / app window) rather than a browser tab. */
export function isInstalledApp() {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  } catch {
    return false;
  }
}
