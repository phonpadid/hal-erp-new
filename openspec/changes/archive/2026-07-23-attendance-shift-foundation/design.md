## Context

Attendance is the first capability in this ERP whose correctness depends on *local wall-clock
time*. Everything shipped so far is either amount-based (budget, quota, GL) or event-ordered
(approval logs, SLA countdowns), and all of it computes dates in UTC —
`WorkingTimeService` calls `getUTCDay()` and `toISOString().slice(0, 10)` to decide whether a
moment falls on a weekend or a holiday. For an SLA that is a rounding error. For attendance it
is a wrong "absent" on a person's record: at UTC+7, a punch at 06:30 local on Tuesday is
23:30 UTC on Monday, and a night shift ending at 06:00 belongs to the *previous* working day.

This slice adds no time records. It defines the expectation a later `attendance_day` will
judge against — which shift a person works, on which weekdays, with what tolerance for
lateness — plus the timezone that says when a day starts, and the geofence definitions the
capture slice will check punches against. The pattern to follow is `modules/job-level`: a
company-scoped master with `CODE_MANAGE` / `CODE_READ` permission codes, deactivation instead
of deletion, and `(company_id, code)` uniqueness.

Constraint that shapes everything below: `work_shift` is mutable master data, but a later
`attendance_day` is a historical record. If HR edits the office shift in July, June's
lateness figures must not silently change. This slice does not build `attendance_day`, but it
must not make that impossible.

## Goals / Non-Goals

**Goals:**

- Define a shift precisely enough that "late", "early leave", "absent", "half day" and
  "overtime" are each a pure function of (punch times, shift, holiday calendar) with no
  further configuration needed.
- Give every company a declared timezone, and stop day boundaries from being implicitly UTC.
- Make "which shift does employee E work on date D" a single, total, deterministic lookup.
- Mark the employees who are exempt from attendance at all, and record the pay basis that
  makes holiday work pay differently for monthly- versus daily-paid staff.
- Keep the shift row shaped so a future `attendance_day` can snapshot the four values it
  judged against as a flat copy.

**Non-Goals:**

- No `attendance_event`, no `attendance_day`, no punch endpoints, no geofence *enforcement*
  (only its configuration), no leave or OT documents.
- No rotating rosters. Assignment is fixed per employee over a date range; a person who
  alternates day and night shifts week by week is out of scope and would need a roster table.
- No `quota` changes. The leave/OT slices need `quota.control_policy`, `quota.is_paid` and a
  `WEEKLY` reset cycle; proposing them here would couple this slice to a capability it does
  not use.
- No pay rates. The system stores *how many* minutes of each overtime kind; the multiplier
  (1.5× / 2× / 3× under Thai law, different under Lao law) belongs to whatever consumes the
  export, not here — the platform is multi-company across jurisdictions.
- No frontend.

## Decisions

### 1. Shift times are stored as minutes from midnight, not `time` columns

`start_minute` and `end_minute` are `smallint` counts from local midnight. `end_minute` may
exceed 1440 to express a shift ending on the following day: a 22:00–06:00 night shift is
`start_minute = 1320`, `end_minute = 1800`.

Duration is then `end_minute - start_minute` with no branch, and "did this punch arrive after
start + grace" is integer comparison. The alternative — `time` columns plus a
`crosses_midnight` boolean — was rejected because the flag is derivable from the times and can
therefore contradict them: nothing stops a row with `start 22:00`, `end 06:00`,
`crosses_midnight = false`, and every duration calculation would need to branch on a field that
may be wrong. With minutes, "crosses midnight" is `end_minute > 1440`, computed, never stored.

The API does not leak this. DTOs accept and return `"22:00"` / `"06:00"` strings and convert at
the boundary, so the wire format and the admin UI stay readable; only storage is packed.

**Consequence for the proposal:** `crosses_midnight` is dropped as a column. It is a derived
property, not configuration.

### 2. The weekday pattern is a child table, not a bitmask

`work_shift_day` holds one row per weekday the shift is configured for:
`(work_shift_id, weekday 1–7 ISO, is_working, start_minute NULL, end_minute NULL)`. Null
per-day times mean "use the shift's own times".

A bitmask column (or seven booleans) is smaller and was the obvious first choice, but it
forecloses a case that is close to universal in this market: **Saturday half-day**. An office
that works 08:00–17:00 Monday to Friday and 08:00–12:00 on Saturday cannot be expressed by any
"which days" representation — Saturday has different hours, not just a different on/off state.
Modelling that as a second shift does not work either, because assignment is per employee, not
per weekday.

So the table is not additive complexity: it *replaces* the `working_days` column with a
representation of the same required data that also carries the per-day hours. Cost is one small
table read alongside the shift; the rows are static and cacheable.

### 3. Break is stored as a window, and deducted only where it overlaps actual attendance

`break_start_minute` / `break_end_minute` are nullable. The deduction rule fixed here — and
implemented by the daily slice — is: subtract the overlap between the worked interval
(first punch → last punch) and the break window, not a flat duration.

