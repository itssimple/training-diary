// Exercise library: list, editor and the reusable exercise picker.

import * as store from '../store.js';
import { h, append, btn, iconBtn, pageHead, field, input, select, textarea, numInput, checkbox, toast, confirmDialog, openDialog, emptyState, segmented } from '../ui.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../shell.js';
import { EXERCISE_TYPES, CATEGORIES, EQUIPMENT, MUSCLES, WEIGHT_MODES, lastPerformance, computeRecords, RECORD_LABELS } from '../model.js';
import { uid, num, plural, fmtDateShort } from '../util.js';
import { muscleMapSvg, musclesFor } from '../muscle-map.js';
import { fmtSetsCompact } from './workout.js';
import { formatRecordValue } from './progress.js';
import { exercisesNeedingDetails, missingDetails } from '../coach.js';

export function trainTabs(active) {
  return h('nav', { class: 'tabs', 'aria-label': 'Train sections' },
    h('a', { href: '#/train', class: 'tab', 'aria-current': active === 'programs' ? 'page' : null }, 'Programs'),
    h('a', { href: '#/library', class: 'tab', 'aria-current': active === 'library' ? 'page' : null }, 'Exercises'));
}

function exerciseMeta(ex) {
  return [ex.category, ex.equipment, EXERCISE_TYPES[ex.type]?.label.split(' (')[0]].filter(Boolean).join(' · ');
}

function filterExercises(list, q, cat) {
  const needle = (q || '').trim().toLowerCase();
  return list.filter((e) => (!cat || e.category === cat) && (!needle
    || e.name.toLowerCase().includes(needle)
    || (e.equipment || '').toLowerCase().includes(needle)
    || (e.muscles || []).some((m) => m.toLowerCase().includes(needle))));
}

function libraryList(query, selectedId) {
  const wrap = h('div', { class: 'md-list' });
  const showArchived = query.archived === '1';
  const search = input({ type: 'search', placeholder: 'Search name, equipment, muscle', 'aria-label': 'Search exercises', value: query.q || '', class: 'search' });
  const cat = select([['', 'All categories'], ...CATEGORIES.map((c) => [c, c])], query.cat || '', { 'aria-label': 'Category' });
  const listEl = h('ul', { class: 'list' });
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const draw = () => {
    const all = store.exercisesSorted({ includeArchived: showArchived });
    const items = filterExercises(all, search.value, cat.value);
    listEl.replaceChildren(...items.map((ex) => h('li', null,
      h('a', { href: `#/library/${ex.id}${location.hash.includes('?') ? `?${location.hash.split('?')[1]}` : ''}`, class: ['row-link', ex.id === selectedId ? 'selected' : ''], 'aria-current': ex.id === selectedId ? 'true' : null },
        h('span', { class: 'row-main' },
          h('strong', null, ex.name, ex.archived ? h('span', { class: 'badge' }, 'Archived') : null),
          h('span', { class: 'muted small' }, exerciseMeta(ex))),
        icon('forward')))));
    count.textContent = `${plural(items.length, 'exercise')}${search.value || cat.value ? ' match' : ''}`;
    if (!items.length) listEl.append(h('li', { class: 'empty-row' }, 'No exercises match. Try another search or add a new exercise.'));
  };
  search.addEventListener('input', () => { setQuery({ q: search.value }); draw(); });
  cat.addEventListener('change', () => { setQuery({ cat: cat.value }); draw(); });
  wrap.append(
    h('div', { class: 'toolbar' }, search, cat),
    h('div', { class: 'toolbar between' }, count,
      checkbox('Show archived', showArchived, (v) => { setQuery({ archived: v ? '1' : '' }); navigate(location.hash, { replace: true }); })),
    listEl);
  draw();
  return wrap;
}

