import test from 'node:test';
import assert from 'node:assert/strict';
import { DAYS, createDefaultSlots, generateTimetable, regenerateClassTimetable, checkSchedule, checkExtracurricularSchedule, checkDailyLabTheoryRestriction, extracurricularStarts, firstPeriodRoleBlock } from '../src/scheduler.js';

test('creates the eight teaching periods and fixed breaks', () => {
  const slots = createDefaultSlots();
  assert.deepEqual(slots.filter(s => s.teaching).map(s => s.period), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(slots.filter(s => !s.teaching).length, 3);
});

test('generates a schedule without teacher double booking or adjacent duplicates', () => {
  const model = {
    classes: ['AIDS', 'CSE'],
    teachers: {},
    settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'b', className: 'CSE', acronym: 'OS', code: 'O1', name: 'OS', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 }
    ],
    labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.filter(d => d.rule === 'R5' && d.severity === 'error').length, 0);
  for (const schedule of Object.values(result.schedules)) {
    assert.equal(checkSchedule(schedule, model).filter(d => d.severity === 'error').length, 0);
  }
});

test('keeps fixed labs consecutive and outside break slots', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 2 }]
  };
  const result = generateTimetable(model);
  const cells = result.schedules.AIDS.MON.filter(c => c?.kind === 'lab');
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(c => c.period), [4, 5]);
  assert.equal(result.diagnostics.filter(d => d.rule === 'R16' && d.severity === 'error').length, 0);
});

test('starts a fixed lab exactly at the selected period for its full duration', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'AIT', code: 'AIT1', name: 'AIT Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 3 },
      { id: 't1', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Maths', teacher: 'T2', theoryPeriods: 12, labPeriods: 0 },
      { id: 't2', className: 'AIDS', acronym: 'OS', code: 'O1', name: 'OS', teacher: 'T3', theoryPeriods: 12, labPeriods: 0 },
      { id: 't3', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'DBMS', teacher: 'T4', theoryPeriods: 11, labPeriods: 0 }
    ],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 3 }]
  };
  const result = generateTimetable(model);
  const a = result.schedules.AIDS;
  assert.deepEqual(a.MON.filter(c => c?.subjectId === 'a').map(c => c.period), [4, 5, 6]);
  assert.equal(DAYS.filter(day => a[day].some(c => c?.subjectId === 'a')).length, 1);
  assert.equal(result.diagnostics.some(d => d.rule === 'R16' && d.severity === 'error'), false);
});

test('keeps manually selected Placement periods fixed while scheduling theory around them', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'p', className: 'AIDS', acronym: 'PT', code: 'P1', name: 'Placement', teacher: 'T1', theoryPeriods: 3, labPeriods: 0, manualKind: 'placement' },
      { id: 't', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T2', theoryPeriods: 3, labPeriods: 0 },
    ],
    labs: [],
    manualReservations: [{ subjectId: 'p', className: 'AIDS', kind: 'PLACEMENT', mode: 'separate', slots: [{ day: 'MON', period: 7 }, { day: 'TUE', period: 5 }, { day: 'WED', period: 3 }] }],
  };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  assert.deepEqual([schedule.MON[6], schedule.TUE[4], schedule.WED[2]].map(cell => cell?.subjectId), ['p', 'p', 'p']);
  assert.ok([schedule.MON[6], schedule.TUE[4], schedule.WED[2]].every(cell => cell.manual && cell.kind === 'placement'));
  assert.equal(result.diagnostics.some(item => item.subjectId === 'p' && item.severity === 'error'), false);
});

test('keeps fixed Library periods exactly where selected without forcing them consecutive', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 5 }, teachers: {},
    subjects: [
      { id: 'lib', className: 'AIDS', acronym: 'LIB', code: 'L1', name: 'Library', teacher: 'T1', theoryPeriods: 3, labPeriods: 0, manualKind: 'library' },
      { id: 't', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T2', theoryPeriods: 3, labPeriods: 0 },
    ],
    labs: [],
    manualReservations: [{ subjectId: 'lib', className: 'AIDS', kind: 'LIBRARY', mode: 'separate', slots: [{ day: 'MON', period: 3 }, { day: 'TUE', period: 6 }, { day: 'WED', period: 7 }] }],
  };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  assert.deepEqual([schedule.MON[2], schedule.TUE[5], schedule.WED[6]].map(cell => cell?.subjectId), ['lib', 'lib', 'lib']);
  assert.ok([schedule.MON[2], schedule.TUE[5], schedule.WED[6]].every(cell => cell.manual && cell.kind === 'library'));
  assert.equal(DAYS.flatMap(day => schedule[day].filter(cell => cell?.subjectId === 'lib')).length, 3);
  assert.equal(result.diagnostics.some(item => item.subjectId === 'lib' && item.severity === 'error'), false);
});

test('reports a Library period selected in Period 1 or 2 as conflicting instead of moving it', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 5 }, teachers: {},
    subjects: [{ id: 'lib', className: 'AIDS', acronym: 'LIB', code: 'L1', name: 'Library', teacher: 'T1', theoryPeriods: 1, labPeriods: 0, manualKind: 'library' }],
    labs: [],
    manualReservations: [{ subjectId: 'lib', className: 'AIDS', kind: 'LIBRARY', mode: 'separate', slots: [{ day: 'MON', period: 1 }] }],
  };
  const result = generateTimetable(model);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'lib')).length, 0);
  assert.equal(result.diagnostics.some(item => item.rule === 'MANUAL_CONFLICT' && item.subjectId === 'lib'), true);
});

test('treats an empty-string starting period as Auto instead of period zero', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: '', length: 2 }]
  };
  const result = generateTimetable(model);
  const cells = result.schedules.AIDS.MON.filter(c => c?.subjectId === 'a');
  assert.equal(cells.length, 2);
  assert.ok(cells.every(c => c.period >= 0 && c.period < 8));
  assert.equal(Math.abs(cells[0].period - cells[1].period), 1);
});

test('allows R2a fallback repeats only when weekly demand exceeds available days', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Theory', teacher: 'T1', theoryPeriods: 7, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.some(d => d.rule === 'R2a' && d.severity === 'warning'), true);
  assert.equal(result.diagnostics.some(d => d.rule === 'R4' && d.severity === 'error'), false);
});

test('permits exactly one R12 theory repeat on an externally fixed lab day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 7, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 2 }]
  };
  const result = generateTimetable(model);
  const mondayTheory = result.schedules.AIDS.MON.filter(c => c?.subjectId === 'a' && c.kind === 'theory');
  assert.equal(mondayTheory.length <= 1, true);
  assert.equal(result.diagnostics.some(d => d.rule === 'R4' && d.severity === 'error'), false);
});

test('respects unavailable teacher periods', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    teachers: { T1: { name: 'T1', unavailable: [{ day: 'MON', period: 0 }], externalHours: {} } },
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'DB', code: 'D1', name: 'Database', teacher: 'T1', theoryPeriods: 1, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  assert.notEqual(result.schedules.AIDS.MON[0]?.subjectId, 'a');
  assert.equal(result.diagnostics.some(d => d.rule === 'R17' && d.severity === 'error'), false);
});