A flat `break_minutes` number is simpler but wrong at the edges that matter. An employee on
approved morning-half leave who works 13:00–17:00 never sits through a 12:00–13:00 break and
must not be charged for it; an employee who leaves at 11:30 likewise. Thai labour law requires
a break of at least one hour after five consecutive hours worked, so the window has to be a
real interval anyway for that rule to be checkable later.

Requiring employees to punch in and out for lunch was rejected outright: four punches a day is
the single largest source of missing-punch data in every system that does it, and the whole
point of storing the break as configuration is that it does not need to be observed.

### 4. Shift resolution: employee assignment → department default → none

```
resolve(employee, date):
    employee_shift where employee = E
                      and effective_from <= D
                      and (effective_to is null or effective_to >= D)   ──▶ found? use it
                                    │ not found
                                    ▼
    department.default_work_shift_id of E's department                  ──▶ set? use it
                                    │ null
                                    ▼
    null  ── a legitimate result, not an error
```

The department default is a **single nullable FK column on `department`**, not a second
date-ranged assignment table. A department's default is "what most people here work now"; the
history that matters is per person, and a person whose hours change gets an explicit
`employee_shift` row with dates. Adding a `department_shift` table with its own effective
ranges would double the resolution logic to serve a case that does not arise.

Resolution returning `null` is defined as a valid state, not a failure. An employee with
`attendance_required = false` will normally have no shift at all, and the daily slice must
treat "no shift" as "nothing expected today" rather than throwing. Fixing that meaning now
prevents the next slice from inventing a sentinel shift.

**Overlap prevention:** two `employee_shift` rows for the same employee must not cover the same
date. PostgreSQL can enforce this with an `EXCLUDE` constraint over a `daterange`, but that
needs the `btree_gist` extension — a deployment concern for a rule this slice can enforce in
the service. The choice here is a service-level check plus a unique index on
`(employee_id, effective_from)`, with a test for the overlap cases. The exclusion constraint is
noted as later hardening, not skipped silently.

**Corrected during implementation:** this decision originally said the check and the write
sharing one transaction was enough. It is not, and the concurrency test caught it. At
PostgreSQL's default READ COMMITTED isolation a plain `SELECT` takes no lock, so two concurrent
assignments each scan a clear field and each insert; the unique index only catches them in the
special case where both start on the same date. The employee row is therefore read
`FOR UPDATE` before the scan, serializing every write to that person's timeline. That makes this
the same pessimistic-lock pattern budget reservation and document numbering already use — see
decision 8, which is amended to match.

### 5. `company.timezone` is an IANA name, validated against the runtime's own list

Stored as `varchar` holding e.g. `Asia/Bangkok`, `Asia/Vientiane`. Validation uses
`Intl.supportedValuesOf('timeZone')`, available in Node 20 — no new dependency, and the list
tracks whatever tzdata the runtime ships. Fixed offsets (`+07:00`) were rejected: they cannot
express DST, and while neither Thailand nor Laos observes it, the platform is multi-company and
nothing stops a company elsewhere.

Backfill is `Asia/Bangkok` for existing rows, chosen because `THB` is the seeded base currency
and it is the correct answer for every company currently in the data. The column is `not null`
after backfill so no code path has to handle an absent zone.

The moment to do this is now: **no attendance data exists yet**, so changing a company's
timezone today reinterprets nothing. Once punches accumulate, changing it silently reclassifies
which day past punches fell on.

This slice adds the column and validates it; it does not retrofit `WorkingTimeService`. That
service computes approval SLAs and changing its behaviour is a separate, testable concern with
its own blast radius.

### 6. `employment_type` is a TS enum with a check constraint; `attendance_required` is a plain boolean

`employment_type` follows `ControlPolicy`: a TypeScript enum mapped with MikroORM's `@Enum`,
producing a `text` column with a check constraint. It exists because Thai labour law pays work
on a holiday at a different multiple for monthly-paid than for daily-paid employees, so the
distinction must be recorded at the source rather than reconstructed at export time. Default
`MONTHLY`.

`attendance_required` defaults `true`, so every existing employee keeps the expected behaviour
and only exemptions are edited. It gates reporting, not writing: an exempt employee who does
punch still gets their events recorded — the flag means "do not report this person as absent",
not "reject their data".

### 7. `work_location` declares a policy this slice does not enforce

`latitude` / `longitude` as `decimal(9,6)` (≈0.11 m resolution, well under any useful radius,
and consistent with the project rule that no numeric of consequence rides on a JS float),
`radius_meters` as an integer, and `control_policy` reusing the existing `ControlPolicy` enum
with `SOFT_WARNING` as the default.

Reusing the budget over-limit enum is deliberate rather than cosmetic: the situation is
identical in shape — a configured limit, a value outside it, and a per-row choice between
blocking and recording. `HARD_STOP` refuses the punch; `SOFT_WARNING` accepts it and records
the measured distance for a supervisor to see. `SOFT_WARNING` is the default because indoor GPS
error of 50–200 m is routine, and a system that blocks on it pushes every morning through
manual entry until the geofence means nothing.