export function renderLibrary({ el, query }) {
  const needDetails = exercisesNeedingDetails(store.state.exercises).length;
  el.append(pageHead('Exercises', {
    actions: [
      h('a', { class: 'btn btn-secondary', href: '#/coach?section=exercises' }, icon('progress'), h('span', null, `Fill details with AI${needDetails ? ` (${needDetails})` : ''}`)),
      h('a', { class: 'btn btn-primary', href: '#/library/new' }, icon('plus'), h('span', null, 'New')),
    ],
  }));
  el.append(trainTabs('library'));
  const md = h('div', { class: 'md' });
  md.append(libraryList(query, null), h('div', { class: 'md-detail md-placeholder' },
    emptyState('Select an exercise', 'Pick an exercise to view or edit it. Edit the library to match the equipment at your gym.', null, 'library')));
  el.append(md);
  el.append(h('p', { class: 'muted small center' },
    'Missing a starter exercise you deleted? ',
    h('button', {
      type: 'button', class: 'linklike',
      onclick: async () => { const n = await store.restoreStarterExercises(); toast(n ? `Restored ${plural(n, 'starter exercise')}.` : 'All starter exercises are already in your library.'); if (n) navigate(location.hash, { replace: true }); },
    }, 'Restore starter exercises')));
}

export function renderExercise({ el, params, query }) {
  const id = params[0];
  const isNew = id === 'new';
  const existing = isNew ? null : store.exerciseById(id);
  if (!isNew && !existing) {
    el.append(pageHead('Exercise not found', { back: '#/library' }), emptyState('This exercise does not exist', 'It may have been deleted.', h('a', { href: '#/library', class: 'btn' }, 'Back to library')));
    return;
  }
  const md = h('div', { class: 'md has-detail' });
  const detail = h('div', { class: 'md-detail' });
  md.append(libraryList(query, id), detail);
  el.append(pageHead(isNew ? 'New exercise' : existing.name, { back: '#/library', kicker: 'Exercise library' }));
  el.append(md);
  if (existing && !query.edit) {
    detail.append(h('div', { class: 'form-actions' },
      h('a', { class: 'btn btn-primary', href: `#/library/${id}?edit=1` }, icon('edit'), h('span', null, 'Edit'))),
      exerciseInfo(existing));
    return;
  }
  detail.append(exerciseForm(existing, {
    onSaved: (ex) => { toast('Exercise saved.'); navigate(`#/library/${ex.id}`, { replace: true }); },
    onDeleted: () => navigate('#/library', { replace: true }),
  }));
}