test('reserves different first-period subjects across the six days', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index + 1}`, code: `C${index + 1}`, name: `Subject ${index + 1}`, teacher: `T${index + 1}`, theoryPeriods: 2, labPeriods: 0 })), labs: []
  };
  const result = generateTimetable(model);
  const firstPeriodSubjects = model.settings.days.map(day => result.schedules.AIDS[day][0]?.subjectId);
  assert.equal(new Set(firstPeriodSubjects).size, 6);
  assert.deepEqual(new Set(firstPeriodSubjects), new Set(['s0', 's1', 's2', 's3', 's4', 's5']));
});

test('keeps auto lab blocks away from the six distinct theory first-hour slots', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [...Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index + 1}`, code: `C${index + 1}`, name: `Subject ${index + 1}`, teacher: `T${index + 1}`, theoryPeriods: 2, labPeriods: index < 3 ? 2 : 0 })), { id: 'lab-only', className: 'AIDS', acronym: 'LB', code: 'LB1', name: 'Lab Only', teacher: 'TLB', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 's0', className: 'AIDS', labPeriods: 2 }, { subjectId: 's1', className: 'AIDS', labPeriods: 2 }, { subjectId: 's2', className: 'AIDS', labPeriods: 2 }, { subjectId: 'lab-only', className: 'AIDS', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  assert.equal(new Set(model.settings.days.map(day => result.schedules.AIDS[day][0]?.subjectId)).size, 6);
  assert.equal(model.settings.days.every(day => result.schedules.AIDS[day][0]?.kind === 'theory'), true);
});

test('reports unallocated capacity instead of inserting synthetic ACT cells', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 's1', className: 'AIDS', acronym: 'M', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 }], labs: []
  };
  const result = generateTimetable(model);
  const filled = model.settings.days.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length;
  assert.equal(filled, 2);
  assert.equal(result.schedules.AIDS.MON.some(cell => cell?.acronym === 'ACT'), false);
  assert.equal(result.diagnostics.some(d => d.rule === 'CAPACITY'), false);
});

test('applies HOD and CC first-hour rules independently for each class', () => {
  const model = {
    classes: ['AIDS', 'CSE'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
    teachers: { T1: { name: 'T1', unavailable: [], externalHours: {}, hodFor: ['AIDS'], ccFor: [] } },
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'A', code: 'A1', name: 'AIDS Subject', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 },
      { id: 'c', className: 'CSE', acronym: 'C', code: 'C1', name: 'CSE Subject', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(DAYS.some(day => result.schedules.AIDS[day][0]?.teacher === 'T1'), false);
  assert.equal(DAYS.some(day => result.schedules.CSE[day][0]?.teacher === 'T1'), true);
});

test('bars an HOD from Period 1 in every section of the same department', () => {
  const sections = ['AIDS(A)', 'AIDS(B)', 'AIDS(C)'];
  const model = {
    classes: sections, settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 5 },
    teachers: { T1: { name: 'T1', unavailable: [], externalHours: {}, hodFor: ['AIDS(A)'], ccFor: [] } },
    subjects: sections.map((section, index) => ({ id: `s${index}`, className: section, acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: 'T1', theoryPeriods: 3, labPeriods: 0 })),
    labs: []
  };
  const result = generateTimetable(model);
  for (const section of sections) {
    assert.equal(DAYS.some(day => result.schedules[section][day][0]?.teacher === 'T1'), false, `${section} Period 1 must stay free of the department HOD`);
  }
});

test('firstPeriodRoleBlock keeps HOD bar in the department, CC bar in the class and Monday free', () => {
  const model = {
    teachers: {
      HOD: { name: 'HOD', hodFor: ['AIDS'], ccFor: [] },
      CC: { name: 'CC', hodFor: [], ccFor: ['AIDS(A)'] },
      PLAIN: { name: 'PLAIN', hodFor: [], ccFor: [] }
    }
  };
  for (const day of DAYS) {
    const block = firstPeriodRoleBlock(model, 'HOD', 'AIDS', day);
    assert.equal(block?.rule, 'R1', `HOD must be barred every ${day}`);
    assert.equal(firstPeriodRoleBlock(model, 'HOD', 'AIDS(B)', day)?.rule, 'R1', 'HOD bars every section of the department');
    assert.equal(firstPeriodRoleBlock(model, 'HOD', 'CSE', day), null, 'HOD does not bar another department');
  }
  assert.equal(firstPeriodRoleBlock(model, 'CC', 'AIDS(A)', 'MON'), null, 'CC may teach Period 1 on Monday');
  for (const day of ['TUE', 'WED', 'THU', 'FRI', 'SAT']) {
    assert.equal(firstPeriodRoleBlock(model, 'CC', 'AIDS(A)', day)?.rule, 'R11', `CC is barred on ${day}`);
  }
  assert.equal(firstPeriodRoleBlock(model, 'CC', 'AIDS(B)', 'WED'), null, 'CC only bars its own class');
  assert.equal(firstPeriodRoleBlock(model, 'PLAIN', 'AIDS', 'WED'), null, 'unflagged staff are unrestricted');
});

test('toggling an HOD role off restores Period 1 eligibility for the department', () => {
  const sections = ['AIDS(A)', 'AIDS(B)'];
  const base = {
    classes: sections, settings: { days: DAYS, scheduleSeed: 7 }, labs: [],
    subjects: sections.map((section, index) => ({ id: `s${index}`, className: section, acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: 'T1', theoryPeriods: 3, labPeriods: 0 }))
  };
  const withHod = { ...base, teachers: { T1: { name: 'T1', hodFor: ['AIDS'], ccFor: [] } } };
  const barred = generateTimetable(withHod);
  assert.equal(DAYS.some(day => sections.some(section => barred.schedules[section][day][0]?.teacher === 'T1')), false);
  const cleared = { ...base, teachers: { T1: { name: 'T1', hodFor: [], ccFor: [] } } };
  const allowed = generateTimetable(cleared);
  assert.equal(DAYS.some(day => allowed.schedules['AIDS(A)'][day][0]?.teacher === 'T1'), true, 'Period 1 is available again once HOD is toggled off');
});

test('treats unavailable first-period preferences as warnings during regeneration', () => {
  const model = {
    classes: ['AIDS'], settings: { scheduleSeed: 1 }, teachers: {},
    subjects: [
      { id: 'theory', className: 'AIDS', acronym: 'TH', code: 'TH1', name: 'Theory', teacher: 'T1', theoryPeriods: 1, labPeriods: 0 },
      { id: 'activity', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T2', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true, extracurricularPlacement: 'continuous' }
    ], labs: []
  };
  const initial = generateTimetable(model);
  const result = regenerateClassTimetable(model, initial, 'AIDS');
  const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'activity').map(cell => ({ day, period: cell.period })));
  assert.equal(result.diagnostics.some(item => item.rule === 'R9' && item.severity === 'error'), false);
  assert.equal(result.diagnostics.some(item => item.rule === 'R9' && item.severity === 'warning'), true);
  assert.equal(new Set(placements.map(item => item.day)).size, 1);
  assert.equal(placements[1].period, placements[0].period + 1);
});

test('places extracurricular hours together on exactly one day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'club', className: 'AIDS', acronym: 'CLUB', code: 'EC1', name: 'Club Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true, extracurricularPlacement: 'continuous' },
      { id: 'math', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T2', theoryPeriods: 2, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  const placements = model.settings.days.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'club').map(cell => ({ day, period: cell.period, kind: cell.kind })));
  assert.equal(new Set(placements.map(item => item.day)).size, 1);
  assert.equal(placements.every((item, index) => index === 0 || item.period === placements[index - 1].period + 1), true);
  assert.equal(placements.every(item => item.period >= 2), true);
  assert.equal(placements.every(item => item.kind === 'activity'), true);
  assert.equal(result.diagnostics.some(item => item.rule === 'R3' && item.subjectId === 'club'), false);
});