Defining the table with no enforcement is intentional. The capture slice needs configured
locations to check against on the day it lands, and shipping the master separately keeps that
slice to one concern.

### 8. Transactions and locking

**This slice writes no `budget_txn` and no `quota_usage` rows, and issues no document
numbers.** There is no reserve/actual/release sequence to order and no `PESSIMISTIC_WRITE`
lock to take. Writes are ordinary single-aggregate master-data mutations under MikroORM's unit
of work.

The one place locking is required is `employee_shift` creation and update. The overlap check
(decision 4) reads sibling rows and then writes, and a transaction by itself does not make that
safe: at READ COMMITTED the read takes no lock, so two concurrent assignments both see a clear
field and both commit. The employee row is therefore taken under `LockMode.PESSIMISTIC_WRITE`
before the scan, inside a single `em.transactional(...)`, serializing every write to that
person's timeline.

So this *is* the contended-reservation pattern budget and numbering use, applied to a different
scarce resource — an earlier draft of this document claimed otherwise and was wrong; the
concurrency test in task 8.5 is what settled it. Traffic is low, but correctness here does not
depend on that.

### 9. The snapshot contract for the next slice

Recorded here because it constrains this slice's shape even though it is implemented later:
`attendance_day` will copy `expected_in`, `expected_out`, `expected_minutes` and `shift_code`
onto each daily row at computation time and judge against the copy, never re-reading the live
shift.

That is what makes `work_shift` safe to edit. Without it, HR moving the office start time from
08:00 to 08:30 in July would, on the next recompute, retroactively un-late every person who
arrived at 08:15 in June. All four values are flat scalars derivable from a shift plus a date —
no joins, no interpretation — which is the property this slice's schema has to preserve.

## Risks / Trade-offs

- **Backfilled timezone is wrong for a company that is not in Thailand** → Every company in the
  data today is; the column is admin-editable from day one; and because no attendance data
  exists yet, correcting it reinterprets nothing. The risk window closes permanently once the
  capture slice ships, which is the argument for adding the column in this slice rather than
  that one.

- **Shift edited retroactively rewrites history** → Not preventable in this slice, which is why
  decision 9 fixes the snapshot contract in writing before the consuming code is designed.
  Deactivation-over-deletion also keeps a superseded shift resolvable for any row that
  references it.

- **Overlapping `employee_shift` ranges slip past a service-level check under concurrency** →
  The check runs inside the write transaction, and the admin write path is low-traffic. The
  residual race is a same-instant double assignment for one employee; a `btree_gist` `EXCLUDE`
  constraint closes it completely and is recorded as hardening rather than quietly omitted.

- **`work_shift_day` is more machinery than "which days does this shift work"** → Accepted
  deliberately. It costs one small static table and buys Saturday half-day, which no flag-based
  representation can express and which is common enough in this market that discovering it
  after `attendance_day` exists would mean migrating live historical data.

- **The scope grew from three new tables to four** (`work_shift`, `work_shift_day`,
  `employee_shift`, `work_location`) **plus one new column on `department`** → The additions are
  decisions 2 and 4 and both are called out above; neither adds a new concept, they change how
  the weekday pattern and the department default are represented. Flagged explicitly so it can
  be vetoed rather than absorbed.

- **Minutes-from-midnight is less readable than `time` in raw SQL** → Real, and the price of
  removing a contradictable flag. Mitigated by DTOs speaking `"HH:MM"` at both edges, so only
  someone reading the table directly sees the integers.

## Migration Plan

1. **Forward migration**, one file, additive only:
   - create `work_shift`, `work_shift_day`, `employee_shift`, `work_location`;
   - add `company.timezone` nullable, backfill `'Asia/Bangkok'`, set `not null`;
   - add `employee.attendance_required` (`not null default true`) and
     `employee.employment_type` (`not null default 'MONTHLY'` with a check constraint);
   - add `department.default_work_shift_id` (nullable FK).
2. **Update `erp_approval_system.dbml`** in the same change so the canonical model and the
   migration stay in step.
3. **Seed** an `OFFICE` shift (08:00–17:00, 12:00–13:00 break, Mon–Fri, grace 15) and one
   `work_location` for the demo company, plus the two permission codes granted to the `ADMIN`
   role — enough for the capture slice to have something to punch against.

**Rollback:** every column is additive with a default and every table is new, so the down
migration is a plain drop with no data reinterpretation. Nothing existing reads the new
columns, so a partial deploy is inert rather than broken.

## Open Questions

- Should `work_shift_day` carry the per-day `start_minute` / `end_minute` override columns now,
  or only `is_working`? Including them costs nothing at creation and avoids a migration when
  Saturday half-day is configured; the design assumes they are included.
- Should the department default eventually be date-ranged? Decision 4 says no. If a real case
  appears where a whole department's hours change on a date and per-employee rows are too
  coarse, that is a `department_shift` table in a later slice, not a change here.
- `WorkingTimeService` keeps computing in UTC after this slice. Retrofitting it to
  `company.timezone` shifts existing approval SLA boundaries by up to seven hours and deserves
  its own change with its own tests — worth scheduling, out of scope here.
