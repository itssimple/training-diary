import * as store from '../store.js';
import { h, btn, meter, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { onTick } from '../shell.js';
import { startFromTemplate, startEmptyWorkout, shareBackup } from '../actions.js';
import { backupDue, suggestNextTemplate, weekProgress, goalStreak, sessionSummary, sessionTitle, sessionElapsedSec, newRecordsIn, RECORD_LABELS } from '../model.js';
import { fmtDuration, fmtDurationWords, fmtRelativeDay, fmtWeekday, fmtNum, plural, fmtDate } from '../util.js';
import { formatRecordValue } from './progress.js';

export function renderHome({ el, rerender }) {
  const s = store.state;
  const settings = s.settings;
  const active = store.activeSession();
  const done = store.completedSessions();
  const now = Date.now();

  el.append(h('header', { class: 'page-head home-head' },
    h('div', { class: 'page-title' },
      h('p', { class: 'kicker' }, fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', { id: 'page-title', tabindex: '-1' }, 'Training Diary'))));

  const grid = h('div', { class: 'home-grid' });
  el.append(grid);
  const main = h('div', { class: 'home-col' });
  const side = h('div', { class: 'home-col' });
  grid.append(main, side);

  // 1. Resume or next workout
  let tickEl = null;
  if (active) {
    const sum = sessionSummary(active);
    tickEl = h('span', { class: 'mono' }, fmtDuration(sessionElapsedSec(active)));
    main.append(h('section', { class: 'card hero hero-active', 'aria-labelledby': 'resume-title' },
      h('p', { class: 'kicker' }, active.pausedAt ? 'Paused workout' : 'Workout in progress'),
      h('h2', { id: 'resume-title' }, active.name),
      h('p', { class: 'hero-meta' }, tickEl, ' · ', `${sum.setsDone} of ${sum.setsPlanned} sets`),
      h('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/workout' }, icon('play'), h('span', null, 'Resume workout'))));
  } else {
    const next = suggestNextTemplate(s.programs, s.templates, done);
    if (next) {
      const t = next.template;
      const lastOfThis = done.find((x) => x.templateId === t.id);
      main.append(h('section', { class: 'card hero', 'aria-labelledby': 'next-title' },
        h('p', { class: 'kicker' }, `Up next · ${next.program?.name || 'Program'}`),
        h('h2', { id: 'next-title' }, t.name),
        h('p', { class: 'hero-meta' },
          plural((t.items || []).length, 'exercise'),
          lastOfThis ? ` · last done ${fmtRelativeDay(lastOfThis.startedAt).toLowerCase()}` : ' · not done yet'),
        h('ul', { class: 'hero-list' }, (t.items || []).slice(0, 6).map((i) => h('li', null, store.exerciseById(i.exerciseId)?.name || i.exerciseName))),
        settings.simpleLogging
          ? h('a', { class: 'btn btn-primary btn-lg btn-block', href: `#/quick?tpl=${t.id}` }, icon('edit'), h('span', null, 'Log this workout'))
          : btn('Start workout', () => startFromTemplate(t.id), { variant: 'primary', size: 'lg', block: true, icon: 'play' })));
    } else {
      main.append(h('section', { class: 'card hero' },
        h('h2', null, 'Ready when you are'),
        h('p', { class: 'muted' }, 'Create a program with workout templates, or start an empty workout and add exercises as you go.'),
        h('a', { class: 'btn btn-primary btn-lg btn-block', href: '#/train' }, 'Set up a program')));
    }
  }
  main.append(h('div', { class: 'quick-actions' },
    btn('Log activity', () => { location.hash = '#/activity/new'; }, { icon: 'run' }),
    settings.simpleLogging
      ? h('a', { class: 'btn btn-secondary', href: '#/quick' }, icon('plus'), h('span', null, 'Log other workout'))
      : btn('Empty workout', () => startEmptyWorkout(), { icon: 'plus', disabled: !!active }),
    h('a', { class: 'btn btn-secondary', href: '#/train' }, icon('train'), h('span', null, 'All workouts'))));

  // 2. Weekly goal
  const wp = weekProgress(done, settings, now);
  const streak = goalStreak(done, settings, now);
  let goalMsg;
  if (!wp.goal) goalMsg = 'No weekly goal set.';
  else if (wp.remaining === 0) goalMsg = 'Weekly goal reached.';
  else goalMsg = `${plural(wp.remaining, 'more session')} to reach your goal · ${plural(wp.daysLeft, 'day')} left this week`;
  const todayIdx = wp.days.findIndex((d) => d.isToday);
  const reminderToday = (settings.reminderDays || []).includes(new Date(now).getDay()) && !wp.days[todayIdx]?.count;
  side.append(h('section', { class: 'card', 'aria-labelledby': 'week-title' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'week-title' }, 'This week'),
      h('a', { href: '#/settings', class: 'link-sm' }, 'Goal settings')),
    h('p', { class: 'big-stat' }, h('strong', null, String(wp.count)), wp.goal ? h('span', null, ` / ${wp.goal} sessions`) : h('span', null, ' sessions')),
    wp.goal ? meter(wp.count, wp.goal, 'Weekly goal progress') : null,
    h('ol', { class: 'week-dots', 'aria-label': 'Sessions per day' }, wp.days.map((d) => h('li', {
      class: [d.count ? 'on' : '', d.isToday ? 'today' : ''],
      'aria-label': `${fmtWeekday(d.date)}: ${d.count ? plural(d.count, 'session') : 'none'}${d.isToday ? ' (today)' : ''}`,
    }, h('span', { class: 'dot' }, d.count ? icon('check') : null), h('span', { class: 'dow' }, fmtWeekday(d.date).slice(0, 2))))),
    h('p', { class: 'muted small' }, goalMsg),
    reminderToday ? h('p', { class: 'notice' }, icon('calendar'), h('span', null, `Today is one of your planned training days${settings.reminderTime ? ` (${settings.reminderTime})` : ''}.`)) : null,
    streak > 1 ? h('p', { class: 'small' }, icon('trophy'), ` Goal met ${streak} weeks in a row`) : null,
    wp.distanceKm > 0 ? h('p', { class: 'small muted' }, `Distance this week: ${fmtNum(wp.distanceKm, 1)} km`) : null));

  // 3. Last session
  const last = done[0];
  if (last) {
    const sum = sessionSummary(last);
    side.append(h('section', { class: 'card', 'aria-labelledby': 'last-title' },
      h('div', { class: 'card-head' }, h('h2', { id: 'last-title' }, 'Last trained'), h('a', { href: '#/history', class: 'link-sm' }, 'History')),
      h('a', { class: 'row-link', href: `#/history/${last.id}` },
        h('span', { class: 'row-main' },
          h('strong', null, sessionTitle(last)),
          h('span', { class: 'muted small' }, `${fmtRelativeDay(last.startedAt)} · ${fmtDurationWords(sum.durationSec)}${last.kind === 'workout' ? ` · ${plural(sum.setsDone, 'set')}` : ''}${sum.distanceKm ? ` · ${fmtNum(sum.distanceKm, 2)} km` : ''}`)),
        icon('forward'))));
  } else {
    side.append(h('section', { class: 'card' }, emptyState('No sessions yet', 'Your completed workouts and activities will show up here.', null, 'history')));
  }

  // 4. Recent records (last 30 days)
  const recent = done.filter((x) => x.startedAt > now - 30 * 86400000).slice(0, 15);
  const prs = recent.flatMap((x) => newRecordsIn(x, done).map((r) => ({ ...r, date: x.startedAt })))
    .filter((r) => r.key === 'maxWeightKg' || r.key === 'leastAssistKg' || r.key === 'bestE1rmKg' || r.key === 'longestDistanceKm' || r.key === 'bestPaceSecPerKm' || r.key === 'maxReps')
    .slice(0, 4);
  if (prs.length) {
    side.append(h('section', { class: 'card', 'aria-labelledby': 'pr-title' },
      h('div', { class: 'card-head' }, h('h2', { id: 'pr-title' }, 'Recent records'), h('a', { href: '#/progress?tab=records', class: 'link-sm' }, 'All records')),
      h('ul', { class: 'pr-list' }, prs.map((r) => h('li', null, icon('trophy'),
        h('span', null, h('strong', null, r.name), h('span', { class: 'muted small' }, ` ${RECORD_LABELS[r.key].toLowerCase()}: ${formatRecordValue(r.key, r.value, r.extra, r.snap)} · ${fmtRelativeDay(r.date)}`)))))));
  }

  // 5. iPhone/iPad in a Safari tab: storage is deleted after 7 days of Safari use without
  // visiting the site. Home Screen web apps are exempt, so push for installation.
  if ('standalone' in navigator && navigator.standalone === false) {
    main.prepend(h('section', { class: 'card notice-card', role: 'note', 'aria-labelledby': 'ios-title' },
      h('h2', { id: 'ios-title' }, icon('warn'), ' Add this app to your Home Screen'),
      h('p', { class: 'small' }, 'In a Safari tab, iOS deletes this diary after 7 days of using Safari without opening it. Apps on the Home Screen are exempt.'),
      h('p', { class: 'small' }, 'Tap Share, then "Add to Home Screen", and from now on open the app from that icon. Data in this Safari tab is not moved over automatically: export a backup here first and import it in the installed app if you already have data.')));
  }

  // 6. Backup reminder (data lives only on this device)
  const lastExport = settings.lastExportAt || null;
  const backup = backupDue(store.state.sessions, settings, now);
  if (backup.due) {
    main.append(h('section', { class: 'card notice-card', 'aria-labelledby': 'backup-title' },
      h('h2', { id: 'backup-title' }, icon('download'), ' Back up your diary'),
      h('p', { class: 'small' }, `${plural(backup.pending, 'session')} recorded since your last backup (${lastExport ? fmtRelativeDay(lastExport).toLowerCase() : 'never'}). Your diary exists only on this phone.`),
      btn('Back up now', async () => { await shareBackup(); rerender(); }, { size: 'sm', variant: 'primary', icon: 'upload' })));
  }

  if (tickEl) {
    return onTick(() => { tickEl.textContent = fmtDuration(sessionElapsedSec(active)); });
  }
  return null;
}
