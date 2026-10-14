import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRows, validateRows, classAdvisorFor, setClassCc, setClassHod, departmentOf } from '../src/data-model.js';
import { validateManualReservation } from '../src/manual-periods.js';

test('normalizes the supplied section-marker workbook format', () => {
  const rows = [
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan / AI&DS', '4+2'],
    ['CSE'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['OS', '24CS301T', 'Operating Systems', 'Dr. Rao / CSE', 4]
  ];
  const result = normalizeRows(rows);
  assert.deepEqual(result.classes, ['AIDS', 'CSE']);
  assert.equal(result.subjects[0].className, 'AIDS');
  assert.equal(result.subjects[0].theoryPeriods, 4);
  assert.equal(result.subjects[0].labPeriods, 2);
});

const template = {
  days: ['MON', 'TUE', 'WED'],
  periods: [
    { period_number: 1, type: 'TEACHING' }, { period_number: 2, type: 'TEACHING' },
    { period_number: 3, type: 'TEACHING' }, { period_number: 4, type: 'TEACHING' },
    { period_number: 5, type: 'LUNCH' }, { period_number: 6, type: 'TEACHING' },
    { period_number: 7, type: 'TEACHING' }, { period_number: 8, type: 'TEACHING' },
  ],
};

test('validates a continuous lab block and lunch-side selection', () => {
  const subject = { id: 'LAB', labPeriods: 2 };
  assert.deepEqual(validateManualReservation({ subjectId: 'LAB', kind: 'LAB', day: 'MON', periodNumbers: [1, 2], mode: 'continuous', session: 'before_lunch' }, subject, template), []);
  assert.match(validateManualReservation({ subjectId: 'LAB', kind: 'LAB', day: 'MON', periodNumbers: [4, 6], mode: 'continuous', session: 'before_lunch' }, subject, template).join(' '), /consecutive|before lunch/i);
});

test('validates separate placement/library periods independently', () => {
  const subject = { id: 'LIB', theoryPeriods: 3 };
  assert.deepEqual(validateManualReservation({ subjectId: 'LIB', kind: 'LIBRARY', slots: [{ day: 'MON', period: 7 }, { day: 'TUE', period: 6 }, { day: 'WED', period: 3 }], mode: 'separate' }, subject, template), []);
  assert.match(validateManualReservation({ subjectId: 'LIB', kind: 'LIBRARY', slots: [{ day: 'MON', period: 7 }, { day: 'MON', period: 7 }, { day: 'WED', period: 3 }], mode: 'separate' }, subject, template).join(' '), /exactly|duplicate|different days/i);
});

test('blocks Library in Period 1 and Period 2 and never forces it continuous', () => {
  const subject = { id: 'LIB', libraryPeriods: 3 };
  assert.match(validateManualReservation({ subjectId: 'LIB', kind: 'LIBRARY', slots: [{ day: 'MON', period: 1 }, { day: 'TUE', period: 6 }, { day: 'WED', period: 3 }], mode: 'separate' }, subject, template).join(' '), /Period 1 or Period 2/);
  assert.match(validateManualReservation({ subjectId: 'LIB', kind: 'LIBRARY', slots: [{ day: 'MON', period: 2 }, { day: 'TUE', period: 6 }, { day: 'WED', period: 3 }], mode: 'separate' }, subject, template).join(' '), /Period 1 or Period 2/);
  assert.deepEqual(validateManualReservation({ subjectId: 'LIB', kind: 'LIBRARY', mode: 'continuous', slots: [{ day: 'MON', period: 6 }, { day: 'TUE', period: 3 }, { day: 'WED', period: 7 }], requiredPeriods: 3 }, subject, template), []);
});

test('treats padded one-cell class headings as class markers, not subjects', () => {
  const result = normalizeRows([
    ['AIDS', '', '', '', '', ''],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', ''],
    ['M', 'M1', 'Math', 'Dr. Saranya, Professor / Maths', 4, ''],
    ['', '', '', '', '', ''],
    ['     CSE', '', '', '', '', '']
  ]);
  assert.deepEqual(result.classes, ['AIDS', 'CSE']);
  assert.equal(result.subjects.length, 1);
  assert.equal(result.subjects.some(subject => subject.acronym === 'CSE'), false);
});

test('validates required canonical columns and reports missing fields', () => {
  const result = validateRows([['Teacher Name', 'Subject Name'], ['T', 'S']]);
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('Subject Code'));
  assert.ok(result.missing.includes('Class Name'));
  assert.ok(result.missing.includes('Periods Required'));
});

