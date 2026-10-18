// Exercise library: list, editor and the reusable exercise picker.

import * as store from '../store.js';
import { h, append, btn, iconBtn, pageHead, field, input, select, textarea, numInput, checkbox, toast, confirmDialog, openDialog, emptyState, segmented } from '../ui.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../shell.js';
import { EXERCISE_TYPES, CATEGORIES, EQUIPMENT, MUSCLES, WEIGHT_MODES } from '../model.js';
import { uid, num, plural } from '../util.js';

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
  el.append(pageHead('Exercises', {
    actions: [h('a', { class: 'btn btn-primary', href: '#/library/new' }, icon('plus'), h('span', null, 'New'))],
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
  detail.append(exerciseForm(existing, {
    onSaved: (ex) => { toast('Exercise saved.'); navigate(`#/library/${ex.id}`, { replace: true }); },
    onDeleted: () => navigate('#/library', { replace: true }),
  }));
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
  const instructions = textarea(ex.instructions, { rows: 3, maxlength: 2000 });
  const notes = textarea(ex.notes, { rows: 2, maxlength: 2000, placeholder: 'e.g. seat height 4, handle position' });
  const muscles = new Set(ex.muscles || []);
  const alts = new Set(ex.alternativeIds || []);
  const meta = (ex.meta || []).map((m) => ({ ...m }));
  let isActivity = !!ex.isActivity;

  const syncType = () => {
    cardioField.hidden = type.value !== 'cardio';
    weightBox.hidden = !['strength', 'bodyweight'].includes(type.value);
  };
  type.addEventListener('change', syncType);
  syncType();

  const muscleChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Muscle groups' }, MUSCLES.map((m) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(muscles.has(m)),
    onclick: (e) => { if (muscles.has(m)) muscles.delete(m); else muscles.add(m); e.currentTarget.setAttribute('aria-pressed', String(muscles.has(m))); },
  }, m)));

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
    compact ? null : h('fieldset', { class: 'fieldset' }, h('legend', null, 'Muscle groups (optional)'), muscleChips),
    field('Default rest', rest, { unit: 'seconds', hint: 'Overrides the app default rest timer for this exercise.' }),
    checkbox('Show in "Log activity" (for outdoor or standalone activities)', isActivity, (v) => { isActivity = v; }),
    compact ? null : field('Short description', desc),
    compact ? null : field('Instructions', instructions),
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
      instructions: compact ? ex.instructions : instructions.value.trim(),
      notes: compact ? ex.notes : notes.value.trim(),
      muscles: [...muscles],
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
