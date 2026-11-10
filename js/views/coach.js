// AI coach: export data + prompt for any LLM, import its proposed changes with a reviewed preview.
// Everything the LLM writes is shown as plain text (never as HTML) and validated before use.

import * as store from '../store.js';
import { h, append, btn, pageHead, field, textarea, select, checkbox, toast, confirmDialog, openDialog, downloadFile, readFileText } from '../ui.js';
import { icon } from '../icons.js';
import { exerciseFileName, buildCoachExport, coachPrompt, coachFileName, extractPlan, reviewPlan, applyPlan, dependenciesOf, dependentsOf, describeItems, buildExerciseExport, exercisePrompt, exercisesNeedingDetails, missingDetails } from '../coach.js';
import { APP_VERSION } from '../version.js';
import { fmtDate, plural, fmtNum } from '../util.js';

const WEEKS = [['4', 'Last 4 weeks'], ['8', 'Last 8 weeks'], ['12', 'Last 12 weeks'], ['26', 'Last 6 months'], ['52', 'Last 12 months'], ['all', 'All history']];
const OP_LABEL = { add: 'New', update: 'Change', archive: 'Archive', remove: 'Remove' };
const ENTITY_LABEL = { exercise: 'Exercise', program: 'Program', template: 'Workout' };

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied. Paste it into your AI chat.`);
  } catch {
    // Clipboard blocked (permissions, older browsers): let the user copy by hand.
    await openDialog({
      title: `Copy ${what.toLowerCase()}`, sheet: false, wide: true,
      build: (close) => {
        const ta = textarea(text, { rows: 12, readonly: true, 'aria-label': what });
        setTimeout(() => { ta.focus(); ta.select(); }, 50);
        return h('div', { class: 'form' }, h('p', { class: 'small' }, 'Copying automatically was blocked. Select all text below and copy it.'), ta,
          h('div', { class: 'dialog-actions' }, btn('Done', () => close(), { variant: 'primary' })));
      },
    });
  }
}

export function renderCoach({ el, rerender, query }) {
  const st = store.state.settings;
  el.append(pageHead('AI coach', { back: '#/progress', kicker: 'Works with any AI chat' }));
  el.append(h('p', { class: 'small narrow' }, 'Get training advice from the AI chat of your choice (ChatGPT, Claude, Gemini…). The app gives it your data and exact instructions, and can import the workout changes it suggests. You review every change first. Your recorded history is never changed.'));

  // ----- 1. Export -----
  const goals = textarea(st.coachGoals || '', { rows: 4, maxlength: 2000, placeholder: 'e.g. Get stronger in squat and bench, 3 sessions a week of about 60 minutes. Sore left shoulder, avoid overhead pressing.' });
  goals.addEventListener('change', () => store.saveSettings({ coachGoals: goals.value.trim() }));
  const weeks = select(WEEKS, '12', { 'aria-label': 'History to include' });
  let includeBody = false;
  const sizeInfo = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const build = () => buildCoachExport(store.snapshotData(), { weeks: weeks.value, includeBody, goals: goals.value, appVersion: APP_VERSION });
  const updateSize = () => {
    const chars = JSON.stringify(build()).length;
    sizeInfo.textContent = `Data: about ${fmtNum(Math.round(chars / 1000), 0)} k characters (roughly ${fmtNum(Math.round(chars / 3800), 0)} k tokens). Most current AI chats handle this; choose a shorter period if yours complains.`;
  };
  weeks.addEventListener('change', updateSize);
  goals.addEventListener('input', updateSize);
  const remember = async (exp) => { await store.saveSettings({ coachGoals: goals.value.trim() }); await rememberExport(exp); };

  el.append(h('section', { class: 'card form narrow', 'aria-labelledby': 'coach-export' },
    h('h2', { id: 'coach-export' }, '1. Training advice'),
    field('Your goals and situation', goals, { hint: 'Saved on this phone and included in the prompt. The more specific, the better the advice.' }),
    field('History to include', weeks),
    checkbox('Include body measurements (body weight, waist…)', false, (v) => { includeBody = v; updateSize(); }),
    sizeInfo,
    h('p', { class: 'notice small' }, icon('info'), h('span', null, 'This sends your training data to the AI service you paste it into. Their privacy terms apply, not this app\'s.')),
    h('div', { class: 'coach-options' },
      h('div', { class: 'coach-option' },
        h('h3', null, 'Option A: one paste'),
        h('p', { class: 'small muted' }, 'Works in any chat app, also on the phone.'),
        btn('Copy prompt with data', async () => { const exp = build(); await remember(exp); await copyText(coachPrompt(exp, { embedData: true }), 'Prompt with data'); }, { variant: 'primary', icon: 'copy', block: true })),
      h('div', { class: 'coach-option' },
        h('h3', null, 'Option B: file + prompt'),
        h('p', { class: 'small muted' }, 'For chats that accept file uploads. Attach the file, then paste the prompt.'),
        btn('Download data file', async () => { const exp = build(); await remember(exp); downloadFile(coachFileName(exp), JSON.stringify(exp, null, 1)); toast('Data file downloaded. Attach it in your AI chat.'); }, { icon: 'download', block: true }),
        btn('Copy prompt', async () => { const exp = build(); await copyText(coachPrompt(exp), 'Prompt'); }, { icon: 'copy', block: true }))),
    h('p', { class: 'muted small' }, 'Then copy the AI\'s whole answer (or save its JSON file) and import it below. If the answer has no JSON block, the AI only gave advice and there is nothing to import.')));
  updateSize();

  // ----- 2. Exercise details -----
  el.append(exerciseDetailsSection(query));

  // ----- 3. Import -----
  const answer = textarea('', { rows: 6, placeholder: 'Paste the AI\'s complete answer here', 'aria-label': 'AI answer' });
  const fileIn = h('input', { type: 'file', accept: '.json,.txt,.md,application/json,text/plain', class: 'sr-only', 'aria-label': 'Choose answer file', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { answer.value = await readFileText(f); check(); } } });
  const result = h('div', { class: 'coach-result' });
  el.append(h('section', { class: 'card form narrow', 'aria-labelledby': 'coach-import' },
    h('h2', { id: 'coach-import' }, '3. Import the AI\'s answer'),
    answer, fileIn,
    h('div', { class: 'form-actions' },
      btn('Check answer', () => check(), { variant: 'primary', icon: 'check' }),
      btn('Choose file…', () => fileIn.click(), { icon: 'upload' })),
    result));

  // ----- 3. Undo -----
  const undoBox = h('div', { class: 'narrow' });
  el.append(undoBox);
  store.getCoachUndo().then((u) => {
    if (!u) return;
    undoBox.append(h('section', { class: 'card', 'aria-labelledby': 'coach-undo' },
      h('h2', { id: 'coach-undo' }, 'Last import'),
      h('p', { class: 'small' }, `Applied ${fmtDate(u.at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`, u.summary ? ` ${u.summary}` : ''),
      btn('Undo last import', async () => {
        const ok = await confirmDialog({
          title: 'Undo last import?',
          message: 'Your exercises, programs and workout templates go back to how they were before the import. Edits you made to them since then are undone too. Your recorded history is not affected.',
          confirmLabel: 'Undo import', danger: true,
        });
        if (!ok) return;
        await store.undoCoachChanges();
        toast('Import undone.');
        rerender();
      }, { icon: 'reset' })));
  });

  function check() {
    result.replaceChildren();
    const ex = extractPlan(answer.value);
    if (!ex.ok) { result.append(h('p', { class: 'form-error', role: 'alert' }, ex.error)); return; }
    const review = reviewPlan(ex.plan, store.snapshotData(), { lastExport: store.state.settings.lastCoachExport, exports: store.state.settings.recentCoachExports });
    if (!review.ok) { result.append(h('ul', { class: 'error-list form-error' }, review.errors.map((e) => h('li', null, e)))); return; }
    renderReview(review);
  }

  function renderReview(review) {
    const selected = new Set(review.changes.filter((c) => c.valid).map((c) => c.key));
    const boxes = new Map();
    const applyBtn = btn('', null, { variant: 'primary', icon: 'check' });
    const sync = () => {
      for (const [k, b] of boxes) b.checked = selected.has(k);
      applyBtn.querySelector('span').textContent = `Apply ${plural(selected.size, 'change')}`;
      applyBtn.disabled = selected.size === 0;
    };
    const exName = (id) => store.exerciseById(id)?.name || review.changes.find((c) => c.ref === id)?.title || id;
    const progName = (id) => store.programById(id)?.name || review.changes.find((c) => c.ref === id)?.title || id;
    const itemsList = (items) => {
      let lastGroup = null;
      return h('ul', { class: 'coach-items' }, describeItems(items, exName).map((d) => {
        const li = h('li', { class: d.group ? (d.group === lastGroup ? 'grouped' : 'grouped first') : '' }, d.text);
        lastGroup = d.group;
        return li;
      }));
    };
    const details = (c) => {
      if (c.entity === 'exercise' && c.op === 'add' && c.after) {
        const a = c.after;
        return h('div', null,
          h('p', { class: 'small' }, [a.type, a.category, a.equipment, (a.muscles || []).join(', ')].filter(Boolean).join(' · ')),
          a.description ? h('p', { class: 'small' }, a.description) : null,
          a.instructions ? h('ol', { class: 'small steps' }, a.instructions.split('\n').filter(Boolean).map((s) => h('li', null, s))) : null);
      }
      if (c.op === 'update' && c.patch && c.entity !== 'template') {
        return h('ul', { class: 'small coach-diff' }, Object.entries(c.patch).map(([k, v]) => {
          const show = (x) => (Array.isArray(x) ? x.map((i) => (k === 'alternativeIds' ? exName(i) : i)).join(', ') : x === null || x === undefined || x === '' ? '—' : String(x));
          const before = show(c.before[k]);
          const after = show(v);
          const long = before.length + after.length > 120;
          return h('li', null, h('strong', null, `${k}: `), long ? h('span', null, h('span', { class: 'muted' }, 'new text: '), after) : h('span', null, h('del', null, before), ' → ', h('ins', null, after)));
        }));
      }
      if (c.entity === 'template' && c.op === 'add' && c.after) {
        return h('div', null, h('p', { class: 'small muted' }, `In program: ${progName(c.after.programId)}`), itemsList(c.after.items));
      }
      if (c.entity === 'template' && c.op === 'update' && c.patch) {
        return h('div', null,
          c.patch.name ? h('p', { class: 'small' }, h('del', null, c.before.name), ' → ', h('ins', null, c.patch.name)) : null,
          c.patch.items ? h('div', { class: 'coach-compare' },
            h('div', null, h('p', { class: 'small muted' }, 'Before'), itemsList(c.before.items)),
            h('div', null, h('p', { class: 'small muted' }, 'After'), itemsList(c.patch.items))) : null,
          c.patch.notes !== undefined ? h('p', { class: 'small' }, `Notes: ${c.patch.notes || '—'}`) : null);
      }
      if (c.entity === 'template' && c.op === 'remove' && c.before) return itemsList(c.before.items);
      return null;
    };

    const group = (entity, title) => {
      const list = review.changes.filter((c) => c.entity === entity);
      if (!list.length) return null;
      return h('section', { class: 'coach-group' }, h('h3', { class: 'list-label' }, `${title} (${list.length})`),
        list.map((c) => {
          const id = `chg-${c.key}`;
          const box = h('input', { type: 'checkbox', id, disabled: !c.valid, checked: selected.has(c.key), onchange: (e) => {
            if (e.target.checked) { selected.add(c.key); for (const d of dependenciesOf(review.changes, c.key)) selected.add(d); }
            else { selected.delete(c.key); for (const d of dependentsOf(review.changes, c.key)) selected.delete(d); }
            sync();
          } });
          boxes.set(c.key, box);
          return h('article', { class: ['coach-change', c.valid ? '' : 'invalid', `op-${c.op}`] },
            h('div', { class: 'coach-change-head' }, box,
              h('label', { for: id },
                h('span', { class: 'badge op' }, OP_LABEL[c.op] || c.op), ' ',
                h('strong', null, c.title), h('span', { class: 'muted small' }, ` · ${ENTITY_LABEL[c.entity]}`))),
            c.reason ? h('p', { class: 'coach-reason small' }, `“${c.reason}”`) : null,
            details(c),
            c.problems.length ? h('ul', { class: 'small coach-problems' }, c.problems.map((p) => h('li', null, icon('warn'), ' ', p))) : null,
            c.notes.length ? h('ul', { class: 'small muted coach-notes' }, c.notes.map((p) => h('li', null, p))) : null);
        }));
    };

    append(result, [
      h('h3', null, 'Proposed changes'),
      review.summary ? h('p', { class: 'coach-summary' }, review.summary) : null,
      review.warnings.length ? h('ul', { class: 'notice small coach-warnings' }, review.warnings.map((w) => h('li', null, w))) : null,
      group('exercise', 'Exercises'), group('program', 'Programs'), group('template', 'Workouts'),
      review.changes.some((c) => !c.valid) ? h('p', { class: 'muted small' }, 'Changes with problems can\'t be applied. Ask the AI to fix them (copy the problem text), or apply the rest.') : null,
      h('div', { class: 'form-actions' }, applyBtn, btn('Cancel', () => result.replaceChildren(), { variant: 'ghost' })),
    ]);
    let applying = false;
    applyBtn.addEventListener('click', async () => {
      if (!selected.size || applying) return;
      applying = true;
      applyBtn.disabled = true;
      const out = applyPlan(store.snapshotData(), review, [...selected]);
      await store.applyCoachChanges(out, review.summary.slice(0, 200));
      toast(`Applied ${plural(out.applied.length, 'change')}${out.skipped.length ? `, skipped ${out.skipped.length}` : ''}. You can undo this import.`, { duration: 6000 });
      answer.value = '';
      rerender();
    });
    sync();
    result.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

const BATCH = 10;

/** Remember an export so answers made from it (even from earlier batches) are recognised. */
async function rememberExport(exp) {
  const prev = store.state.settings.recentCoachExports || [];
  const entry = { id: exp.exportId, at: Date.now() };
  await store.saveSettings({ lastCoachExport: entry, recentCoachExports: [...prev, entry].slice(-20) });
}

const GAP_LABEL = { description: 'description', instructions: 'how-to', muscles: 'muscles', primaryMuscles: 'main muscles', cues: 'cues', commonMistakes: 'mistakes' };

/** Pick exercises and copy a prompt that asks the AI to fill in their details. */
function exerciseDetailsSection(query) {
  const all = store.exercisesSorted();
  const needing = new Set(exercisesNeedingDetails(all).map((e) => e.id));
  const only = query.ex && store.exerciseById(query.ex) ? query.ex : null;
  const selected = new Set(only ? [only] : needing);
  let showAll = !!only && !needing.has(only);
  const listEl = h('ul', { class: 'coach-ex-list' });
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const actionsEl = h('div', { class: 'coach-batches' });
  const draw = () => {
    const shown = all.filter((e) => showAll || needing.has(e.id) || selected.has(e.id));
    listEl.replaceChildren(...shown.map((e) => {
      const id = `exd-${e.id}`;
      const gaps = missingDetails(e);
      return h('li', null,
        h('input', { type: 'checkbox', id, checked: selected.has(e.id), onchange: (ev) => { if (ev.target.checked) selected.add(e.id); else selected.delete(e.id); sync(); } }),
        h('label', { for: id }, h('strong', null, e.name),
          h('span', { class: 'muted small' }, gaps.length ? ` · missing ${gaps.map((g) => GAP_LABEL[g] || g).join(', ')}` : ' · complete')));
    }));
    if (!shown.length) listEl.append(h('li', { class: 'muted small' }, 'All your exercises have details. Tick "Show all exercises" to improve existing ones.'));
    sync();
  };
  // Big selections are split: chat apps cut off long pastes, and an AI cannot write details for
  // dozens of exercises in one answer without hitting its length limit.
  const sync = () => {
    const ids = all.map((e) => e.id).filter((id) => selected.has(id));
    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
    count.textContent = `${plural(selected.size, 'exercise')} selected${batches.length > 1 ? `, sent in ${batches.length} batches of up to ${BATCH}. Import each answer before sending the next batch.` : ''}`;
    actionsEl.replaceChildren(...batches.map((batch, i) => {
      const n = batches.length > 1 ? i + 1 : null;
      const make = async () => { const exp = buildExerciseExport(store.snapshotData(), batch, { appVersion: APP_VERSION }); await rememberExport(exp); return exp; };
      return h('div', { class: 'coach-batch' },
        n ? h('p', { class: 'small' }, h('strong', null, `Batch ${n} of ${batches.length}`), ` · ${batch.map((id) => store.exerciseById(id)?.name).join(', ')}`) : null,
        h('div', { class: 'form-actions' },
          btn(n ? `Copy prompt ${n} with data` : 'Copy prompt with exercises', async () => copyText(exercisePrompt(await make()), 'Prompt with exercises'), { variant: 'primary', icon: 'copy' }),
          btn('Download file', async () => { const exp = await make(); downloadFile(exerciseFileName(exp, n), JSON.stringify(exp, null, 1)); toast('File downloaded. Attach it in your AI chat, then copy the prompt for the file.'); }, { icon: 'download', size: 'sm' }),
          btn('Copy prompt for file', async () => { const exp = buildExerciseExport(store.snapshotData(), batch, { appVersion: APP_VERSION }); await copyText(exercisePrompt(exp, { embedData: false, fileName: exerciseFileName(exp, n) }), 'Prompt'); }, { icon: 'copy', size: 'sm', variant: 'ghost' })));
    }));
  };
  const sec = h('section', { class: 'card form narrow', id: 'coach-exercises', 'aria-labelledby': 'coach-ex-title' },
    h('h2', { id: 'coach-ex-title' }, '2. Fill in exercise details'),
    h('p', { class: 'small' }, 'For exercises you added yourself: the AI writes the description, how-to steps, cues and common mistakes, sets the muscles for the muscle map, and suggests alternatives from your library. You review everything before it is saved.'),
    checkbox('Show all exercises (also complete ones)', showAll, (v) => { showAll = v; draw(); }),
    listEl, count, actionsEl,
    h('p', { class: 'muted small' }, '"Copy prompt with data" works in any chat. If your chat cuts off long pastes, use "Download file", attach it, and paste "Copy prompt for file". Then import the answer in step 3.'));
  draw();
  if (query.section === 'exercises') setTimeout(() => sec.scrollIntoView({ block: 'start' }), 50);
  return sec;
}