test('keeps multiple extracurricular blocks continuous with one activity subject per day', () => {
  const subjects = [2, 2, 2].map((theoryPeriods, index) => ({
    id: `activity-${index}`,
    className: 'AIDS',
    acronym: `ACT${index}`,
    code: `EC${index}`,
    name: `Activity ${index}`,
    teacher: `T${index}`,
    theoryPeriods,
    labPeriods: 0,
    isExtracurricular: true,
    extracurricularPlacement: 'continuous',
  }));
  for (const seed of Array.from({ length: 30 }, (_, index) => index)) {
    const result = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: seed }, teachers: {}, subjects, labs: [] });
    const dailyActivitySubjects = Object.fromEntries(DAYS.map(day => [day, new Set(result.schedules.AIDS[day].filter(cell => cell?.kind === 'activity').map(cell => cell.subjectId))]));
    assert.ok(Math.max(...Object.values(dailyActivitySubjects).map(subjectsOnDay => subjectsOnDay.size)) <= 1, `${seed}: ${JSON.stringify(Object.fromEntries(Object.entries(dailyActivitySubjects).map(([day, subjectsOnDay]) => [day, [...subjectsOnDay]])))}`);
    for (const subject of subjects) {
      const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === subject.id).map(cell => ({ day, period: cell.period })));
      assert.equal(new Set(placements.map(item => item.day)).size, 1);
      const periods = placements.map(item => item.period).sort((a, b) => a - b);
      assert.deepEqual(periods, Array.from({ length: subject.theoryPeriods }, (_, index) => periods[0] + index));
    }
  }
});

test('places every extracurricular subject as one continuous same-day block regardless of the stored placement mode', () => {
  for (const [theoryPeriods, seed] of [[2, 4], [2, 40], [1, 13]]) {
    const model = {
      classes: ['AIDS'], settings: { scheduleSeed: seed }, teachers: {},
      subjects: [{ id: 'club', className: 'AIDS', acronym: 'CLUB', code: 'EC1', name: 'Club Activity', teacher: 'T1', theoryPeriods, labPeriods: 0, isExtracurricular: true, extracurricularPlacement: 'separate' }], labs: []
    };
    const result = generateTimetable(model);
    const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'club').map(cell => ({ day, period: cell.period })));
    assert.equal(placements.length, theoryPeriods);
    assert.equal(new Set(placements.map(item => item.day)).size, 1);
    const periods = placements.map(item => item.period).sort((a, b) => a - b);
    assert.deepEqual(periods, Array.from({ length: theoryPeriods }, (_, index) => periods[0] + index));
    assert.equal(placements.every(item => item.period >= 2 || (theoryPeriods === 1 && item.period === 0)), true);
    assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false);
  }
});

test('R26 offers Period 1 only to single-period extracurricular activities', () => {
  assert.equal(extracurricularStarts(1).includes(0), true);
  assert.equal(extracurricularStarts(2).includes(0), false);
  assert.equal(extracurricularStarts(3).includes(0), false);
});

test('R26 accepts one single-period extracurricular in Period 1 and rejects a second day', () => {
  const single = {
    classes: ['AIDS'], settings: { scheduleSeed: 1 }, teachers: {},
    subjects: [{ id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 1, labPeriods: 0, isExtracurricular: true }],
    labs: []
  };
  const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  week.className = 'AIDS';
  week.MON[0] = { subjectId: 'act', subjectCode: 'EC1', acronym: 'ACT', subjectName: 'Activity', teacher: 'T1', period: 0, kind: 'activity' };
  assert.deepEqual(checkExtracurricularSchedule(week, single), []);

  const secondDay = structuredClone(week);
  secondDay.TUE[0] = { ...week.MON[0], period: 0 };
  const diagnostics = checkExtracurricularSchedule(secondDay, single);
  assert.equal(diagnostics.some(item => item.rule === 'R26'), true);
});

test('R26 still bars a multi-period extracurricular from Period 1', () => {
  const multi = {
    classes: ['AIDS'], settings: { scheduleSeed: 1 }, teachers: {},
    subjects: [{ id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true }],
    labs: []
  };
  const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  week.className = 'AIDS';
  week.MON[0] = { subjectId: 'act', subjectCode: 'EC1', acronym: 'ACT', subjectName: 'Activity', teacher: 'T1', period: 0, kind: 'activity' };
  week.MON[1] = { ...week.MON[0], period: 1 };
  assert.equal(checkExtracurricularSchedule(week, multi).some(item => item.rule === 'R23'), true);
});

test('R26 keeps at most one single-period extracurricular in Period 1 per week', () => {
  const subjects = [0, 1, 2].map(index => ({ id: `act-${index}`, className: 'AIDS', acronym: `A${index}`, code: `EC${index}`, name: `Activity ${index}`, teacher: `T${index}`, theoryPeriods: 1, labPeriods: 0, isExtracurricular: true }));
  for (const seed of Array.from({ length: 20 }, (_, index) => index)) {
    const result = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: seed }, teachers: {}, subjects, labs: [] });
    const periodOneDays = DAYS.filter(day => result.schedules.AIDS[day][0]?.kind === 'activity');
    assert.ok(periodOneDays.length <= 1, `seed ${seed}: ${periodOneDays.join(', ')}`);
    assert.equal(result.diagnostics.some(item => item.rule === 'R26'), false, `seed ${seed}`);
    assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false, `seed ${seed}`);
  }
});

test('fills the week when more soft-skill hours than days are marked extracurricular', () => {
  const activities = [2, 2, 2, 1, 1, 1, 1].map((theoryPeriods, index) => ({
    id: `act-${index}`, className: 'AIDS', acronym: `A${index}`, code: `EC${index}`,
    name: `Activity ${index}`, teacher: `T${index}`, theoryPeriods, labPeriods: 0, isExtracurricular: true
  }));
  const result = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: 3 }, teachers: {}, subjects: activities, labs: [] });
  for (const subject of activities) {
    const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === subject.id).map(cell => cell.period)).sort((a, b) => a - b);
    assert.deepEqual(placements, Array.from({ length: subject.theoryPeriods }, (_, index) => placements[0] + index));
  }
  const dailySubjects = DAYS.map(day => new Set(result.schedules.AIDS[day].filter(cell => cell?.kind === 'activity').map(cell => cell.subjectId)).size);
  assert.equal(Math.max(...dailySubjects), 2);
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0);
});

const activityModel = {
  classes: ['AIDS'], settings: { scheduleSeed: 4 }, teachers: {},
  subjects: [
    { id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true },
    { id: 'th', className: 'AIDS', acronym: 'TH', code: 'C1', name: 'Theory', teacher: 'T2', theoryPeriods: 3, labPeriods: 0 },
  ],
  labs: []
};
const activityWeek = (placements) => {
  const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  for (const period of placements) {
    week.MON[period] = { subjectId: 'act', subjectCode: 'EC1', acronym: 'ACT', subjectName: 'Activity', teacher: 'T1', period, kind: 'activity' };
  }
  week.className = 'AIDS';
  return week;
};

test('R23 accepts a break-free continuous extracurricular block from Period 3 onward', () => {
  assert.deepEqual(checkExtracurricularSchedule(activityWeek([2, 3]), activityModel), []);
  assert.deepEqual(checkExtracurricularSchedule(activityWeek([4, 5]), activityModel), []);
  assert.deepEqual(checkExtracurricularSchedule(activityWeek([6, 7]), activityModel), []);
});

