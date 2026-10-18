// Programs and workout templates.

import * as store from '../store.js';
import { h, btn, iconBtn, pageHead, field, input, select, textarea, numInput, toast, confirmDialog, actionSheet, emptyState, checkbox } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../shell.js';
import { startFromTemplate, startEmptyWorkout } from '../actions.js';
import { fieldsForType, GROUP_TYPES } from '../model.js';
import { uid, num, plural, moveItem, fmtNum, fmtDurationWords } from '../util.js';
import { trainTabs, pickExercise } from './library.js';

// ---------- program list ----------

export function renderTrain({ el }) {
  el.append(pageHead('Train', {
    actions: [btn('New program', newProgram, { variant: 'primary', icon: 'plus' })],
  }));
  el.append(trainTabs('programs'));
  const active = store.activeSession();
  el.append(h('div', { class: 'quick-actions' },
    active ? h('a', { class: 'btn btn-primary', href: '#/workout' }, icon('play'), h('span', null, 'Resume workout')) : btn('Empty workout', startEmptyWorkout, { icon: 'plus' }),
    h('a', { class: 'btn btn-secondary', href: '#/activity/new' }, icon('run'), h('span', null, 'Log activity'))));

  const programs = store.programsSorted();
  const current = programs.filter((p) => !p.archived);
  const archived = programs.filter((p) => p.archived);
  if (!programs.length) {
    el.append(emptyState('No programs yet', 'A program holds one or more workout templates, e.g. "Upper / Lower" with two workouts.', btn('Create a program', newProgram, { variant: 'primary', icon: 'plus' }), 'train'));
    return;
  }
  const grid = h('div', { class: 'card-grid' });
  for (const p of current) grid.append(programCard(p));
  el.append(grid);
  if (archived.length) {
    el.append(h('details', { class: 'archived' }, h('summary', null, `Archived programs (${archived.length})`),
      h('div', { class: 'card-grid' }, archived.map(programCard))));
  }
}

function programCard(p) {
  const tpls = store.templatesFor(p.id);
  return h('section', { class: 'card program-card', 'aria-labelledby': `p-${p.id}` },
    h('div', { class: 'card-head' },
      h('h2', { id: `p-${p.id}` }, p.name),
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/train/program/${p.id}` }, icon('edit'), h('span', null, 'Edit'))),
    p.description ? h('p', { class: 'muted small' }, p.description) : null,
    tpls.length ? h('ul', { class: 'list' }, tpls.map((t) => h('li', { class: 'tpl-row' },
      h('a', { class: 'row-main', href: `#/train/template/${t.id}` },
        h('strong', null, t.name),
        h('span', { class: 'muted small' }, templateSummary(t))),
      store.state.settings.simpleLogging
        ? h('a', { class: 'btn btn-primary btn-sm', href: `#/quick?tpl=${t.id}`, 'aria-label': `Log ${t.name}` }, icon('edit'), h('span', null, 'Log'))
        : btn('Start', () => startFromTemplate(t.id), { variant: 'primary', size: 'sm', icon: 'play', ariaLabel: `Start ${t.name}` }))))
      : h('p', { class: 'muted small' }, 'No workouts in this program yet.'),
    btn('Add workout', () => newTemplate(p.id), { variant: 'ghost', size: 'sm', icon: 'plus' }));
}

function templateSummary(t) {
  const items = t.items || [];
  const sets = items.reduce((a, i) => a + (i.sets || 0), 0);
  const groups = (t.groups || []).filter((g) => items.filter((i) => i.groupId === g.id).length > 1).length;
  return [plural(items.length, 'exercise'), plural(sets, 'set'), groups ? plural(groups, 'superset/circuit', 'supersets/circuits') : null].filter(Boolean).join(' · ');
}

async function newProgram() {
  const p = await store.saveProgram({ id: uid('prg'), name: 'New program', description: '', order: store.state.programs.length, archived: false });
  navigate(`#/train/program/${p.id}?new=1`);
}

async function newTemplate(programId) {
  const t = await store.saveTemplate({ id: uid('tpl'), programId, name: `Workout ${String.fromCharCode(65 + store.templatesFor(programId).length)}`, notes: '', order: store.templatesFor(programId).length, items: [], groups: [] });
  navigate(`#/train/template/${t.id}?new=1`);
}

// ---------- program editor ----------

