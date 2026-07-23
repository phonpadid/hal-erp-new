## Why

The ERP has no notion of *when* an employee is expected to be at work. `employee` records
who they are, `holiday_calendar` records when the company is closed, and `quota` already
models leave days and OT hours — but nothing states that Somchai works 08:00–17:00
Mon–Fri with a one-hour break, or that arriving at 08:10 is still on time.

Every downstream attendance slice (time capture, daily status, leave, OT certification,
correction requests) needs that expectation to exist first: you cannot say "late" without
a scheduled start, and you cannot say "absent" without knowing today was a working day.
This slice lays that foundation and nothing else — it adds no time records and changes no
runtime behaviour.

It also closes a latent defect that only becomes visible once attendance lands: `company`
carries no timezone, and every date calculation in the system today runs in UTC
(`WorkingTimeService` uses `getUTCDay()` and `toISOString().slice(0, 10)`). An approval SLA
that lands on the wrong side of midnight is a nuisance; an attendance day that lands on the
wrong side of midnight is a wrong "absent" mark on a real person's record.

## What Changes

- **New `work_shift` master (per company).** Scheduled start/end, break window, standard
  working minutes, which weekdays the shift works, and the policy dials that turn raw
  clock times into judgements: `grace_minutes` (arrive within this and you are not late),
  `half_day_threshold_minutes` (arrive after this and the morning is lost),
  `ot_min_minutes` / `ot_round_minutes` (overtime is rounded down in blocks and ignored
  below a floor). A `crosses_midnight` flag marks night shifts whose end time is on the
  following calendar day.
- **New `employee_shift` assignment.** Binds an employee to a shift over a date range
  (`effective_from` / `effective_to`, open-ended when null). Fixed assignment only — no
  rotating day-by-day roster. A department-level default shift covers employees with no
  explicit assignment.
- **New `work_location` master (per company).** A named point (`latitude`, `longitude`)
  with a `radius_meters` and a `control_policy` reusing the existing `HARD_STOP` /
  `SOFT_WARNING` enum, defaulting to `SOFT_WARNING`. Nothing enforces it in this slice; the
  policy is declared here so the capture slice has a configured target to check against.
- **`company.timezone` added.** An IANA zone name (e.g. `Asia/Bangkok`) that defines when
  a calendar day starts and ends for that company. Backfilled to a single default so no
  existing row is left null.
- **`employee.attendance_required` added** (boolean, default true) so executives and field
  staff who never clock in are not reported as absent, and **`employee.employment_type`
  added** (`MONTHLY` / `DAILY` / `HOURLY`) because Thai labour law pays holiday work at a
  different multiple for monthly-paid versus daily-paid staff — the distinction has to
  exist before any figure is exported.
- **New permission codes** `ATTEND_SHIFT_MANAGE` (write shifts, assignments, locations) and
  `ATTEND_SHIFT_READ` (read them), gating every new endpoint by code, never by role name.
- **CRUD endpoints** for all three masters under the active-company scope, with
  class-validator DTOs, deactivation instead of deletion, and `(company_id, code)`
  uniqueness on `work_shift`.
- **`erp_approval_system.dbml` updated** with the three new tables and the three new
  columns, keeping the canonical model in step with the migration.

Not in this slice, deliberately: `attendance_event`, `attendance_day`, punch endpoints,
geofence enforcement, leave documents, OT certification, and the `quota` changes those
need (`control_policy`, `is_paid`, a `WEEKLY` reset cycle). Those land in later slices.

## Capabilities

### New Capabilities
- `attendance-shift`: company-scoped work-shift definitions, employee-to-shift assignment
  over effective date ranges with a department default, work-location geofence
  definitions, and the `ATTEND_SHIFT_MANAGE` / `ATTEND_SHIFT_READ` permission codes that
  gate them.

### Modified Capabilities
- `multi-company`: the Company Registry requirement gains a `timezone` — companies now
  declare the zone in which their calendar days are reckoned, so day-boundary decisions
  stop being implicitly UTC.
- `employee-registry`: the Employee Registry Management requirement gains
  `attendance_required` and `employment_type`, and the shift a given employee is expected
  to work on a given date becomes a derivable property of the registry.

## Impact

**Schema** — three new tables (`work_shift`, `employee_shift`, `work_location`); three new
columns (`company.timezone`, `employee.attendance_required`, `employee.employment_type`).
One forward migration; all three columns are additive with defaults, so no existing row
breaks and there is no BREAKING change.

**Backend** — a new `attendance` module (entities, service, controller, DTOs, permission
codes) following the shape of `modules/job-level`. `Company` and `Employee` entities in
`multi-company` / `rbac` gain properties. `erp_approval_system.dbml` is amended.

**Frontend** — none in this slice; the admin UI arrives with `web-attendance`.

**Invariants** — every new table carries `company_id` and is read through
`CompanyScopeService` (invariant 1). `employee_shift` references an `employee` and a
`work_shift` that must both belong to the active company. No ledger, budget, quota, FX, or
approval path is touched, so invariants 2, 3, 4, 6 and 8 are not in play. Authorization is
by permission code (invariant 5), and all shift behaviour is configuration read at runtime
rather than per-company branching in code (invariant 7).

**Forward constraint** — `work_shift` rows are mutable master data, but a later
`attendance_day` must not silently rewrite history when HR edits a shift. This slice
therefore fixes the contract that the daily projection will snapshot the values it judged
against (expected in, expected out, expected minutes, shift code) rather than re-reading
the live shift. The shift table is shaped so that snapshot is a plain copy of four fields.