test('R23 rejects an extracurricular starting in Period 1 or Period 2', () => {
  for (const start of [0, 1]) {
    const diagnostics = checkExtracurricularSchedule(activityWeek([start, start + 1]), activityModel);
    assert.equal(diagnostics.length > 0, true);
    assert.ok(diagnostics.every(item => item.rule === 'R23'));
    assert.match(diagnostics[0].message, /first possible starting period is Period 3/);
  }
});

test('R23 rejects a shortened or split extracurricular block', () => {
  const shortened = checkExtracurricularSchedule(activityWeek([4]), activityModel);
  assert.match(shortened[0].message, /exactly 2 consecutive periods/);
  assert.match(shortened[0].message, /forbids splitting or shortening/);
  const gapped = checkExtracurricularSchedule(activityWeek([2, 4]), activityModel);
  assert.match(gapped[0].message, /consecutive periods without a gap/);
});

test('R23 forbids a 2-period block from crossing Break/Lunch and a 3-period block from crossing Lunch', () => {
  const crossing = checkExtracurricularSchedule(activityWeek([3, 4]), activityModel);
  assert.equal(crossing.length, 1);
  assert.equal(crossing[0].rule, 'R23');
  assert.match(crossing[0].message, /crosses a Break or Lunch/);
  const model3 = { ...activityModel, subjects: activityModel.subjects.map(subject => subject.id === 'act' ? { ...subject, theoryPeriods: 3 } : subject) };
  const acrossLunch = checkExtracurricularSchedule(activityWeek([2, 3, 4]), model3);
  assert.equal(acrossLunch.length, 1);
  assert.equal(acrossLunch[0].rule, 'R23');
  assert.match(acrossLunch[0].message, /crosses the Lunch break/);
  assert.deepEqual(checkExtracurricularSchedule(activityWeek([4, 5, 6]), model3), []);
  assert.deepEqual(checkExtracurricularSchedule(activityWeek([5, 6, 7]), model3), []);
});

test('R23 restricts 3-period extracurricular activities to the post-lunch starts', () => {
  assert.deepEqual(extracurricularStarts(3), [4, 5]);
  assert.equal(extracurricularStarts(2).includes(3), false);
  assert.equal(extracurricularStarts(2).includes(2), true);
});

test('places a 3-period extracurricular activity as one continuous same-day block from Period 3 onward', () => {
  for (const length of [3, 4]) {
    const model = {
      classes: ['AIDS'], settings: { scheduleSeed: 4 }, teachers: {},
      subjects: [{ id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: length, labPeriods: 0, isExtracurricular: true }],
      labs: []
    };
    const result = generateTimetable(model);
    const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'act').map(cell => ({ day, period: cell.period }))).sort((left, right) => left.period - right.period);
    assert.equal(placements.length, length, `length ${length}`);
    assert.equal(new Set(placements.map(item => item.day)).size, 1, `length ${length}`);
    assert.equal(placements[0].period >= (length === 3 ? 4 : 2), true, `length ${length} start`);
    assert.equal(placements.every((item, index) => index === 0 || item.period === placements[index - 1].period + 1), true, `length ${length} continuous`);
    assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false, `length ${length}`);
  }
});

test('R23 keeps a generated 3-period extracurricular activity after Lunch and off the Lunch break', () => {
  for (const seed of Array.from({ length: 24 }, (_, index) => index)) {
    const model = {
      classes: ['AIDS'], settings: { scheduleSeed: seed }, teachers: {},
      subjects: [{ id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 3, labPeriods: 0, isExtracurricular: true }],
      labs: []
    };
    const result = generateTimetable(model);
    const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'act').map(cell => ({ day, period: cell.period }))).sort((left, right) => left.period - right.period);
    assert.equal(placements.length, 3, `seed ${seed}`);
    assert.equal(new Set(placements.map(item => item.day)).size, 1, `seed ${seed}`);
    assert.ok(placements[0].period >= 4, `seed ${seed}: block starts at index ${placements[0].period}`);
    assert.ok(placements[2].period <= 7, `seed ${seed}: block ends at index ${placements[2].period}`);
    assert.deepEqual(placements.map(item => item.period), [placements[0].period, placements[0].period + 1, placements[0].period + 2], `seed ${seed}`);
    assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false, `seed ${seed}`);
  }
});

test('R23 is reported by checkSchedule for a hand-built invalid extracurricular block', () => {
  const schedule = activityWeek([1, 2]);
  const rules = checkSchedule(schedule, activityModel).filter(item => item.rule === 'R23');
  assert.ok(rules.length > 0);
  assert.ok(rules.every(item => item.message));
});

test('R23 leaves theory subjects, labs, and teachers untouched', () => {
  const model = {
    classes: ['AIDS'], settings: { scheduleSeed: 11 }, teachers: {},
    subjects: [
      { id: 'act', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true },
      { id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Lab', teacher: 'T2', theoryPeriods: 0, labPeriods: 2 },
      { id: 'th', className: 'AIDS', acronym: 'TH', code: 'C1', name: 'Theory', teacher: 'T3', theoryPeriods: 3, labPeriods: 0 },
    ],
    labs: [{ subjectId: 'lab', className: 'AIDS', day: 'MON', startPeriod: 1, length: 2 }]
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false);
  const schedule = result.schedules.AIDS;
  assert.deepEqual([schedule.MON[0], schedule.MON[1]].map(cell => cell?.subjectId), ['lab', 'lab']);
  assert.equal(DAYS.flatMap(day => schedule[day]).filter(cell => cell?.subjectId === 'th').length, 3);
});

test('allows a continuous extracurricular block to use the final two periods', () => {
  const unavailable = DAYS.flatMap(day => [1, 2, 3, 4, 5].map(period => ({ day, period })));
  const model = {
    classes: ['AIDS'], settings: { scheduleSeed: 9 },
    teachers: { T1: { name: 'T1', unavailable, externalHours: {} } },
    subjects: [{ id: 'club', className: 'AIDS', acronym: 'CLUB', code: 'EC1', name: 'Club Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true, extracurricularPlacement: 'continuous' }],
    labs: []
  };
  const result = generateTimetable(model);
  const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'club').map(cell => cell.period));
  assert.deepEqual(placements, [6, 7]);
  assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false);
});

test('keeps a 2-period extracurricular block inside a break-free run from Period 3 onward', () => {
  const allowedPairs = new Set(['2-3', '4-5', '6-7']);
  for (const seed of Array.from({ length: 20 }, (_, index) => index)) {
    const model = {
      classes: ['AIDS'], settings: { scheduleSeed: seed }, teachers: {},
      subjects: [{ id: 'club', className: 'AIDS', acronym: 'CLUB', code: 'EC1', name: 'Club Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true }],
      labs: []
    };
    const result = generateTimetable(model);
    const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'club').map(cell => ({ day, period: cell.period })));
    assert.equal(placements.length, 2, `seed ${seed}`);
    assert.equal(new Set(placements.map(item => item.day)).size, 1, `seed ${seed}`);
    const periods = placements.map(item => item.period).sort((a, b) => a - b);
    assert.ok(allowedPairs.has(periods.join('-')), `seed ${seed}: ${periods.join(',')}`);
    assert.equal(result.diagnostics.some(item => item.rule === 'R23'), false, `seed ${seed}`);
  }
});

test('reports a long extracurricular as unresolved instead of splitting it across days', () => {
  const model = {
    classes: ['AIDS'], settings: { scheduleSeed: 2 }, teachers: {},
    subjects: [{ id: 'camp', className: 'AIDS', acronym: 'CAMP', code: 'EC2', name: 'Camp', teacher: 'T1', theoryPeriods: 7, labPeriods: 0, isExtracurricular: true }],
    labs: []
  };
  const result = generateTimetable(model);
  const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'camp'));
  assert.equal(placements.length, 0);
  assert.equal(result.diagnostics.some(item => item.rule === 'R23' && item.subjectId === 'camp'), true);
});

