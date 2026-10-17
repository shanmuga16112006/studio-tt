import { normalizeRows, setClassCc, setClassHod, departmentOf } from './data-model.js';
import { buildModelFromWorkbook, loadWorkbook } from './xlsx-loader.js';
import { DAYS, generateTimetable, regenerateClassTimetable, checkSchedule, firstPeriodRoleBlock } from './scheduler.js';
import { buildExportDocument, downloadPdf, downloadTeacherPdf } from './export.js';
import { renderShell, renderLogin, renderSetup, renderGenerated, renderTeacherTimetable, renderLabTimetable, renderConflictPanel, renderManualPanel } from './ui.js';
import { validateManualReservation } from './manual-periods.js';
import { getSession, login, logout, saveTimetable, listTimetables, getTimetable } from './auth.js';

const state = { model: null, result: null, selectedClass: '', selectedTeacher: '', template: 'class', view: 'class', manualMode: false, mode: 'setup' };
let currentUser = 'Rpsit_admin';
let observerStarted = false;
let savingTimetable = false;
const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const content = () => document.querySelector('#content');
const toast = message => { const region = document.querySelector('#toast-region'); const item = document.createElement('div'); item.className = 'toast'; item.textContent = message; region.append(item); setTimeout(() => item.remove(), 3200); };
const setModel = model => { state.model = model; state.result = null; state.mode = 'setup'; state.selectedClass = model.classes[0] || ''; model.metadata = model.metadata || {}; localStorage.setItem('rpsit-model', JSON.stringify(model)); document.querySelector('#class-selector').innerHTML = model.classes.map(c => `<option value="${c}">${c}</option>`).join(''); document.querySelector('#class-selector').disabled = false; document.querySelector('#class-selector').value = state.selectedClass; content().innerHTML = renderSetup({ ...model, activeClass: state.selectedClass, filename: state.filename }); bindSetup(); toast(`Loaded ${model.classes.length} class${model.classes.length === 1 ? '' : 'es'}. Select a class above to configure and generate it.`); };
const rerenderSetup = () => { content().innerHTML = renderSetup({ ...state.model, activeClass: state.selectedClass, filename: state.filename }); bindSetup(); };
const toggleClassRole = (person, field, className) => { const values = new Set(person[field] || []); if (values.has(className)) values.delete(className); else values.add(className); person[field] = [...values]; };
const todayDDMMYYYY = () => { const now = new Date(); const pad = value => String(value).padStart(2, '0'); return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`; };
const stampEffectiveDate = () => { if (!state.model) return; state.model.metadata = state.model.metadata || {}; state.model.metadata.effectiveDate = todayDDMMYYYY(); };
const bindSetup = () => { document.querySelector('#file-input')?.addEventListener('change', handleFile); document.querySelector('#validate-button')?.addEventListener('click', generate); document.querySelectorAll('.template-option:not(:disabled)').forEach(button => button.addEventListener('click', () => { state.template = button.dataset.template; document.querySelectorAll('.template-option').forEach(x => x.classList.toggle('selected', x === button)); })); document.querySelectorAll('[data-staff-hod]').forEach(button => button.addEventListener('click', () => { const name = button.dataset.staffHod; const person = state.model.teachers[name] || Object.values(state.model.teachers).find(item => item.name === name); if (!person) return; delete person.isHod; const active = setClassHod(state.model.teachers, person, state.selectedClass); state.model.staff = Object.values(state.model.teachers); state.result = null; localStorage.setItem('rpsit-model', JSON.stringify(state.model)); rerenderSetup(); toast(`${name} ${active ? 'is now' : 'is no longer'} HOD for ${departmentOf(state.selectedClass)}.`); })); document.querySelectorAll('[data-staff-cc]').forEach(button => button.addEventListener('click', () => { const name = button.dataset.staffCc; const person = state.model.teachers[name] || Object.values(state.model.teachers).find(item => item.name === name); if (!person) return; const active = setClassCc(state.model.teachers, person, state.selectedClass); state.model.staff = Object.values(state.model.teachers); state.result = null; localStorage.setItem('rpsit-model', JSON.stringify(state.model)); rerenderSetup(); toast(`${name} ${active ? 'is now' : 'is no longer'} CC for ${state.selectedClass}.`); })); document.querySelectorAll('[data-extracurricular]').forEach(input => input.addEventListener('change', () => { const subject = state.model.subjects.find(item => item.id === input.dataset.extracurricular); if (!subject) return; subject.isExtracurricular = input.checked; localStorage.setItem('rpsit-model', JSON.stringify(state.model)); rerenderSetup(); toast(`${subject.name} set as ${input.checked ? 'extracurricular' : 'theory'}.`); })); document.querySelectorAll('[data-lab-day], [data-lab-period]').forEach(select => select.addEventListener('change', () => { const subjectId = select.dataset.labDay || select.dataset.labPeriod; const lab = state.model.labs.find(item => item.subjectId === subjectId); const subject = state.model.subjects.find(item => item.id === subjectId); if (!lab || !subject) return; const daySelect = document.querySelector(`[data-lab-day="${CSS.escape(subjectId)}"]`); const periodSelect = document.querySelector(`[data-lab-period="${CSS.escape(subjectId)}"]`); lab.day = daySelect.value; lab.startPeriod = periodSelect.value ? Number(periodSelect.value) : null; lab.length = subject.labPeriods || lab.length || 2; subject.labDay = lab.day; subject.labStart = lab.startPeriod; localStorage.setItem('rpsit-model', JSON.stringify(state.model)); toast(lab.day && lab.startPeriod ? `${subject.name} fixed to ${lab.day}, Period ${lab.startPeriod}.` : `${subject.name} will be placed automatically.`); })); setViewToggle(state.mode); };
async function handleFile(event) { const file = event.target.files[0]; if (!file) return; const error = document.querySelector('#upload-error'); try { const model = await buildModelFromWorkbook(file); state.filename = file.name; setModel(model); } catch (err) { error.hidden = false; error.textContent = err.validation?.missing?.length ? `Missing columns: ${err.validation.missing.join(', ')}` : err.message; toast('Upload needs attention.'); } }
function selectedSchedule() { return state.result?.schedules?.[state.selectedClass] || Object.values(state.result?.schedules || {})[0]; }
function renderCurrentView() { if (!state.result) { state.mode = 'setup'; content().innerHTML = renderSetup(state.model ? { ...state.model, activeClass: state.selectedClass, filename: state.filename } : null); bindSetup(); setViewToggle('setup'); refreshHistoryIfNeeded(); return; } state.mode = 'generated'; setViewToggle('generated'); if (state.view === 'teacher') { content().innerHTML = renderTeacherTimetable(state.result, state.model, state.selectedTeacher); bindTeacherView(); } else if (state.view === 'lab') content().innerHTML = renderLabTimetable(state.result, state.model, state.selectedClass); else content().innerHTML = renderGenerated(selectedSchedule(), state.model, state.result.diagnostics, state.result.schedules); if (state.view === 'class') bindGenerated(); }
function openView(view) { if (!state.model) { toast('Upload a workbook first.'); return; } if (!state.result) { const result = generateTimetable(state.model); if (returnToManualSelection(result)) return; state.result = result; stampEffectiveDate(); } if (view === 'teacher' && !state.selectedTeacher) state.selectedTeacher = Object.values(state.model.teachers || {})[0]?.name || ''; state.view = view; state.template = view === 'teacher' ? 'teacher' : 'class'; const templateSelector = document.querySelector('#template-selector'); if (templateSelector) templateSelector.value = state.template; document.querySelectorAll('.rail-item').forEach(item => item.classList.toggle('active', item.dataset.view === view)); document.querySelector('h1').textContent = view === 'teacher' ? 'Staff Timetable' : view === 'lab' ? 'Lab Timetable' : 'Class Timetable'; renderCurrentView(); }
function returnToManualSelection(result) {
  const missingItems = result.diagnostics.filter(item => item.rule === 'MANUAL_REQUIRED');
  const missing = [...new Set(missingItems.map(item => item.message))];
  if (!missing.length) return false;
  const classes = [...new Set(missingItems.map(item => item.className).filter(Boolean))];
  state.result = null;
  state.mode = 'setup';
  state.view = 'class';
  content().innerHTML = renderSetup({ ...state.model, activeClass: state.selectedClass, filename: state.filename });
  bindSetup();
  toast(`${missing.length} manual period selection${missing.length === 1 ? '' : 's'} required${classes.length ? ` for ${classes.join(', ')}` : ''}.`);
  setTimeout(() => document.querySelector('.lab-classification, .manual-classification')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  return true;
}
function generateAll() { if (!state.model) return; state.model.settings = { ...(state.model.settings || {}), scheduleSeed: Date.now() }; const result = generateTimetable(state.model); if (returnToManualSelection(result)) return; state.result = result; stampEffectiveDate(); state.view = state.template === 'teacher' ? 'teacher' : 'class'; if (state.view === 'teacher' && !state.selectedTeacher) state.selectedTeacher = Object.values(state.model.teachers || {})[0]?.name || ''; renderCurrentView(); }
function regenerateSelected() { if (!state.model || !state.result || !state.selectedClass) return generateAll(); state.model.settings = { ...(state.model.settings || {}), scheduleSeed: Date.now() }; const previous = state.result; const next = regenerateClassTimetable(state.model, previous, state.selectedClass); const selectedErrors = next.diagnostics.filter(item => item.severity === 'error' && (item.className === state.selectedClass || !item.className)); if (selectedErrors.length === 0 || fixedLabScore(next.schedules[state.selectedClass]) > fixedLabScore(previous.schedules[state.selectedClass])) state.result = { ...next, schedules: { ...previous.schedules, [state.selectedClass]: next.schedules[state.selectedClass] } }; else state.result = previous; state.view = 'class'; renderCurrentView(); }
function regenerateSelectedBest() { if (!state.model || !state.result || !state.selectedClass) return generateAll(); state.model.settings = { ...(state.model.settings || {}), scheduleSeed: Date.now() }; const previous = state.result; const next = regenerateClassTimetable(state.model, previous, state.selectedClass); const selectedErrors = next.diagnostics.filter(item => item.severity === 'error' && (item.className === state.selectedClass || !item.className)); const previousSchedule = previous.schedules[state.selectedClass]; const nextSchedule = next.schedules[state.selectedClass]; const countFilled = schedule => DAYS.reduce((total, day) => total + schedule[day].filter(Boolean).length, 0); const previousFilled = countFilled(previousSchedule); const nextFilled = countFilled(nextSchedule); const previousErrors = previous.diagnostics.filter(item => item.severity === 'error' && (item.className === state.selectedClass || !item.className)).length; const previousFixed = fixedLabScore(previousSchedule); const nextFixed = fixedLabScore(nextSchedule); if (nextFixed > previousFixed || (nextFixed === previousFixed && (nextFilled >= previousFilled || selectedErrors.length < previousErrors))) state.result = { ...next, schedules: { ...previous.schedules, [state.selectedClass]: nextSchedule } }; else state.result = previous; stampEffectiveDate(); state.view = 'class'; renderCurrentView(); }
function generate() { return state.result ? regenerateSelectedBest() : generateAll(); }
const satisfiesFixedLab = (schedule, lab, subject) => {
  const day = lab.day || subject?.labDay || '';
  const rawStart = lab.startPeriod !== null && lab.startPeriod !== undefined && lab.startPeriod !== '' ? lab.startPeriod : (subject?.labStart ?? null);
  const length = Number(lab.length || lab.labPeriods || subject?.labPeriods || 1);
  const cells = (day ? (schedule[day] || []) : DAYS.flatMap(d => schedule[d] || [])).filter(cell => cell?.subjectId === lab.subjectId);
  if (!cells.length || cells.length < length) return false;
  if (day && DAYS.some(d => d !== day && (schedule[d] || []).some(cell => cell?.subjectId === lab.subjectId))) return false;
  const start = Math.min(...cells.map(cell => cell.period));
  if (rawStart != null && rawStart !== '' && start !== Number(rawStart) - 1) return false;
  for (let offset = 0; offset < length; offset++) if (!cells.some(cell => cell.period === start + offset)) return false;
  return true;
};
const fixedLabScore = schedule => {
  if (!state.model) return 0;
  return (state.model.labs || []).filter(lab => {
    const subject = state.model.subjects.find(item => item.id === lab.subjectId);
    return subject && subject.className === state.selectedClass;
  }).filter(lab => satisfiesFixedLab(schedule, lab, state.model.subjects.find(item => item.id === lab.subjectId))).length;
};
function syncManualReservation(subjectId) {
  if (!state.model) return;
  const subject = state.model.subjects.find(item => item.id === subjectId);
  if (!subject) return;
  const kind = subject.labPeriods > 0 ? 'LAB' : String(subject.manualKind || '').toUpperCase();
  if (!kind) return;
  const sName = ((subject.name || '') + ' ' + (subject.code || '') + ' ' + (subject.acronym || '')).toLowerCase();
  const sdcExtra = (sName.includes('sdc') || sName.includes('skill development')) ? (subject.theoryPeriods || subject.placementPeriods || subject.libraryPeriods || 0) : 0;
  const required = Number(subject.labPeriods || subject.placementPeriods || subject.libraryPeriods || subject.theoryPeriods || sdcExtra || 0);
  const key = CSS.escape(subjectId);
  const startDay = document.querySelector(`[data-manual-day="${key}"]`)?.value || document.querySelector(`[data-lab-day="${key}"]`)?.value || '';
  const startPeriod = Number(document.querySelector(`[data-manual-period="${key}"]`)?.value || document.querySelector(`[data-lab-period="${key}"]`)?.value || 0);
  const isLibrary = kind === 'LIBRARY';
  const periodSelects = [...document.querySelectorAll(`[data-manual-period="${key}"][data-manual-index]`)];
  const sharedDay = document.querySelector(`[data-manual-day="${key}"][data-manual-index="0"]`)?.value || '';
  const explicitPeriods = periodSelects.map(node => Number(node.value || 0)).filter(Boolean);
  let slots = [];
  if (sharedDay && explicitPeriods.length === periodSelects.length && periodSelects.length > 1) slots = explicitPeriods.map(period => ({ day: sharedDay, period }));
  else if (startDay && startPeriod) {
    slots = Array.from({ length: required }, (_, offset) => {
      if (isLibrary) return { day: DAYS[(DAYS.indexOf(startDay) + offset + DAYS.length) % DAYS.length], period: startPeriod };
      return { day: startDay, period: startPeriod + offset };
    });
  }
  const reservation = { subjectId, className: subject.className, kind, mode: isLibrary ? 'separate' : 'continuous', session: '', slots };
  const template = { days: DAYS, periods: [...Array.from({ length: 4 }, (_, index) => ({ period_number: index + 1, type: 'TEACHING' })), { period_number: 4.5, type: 'LUNCH' }, ...Array.from({ length: 4 }, (_, index) => ({ period_number: index + 5, type: 'TEACHING' }))] };
  const errors = validateManualReservation(reservation, subject, template);
  if (errors.length) { toast(errors[0]); return; }
  state.model.manualReservations = (state.model.manualReservations || []).filter(item => item.subjectId !== subjectId).concat(reservation);
  if (kind === 'LAB') {
    const lab = state.model.labs.find(item => item.subjectId === subjectId);
    if (lab) { lab.day = slots[0]?.day || ''; lab.startPeriod = slots[0]?.period || null; }
    subject.labDay = slots[0]?.day || '';
    subject.labStart = slots[0]?.period || null;
  }
  localStorage.setItem('rpsit-model', JSON.stringify(state.model));
  toast(`${subject.name} manual periods updated.`);
}

document.addEventListener('change', event => {
  const target = event.target;
  const subjectId = target.dataset.manualDay || target.dataset.manualPeriod;
  if (subjectId) syncManualReservation(subjectId);
});
function saveDocumentDetails() { if (!state.model) return; state.model.metadata = { ...(state.model.metadata || {}), documentId: document.querySelector('#document-id')?.value || '', documentName: document.querySelector('#document-name')?.value || 'Time Table', programme: document.querySelector('#programme')?.value || '', yearSem: document.querySelector('#year-sem')?.value || '', regulation: document.querySelector('#regulation')?.value || '', academicYear: document.querySelector('#academic-year')?.value || '', oddEven: document.querySelector('#odd-even')?.value || '', effectiveDate: document.querySelector('#effective-date')?.value || '', classAdvisor: document.querySelector('#class-advisor')?.value || '' }; }
function bindDocumentDetails() { const fields = { 'document-id': 'documentId', 'document-name': 'documentName', 'programme': 'programme', 'year-sem': 'yearSem', 'regulation': 'regulation', 'academic-year': 'academicYear', 'odd-even': 'oddEven', 'effective-date': 'effectiveDate', 'class-advisor': 'classAdvisor' }; Object.entries(fields).forEach(([id, field]) => { const input = document.querySelector(`#${id}`); if (!input) return; input.addEventListener('input', event => { if (!state.model) return; state.model.metadata = state.model.metadata || {}; state.model.metadata[field] = event.currentTarget.value; localStorage.setItem('rpsit-model', JSON.stringify(state.model)); }); }); }
function bindGenerated() { bindDocumentDetails(); document.querySelector('#save-button')?.addEventListener('click', () => { saveDocumentDetails(); saveCurrentTimetable(); }); document.querySelector('#export-button')?.addEventListener('click', () => { saveDocumentDetails(); downloadPdf(selectedSchedule(), state.model, 'class').catch(error => toast(`PDF export failed: ${error.message}`)); }); document.querySelector('#regenerate-button')?.addEventListener('click', () => { saveDocumentDetails(); generate(); }); document.querySelector('#allocate-button')?.addEventListener('click', () => { saveDocumentDetails(); generate(); toast('Exact subject workloads regenerated; valid empty slots remain empty.'); }); document.querySelector('#manual-button')?.addEventListener('click', () => { state.manualMode = true; document.querySelectorAll('.grid-cell:not(.break-cell)').forEach(cell => cell.classList.add('manual-mode')); toast('Manual mode enabled. Click any cell to edit its subject and teacher.'); }); document.querySelectorAll('.grid-cell:not(.break-cell)').forEach(cell => cell.addEventListener('click', () => { if (!state.manualMode) return; const schedule = selectedSchedule(); const current = schedule[cell.dataset.day][Number(cell.dataset.period)]; document.body.insertAdjacentHTML('beforeend', renderManualPanel(current, cell.dataset.day, Number(cell.dataset.period), state.model, state.selectedClass)); bindManualPanel(); })); document.querySelectorAll('.conflict-cell').forEach(cell => cell.addEventListener('click', () => { if (state.manualMode) return; const diagnostic = state.result.diagnostics.find(d => d.subjectId === cell.dataset.subject && d.day === cell.dataset.day); if (diagnostic) { document.body.insertAdjacentHTML('beforeend', renderConflictPanel(diagnostic)); bindPanel(); } })); }

document.addEventListener('change', event => { const select = event.target.closest('[data-lab-day]'); if (!select || !state.model) return; const subject = state.model.subjects.find(item => item.id === select.dataset.labDay); const lab = (state.model.labs || []).find(item => item.subjectId === select.dataset.labDay); if (!lab && !subject) return; if (lab) lab.day = select.value; if (subject) subject.labDay = select.value; syncManualReservation(select.dataset.labDay); localStorage.setItem('rpsit-model', JSON.stringify(state.model)); toast(`${(lab || subject).acronym || (lab || subject).code || (lab || subject).name} lab fixed to ${select.value || 'Select'}.`); });
document.addEventListener('change', event => { const select = event.target.closest('[data-lab-period]'); if (!select || !state.model) return; const subject = state.model.subjects.find(item => item.id === select.dataset.labPeriod); const lab = (state.model.labs || []).find(item => item.subjectId === select.dataset.labPeriod); if (!lab && !subject) return; const value = select.value ? Number(select.value) : null; if (lab) lab.startPeriod = value; if (subject) subject.labStart = value; syncManualReservation(select.dataset.labPeriod); localStorage.setItem('rpsit-model', JSON.stringify(state.model)); toast(`${(lab || subject).acronym || (lab || subject).code || (lab || subject).name} lab starts at ${value ? `Period ${value}` : 'Select'}.`); });
document.addEventListener('click', event => { if (!event.target.closest('#view-generated-button') || !state.result) return; state.view = 'class'; renderCurrentView(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
function bindTeacherView() { document.querySelector('#teacher-selector')?.addEventListener('change', event => { state.selectedTeacher = event.currentTarget.value; renderCurrentView(); }); document.querySelector('#teacher-export-button')?.addEventListener('click', () => { downloadTeacherPdf(state.result, state.model, state.selectedTeacher).catch(error => toast(`PDF export failed: ${error.message}`)); }); }
function bindManualPanel() { document.querySelectorAll('.manual-panel [data-close-panel]').forEach(button => button.addEventListener('click', () => document.querySelector('.manual-panel')?.remove())); document.querySelector('[data-save-manual]')?.addEventListener('click', event => { const schedule = selectedSchedule(); const day = event.currentTarget.dataset.day; const period = Number(event.currentTarget.dataset.period); const subject = state.model.subjects.find(item => item.id === document.querySelector('#manual-subject')?.value); const teacher = document.querySelector('#manual-teacher')?.value; if (schedule?.[day] && subject && teacher) { const roleBlock = period === 0 ? firstPeriodRoleBlock(state.model, teacher, state.selectedClass, day) : null; if (roleBlock) { toast(roleBlock.message); return; } const kind = subject.labPeriods > 0 ? 'LAB' : String(subject.manualKind || '').toUpperCase(); schedule[day][period] = { subjectId: subject.id, subjectCode: subject.code, acronym: subject.acronym, subjectName: subject.name, teacher, period, lab: subject.labPeriods > 0, manual: Boolean(kind), kind: subject.labPeriods > 0 ? 'lab' : subject.manualKind || (subject.isExtracurricular ? 'activity' : 'theory') }; if (kind) { const previous = (state.model.manualReservations || []).find(item => item.subjectId === subject.id); const slots = [...(previous?.slots || []).filter(slot => !(slot.day === day && Number(slot.period) === period + 1)), { day, period: period + 1 }]; state.model.manualReservations = (state.model.manualReservations || []).filter(item => item.subjectId !== subject.id).concat({ subjectId: subject.id, className: subject.className, kind, mode: kind === 'LAB' ? 'continuous' : previous?.mode || 'separate', slots }); localStorage.setItem('rpsit-model', JSON.stringify(state.model)); } } const otherDiagnostics = (state.result.diagnostics || []).filter(item => item.className && item.className !== state.selectedClass); state.result.diagnostics = [...otherDiagnostics, ...checkSchedule(schedule, state.model)]; document.querySelector('.manual-panel')?.remove(); state.manualMode = false; content().innerHTML = renderGenerated(schedule, state.model, state.result.diagnostics, state.result.schedules); bindGenerated(); toast('Subject and teacher updated for this period.'); }); }
function bindPanel() { document.querySelector('[data-close-panel]')?.addEventListener('click', () => document.querySelector('.conflict-panel')?.remove()); document.querySelector('[data-approve-conflict]')?.addEventListener('click', () => { document.querySelector('.conflict-panel')?.remove(); toast('Suggested swap applied. Regenerate to recalculate diagnostics.'); }); document.querySelector('[data-reject-conflict]')?.addEventListener('click', () => document.querySelector('.conflict-panel')?.remove()); }
function showHome() { state.mode = 'setup'; content().innerHTML = renderSetup(state.model ? { ...state.model, activeClass: state.selectedClass, filename: state.filename } : null); if (state.result) document.querySelector('.action-card')?.insertAdjacentHTML('afterbegin', '<button id="view-generated-button" class="button secondary">View Current Timetable</button>'); bindSetup(); setViewToggle('setup'); refreshHistoryIfNeeded(); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => document.querySelector('.upload-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
function init() { document.querySelector('#app').innerHTML = renderShell(currentUser); content().innerHTML = renderSetup(); bindSetup(); bindShellControls(); document.querySelector('#class-selector').addEventListener('change', e => { const previousClass = state.selectedClass; if (document.querySelector('#document-id')) saveDocumentDetails(); state.selectedClass = e.target.value; const programme = (state.model && state.model.metadata && state.model.metadata.programme) || ''; if (state.model && (!programme || programme === previousClass)) state.model.metadata.programme = state.selectedClass; if (state.mode === 'setup') rerenderSetup(); else { state.view = 'class'; renderCurrentView(); } }); document.querySelector('#template-selector').addEventListener('change', e => { state.template = e.target.value; if (state.result) openView(state.template); }); document.querySelector('.rail-home').addEventListener('click', showHome); document.querySelector('.rail-menu').addEventListener('click', showHome); document.querySelectorAll('.rail-item').forEach(item => item.addEventListener('click', () => openView(item.dataset.view))); }
document.querySelector('[data-view="lab"]')?.remove();

function decorateReviewDiagnostics() { const card = document.querySelector('.insight-grid .insight:nth-child(2)'); if (!card || card.querySelector('.manual-review-list') || !state.result) return; const schedule = selectedSchedule(); const empty = DAYS.flatMap(day => (schedule[day] || []).map((cell, period) => cell ? null : `${day} · Period ${period + 1}`).filter(Boolean)); const subjects = state.result.diagnostics.filter(item => item.severity === 'error' && (item.className === state.selectedClass || !item.className)).map(item => state.model.subjects.find(subject => subject.id === item.subjectId)?.name || item.subjectId || item.message).filter(Boolean); const list = document.createElement('div'); list.className = 'manual-review-list'; const heading = document.createElement('strong'); heading.textContent = 'Manual review'; list.append(heading); [...new Set(empty)].forEach(slot => { const row = document.createElement('div'); row.textContent = `${slot} — Empty period; select a subject manually.`; list.append(row); }); [...new Set(subjects)].forEach(subject => { const row = document.createElement('div'); row.textContent = `Subject: ${subject} — Review or place manually.`; list.append(row); }); if (!empty.length && !subjects.length) { const row = document.createElement('div'); row.textContent = 'No empty periods or unresolved subjects.'; list.append(row); } card.append(list); }
function decorateReviewDiagnosticsV2() { const card = document.querySelector('.insight-grid .insight:nth-child(2)'); if (!card || card.querySelector('.manual-review-list') || !state.result) return; const schedule = selectedSchedule(); const empty = DAYS.flatMap(day => (schedule[day] || []).map((cell, period) => cell ? null : `${day} · Period ${period + 1}`).filter(Boolean)); const classSubjects = state.model.subjects.filter(subject => subject.className === state.selectedClass && subject.theoryPeriods + subject.labPeriods > 0); const diagnostics = state.result.diagnostics.filter(item => item.severity === 'error' && (item.className === state.selectedClass || !item.className)); const rows = []; for (const subject of classSubjects) { const required = subject.theoryPeriods + subject.labPeriods; const placed = DAYS.reduce((total, day) => total + (schedule[day] || []).filter(cell => cell?.subjectId === subject.id).length, 0); const subjectDiagnostics = diagnostics.filter(item => item.subjectId === subject.id); const missing = required - placed; if (missing > 0 || subjectDiagnostics.length) { const reason = subjectDiagnostics[0]?.message || 'No rule-compliant slot was available because of the active timetable constraints.'; rows.push(`Subject: ${subject.name} — ${missing > 0 ? `${missing} hour${missing === 1 ? '' : 's'} missing. ` : ''}${reason}`); } } const list = document.createElement('div'); list.className = 'manual-review-list'; const heading = document.createElement('strong'); heading.textContent = 'Manual review'; list.append(heading); empty.forEach(slot => { const row = document.createElement('div'); row.textContent = `${slot} — Empty period; select a subject manually.`; list.append(row); }); [...new Set(rows)].forEach(message => { const row = document.createElement('div'); row.textContent = message; list.append(row); }); if (!empty.length && !rows.length) { const row = document.createElement('div'); row.textContent = 'No empty periods or unresolved subjects.'; list.append(row); } card.append(list); }
const reviewObserver = new MutationObserver(decorateReviewDiagnosticsV2);
function startReviewObserver() { const node = content(); if (!node) return; reviewObserver.disconnect(); reviewObserver.observe(node, { childList: true, subtree: true }); observerStarted = true; }

// ---------------------------------------------------------------------------
// Authentication, view toggle, save/export separation, and saved history
// ---------------------------------------------------------------------------
function setViewToggle(mode) {
  const dashboard = document.querySelector('#toggle-dashboard');
  const timetable = document.querySelector('#toggle-timetable');
  if (!dashboard || !timetable) return;
  dashboard.classList.toggle('active', mode === 'setup');
  timetable.classList.toggle('active', mode === 'generated');
  dashboard.setAttribute('aria-selected', String(mode === 'setup'));
  timetable.setAttribute('aria-selected', String(mode === 'generated'));
}

function bindShellControls() {
  document.querySelector('#logout-button')?.addEventListener('click', handleLogout);
  document.querySelector('[data-history-open]')?.addEventListener('click', toggleHistoryDrawer);
  document.querySelector('#history-drawer-close')?.addEventListener('click', () => setHistoryDrawer(false));
  document.querySelector('#toggle-dashboard')?.addEventListener('click', () => showHome());
  document.querySelector('#toggle-timetable')?.addEventListener('click', () => {
    if (!state.result) { toast('Generate or open a timetable first.'); return; }
    state.view = 'class';
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function handleLogout() {
  try { await logout(); } catch { /* logout should never block the user */ }
  showLogin();
}

function showLogin(message = '') {
  document.querySelector('#app').innerHTML = renderLogin();
  bindLogin(message);
}

function bindLogin(message) {
  const form = document.querySelector('#login-form');
  const errorBox = document.querySelector('#login-error');
  const button = document.querySelector('#login-button');
  const passwordInput = document.querySelector('#login-password');
  if (!form || !errorBox || !button || !passwordInput) return;
  if (message) { errorBox.hidden = false; errorBox.textContent = message; }
  let submitting = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const password = passwordInput.value;
    if (!password) { errorBox.hidden = false; errorBox.textContent = 'Enter the password.'; return; }
    submitting = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    errorBox.hidden = true;
    try {
      const result = await login(document.querySelector('#login-username').value, password);
      currentUser = result.username || 'Rpsit_admin';
      startApp();
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message || 'Invalid username or password. Please try again.';
      passwordInput.value = '';
      passwordInput.focus();
    } finally {
      submitting = false;
      button.disabled = false;
      button.textContent = 'Login';
    }
  });
  passwordInput.focus();
}

function startApp() {
  init();
  startReviewObserver();
}

async function bootstrap() {
  try {
    const session = await getSession();
    if (session && session.authenticated) {
      currentUser = session.username || 'Rpsit_admin';
      startApp();
      return;
    }
    showLogin();
  } catch (error) {
    const offline = !error.status;
    showLogin(offline
      ? 'Cannot reach the server. Start the Flask server (python server.py) and reload.'
      : error.message);
  }
}

// ------------------------------------------------------------------ history
function toggleHistory() {
  const panel = document.querySelector('#history-panel');
  const button = document.querySelector('#history-toggle');
  if (!panel || !button) return;
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  button.textContent = willOpen ? 'Hide Previously Generated Timetables' : 'Previously Generated Timetables';
  if (willOpen) loadHistory();
}

function refreshHistoryIfNeeded() {
  const panel = document.querySelector('#history-panel');
  if (!panel || !state.historyDirty) return;
  state.historyDirty = false;
  panel.hidden = false;
  const button = document.querySelector('#history-toggle');
  if (button) { button.setAttribute('aria-expanded', 'true'); button.textContent = 'Hide Previously Generated Timetables'; }
  loadHistory();
}

function historyTargets() {
  return [
    { status: document.querySelector('#history-status'), list: document.querySelector('#history-list') },
    { status: document.querySelector('#history-drawer-status'), list: document.querySelector('#history-drawer-list') }
  ].filter(target => target.status && target.list);
}

async function loadHistory() {
  const targets = historyTargets();
  if (!targets.length) return;
  targets.forEach(({ status, list }) => { status.hidden = false; status.textContent = 'Loading saved timetables…'; list.innerHTML = ''; });
  try {
    const data = await listTimetables();
    renderHistoryInto(targets, (data && data.timetables) || []);
  } catch (error) {
    if (error.status === 401) { showLogin('Your session expired. Please log in again.'); return; }
    targets.forEach(({ status }) => { status.hidden = false; status.textContent = `Could not load saved timetables: ${error.message}`; });
  }
}

function renderHistoryInto(targets, records) {
  targets.forEach(({ status, list }) => {
    if (!records.length) {
      status.hidden = false;
      status.textContent = 'No saved timetables yet. Generate a timetable and choose “Save Timetable”.';
      list.innerHTML = '';
      return;
    }
    status.hidden = true;
    list.innerHTML = records.map(record => `<div class="history-row"><div class="history-info"><strong>${escHtml(record.name)}</strong><small>${escHtml(record.class_name || '—')} · ${escHtml(formatDate(record.created_at))}</small></div><div class="history-actions"><button class="button secondary" data-history-view="${escHtml(record.id)}">View</button><button class="button ghost" data-history-export="${escHtml(record.id)}">Export PDF</button></div></div>`).join('');
  });
}

function setHistoryDrawer(open) {
  const drawer = document.querySelector('#history-drawer');
  if (!drawer) return;
  const trigger = document.querySelector('[data-history-open]');
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  if (trigger) {
    trigger.classList.toggle('active', open);
    trigger.setAttribute('aria-expanded', String(open));
  }
  if (open) loadHistory();
}

function toggleHistoryDrawer() {
  const drawer = document.querySelector('#history-drawer');
  if (!drawer) return;
  setHistoryDrawer(!drawer.classList.contains('open'));
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
}

async function openSavedTimetable(id) {
  try {
    const record = await getTimetable(id);
    const payload = record.payload;
    if (!payload || !payload.model || !payload.result) { toast('This saved timetable is corrupted or incomplete.'); return; }
    state.model = payload.model;
    state.result = payload.result;
    state.template = payload.template || record.template || 'class';
    state.view = state.template === 'teacher' ? 'teacher' : 'class';
    state.selectedClass = payload.selectedClass || record.class_name || (state.model.classes && state.model.classes[0]) || '';
    state.filename = payload.filename || state.filename;
    state.mode = 'generated';
    localStorage.setItem('rpsit-model', JSON.stringify(state.model));
    const selector = document.querySelector('#class-selector');
    if (selector && state.model.classes) {
      selector.innerHTML = state.model.classes.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
      selector.disabled = false;
      selector.value = state.selectedClass;
    }
    const templateSelector = document.querySelector('#template-selector');
    if (templateSelector) templateSelector.value = state.template;
    document.querySelectorAll('.rail-item').forEach(item => item.classList.toggle('active', item.dataset.view === state.view));
    document.querySelector('h1').textContent = state.view === 'teacher' ? 'Staff Timetable' : 'Class Timetable';
    renderCurrentView();
    setHistoryDrawer(false);
    toast(`Opened “${record.name}”.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    if (error.status === 401) { showLogin('Your session expired. Please log in again.'); return; }
    toast(error.status === 404 ? 'Saved timetable not found.' : `Could not open timetable: ${error.message}`);
  }
}

async function exportSavedTimetable(id) {
  try {
    const record = await getTimetable(id);
    const payload = record.payload || {};
    const schedules = payload.result && payload.result.schedules;
    if (!payload.model || !schedules) { toast('This saved timetable has no exportable contents.'); return; }
    const className = payload.selectedClass || record.class_name || Object.keys(schedules)[0];
    const schedule = schedules[className] || Object.values(schedules)[0];
    if (!schedule) { toast('This saved timetable has no class schedule to export.'); return; }
    await downloadPdf(schedule, payload.model, 'class');
  } catch (error) {
    if (error.status === 401) { showLogin('Your session expired. Please log in again.'); return; }
    toast(`PDF export failed: ${error.message}`);
  }
}

async function saveCurrentTimetable() {
  if (savingTimetable) return;
  if (!state.result || !state.model) { toast('Generate or open a timetable before saving.'); return; }
  saveDocumentDetails();
  const schedule = selectedSchedule();
  const className = state.selectedClass || (schedule && schedule.className) || '';
  const baseName = (state.model.metadata && state.model.metadata.documentName) || 'Time Table';
  const name = className ? `${baseName} · ${className}` : baseName;
  const payload = { model: state.model, result: state.result, template: state.template, selectedClass: className, filename: state.filename };
  const button = document.querySelector('#save-button');
  savingTimetable = true;
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    const record = await saveTimetable({ name, class_name: className, template: state.template, payload });
    toast(record.duplicate ? 'This timetable is already saved.' : `Saved “${name}”.`);
    state.historyDirty = true;
    const panel = document.querySelector('#history-panel');
    const drawer = document.querySelector('#history-drawer');
    if ((panel && !panel.hidden) || (drawer && drawer.classList.contains('open'))) { state.historyDirty = false; loadHistory(); }
  } catch (error) {
    if (error.status === 401) { showLogin('Your session expired. Please log in again.'); return; }
    toast(`Save failed: ${error.message}`);
  } finally {
    savingTimetable = false;
    if (button) { button.disabled = false; button.textContent = 'Save Timetable'; }
  }
}

document.addEventListener('click', event => {
  if (event.target.closest('#history-toggle')) { toggleHistory(); return; }
  const viewId = event.target.closest('[data-history-view]');
  if (viewId) { openSavedTimetable(viewId.dataset.historyView); return; }
  const exportId = event.target.closest('[data-history-export]');
  if (exportId) { exportSavedTimetable(exportId.dataset.historyExport); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setHistoryDrawer(false);
});

bootstrap();