test('preserves input-sheet lab block fields for the scheduler', () => {
  const rows = [
    ['Teacher Name', 'Subject Name', 'Subject Code', 'Class Name', 'Periods Required', 'Lab Day', 'Lab Start', 'Lab Length'],
    ['T1', 'Programming Lab', 'L1', 'AIDS', '0+2', 'MON', 5, 2]
  ];
  const result = normalizeRows(rows);
  assert.equal(result.labs[0].subjectId, result.subjects[0].id);
  assert.deepEqual({ day: result.labs[0].day, startPeriod: result.labs[0].startPeriod, length: result.labs[0].length }, { day: 'MON', startPeriod: 5, length: 2 });
});

test('extracts only faculty names, excluding role and department text', () => {
  const rows = [
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['M', 'M1', 'Math', 'Dr. V. Saranya, Professor / Maths', 4],
    ['DB', 'D1', 'Database', 'Mr. G. Kannan, ASP / AI&DS', 4],
    ['MC', 'MC1', 'Mentor', 'Mr. G. Kannan, ASP / AI&DS; Mrs. M. Srimathi, AP / AI&DS', 1]
  ];
  const result = normalizeRows(rows);
  assert.deepEqual(Object.keys(result.teachers).sort(), ['Dr. V. Saranya', 'Mr. G. Kannan', 'Mrs. M. Srimathi']);
  assert.equal(result.staff.some(person => /Professor|ASP|AI&DS|Maths|Placement Coordinator/.test(person.name)), false);
});

test('treats a lab-named single workload as continuous lab hours', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['AIT LAB', '24AD304P', 'Artificial Intelligence Techniques Laboratory', 'G. Kannan, ASP / AI&DS', 2]
  ]);
  assert.equal(result.subjects[0].theoryPeriods, 0);
  assert.equal(result.subjects[0].labPeriods, 2);
  assert.equal(result.labs[0].length, 2);
});

test('accepts plural Lab Days markers and normalizes full day names', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Days'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan, ASP / AI&DS', '4+2', 'Monday']
  ]);
  assert.equal(result.subjects[0].labDay, 'MON');
  assert.equal(result.labs[0].day, 'MON');
});