test('reports an unplaceable extracurricular block during selected-class regeneration', () => {
  const lockedWeek = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  lockedWeek.MON[1] = { subjectId: 'b-activity', subjectCode: 'EC1', acronym: 'ACT', subjectName: 'Activity', teacher: 'T2', period: 1, kind: 'activity' };
  const model = {
    classes: ['AIDS', 'CSE'], settings: { scheduleSeed: 1 },
    teachers: { T1: { name: 'T1', unavailable: DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => ({ day, period })).filter(slot => slot.day !== 'MON' || ![1, 2].includes(slot.period))), externalHours: {} } },
    subjects: [
      { id: 'a-activity', className: 'AIDS', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T1', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true },
      { id: 'b-activity', className: 'CSE', acronym: 'ACT', code: 'EC1', name: 'Activity', teacher: 'T2', theoryPeriods: 2, labPeriods: 0, isExtracurricular: true }
    ],
    labs: []
  };
  const result = regenerateClassTimetable(model, { schedules: { CSE: { className: 'CSE', ...lockedWeek } } }, 'AIDS');
  const placements = DAYS.flatMap(day => result.schedules.AIDS[day].filter(cell => cell?.subjectId === 'a-activity'));
  assert.equal(placements.length, 0);
  assert.equal(result.diagnostics.some(item => item.rule === 'R23' && item.subjectId === 'a-activity'), true);
});

test('leaves spare capacity empty after satisfying exact subject workloads', () => {
  const subjects = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 5, labPeriods: 0 }));
  const model = { classes: ['AIDS'], settings: { scheduleSeed: 42 }, teachers: {}, subjects, labs: [] };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  assert.equal(DAYS.flatMap(day => schedule[day]).filter(Boolean).length, 40);
  assert.equal(DAYS.flatMap(day => schedule[day]).filter(Boolean).every(cell => subjects.some(subject => subject.id === cell.subjectId)), true);
  const counts = subjects.map(subject => DAYS.flatMap(day => schedule[day]).filter(cell => cell?.subjectId === subject.id).length);
  assert.equal(counts.every(count => count === 5), true);
  assert.equal(result.diagnostics.some(item => item.rule === 'CAPACITY' && item.severity === 'error'), false);
});

test('uses the schedule seed to produce different balanced layouts', () => {
  const subjects = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 5, labPeriods: 0 }));
  const first = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: 1 }, teachers: {}, subjects, labs: [] });
  const second = generateTimetable({ classes: ['AIDS'], settings: { scheduleSeed: 2 }, teachers: {}, subjects, labs: [] });
  const signature = result => DAYS.map(day => result.schedules.AIDS[day].map(cell => cell?.subjectId).join(',')).join('|');
  assert.notEqual(signature(first), signature(second));
});

test('auto-places an unfixed lab as a continuous teaching block', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Programming Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }], labs: [{ subjectId: 'lab', className: 'AIDS', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  const labCells = result.schedules.AIDS.MON.concat(result.schedules.AIDS.TUE, result.schedules.AIDS.WED, result.schedules.AIDS.THU, result.schedules.AIDS.FRI, result.schedules.AIDS.SAT).filter(c => c?.kind === 'lab');
  assert.equal(labCells.length, 2);
  assert.equal(Math.abs(labCells[0].period - labCells[1].period), 1);
});

test('keeps an input-declared lab day when the start period is not supplied', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Programming Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'lab', className: 'AIDS', day: 'TUE', labPeriods: 2 }]
  };
  const result = generateTimetable(model);
  assert.equal(result.schedules.AIDS.MON.filter(cell => cell?.kind === 'lab').length, 0);
  const periods = result.schedules.AIDS.TUE.filter(cell => cell?.kind === 'lab').map(cell => cell.period);
  assert.equal(periods.length, 2);
  assert.equal(periods[1] - periods[0], 1);
});

test('does not leave a partial fixed lab block when Period 1 is forbidden', () => {
  const model = {
    classes: ['AIDS'], settings: { scheduleSeed: 1 },
    teachers: { T1: { name: 'T1', unavailable: [], externalHours: {}, hodFor: ['AIDS'] } },
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'lab', className: 'AIDS', day: 'MON', startPeriod: 1, length: 2 }]
  };
  const result = generateTimetable(model);
  const cells = result.schedules.AIDS.MON.filter(cell => cell?.subjectId === 'lab');
  assert.equal(cells.length, 0);
  assert.equal(result.diagnostics.some(item => item.rule === 'R16' && item.severity === 'error'), true);
});