const lines = (text) => String(text || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

/**
 * Read-only exercise information: muscle map, how-to, cues, mistakes, personal notes and your
 * own numbers. Used on the library page and in a dialog during workouts.
 */
export function exerciseInfo(ex) {
  const wrap = h('div', { class: 'ex-info' });
  const { primary, secondary } = musclesFor(ex);
  const tags = [ex.category, ex.equipment, EXERCISE_TYPES[ex.type]?.label.split(' (')[0], ex.weightMode === 'perHand' ? 'Weight per hand' : null, ex.lowerIsBetter ? 'Lower weight is better' : null, ex.archived ? 'Archived' : null].filter(Boolean);
  append(wrap, [
    h('div', { class: 'chips' }, tags.map((t) => h('span', { class: 'chip static' }, t))),
    ex.description ? h('p', null, ex.description) : null,
    h('section', { class: 'card ex-muscles', 'aria-label': 'Muscles worked' },
      h('div', { html: muscleMapSvg(ex) }),
      primary.length || secondary.length ? h('p', { class: 'small mm-legend' },
        primary.length ? h('span', null, h('i', { class: 'mm-key primary' }), ` Primary: ${primary.join(', ')}`) : null,
        secondary.length ? h('span', null, h('i', { class: 'mm-key secondary' }), ` Secondary: ${secondary.join(', ')}`) : null)
        : h('p', { class: 'muted small' }, (ex.muscles || []).includes('Cardiovascular') ? 'Mainly heart and lungs (cardio).' : 'No muscles recorded yet. Add them under Edit.')),
  ]);
  const steps = lines(ex.instructions);
  const cueList = lines(ex.cues);
  const mistakeList = lines(ex.commonMistakes);
  if (steps.length) wrap.append(h('section', { class: 'card' }, h('h2', null, 'How to do it'), h('ol', { class: 'steps' }, steps.map((s) => h('li', null, s)))));
  if (cueList.length || mistakeList.length) {
    wrap.append(h('div', { class: 'ex-two' },
      cueList.length ? h('section', { class: 'card' }, h('h2', null, icon('check'), ' Cues'), h('ul', { class: 'ticks' }, cueList.map((s) => h('li', null, s)))) : null,
      mistakeList.length ? h('section', { class: 'card' }, h('h2', null, icon('warn'), ' Common mistakes'), h('ul', { class: 'crosses' }, mistakeList.map((s) => h('li', null, s)))) : null));
  }
  if (!ex.archived && exercisesNeedingDetails([ex]).length) {
    wrap.append(h('p', { class: 'notice small' }, icon('info'), h('span', null, `Missing: ${missingDetails(ex).join(', ').replace('commonMistakes', 'common mistakes').replace('primaryMuscles', 'main muscles')}. `,
      h('a', { href: `#/coach?section=exercises&ex=${encodeURIComponent(ex.id)}` }, 'Let an AI fill in the details'), ' or add them under Edit.')));
  }
  if (ex.notes) wrap.append(h('section', { class: 'card' }, h('h2', null, 'Your notes'), h('p', { class: 'pre' }, ex.notes)));
  const last = lastPerformance(store.state.sessions, ex.id);
  const rec = computeRecords(store.state.sessions).get(ex.id);
  if (last || rec) {
    const rows = [];
    if (last) rows.push(['Last time', `${fmtDateShort(last.date)}: ${fmtSetsCompact(last.sets, ex.type, ex)}`]);
    for (const k of ['maxWeightKg', 'leastAssistKg', 'bestE1rmKg', 'maxReps', 'longestDistanceKm', 'bestPaceSecPerKm']) if (rec?.[k]) rows.push([RECORD_LABELS[k], formatRecordValue(k, rec[k].value, rec[k], rec)]);
    wrap.append(h('section', { class: 'card' }, h('h2', null, 'Your numbers'), h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))));
  }
  const alts = (ex.alternativeIds || []).map((a) => store.exerciseById(a)).filter(Boolean);
  if (alts.length) wrap.append(h('section', { class: 'card' }, h('h2', null, 'Alternatives'), h('ul', { class: 'mini-list' }, alts.map((a) => h('li', null, h('a', { href: `#/library/${a.id}` }, a.name))))));
  return wrap;
}