test('reports the imported weekly workload total without counting separator rows', () => {
  const result = normalizeRows([
    ['AIDS'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods'],
    ['M', 'M1', 'Math', 'Dr. Saranya', 4],
    ['', '', '', '', 3],
    ['CSE', '', '', '', '']
  ]);
  assert.equal(result.weeklyHours, 4);
});

test('keeps every section in the input data as its own class', () => {
  const result = normalizeRows([
    ['AIDS(A)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'MON', 3],
    ['AIDS(B)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'TUE', 5],
    ['AIDS(C)'],
    ['Acronym', 'Subject Code', 'Subject Name', 'Faculty Member', 'periods', 'Lab Day', 'Lab Start'],
    ['DDM', '24AD301TP', 'Database Design', 'Mr. Kannan', '4+2', 'FRI', 7]
  ]);
  assert.deepEqual(result.classes, ['AIDS(A)', 'AIDS(B)', 'AIDS(C)']);
  assert.equal(result.subjects.length, 3);
  assert.ok(result.subjects.every(subject => subject.className !== subject.acronym), 'section markers must never be parsed as subject rows');
  assert.deepEqual(result.subjects.map(subject => subject.className), ['AIDS(A)', 'AIDS(B)', 'AIDS(C)']);
  assert.deepEqual(result.subjects.map(subject => subject.id), result.labs.map(lab => lab.subjectId));
  assert.deepEqual(result.subjects.map(subject => subject.labDay), ['MON', 'TUE', 'FRI']);
  assert.deepEqual(result.subjects.map(subject => subject.labStart), [3, 5, 7]);
});

test('treats SDC and Skill Development Course as Placement manual periods', () => {
  const result = normalizeRows([
    ['Teacher Name', 'Subject Name', 'Subject Code', 'Class Name', 'Periods Required'],
    ['T1', 'SDC', 'SDC1', 'AIDS', 2],
    ['T2', 'Skill Development Course', 'SDC2', 'AIDS', 1],
    ['T3', 'Placement', 'PL1', 'AIDS', 2]
  ]);
  assert.deepEqual(result.subjects.map(subject => subject.manualKind), ['placement', 'placement', 'placement']);
  assert.deepEqual(result.subjects.map(subject => subject.placementPeriods), [2, 1, 2]);
  assert.equal(result.subjects.some(subject => subject.labPeriods > 0), false);
});

test('enforces exactly one CC per class when toggling the CC role', () => {
  const alice = { name: 'Alice', ccFor: [] };
  const bob = { name: 'Bob', ccFor: [] };
  const teachers = { Alice: alice, Bob: bob };
  assert.equal(setClassCc(teachers, alice, 'AIDS'), true);
  assert.deepEqual(alice.ccFor, ['AIDS']);
  assert.equal(setClassCc(teachers, bob, 'AIDS'), true);
  assert.deepEqual(alice.ccFor, [], 'starting a new CC clears the previous CC for that class');
  assert.deepEqual(bob.ccFor, ['AIDS']);
  assert.equal(setClassCc(teachers, alice, 'CSE'), true);
  assert.deepEqual(alice.ccFor, ['CSE']);
  assert.deepEqual(bob.ccFor, ['AIDS'], 'CC roles are scoped per class');
  assert.equal(setClassCc(teachers, alice, 'CSE'), false);
  assert.deepEqual(alice.ccFor, []);
});

test('derives the class advisor from the selected CC and falls back to metadata', () => {
  const model = {
    staff: [{ name: 'Alice', ccFor: ['AIDS'] }, { name: 'Bob', ccFor: ['CSE'] }],
    metadata: { classAdvisor: 'Legacy Advisor' }
  };
  assert.equal(classAdvisorFor(model, 'AIDS'), 'Alice');
  assert.equal(classAdvisorFor(model, 'CSE'), 'Bob');
  assert.equal(classAdvisorFor(model, 'ECE'), 'Legacy Advisor');
  assert.equal(classAdvisorFor({ staff: [], metadata: { classAdvisors: { ECE: 'Dr. Rao' } } }, 'ECE'), 'Dr. Rao');
});

test('resolves the department of a section and toggles HOD per department', () => {
  assert.equal(departmentOf('AIDS(A)'), 'AIDS');
  assert.equal(departmentOf('AIDS (B)'), 'AIDS');
  assert.equal(departmentOf('AIDS'), 'AIDS');
  assert.equal(departmentOf('CSE'), 'CSE');
  assert.equal(departmentOf(''), '');

  const alice = { name: 'Alice', hodFor: [] };
  const teachers = { Alice: alice };
  assert.equal(setClassHod(teachers, alice, 'AIDS(A)'), true);
  assert.deepEqual(alice.hodFor, ['AIDS'], 'the HOD role is stored at department scope');
  assert.equal(setClassHod(teachers, alice, 'AIDS(B)'), false, 'a sibling section toggles the same department HOD off');
  assert.deepEqual(alice.hodFor, []);
});