test('does not assign one teacher across classes at the same period', () => {
  const model = {
    classes: ['AIDS', 'CSE'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'b', className: 'CSE', acronym: 'OS', code: 'O1', name: 'OS', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.filter(item => ['R5', 'R10'].includes(item.rule) && item.severity === 'error').length, 0);
});

test('does not double-book the same subject code across classes at the same period', () => {
  const model = {
    classes: ['AIDS', 'CSE'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'b', className: 'CSE', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T2', theoryPeriods: 4, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.filter(item => item.rule === 'R21' && item.severity === 'error').length, 0);
  const occupied = new Map();
  for (const section of ['AIDS', 'CSE']) {
    for (const day of DAYS) {
      result.schedules[section][day].forEach((cell, period) => {
        if (cell?.subjectId) {
          const slot = `${day}-${period}`;
          if (occupied.has(slot) && occupied.get(slot) === cell.subjectId) assert.fail(`subject ${cell.subjectId} appears in two classes at ${day} P${period + 1}`);
          occupied.set(slot, cell.subjectId);
        }
      });
    }
  }
});

test('allows adjacent cross-class slots: a teacher may teach consecutive periods and a subject may sit beside its twin section', () => {
  const model = {
    classes: ['AIDS', 'CSE'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 6 }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'b', className: 'CSE', acronym: 'OS', code: 'O1', name: 'OS', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 },
      { id: 'c', className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T2', theoryPeriods: 4, labPeriods: 0 },
      { id: 'd', className: 'CSE', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T3', theoryPeriods: 4, labPeriods: 0 }
    ], labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0);
  assert.equal(result.diagnostics.some(item => ['R10', 'R21'].includes(item.rule) && item.severity === 'warning'), true);
});

test('co-places the same subject code and teacher across twin sections so no class is left with empty slots', () => {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const allSlots = days.flatMap(day => Array.from({ length: 8 }, (_, period) => ({ day, period })));
  const freeWidth = new Set(['TUE-4', 'WED-6']);
  const model = {
    classes: ['AIDS(A)', 'AIDS(B)'], settings: { days, scheduleSeed: 2 },
    teachers: { T1: { name: 'T1', unavailable: allSlots.filter(slot => !freeWidth.has(`${slot.day}-${slot.period}`)), externalHours: {} } },
    subjects: [
      { id: 'a-tp', className: 'AIDS(A)', acronym: 'NW', code: '24AD302TP', name: 'Networking (T+P)', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 },
      { id: 'b-tp', className: 'AIDS(B)', acronym: 'NW', code: '24AD302TP', name: 'Networking (T+P)', teacher: 'T1', theoryPeriods: 2, labPeriods: 0 }
    ],
    labs: []
  };
  const result = generateTimetable(model);
  for (const section of ['AIDS(A)', 'AIDS(B)']) {
    const periods = Object.entries(result.schedules[section]).filter(([day, cells]) => day !== 'className').flatMap(([day, cells]) => cells.filter(cell => cell?.subjectId === `${section === 'AIDS(A)' ? 'a' : 'b'}-tp`).map(cell => `${day} P${cell.period + 1}`));
    assert.deepEqual(periods.sort(), ['TUE P5', 'WED P7']);
  }
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0);
  assert.equal(result.diagnostics.some(item => ['R5', 'R10', 'R21'].includes(item.rule) && item.severity === 'error'), false);
});

test('places the user-selected lab day and starting period in the final timetable', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 11 }, teachers: {},
    subjects: [
      { id: 'ddm', className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T1', theoryPeriods: 4, labPeriods: 2 },
      { id: 'nwai', className: 'AIDS', acronym: 'NWAI', code: 'N1', name: 'Network Administration', teacher: 'T2', theoryPeriods: 3, labPeriods: 2 },
      { id: 'ait', className: 'AIDS', acronym: 'AIT', code: 'A1', name: 'Advanced IT Lab', teacher: 'T3', theoryPeriods: 0, labPeriods: 4 },
      { id: 'math', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Maths', teacher: 'T4', theoryPeriods: 6, labPeriods: 0 }
    ],
    labs: [
      { subjectId: 'ddm', className: 'AIDS', day: 'MON', startPeriod: 3, length: 2 },
      { subjectId: 'nwai', className: 'AIDS', day: 'TUE', startPeriod: null, length: 2 },
      { subjectId: 'ait', className: 'AIDS', day: 'FRI', startPeriod: 5, length: 4 }
    ],
    weeklyHours: 21
  };
  model.subjects.forEach(subject => {
    const lab = model.labs.find(item => item.subjectId === subject.id);
    if (lab) { subject.labDay = lab.day || ''; subject.labStart = lab.startPeriod ?? null; }
  });
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  const ddmCells = schedule.MON.filter(cell => cell?.subjectId === 'ddm' && cell.kind === 'lab');
  assert.deepEqual(ddmCells.map(cell => cell.period), [2, 3]);
  assert.equal(result.diagnostics.some(item => item.rule === 'R16' && item.subjectId === 'ddm' && item.severity === 'error'), false);
  const nwaiCells = DAYS.flatMap(day => schedule[day].filter(cell => cell?.subjectId === 'nwai' && cell.kind === 'lab'));
  assert.equal(nwaiCells.length, 2);
  assert.equal(DAYS.filter(day => schedule[day].some(cell => cell?.subjectId === 'nwai' && cell.kind === 'lab')).length, 1);
  assert.deepEqual(schedule.TUE.filter(cell => cell?.subjectId === 'nwai' && cell.kind === 'lab').map(cell => cell.period).sort((a, b) => a - b), nwaiCells.map(cell => cell.period).sort((a, b) => a - b));
  const aitCells = schedule.FRI.filter(cell => cell?.subjectId === 'ait' && cell.kind === 'lab');
  assert.deepEqual(aitCells.map(cell => cell.period), [4, 5, 6, 7]);
  assert.equal(result.diagnostics.some(item => item.rule === 'R16' && item.subjectId === 'ait' && item.severity === 'error'), false);
});

test('applies a changed lab day and starting period during regeneration', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 3 }, teachers: {},
    subjects: [
      { id: 'ddm', className: 'AIDS', acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: 'T1', theoryPeriods: 4, labPeriods: 2 },
      { id: 'math', className: 'AIDS', acronym: 'MATH', code: 'M1', name: 'Maths', teacher: 'T2', theoryPeriods: 6, labPeriods: 0 }
    ],
    labs: [{ subjectId: 'ddm', className: 'AIDS', day: 'MON', startPeriod: 3, length: 2 }],
    weeklyHours: 12
  };
  const first = generateTimetable(model);
  assert.deepEqual(first.schedules.AIDS.MON.filter(cell => cell?.subjectId === 'ddm').map(cell => cell.period), [2, 3]);
  const lab = model.labs[0];
  const subject = model.subjects[0];
  lab.day = 'THU';
  lab.startPeriod = 6;
  subject.labDay = 'THU';
  subject.labStart = 6;
  const second = regenerateClassTimetable(model, first, 'AIDS');
  const schedule = second.schedules.AIDS;
  assert.equal(schedule.MON.some(cell => cell?.subjectId === 'ddm' && cell.kind === 'lab'), false);
  assert.deepEqual(schedule.THU.filter(cell => cell?.subjectId === 'ddm' && cell.kind === 'lab').map(cell => cell.period).sort((a, b) => a - b), [5, 6]);
  assert.equal(second.diagnostics.some(item => item.rule === 'R16' && item.severity === 'error'), false);
});

test('uses a lab day saved on the subject when the lab entry carries no day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 2 }, teachers: {},
    subjects: [{ id: 'lab', className: 'AIDS', acronym: 'LB', code: 'L1', name: 'Programming Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2, labDay: 'WED', labStart: 4 }],
    labs: [{ subjectId: 'lab', className: 'AIDS', length: 2 }]
  };
  const result = generateTimetable(model);
  assert.deepEqual(result.schedules.AIDS.WED.filter(cell => cell?.subjectId === 'lab').map(cell => cell.period), [3, 4]);
  assert.equal(DAYS.filter(day => result.schedules.AIDS[day].some(cell => cell?.subjectId === 'lab')).length, 1);
});

test('applies each section\'s own fixed lab day and starting period independently', () => {
  const sections = ['AIDS(A)', 'AIDS(B)', 'AIDS(C)'];
  const days = ['MON', 'TUE', 'FRI'];
  const starts = [3, 5, 7];
  const model = {
    classes: sections, settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 5 }, teachers: {},
    subjects: sections.flatMap((section, index) => [
      { id: `ddm-${section}`, className: section, acronym: 'DDM', code: 'D1', name: 'Database Design', teacher: `T${index + 1}`, theoryPeriods: 4, labPeriods: 2 },
      { id: `math-${section}`, className: section, acronym: 'MATH', code: 'M1', name: 'Maths', teacher: `T${index + 10}`, theoryPeriods: 6, labPeriods: 0 }
    ]),
    labs: sections.map((section, index) => ({ subjectId: `ddm-${section}`, className: section, day: days[index], startPeriod: starts[index], length: 2 })),
    weeklyHours: 36
  };
  const result = generateTimetable(model);
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const cells = result.schedules[section][days[index]].filter(cell => cell?.subjectId === `ddm-${section}` && cell.kind === 'lab');
    assert.deepEqual(cells.map(cell => cell.period), [starts[index] - 1, starts[index]], `${section} must start at ${days[index]} P${starts[index]}`);
    assert.equal(DAYS.filter(day => result.schedules[section][day].some(cell => cell?.subjectId === `ddm-${section}` && cell.kind === 'lab')).length, 1);
    assert.equal(result.diagnostics.some(item => item.rule === 'R16' && item.className === section && item.severity === 'error'), false);
  }
});