/** Exercise editor form. Also used inline from the exercise picker. */
export function exerciseForm(existing, { onSaved, onDeleted, compact = false, presetName = '' } = {}) {
  const ex = existing ? structuredClone(existing) : {
    id: uid('ex'), name: presetName, description: '', category: 'Other', equipment: 'Other', type: 'strength', muscles: [],
    instructions: '', notes: '', alternativeIds: [], defaultRestSec: null, cardioDisplay: null, isActivity: false, archived: false, meta: [], weightMode: 'total', lowerIsBetter: false,
  };
  const form = h('form', { class: 'form', novalidate: true });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = input({ value: ex.name, required: true, maxlength: 80, autofocus: compact ? true : null });
  const type = select(Object.entries(EXERCISE_TYPES).map(([k, v]) => [k, v.label]), ex.type);
  const category = select(CATEGORIES, ex.category);
  const equipment = select(EQUIPMENT, ex.equipment);
  const cardioDisplay = select([['pace', 'Pace (min/km), e.g. running, walking'], ['speed', 'Speed (km/h), e.g. cycling']], ex.cardioDisplay || 'pace');
  const cardioField = field('Show', cardioDisplay);
  const rest = numInput(ex.defaultRestSec, { integer: true, placeholder: 'App default' });
  const weightMode = select(Object.entries(WEIGHT_MODES), ex.weightMode || 'total');
  const increment = numInput(ex.incrementKg, { placeholder: 'auto' });
  let lowerIsBetter = !!ex.lowerIsBetter;
  const weightBox = h('fieldset', { class: 'fieldset' }, h('legend', null, 'Weight'),
    h('div', { class: 'grid-2' },
      field('Weight is entered as', weightMode, { hint: 'Per hand: enter one dumbbell. Volume counts both.' }),
      field('Weight step', increment, { unit: 'kg', hint: 'Used for progression hints. Auto: 2.5 (2 per hand).' })),
    checkbox('Lower weight is better (assisted exercises, e.g. assisted pull-up machine)', lowerIsBetter, (v) => { lowerIsBetter = v; }));
  const desc = textarea(ex.description, { rows: 2, maxlength: 500 });
  const instructions = textarea(ex.instructions, { rows: 5, maxlength: 3000, placeholder: 'One step per line' });
  const cues = textarea(ex.cues, { rows: 3, maxlength: 1500, placeholder: 'One cue per line, e.g. Brace before each rep' });
  const mistakes = textarea(ex.commonMistakes, { rows: 3, maxlength: 1500, placeholder: 'One per line, e.g. Knees caving in' });
  const notes = textarea(ex.notes, { rows: 2, maxlength: 2000, placeholder: 'e.g. seat height 4, handle position' });
  // Muscle level: 'primary' (main target) or 'secondary' (helps). Unlisted = not worked.
  const level = new Map((ex.muscles || []).map((m) => [m, 'secondary']));
  for (const m of ex.primaryMuscles || []) level.set(m, 'primary');
  if (!(ex.primaryMuscles || []).length && ex.muscles?.length) level.set(ex.muscles[0], 'primary');
  const alts = new Set(ex.alternativeIds || []);
  const meta = (ex.meta || []).map((m) => ({ ...m }));
  let isActivity = !!ex.isActivity;

  const syncType = () => {
    cardioField.hidden = type.value !== 'cardio';
    weightBox.hidden = !['strength', 'bodyweight'].includes(type.value);
  };
  type.addEventListener('change', syncType);
  syncType();

  const chipLabel = (m) => `${m}${level.get(m) === 'primary' ? ' · primary' : level.get(m) === 'secondary' ? ' · secondary' : ''}`;
  const muscleChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Muscle groups: tap once for secondary, twice for primary, three times to clear' }, MUSCLES.map((m) => h('button', {
    type: 'button', class: 'chip muscle-chip', dataset: { level: level.get(m) || 'none' }, 'aria-pressed': String(level.has(m)),
    onclick: (e) => {
      const next = { undefined: 'secondary', secondary: 'primary', primary: undefined }[level.get(m)];
      if (next) level.set(m, next); else level.delete(m);
      const b = e.currentTarget;
      b.dataset.level = next || 'none';
      b.setAttribute('aria-pressed', String(!!next));
      b.textContent = chipLabel(m);
    },
  }, chipLabel(m))));

  const altList = h('ul', { class: 'mini-list' });
  const drawAlts = () => {
    altList.replaceChildren(...[...alts].map((aid) => {
      const a = store.exerciseById(aid);
      return h('li', null, h('span', null, a ? a.name : 'Removed exercise'), iconBtn('x', `Remove ${a ? a.name : 'alternative'}`, () => { alts.delete(aid); drawAlts(); }, { size: 'sm' }));
    }));
    if (!alts.size) altList.append(h('li', { class: 'muted small' }, 'None yet. Alternatives are suggested first when you swap an exercise.'));
  };
  drawAlts();

  const metaList = h('div', { class: 'meta-list' });
  const drawMeta = () => {
    metaList.replaceChildren(...meta.map((m, i) => h('div', { class: 'field-row' },
      input({ value: m.key, placeholder: 'Label (e.g. Machine no.)', 'aria-label': 'Custom field label', oninput: (e) => { m.key = e.target.value; } }),
      input({ value: m.value, placeholder: 'Value', 'aria-label': 'Custom field value', oninput: (e) => { m.value = e.target.value; } }),
      iconBtn('trash', 'Remove field', () => { meta.splice(i, 1); drawMeta(); }))));
  };
  drawMeta();

  // append() from ui.js skips null; native form.append() would render the text "null".
  append(form, [
    err,
    field('Name', name),
    h('div', { class: 'grid-2' }, field('Measured as', type), cardioField),
    weightBox,
    h('div', { class: 'grid-2' }, field('Category', category), field('Equipment', equipment)),
    compact ? null : h('fieldset', { class: 'fieldset' }, h('legend', null, 'Muscle groups (optional)'), h('p', { class: 'hint' }, 'Tap once: secondary. Twice: primary (main target). Three times: clear.'), muscleChips),
    field('Default rest', rest, { unit: 'seconds', hint: 'Overrides the app default rest timer for this exercise.' }),
    checkbox('Show in "Log activity" (for outdoor or standalone activities)', isActivity, (v) => { isActivity = v; }),
    compact ? null : field('Short description', desc),
    compact ? null : field('How to do it', instructions, { hint: 'One step per line. Shown as a numbered list.' }),
    compact ? null : field('Cues', cues, { hint: 'Short reminders, one per line.' }),
    compact ? null : field('Common mistakes', mistakes, { hint: 'One per line.' }),
    compact ? null : field('Personal notes', notes, { hint: 'Settings, cues, where it is in your gym.' }),
    compact ? null : h('fieldset', { class: 'fieldset' }, h('legend', null, 'Alternative exercises'), altList,
      btn('Add alternative', async () => {
        const picked = await pickExercise({ title: 'Add alternative', excludeIds: [ex.id, ...alts] });
        if (picked) { alts.add(picked.id); drawAlts(); }
      }, { icon: 'plus', size: 'sm' })),
    compact ? null : h('fieldset', { class: 'fieldset' }, h('legend', null, 'Custom fields (optional)'), metaList,
      btn('Add field', () => { meta.push({ key: '', value: '' }); drawMeta(); }, { icon: 'plus', size: 'sm' })),
  ]);

  const actions = h('div', { class: 'form-actions' });
  actions.append(btn(existing ? 'Save changes' : 'Create exercise', null, { variant: 'primary', type: 'submit' }));
  if (existing && !compact) {
    actions.append(btn(ex.archived ? 'Restore from archive' : 'Archive', async () => {
      const updated = { ...existing, archived: !existing.archived };
      await store.saveExercise(updated);
      toast(updated.archived ? 'Archived. It is hidden from pickers but kept in history.' : 'Restored to the library.');
      navigate(location.hash, { replace: true });
    }, { variant: 'ghost' }));
    actions.append(btn('Delete', async () => {
      const usage = store.exerciseUsage(existing.id);
      const msg = h('div', null,
        h('p', null, `Delete "${existing.name}" from the library?`),
        usage.sessions.length ? h('p', null, `It appears in ${plural(usage.sessions.length, 'recorded session')}. Those records keep their own copy of the name and are not changed.`) : null,
        usage.templates.length ? h('p', null, `It is used in ${plural(usage.templates.length, 'workout template')} (${usage.templates.map((t) => t.name).join(', ')}). Those items will show as removed until you replace them.`) : null,
        h('p', { class: 'muted small' }, 'Tip: Archive hides an exercise without deleting it.'));
      if (await confirmDialog({ title: 'Delete exercise?', message: msg, confirmLabel: 'Delete', danger: true })) {
        await store.deleteExercise(existing.id);
        toast('Exercise deleted.');
        onDeleted?.();
      }
    }, { variant: 'danger' }));
  }
  form.append(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) { err.textContent = 'Please enter a name.'; err.hidden = false; name.focus(); return; }
    const dup = store.state.exercises.find((x) => x.id !== ex.id && x.name.trim().toLowerCase() === n.toLowerCase());
    if (dup) { err.textContent = `An exercise called "${dup.name}" already exists.`; err.hidden = false; name.focus(); return; }
    const restVal = num(rest.value);
    if (rest.value.trim() && (restVal === null || restVal < 0 || restVal > 3600)) { err.textContent = 'Rest must be between 0 and 3600 seconds.'; err.hidden = false; rest.focus(); return; }
    err.hidden = true;
    const saved = await store.saveExercise({
      ...ex,
      name: n,
      type: type.value,
      category: category.value,
      equipment: equipment.value,
      cardioDisplay: type.value === 'cardio' ? cardioDisplay.value : null,
      defaultRestSec: restVal === null ? null : Math.round(restVal),
      weightMode: weightMode.value,
      lowerIsBetter,
      incrementKg: num(increment.value) > 0 ? num(increment.value) : null,
      description: compact ? ex.description : desc.value.trim(),
      instructions: compact ? (ex.instructions || '') : instructions.value.trim(),
      cues: compact ? (ex.cues || '') : cues.value.trim(),
      commonMistakes: compact ? (ex.commonMistakes || '') : mistakes.value.trim(),
      notes: compact ? ex.notes : notes.value.trim(),
      // Primary muscles first, then secondary, in the list order of MUSCLES.
      muscles: compact ? (ex.muscles || []) : [...MUSCLES.filter((m) => level.get(m) === 'primary'), ...MUSCLES.filter((m) => level.get(m) === 'secondary')],
      primaryMuscles: compact ? (ex.primaryMuscles || []) : MUSCLES.filter((m) => level.get(m) === 'primary'),
      alternativeIds: [...alts],
      isActivity,
      meta: meta.filter((m) => m.key.trim()).map((m) => ({ key: m.key.trim(), value: String(m.value || '').trim() })),
    });
    onSaved?.(saved);
  });
  return form;
}