export function renderProgram({ el, params, query, rerender }) {
  const p = store.programById(params[0]);
  if (!p) { el.append(pageHead('Program not found', { back: '#/train' }), emptyState('This program does not exist', null, h('a', { href: '#/train', class: 'btn' }, 'Back'))); return; }
  el.append(pageHead(p.name, { back: '#/train', kicker: 'Program' }));
  const saveState = h('p', { class: 'save-state muted small', 'aria-live': 'polite' }, 'Changes are saved automatically.');
  const name = input({ value: p.name, maxlength: 80, autofocus: query.new ? true : null });
  const desc = textarea(p.description, { rows: 2, maxlength: 1000 });
  const save = async () => {
    const n = name.value.trim();
    if (!n) { saveState.textContent = 'Name cannot be empty.'; return; }
    await store.saveProgram({ ...store.programById(p.id), name: n, description: desc.value.trim() });
    el.querySelector('h1').textContent = n;
    saveState.textContent = 'Saved.';
  };
  name.addEventListener('change', save);
  desc.addEventListener('change', save);
  const tpls = store.templatesFor(p.id);
  const list = h('ul', { class: 'list' });
  tpls.forEach((t, i) => list.append(h('li', { class: 'tpl-row' },
    h('a', { class: 'row-main', href: `#/train/template/${t.id}` }, h('strong', null, t.name), h('span', { class: 'muted small' }, templateSummary(t))),
    h('span', { class: 'row-actions' },
      iconBtn('up', `Move ${t.name} up`, () => reorder(i, -1), { disabled: i === 0 }),
      iconBtn('down', `Move ${t.name} down`, () => reorder(i, 1), { disabled: i === tpls.length - 1 })))));
  async function reorder(i, d) {
    const arr = [...tpls];
    if (!moveItem(arr, i, d)) return;
    arr.forEach((t, idx) => { t.order = idx; });
    await store.saveTemplates(arr);
    rerender();
  }
  if (query.new && name) setTimeout(() => name.select(), 50);
  el.append(h('div', { class: 'narrow' },
    h('section', { class: 'card form' }, field('Program name', name), field('Description', desc), saveState),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Workouts'), btn('Add workout', () => newTemplate(p.id), { size: 'sm', icon: 'plus' })),
      tpls.length ? list : h('p', { class: 'muted' }, 'Add a workout template, e.g. "Upper body" or "Day A".')),
    h('section', { class: 'card' },
      checkbox('Archived (hidden from Home suggestions, kept for history)', !!p.archived, async (v) => { await store.saveProgram({ ...store.programById(p.id), archived: v }); toast(v ? 'Program archived.' : 'Program restored.'); }),
      h('div', { class: 'form-actions' }, btn('Delete program', async () => {
        const ok = await confirmDialog({
          title: 'Delete program?',
          message: `This deletes "${p.name}" and its ${plural(tpls.length, 'workout template')}. Recorded workouts in your history are not affected.`,
          confirmLabel: 'Delete program', danger: true,
        });
        if (ok) { await store.deleteProgram(p.id); toast('Program deleted.'); navigate('#/train', { replace: true }); }
      }, { variant: 'danger' })))));
}

// ---------- template editor ----------

function durationUnit(type) { return type === 'cardio' ? 'min' : 's'; }