test('regenerating one section leaves every other section untouched', () => {
  const sections = ['AIDS(A)', 'AIDS(B)', 'AIDS(C)'];
  const model = {
    classes: sections, settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 21 }, teachers: {},
    subjects: sections.flatMap((section, index) => [
      { id: `s1-${section}`, className: section, acronym: 'SUB1', code: 'S1', name: `Subject 1 (${section})`, teacher: `T${index}`, theoryPeriods: 4, labPeriods: 2 },
      { id: `s2-${section}`, className: section, acronym: 'SUB2', code: 'S2', name: `Subject 2 (${section})`, teacher: `T${index + 10}`, theoryPeriods: 6, labPeriods: 0 }
    ]),
    labs: sections.map((section, index) => ({ subjectId: `s1-${section}`, className: section, day: ['MON', 'TUE', 'WED'][index], startPeriod: index === 1 ? 5 : 3, length: 2 })),
    weeklyHours: 36
  };
  const first = generateTimetable(model);
  const signature = schedule => DAYS.map(day => schedule[day].map(cell => cell?.subjectId || '').join(',')).join('|');
  const lockSignature = (result, exclude) => Object.fromEntries(Object.entries(result.schedules).filter(([name]) => name !== exclude).map(([name, schedule]) => [name, signature(schedule)]));
  const before = lockSignature(first, 'AIDS(B)');
  const modelClone = structuredClone(model);
  const lab = modelClone.labs.find(item => item.className === 'AIDS(B)');
  const subject = modelClone.subjects.find(item => item.id === lab.subjectId);
  lab.day = 'FRI';
  lab.startPeriod = 6;
  subject.labDay = 'FRI';
  subject.labStart = 6;
  const second = regenerateClassTimetable(modelClone, first, 'AIDS(B)');
  assert.deepEqual(lockSignature(second, 'AIDS(B)'), before);
  assert.equal(second.schedules['AIDS(B)'].MON.filter(cell => cell?.subjectId === 's1-AIDS(B)' && cell.kind === 'lab').length, 0);
  assert.deepEqual(second.schedules['AIDS(B)'].FRI.filter(cell => cell?.subjectId === 's1-AIDS(B)' && cell.kind === 'lab').map(cell => cell.period).sort((a, b) => a - b), [5, 6]);
});

test('fills every teaching period when the class requires all 48', () => {
  const subjects = Array.from({ length: 16 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 3, labPeriods: 0 }));
  const model = { classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 7 }, teachers: {}, subjects, labs: [], weeklyHours: 48 };
  const result = generateTimetable(model);
  const filled = DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length;
  assert.equal(filled, 48);
  assert.equal(result.diagnostics.some(item => item.rule === 'CAPACITY' && item.severity === 'error'), false);
  const counts = subjects.map(subject => DAYS.flatMap(day => result.schedules.AIDS[day]).filter(cell => cell?.subjectId === subject.id).length);
  counts.forEach(count => assert.equal(count, 3));
});

test('stops with exact CAPACITY reason when the workload exceeds 48 slots and leaves the week empty', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'A', code: 'A1', name: 'A', teacher: 'T1', theoryPeriods: 12, labPeriods: 0 },
      { id: 'b', className: 'AIDS', acronym: 'B', code: 'B1', name: 'B', teacher: 'T2', theoryPeriods: 12, labPeriods: 0 },
      { id: 'c', className: 'AIDS', acronym: 'C', code: 'C1', name: 'C', teacher: 'T3', theoryPeriods: 12, labPeriods: 0 },
      { id: 'd', className: 'AIDS', acronym: 'D', code: 'D1', name: 'D', teacher: 'T4', theoryPeriods: 12, labPeriods: 0 },
      { id: 'e', className: 'AIDS', acronym: 'E', code: 'E1', name: 'E', teacher: 'T5', theoryPeriods: 1, labPeriods: 0 }
    ],
    labs: []
  };
  const result = generateTimetable(model);
  const capacity = result.diagnostics.find(item => item.rule === 'CAPACITY' && item.severity === 'error');
  assert.ok(capacity);
  assert.match(capacity.message, /49 teaching slots/);
  assert.match(capacity.message, /only 48 are available/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('stops with exact R4 reason when a theory subject needs more than 12 weekly periods', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'MAT', code: 'M1', name: 'Math', teacher: 'T1', theoryPeriods: 14, labPeriods: 0 }],
    labs: []
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R4' && item.severity === 'error');
  assert.ok(blocker);
  assert.match(blocker.message, /needs 14 weekly theory periods/);
  assert.match(blocker.message, /maximum 12/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('stops with exact R16 reason when a fixed lab overflows the 8-slot teaching day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 3 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 7, length: 3 }]
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R16' && item.severity === 'error');
  assert.ok(blocker);
  assert.match(blocker.message, /overflowing/);
  assert.match(blocker.message, /starting at Period 7/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('stops with exact R16 reason when the fixed lab day has the teacher unavailable for the whole day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: { T1: { name: 'T1', unavailable: Array.from({ length: 8 }, (_, period) => ({ day: 'MON', period })) } },
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', length: 2 }]
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R16' && item.severity === 'error');
  assert.ok(blocker);
  assert.match(blocker.message, /on MON/);
  assert.match(blocker.message, /unavailable during every eligible time window/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('stops with exact R16 reason when the fixed lab Starting Period is outside 1–8', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 9, length: 2 }]
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R16' && item.severity === 'error');
  assert.ok(blocker);
  assert.match(blocker.message, /outside the allowed 1–8 range/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('stops with exact R23 reason when a continuous extracurricular cannot fit the teaching day', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'ACT', code: 'AC1', name: 'Activity', teacher: 'T1', theoryPeriods: 8, isExtracurricular: true, extracurricularPlacement: 'continuous' }],
    labs: []
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R23' && item.severity === 'error');
  assert.ok(blocker);
  assert.match(blocker.message, /needs 8 consecutive periods/);
  assert.match(blocker.message, /only 6 teaching periods are available from Period 3 to Period 8/);
  assert.equal(DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length, 0);
});

test('does not flag a deterministically feasible 48-slot workload as infeasible', () => {
  const subjects = Array.from({ length: 16 }, (_, index) => ({ id: `s${index}`, className: 'AIDS', acronym: `S${index}`, code: `C${index}`, name: `Subject ${index}`, teacher: `T${index}`, theoryPeriods: 3, labPeriods: 0 }));
  const model = { classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 7 }, teachers: {}, subjects, labs: [], weeklyHours: 48 };
  const result = generateTimetable(model);
  const filled = DAYS.flatMap(day => result.schedules.AIDS[day]).filter(Boolean).length;
  assert.equal(filled, 48);
  assert.equal(result.diagnostics.filter(item => item.severity === 'error').length, 0);
});

test('R4 report lists the exact per-slot blockers when theory cannot be placed', () => {
  const unavailable = DAYS.flatMap(day => Array.from({ length: 8 }, (_, period) => ({ day, period })).filter(slot => slot.day !== 'MON' || ![1, 2].includes(slot.period)));
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 3 }, teachers: { T1: { name: 'T1', unavailable, externalHours: {} } },
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'SUB', code: 'S1', name: 'Subject A', teacher: 'T1', theoryPeriods: 4, labPeriods: 0 }
    ],
    labs: []
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R4' && item.severity === 'error' && item.subjectId === 'a');
  assert.ok(blocker);
  assert.match(blocker.message, /Every free slot was blocked/);
  assert.match(blocker.message, /unavailable/);
});

