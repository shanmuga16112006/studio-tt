R1 — HOD not in Period 1
The HOD of a department is never assigned Period 1 for any class of that department.

R2 — Subject once per day
A subject appears at most once per day (theory), except the fallback in R2a.
R2a Fallback: if a subject's weekly required periods exceed the number of available days, it may appear twice on one day (e.g. 7h over 6 days) — flagged as a fallback case, not silent.

R3 — No consecutive same-subject periods
A subject cannot occupy two immediately adjacent periods on the same day (no break/lunch between them), same class.

R4 — Required weekly periods
Every subject receives its required weekly periods; anything unplaceable is reported as unresolved.

R5 — No teacher double-booking (checked across all classes)
A teacher cannot teach two different classes at the same period, checked across all classes being generated.

R6 — One subject per period per class
A class has at most one subject in any single period.

R7 — Labs managed manually
Lab periods are fixed by the user/admin and can be modified by them; the generator works around them.

R8 — Admin can update
Admin can update subject and teacher information at any time.

R9 — First-hour preference
Each subject should receive a Period-1 slot at least once per week whenever possible; reported as a warning if not achieved.

R10 — No continuous periods across classes for a teacher
A teacher should not have continuous periods across different classes (e.g. Class X period 1 → Class Y period 2 is avoided; a gap, e.g. period 3, is acceptable).

R11 — CC excluded from Period 1 of their own class (except Monday)
The staff member who is CC of a specific class is never assigned Period 1 for that class, except on Monday, where Period 1 is permitted. This rule applies whenever CC is present in the input, so the generator must not reject or move a CC period merely because it is Monday Period 1.

R12 — Lab-triggered exception for same-day repeat
If subject S has an externally-allotted lab on day D, exactly one theory period of S is additionally permitted on D — separate from the R2a weekly-shortfall fallback.

R13 — Staff daily hour cap (combined with external hours)
For any staff member on any day: (theory periods assigned that day) + (external_daily_hours that day) ≤ 5. External hours are a pre-consumed budget — compute remaining capacity before placing theory periods.

R14 — Weekly spread (no clustering)
A subject's weekly theory periods must be distributed across as many distinct days as possible. Default: no more than 1 period of a subject per day unless the weekly count can't otherwise fit (this is the R2a fallback, not silent).

R15 — Time-slot variety
Across the days a subject appears in a week, it should avoid the identical period-number every time. Where multiple valid slots exist, prefer the one that most varies the subject's position in the day relative to its other placements that week.

R16 — Lab consecutiveness (input-sheet driven) (new)
Lab periods must occupy the exact consecutive block of periods specified in the input sheet for that lab. The generator must not split, shorten, or relocate this block on its own — it treats the block as fixed and schedules theory periods around it, per R7.

R17 — Teacher availability constraints (new)
If a teacher has declared unavailable periods/days (leave, external commitment, etc.), those slots must be excluded from assignment for that teacher — distinct from R5, which only prevents simultaneous double-booking.

R18 — Lunch/break periods respected (new)
Lunch and break periods are fixed non-teaching slots; no subject or lab may be assigned into them, and they don't count as "adjacent" for the purposes of R3.

R-19 --A teacher can be assigned to multiple classes and different subjects & activities, but the same teacher must not be scheduled for two different classes in the same time slot.

R21 — No continuous subject patterns across classes (new)
A subject must not form a continuous column or row pattern across different classes: if the subject occupies slot P on day D in Class X, the same subject must not be placed at P on D or an adjacent day in another class, nor at an adjacent period (P±1) on the same day in another class. Labs are fixed per R16 and excluded from the pattern check, but theory placements still steer around lab slots.

R22 — No empty periods when a full 48-period week is required (new)
If a class requires all 48 teaching periods (input demand equals weekly capacity), the timetable must contain all 48 with no empty periods. Generation detects any empty slot, attempts to backfill the most under-allocated subject into it first (then any eligible subject), and rechecks all rules afterward; the CAPACITY diagnostic reports only what remains genuinely unfillable.

R23 — Extracurricular consecutive period rule (new)
This rule applies only to extracurricular activities. An extracurricular activity must be scheduled as one continuous block of its full required duration (for example 2, 3, or 4 consecutive periods) on a single day, starting at Period 3 or later. The entire duration must be allocated together — it may never contain gaps, be split across periods or days, or be shortened. For 2-period activities the block must stay inside one uninterrupted teaching run and may not cross a Break or Lunch (valid placements are Period 3–4, Period 5–6, or Period 7–8). Because no uninterrupted teaching run after Period 2 is longer than 2 periods, an activity of 3 or more periods is allowed to span the surrounding teaching periods across a Break or Lunch, exactly like a lab, and is not broken by it. If the required duration cannot fit in the teaching periods from Period 3 to Period 8, the activity is reported as unresolved (R23) instead of being split, shortened, or moved into an invalid slot.

R24 — Placement and SDC equivalence (new)
Placement, SDC, and Skill Development Course are equivalent labels. If any of these names is found in the input, the system must automatically recognize the subject as a Placement-type manually selected period and handle it exactly like the existing manually selected Placement/Library periods. The system must not create separate periods for Placement and SDC when they refer to the same input period.

R25 — Daily lab-to-theory restriction (new)
This rule applies separately for each subject, class, and day. If a subject has 3 or more lab periods on the same day, that subject must not be scheduled for any theory period on that day. If a subject has exactly 2 lab periods on the same day, only 1 theory period of that subject is permitted on that day (in addition to the two lab periods). Days with 0 or 1 lab period keep the normal theory cap. Lab periods must remain continuous and preserve their required duration (R16) — the restriction is applied by reserving the lab block first and then capping the subject's theory hours on that day. The generator enforces this while placing theory, and the output is revalidated so any violating theory period on a lab day is reported as R25.

R26 — Single-period extracurricular first-period allowance (new)
A single-period extracurricular activity (exactly 1 period in the week) is the only extracurricular that may be scheduled in Period 1. An extracurricular of 2 or more periods must still start at Period 3 or later and may never occupy Period 1 or Period 2 (R23). A single-period extracurricular may occupy Period 1 at most once in the whole week for a class — it is fixed on one day only, never on all the days of the week. The generator offers Period 1 to a single-period activity exactly once per week and falls back to Periods 3–8 for any further single-period activities. The output is revalidated so any second Period-1 activity in the week is reported as R26.