export function renderTemplate({ el, params, query, rerender }) {
  const original = store.templateById(params[0]);
  if (!original) { el.append(pageHead('Workout not found', { back: '#/train' }), emptyState('This workout template does not exist', null, h('a', { href: '#/train', class: 'btn' }, 'Back'))); return; }
  const t = structuredClone(original);
  t.items = t.items || [];
  t.groups = t.groups || [];
  const program = store.programById(t.programId);
  const saveState = h('span', { class: 'save-state muted small', 'aria-live': 'polite' }, 'Saved automatically');
  let timer = null;
  const persist = async () => {
    clearTimeout(timer);
    timer = null;
    // drop groups with fewer than two members
    const counts = new Map();
    for (const i of t.items) if (i.groupId) counts.set(i.groupId, (counts.get(i.groupId) || 0) + 1);
    for (const i of t.items) if (i.groupId && (counts.get(i.groupId) || 0) < 2) i.groupId = null;
    t.groups = t.groups.filter((g) => (counts.get(g.id) || 0) >= 2);
    await store.saveTemplate(structuredClone(t));
    saveState.textContent = 'Saved';
  };
  const scheduleSave = () => { saveState.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(persist, 400); };
  const saveNow = async () => { await persist(); rerender(); };

  el.append(pageHead(t.name, {
    back: program ? `#/train/program/${program.id}` : '#/train',
    kicker: program ? program.name : 'Workout template',
    actions: [btn('Start', async () => { await persist(); startFromTemplate(t.id); }, { variant: 'primary', icon: 'play' })],
  }));

  const name = input({ value: t.name, maxlength: 80, autofocus: query.new ? true : null });
  name.addEventListener('input', () => { if (name.value.trim()) { t.name = name.value.trim(); el.querySelector('h1').textContent = t.name; scheduleSave(); } });
  const notes = textarea(t.notes, { rows: 2, maxlength: 2000, placeholder: 'Warm-up, focus for the day…' });
  notes.addEventListener('input', () => { t.notes = notes.value; scheduleSave(); });

  const wrap = h('div', { class: 'narrow' });
  wrap.append(h('section', { class: 'card form' }, field('Workout name', name), field('Notes', notes), saveState));
  wrap.append(h('p', { class: 'muted small' }, 'This is a template: changing it never alters workouts you already recorded. During a workout you can still swap, add, skip or reorder exercises.'));

  const itemsEl = h('div', { class: 'tpl-items' });
  wrap.append(itemsEl);

  // Render items, wrapping contiguous grouped items in a group box.
  let i = 0;
  while (i < t.items.length) {
    const it = t.items[i];
    if (it.groupId) {
      const gid = it.groupId;
      const members = [];
      while (i < t.items.length && t.items[i].groupId === gid) { members.push(i); i++; }
      const g = t.groups.find((x) => x.id === gid) || { id: gid, type: 'superset', restSec: null };
      if (!t.groups.includes(g)) t.groups.push(g);
      itemsEl.append(groupBox(g, members));
    } else {
      itemsEl.append(itemCard(i));
      i++;
    }
  }
  if (!t.items.length) itemsEl.append(emptyState('No exercises yet', 'Add the exercises for this workout. You can group them into supersets or circuits afterwards.', null, 'train'));

  wrap.append(btn('Add exercise', async () => {
    const ex = await pickExercise({ title: 'Add exercise' });
    if (!ex) return;
    t.items.push(newItem(ex));
    await saveNow();
    setTimeout(() => itemsEl.lastElementChild?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, { icon: 'plus', block: true, variant: 'primary' }));

  wrap.append(h('div', { class: 'form-actions' }, btn('Delete workout template', async () => {
    if (await confirmDialog({ title: 'Delete workout template?', message: `Delete "${t.name}"? Recorded workouts are not affected.`, confirmLabel: 'Delete', danger: true })) {
      clearTimeout(timer);
      await store.deleteTemplate(t.id);
      toast('Workout template deleted.');
      navigate(program ? `#/train/program/${program.id}` : '#/train', { replace: true });
    }
  }, { variant: 'danger' })));
  el.append(wrap);

  function groupBox(g, indexes) {
    const type = select(Object.entries(GROUP_TYPES), g.type, { 'aria-label': 'Group type' });
    type.addEventListener('change', () => { g.type = type.value; scheduleSave(); label.textContent = GROUP_TYPES[g.type]; });
    const rest = numInput(g.restSec, { integer: true, placeholder: 'default', 'aria-label': 'Rest after each round in seconds', class: 'w-num' });
    rest.addEventListener('input', () => { const v = num(rest.value); g.restSec = v === null ? null : Math.max(0, Math.round(v)); scheduleSave(); });
    const label = h('strong', null, GROUP_TYPES[g.type]);
    return h('section', { class: 'group-box', 'aria-label': GROUP_TYPES[g.type] },
      h('div', { class: 'group-head' },
        h('span', { class: 'group-tag' }, icon('link'), label),
        h('label', { class: 'inline' }, h('span', { class: 'sr-only' }, 'Type'), type),
        h('label', { class: 'inline' }, h('span', { class: 'small muted' }, 'Rest after round'), rest, h('span', { class: 'small muted' }, 's'))),
      h('p', { class: 'muted small group-help' }, 'Do one set of each exercise in order, then rest. Sets per exercise = number of rounds.'),
      indexes.map((idx) => itemCard(idx, true)));
  }

  function itemCard(idx, inGroup = false) {
    const it = t.items[idx];
    const ex = store.exerciseById(it.exerciseId);
    const type = ex?.type || it.exerciseType || 'strength';
    const fields = fieldsForType(type);
    const exName = ex ? ex.name : `${it.exerciseName || 'Unknown'} (removed from library)`;

    const sets = numInput(it.sets, { integer: true, 'aria-label': 'Sets', class: 'w-num' });
    sets.addEventListener('input', () => { const v = num(sets.value); it.sets = v === null ? 0 : Math.min(50, Math.max(0, Math.round(v))); scheduleSave(); });
    const inputs = [field(inGroup ? 'Rounds' : 'Sets', sets)];
    if (fields.includes('reps')) {
      const reps = numInput(it.reps, { integer: true, class: 'w-num' });
      reps.addEventListener('input', () => { const v = num(reps.value); it.reps = v === null ? null : Math.max(0, Math.round(v)); scheduleSave(); });
      inputs.push(field(it.repsMax ? 'Reps from' : 'Reps', reps));
      const repsMax = numInput(it.repsMax, { integer: true, class: 'w-num', placeholder: 'opt.' });
      repsMax.addEventListener('input', () => { const v = num(repsMax.value); it.repsMax = v === null ? null : Math.max(0, Math.round(v)); scheduleSave(); });
      inputs.push(field('Reps to', repsMax, { hint: 'Range top' }));
    }
    if (fields.includes('weightKg')) {
      const w = numInput(it.weightKg, { class: 'w-num', placeholder: type === 'bodyweight' ? '+0' : '' });
      w.addEventListener('input', () => { const v = num(w.value); it.weightKg = v === null ? null : Math.max(0, v); scheduleSave(); });
      inputs.push(field(type === 'bodyweight' ? 'Added' : 'Weight', w, { unit: 'kg' }));
    }
    if (fields.includes('durationSec')) {
      const unit = durationUnit(type);
      const d = numInput(it.durationSec === null || it.durationSec === undefined ? null : (unit === 'min' ? it.durationSec / 60 : it.durationSec), { class: 'w-num' });
      d.addEventListener('input', () => { const v = num(d.value); it.durationSec = v === null ? null : Math.round(Math.max(0, unit === 'min' ? v * 60 : v)); scheduleSave(); });
      inputs.push(field('Time', d, { unit }));
    }
    if (fields.includes('distanceKm')) {
      const d = numInput(it.distanceKm, { class: 'w-num' });
      d.addEventListener('input', () => { const v = num(d.value); it.distanceKm = v === null ? null : Math.max(0, v); scheduleSave(); });
      inputs.push(field('Distance', d, { unit: 'km' }));
    }
    const rest = numInput(it.restSec, { integer: true, class: 'w-num', placeholder: ex?.defaultRestSec ? String(ex.defaultRestSec) : 'default' });
    rest.addEventListener('input', () => { const v = num(rest.value); it.restSec = v === null ? null : Math.max(0, Math.round(v)); scheduleSave(); });
    if (!inGroup) inputs.push(field('Rest', rest, { unit: 's' }));

    const notes = input({ value: it.notes || '', placeholder: 'Notes, e.g. tempo, seat setting', 'aria-label': `Notes for ${exName}` });
    notes.addEventListener('input', () => { it.notes = notes.value; scheduleSave(); });

    const altIds = it.alternativeIds || [];
    const altChips = h('div', { class: 'chips' },
      altIds.map((aid) => {
        const a = store.exerciseById(aid);
        return h('span', { class: 'chip static' }, a ? a.name : 'Removed', h('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove alternative ${a ? a.name : ''}`, onclick: async () => { it.alternativeIds = altIds.filter((x) => x !== aid); await saveNow(); } }, icon('x')));
      }),
      h('button', {
        type: 'button', class: 'chip add', onclick: async () => {
          const a = await pickExercise({ title: `Alternative for ${exName}`, suggestedIds: ex?.alternativeIds || [], suggestedLabel: 'Library alternatives', excludeIds: [it.exerciseId, ...altIds] });
          if (a) { it.alternativeIds = [...altIds, a.id]; await saveNow(); }
        },
      }, icon('plus'), 'Alternative'));

    const isFirst = idx === 0;
    const isLast = idx === t.items.length - 1;
    const menu = () => actionSheet(exName, [
      { label: 'Change exercise', icon: 'swap', run: async () => { const n = await pickExercise({ title: 'Change exercise', suggestedIds: ex?.alternativeIds || [] }); if (n) { Object.assign(it, { exerciseId: n.id, exerciseName: n.name, exerciseType: n.type }); await saveNow(); } } },
      { label: it.groupId ? 'Remove from group' : 'Link with next as superset', icon: it.groupId ? 'unlink' : 'link', hidden: !it.groupId && isLast, run: async () => { if (it.groupId) unlinkItem(idx); else linkNext(idx, 'superset'); await saveNow(); } },
      { label: 'Link with next as circuit', icon: 'link', hidden: !!it.groupId || isLast, run: async () => { linkNext(idx, 'circuit'); await saveNow(); } },
      { label: 'Add next exercise to this group', icon: 'link', hidden: !it.groupId || isLast || t.items[idx + 1]?.groupId === it.groupId, run: async () => { linkNext(idx); await saveNow(); } },
      { label: 'Duplicate', icon: 'copy', run: async () => { t.items.splice(idx + 1, 0, { ...structuredClone(it), id: uid('it') }); await saveNow(); } },
      { label: 'Remove from workout', icon: 'trash', danger: true, run: async () => { t.items.splice(idx, 1); await saveNow(); toast(`Removed ${exName}.`, { action: { label: 'Undo', run: async () => { t.items.splice(idx, 0, it); await saveNow(); } } }); } },
    ]);

    return h('article', { class: ['card', 'tpl-item', inGroup ? 'in-group' : ''], 'aria-label': exName },
      h('div', { class: 'tpl-item-head' },
        h('div', { class: 'row-main' }, h('strong', null, exName), h('span', { class: 'muted small' }, [ex?.equipment, ex?.category].filter(Boolean).join(' · '))),
        h('div', { class: 'row-actions' },
          iconBtn('up', `Move ${exName} up`, async () => { moveTemplateItem(idx, -1); await saveNow(); }, { disabled: isFirst }),
          iconBtn('down', `Move ${exName} down`, async () => { moveTemplateItem(idx, 1); await saveNow(); }, { disabled: isLast }),
          iconBtn('more', `More actions for ${exName}`, menu))),
      h('div', { class: 'tpl-fields' }, inputs),
      notes,
      altChips,
      planPreview(it, type));
  }

  function planPreview(it, type) {
    const parts = [];
    if (it.sets) parts.push(`${it.sets} ×`);
    if (it.reps) parts.push(it.repsMax > it.reps ? `${it.reps}–${it.repsMax} reps` : `${it.reps} reps`);
    if (it.weightKg) parts.push(`@ ${fmtNum(it.weightKg)} kg`);
    if (it.durationSec) parts.push(fmtDurationWords(it.durationSec));
    if (it.distanceKm) parts.push(`${fmtNum(it.distanceKm)} km`);
    return parts.length > 1 ? h('p', { class: 'plan-preview small muted' }, `Plan: ${parts.join(' ')}${type === 'bodyweight' && it.weightKg ? ' added' : ''}`) : null;
  }

  function newItem(ex) {
    return {
      id: uid('it'), exerciseId: ex.id, exerciseName: ex.name, exerciseType: ex.type, groupId: null,
      sets: ex.type === 'cardio' ? 1 : 3, reps: ['strength', 'bodyweight', 'other'].includes(ex.type) ? 10 : null,
      weightKg: null, durationSec: ex.type === 'timed' ? 30 : ex.type === 'cardio' ? 600 : null, distanceKm: null,
      restSec: null, notes: '', alternativeIds: [],
    };
  }

  // Grouped items move within their group; ungrouped items jump over whole groups.
  function moveTemplateItem(idx, d) {
    const it = t.items[idx];
    if (it.groupId) {
      const j = idx + d;
      if (t.items[j]?.groupId === it.groupId) moveItem(t.items, idx, d);
      return;
    }
    const units = [];
    for (const item of t.items) {
      const last = units[units.length - 1];
      if (item.groupId && last && last[0].groupId === item.groupId) last.push(item); else units.push([item]);
    }
    const ui = units.findIndex((u) => u.includes(it));
    if (moveItem(units, ui, d)) t.items = units.flat();
  }

  function linkNext(idx, type) {
    const a = t.items[idx];
    const b = t.items[idx + 1];
    if (!b) return;
    let gid = a.groupId || b.groupId;
    if (!gid) { gid = uid('grp'); t.groups.push({ id: gid, type: type || 'superset', restSec: null }); }
    // pull in b's whole group if it has one
    const oldB = b.groupId;
    for (const x of t.items) if (x === a || x === b || (oldB && x.groupId === oldB)) x.groupId = gid;
  }

  function unlinkItem(idx) {
    const it = t.items[idx];
    const gid = it.groupId;
    it.groupId = null;
    const lastIdx = t.items.map((x) => x.groupId).lastIndexOf(gid);
    if (lastIdx > idx) { t.items.splice(idx, 1); t.items.splice(lastIdx, 0, it); }
  }

  if (query.new) setTimeout(() => name.select(), 50);
  return () => { if (timer) persist(); };
}