test('R16 search failure report names the exact blocking day and reason', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 5 }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 2 },
      { id: 'b', className: 'AIDS', acronym: 'SUB', code: 'S1', name: 'Subject B', teacher: 'T2', theoryPeriods: 12, labPeriods: 0 },
      { id: 'c', className: 'AIDS', acronym: 'SUB', code: 'S2', name: 'Subject C', teacher: 'T3', theoryPeriods: 12, labPeriods: 0 },
      { id: 'd', className: 'AIDS', acronym: 'SUB', code: 'S3', name: 'Subject D', teacher: 'T4', theoryPeriods: 12, labPeriods: 0 },
      { id: 'e', className: 'AIDS', acronym: 'SUB', code: 'S4', name: 'Subject E', teacher: 'T5', theoryPeriods: 11, labPeriods: 0 }
    ],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', length: 2 }]
  };
  const result = generateTimetable(model);
  const blocker = result.diagnostics.find(item => item.rule === 'R16' && item.severity === 'error');
  if (blocker) {
    assert.match(blocker.message, /could not be placed as a continuous block/);
    assert.match(blocker.message, /on MON/);
    assert.match(blocker.message, /Blocked because/);
  }
});

test('allows a CC to teach Monday Period 1 but still bars every other Period 1', () => {
  const model = {
    classes: ['AIDS'],
    teachers: { T2: { name: 'T2', unavailable: [], externalHours: {}, hodFor: [], ccFor: ['AIDS'] } },
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'A', code: 'A1', name: 'AIDS Subject', teacher: 'T2', theoryPeriods: 5, labPeriods: 0 }],
    labs: []
  };
  const cell = { subjectId: 'a', subjectCode: 'A1', acronym: 'A', subjectName: 'AIDS Subject', teacher: 'T2', period: 0, kind: 'theory' };
  const week = day => {
    const schedule = Object.fromEntries(DAYS.map(item => [item, Array(8).fill(null)]));
    schedule[day][0] = cell;
    schedule.className = 'AIDS';
    return schedule;
  };
  assert.equal(checkSchedule(week('MON'), model).some(item => item.rule === 'R11'), false);
  assert.equal(checkSchedule(week('TUE'), model).some(item => item.rule === 'R11'), true);
});

test('places a CC subject in Monday Period 1 when it is otherwise eligible', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 9 },
    teachers: { T2: { name: 'T2', unavailable: [], externalHours: {}, hodFor: [], ccFor: ['AIDS'] } },
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'A', code: 'A1', name: 'AIDS Subject', teacher: 'T2', theoryPeriods: 5, labPeriods: 0 }],
    labs: []
  };
  const result = generateTimetable(model);
  assert.equal(result.diagnostics.some(item => item.rule === 'R11'), false);
  assert.equal(DAYS.some(day => result.schedules.AIDS[day][0]?.teacher === 'T2'), true);
});

test('R25 forbids every theory period on a day that already holds 3 or more lab periods', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 4 }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Big Lab', teacher: 'T1', theoryPeriods: 3, labPeriods: 3 },
      { id: 'b', className: 'AIDS', acronym: 'SUB', code: 'S1', name: 'Filler', teacher: 'T2', theoryPeriods: 6, labPeriods: 0 }
    ],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 3 }]
  };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  const monday = schedule.MON.filter(cell => cell?.subjectId === 'a');
  assert.deepEqual(monday.map(cell => cell.period), [4, 5, 6]);
  assert.equal(monday.every(cell => cell.kind === 'lab'), true);
  assert.equal(DAYS.flatMap(day => schedule[day]).filter(cell => cell?.subjectId === 'a' && cell.kind === 'theory').length, 3);
  assert.equal(result.diagnostics.some(item => item.rule === 'R25' && item.severity === 'error'), false);
});

test('R25 allows at most one theory period on a day that has exactly two lab periods', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 6 }, teachers: {},
    subjects: [
      { id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Two Lab', teacher: 'T1', theoryPeriods: 3, labPeriods: 2 },
      { id: 'b', className: 'AIDS', acronym: 'SUB', code: 'S1', name: 'Filler', teacher: 'T2', theoryPeriods: 6, labPeriods: 0 }
    ],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'MON', startPeriod: 5, length: 2 }]
  };
  const result = generateTimetable(model);
  const schedule = result.schedules.AIDS;
  const mondayTheory = schedule.MON.filter(cell => cell?.subjectId === 'a' && cell.kind === 'theory');
  assert.equal(mondayTheory.length <= 1, true);
  assert.equal(result.diagnostics.some(item => item.rule === 'R25' && item.severity === 'error'), false);
});

test('R25 keeps the lab block continuous and at its required duration', () => {
  const model = {
    classes: ['AIDS'], settings: { days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], scheduleSeed: 8 }, teachers: {},
    subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 4 }],
    labs: [{ subjectId: 'a', className: 'AIDS', day: 'WED', startPeriod: 4, length: 4 }]
  };
  const result = generateTimetable(model);
  const periods = result.schedules.AIDS.WED.filter(cell => cell?.subjectId === 'a' && cell.kind === 'lab').map(cell => cell.period).sort((left, right) => left - right);
  assert.deepEqual(periods, [3, 4, 5, 6]);
  assert.equal(result.diagnostics.some(item => item.rule === 'R25'), false);
});

test('R25 validation flags a hand-built theory period on a 3-lab day', () => {
  const model = { classes: ['AIDS'], teachers: {}, subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Big Lab', teacher: 'T1', theoryPeriods: 3, labPeriods: 3 }], labs: [] };
  const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  week.className = 'AIDS';
  [2, 3, 4].forEach(period => { week.MON[period] = { subjectId: 'a', subjectCode: 'L1', acronym: 'LAB', subjectName: 'Big Lab', teacher: 'T1', period, kind: 'lab' }; });
  week.MON[0] = { subjectId: 'a', subjectCode: 'L1', acronym: 'LAB', subjectName: 'Big Lab', teacher: 'T1', period: 0, kind: 'theory' };
  const diagnostics = checkDailyLabTheoryRestriction(week, model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rule, 'R25');
  assert.match(diagnostics[0].message, /must not be scheduled for any theory period/);
});

test('R25 validation allows exactly one theory period on a 2-lab day but rejects a second', () => {
  const model = { classes: ['AIDS'], teachers: {}, subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Two Lab', teacher: 'T1', theoryPeriods: 3, labPeriods: 2 }], labs: [] };
  const build = theoryPeriods => {
    const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
    week.className = 'AIDS';
    [4, 5].forEach(period => { week.MON[period] = { subjectId: 'a', subjectCode: 'L1', acronym: 'LAB', subjectName: 'Two Lab', teacher: 'T1', period, kind: 'lab' }; });
    theoryPeriods.forEach(period => { week.MON[period] = { subjectId: 'a', subjectCode: 'L1', acronym: 'LAB', subjectName: 'Two Lab', teacher: 'T1', period, kind: 'theory' }; });
    return week;
  };
  assert.deepEqual(checkDailyLabTheoryRestriction(build([0]), model), []);
  const diagnostics = checkDailyLabTheoryRestriction(build([0, 1]), model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rule, 'R25');
  assert.match(diagnostics[0].message, /at most 1 theory period is allowed/);
});

test('R25 validation reports a non-continuous lab block', () => {
  const model = { classes: ['AIDS'], teachers: {}, subjects: [{ id: 'a', className: 'AIDS', acronym: 'LAB', code: 'L1', name: 'Lab', teacher: 'T1', theoryPeriods: 0, labPeriods: 3 }], labs: [] };
  const week = Object.fromEntries(DAYS.map(day => [day, Array(8).fill(null)]));
  week.className = 'AIDS';
  [2, 4, 5].forEach(period => { week.MON[period] = { subjectId: 'a', subjectCode: 'L1', acronym: 'LAB', subjectName: 'Lab', teacher: 'T1', period, kind: 'lab' }; });
  const diagnostics = checkDailyLabTheoryRestriction(week, model);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].rule, 'R25');
  assert.match(diagnostics[0].message, /not continuous/);
});