/**
 * Exercise picker dialog. Suggested ids (e.g. alternatives) are listed first.
 * Allows creating a new exercise on the spot. Resolves with an exercise or undefined.
 */
export function pickExercise({ title = 'Choose exercise', suggestedIds = [], excludeIds = [], suggestedLabel = 'Alternatives', filter = null } = {}) {
  return openDialog({
    title,
    wide: true,
    build: (close, body) => {
      const wrap = h('div', { class: 'picker' });
      let mode = 'list';
      const render = () => {
        wrap.replaceChildren();
        if (mode === 'new') {
          wrap.append(exerciseForm(null, { compact: true, presetName: search.value.trim(), onSaved: (ex) => close(ex) }),
            btn('Back to list', () => { mode = 'list'; render(); }, { variant: 'ghost', icon: 'back' }));
          return;
        }
        wrap.append(h('div', { class: 'toolbar' }, search, catSel), listEl,
          btn('Create new exercise', () => { mode = 'new'; render(); }, { icon: 'plus', block: true }));
        draw();
        search.focus();
      };
      const search = input({ type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', class: 'search' });
      let cat = '';
      const catSel = segmented([['', 'All'], ['Legs', 'Legs'], ['Chest', 'Chest'], ['Back', 'Back'], ['Shoulders', 'Shoulders'], ['Arms', 'Arms'], ['Core', 'Core'], ['Cardio', 'Cardio']], '', (v) => {
        cat = v;
        for (const b of catSel.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === (v || 'All')));
        draw();
      }, 'Category filter');
      catSel.classList.add('scroll-x');
      const listEl = h('div', { class: 'picker-list' });
      const exclude = new Set(excludeIds);
      const row = (ex) => h('button', { type: 'button', class: 'pick-row', onclick: () => close(ex) },
        h('span', { class: 'row-main' }, h('strong', null, ex.name), h('span', { class: 'muted small' }, exerciseMeta(ex))), icon('plus'));
      const draw = () => {
        const base = store.exercisesSorted().filter((e) => !exclude.has(e.id) && (!filter || filter(e)));
        const items = filterExercises(base, search.value, cat);
        const sugg = !search.value && !cat ? suggestedIds.map((sid) => store.exerciseById(sid)).filter((e) => e && !e.archived && !exclude.has(e.id)) : [];
        const blocks = [];
        if (sugg.length) blocks.push(h('h3', { class: 'list-label' }, suggestedLabel), ...sugg.map(row), h('h3', { class: 'list-label' }, 'All exercises'));
        blocks.push(...items.map(row));
        if (!items.length) blocks.push(h('p', { class: 'muted small' }, 'No match. Create a new exercise below.'));
        listEl.replaceChildren(...blocks);
      };
      search.addEventListener('input', draw);
      render();
      body.classList.add('picker-body');
      return wrap;
    },
  });
}
