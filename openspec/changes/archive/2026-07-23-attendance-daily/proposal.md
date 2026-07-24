## Why

Two slices have shipped either half of the answer and neither can speak. `attendance-shift`
knows what was expected of a person on a date; `attendance-capture` knows what actually happened.
Nothing yet puts them side by side, so the system still cannot say whether anyone was late, absent,
or worked past their hours — the questions the module exists to answer.

This slice is the join. It produces one row per employee per shift day carrying the comparison:
when they were due, when they arrived, how long they worked once the unpaid break is taken out,
how late, how early they left, and how many minutes ran past the shift. It is the last slice that
computes anything from attendance alone; everything after it (leave, overtime certification,
correction requests) is approval workflow layered on top of these numbers.

## What Changes

- **New `attendance_day` projection.** One row per `(company, employee, shift_date)`, derived
  entirely from the `attendance_event` ledger plus configuration. It is a projection, not a
  ledger: it can be thrown away and rebuilt, and rebuilding it must reproduce the same numbers.
- **The shift is snapshotted onto each row.** `shift_code`, `expected_in_minute`,
  `expected_out_minute`, and `expected_minutes` are copied at computation time and judged against
  the copy. This is the contract `attendance-shift` fixed in writing precisely so that HR editing
  the office start time in July cannot retroactively un-late everyone who arrived at 08:15 in June.
- **Punches are collected by the shift's window, not by calendar date.** A 22:00–06:00 night shift
  has its check-in on one calendar day and its check-out on the next; grouping by `local_date`
  would split it into two half-days and mark both incomplete. The row for shift day D consumes the
  punches falling inside D's shift window, wherever their `local_date` lands.
- **Worked minutes deduct only the overlap with the break window**, as `attendance-shift`
  specified — an employee who leaves at 11:30 never sat through a 12:00–13:00 lunch and is not
  charged for it.
- **Lateness is counted twice, in minutes and in occurrences**, because the two have different
  consumers: minutes drive any pay deduction, occurrences drive the "late three times this month"
  disciplinary rule that Thai companies actually run on. Storing one loses the other.
- **Raw overtime is split into the three kinds Thai labour law pays differently** —
  `ot_normal_minutes` (past the shift on a working day), `holiday_work_minutes` (working a company
  holiday or a shift day off, within normal hours), and `ot_holiday_minutes` (past normal hours on
  such a day). Split at computation because a single total cannot be separated afterwards, and the
  multipliers (1.5× / 2× / 3× under Thai law, different under Lao) are deliberately **not** stored
  — this platform spans jurisdictions, so it exports hours by kind and lets the consumer price them.
- **Overtime here is raw and carries no entitlement.** Nothing is approved and no quota is touched.
  Slice 5 turns raw minutes into a certified claim; until then these are an observation, and the
  spec says so.
- **Day status resolution** in a fixed order: no shift → company holiday → shift day off →
  attendance-exempt → no punches → unpairable punches → present. Status says what the *day* was;
  the minute columns say what happened in it.
- **Recomputation** for one employee-day, an employee over a range, or a whole company for a date,
  guarded by permission codes. Capture stays ignorant of it: the ledger is the truth and the
  projection follows.
- **New permission codes** `ATTEND_DAY_READ` and `ATTEND_DAY_RECOMPUTE`.
- **`erp_approval_system.dbml` updated** with the new table and its status enum.

Deliberately not in this slice: leave (so `LEAVE` is not yet a reachable status — a working day
with no punches reports `ABSENT` until slice 4 lands and recomputation reclassifies it), approved
overtime, correction requests, period close, payroll export, and any frontend.

## Capabilities

### New Capabilities
- `attendance-daily`: the `attendance_day` projection, shift-window punch collection, break-aware
  worked minutes, lateness in minutes and occurrences, raw overtime split by kind, day status
  resolution, recomputation, and the `ATTEND_DAY_READ` / `ATTEND_DAY_RECOMPUTE` permission codes.

### Modified Capabilities
- `attendance-shift`: the shift-resolution requirement currently promises callers everything
  needed to judge a day. This slice is the first caller, and it needs one thing that requirement
  does not yet state — that resolution is available for a range of dates without a query per day,
  since recomputing a month for a company would otherwise issue one resolution per employee per
  date.

## Impact

**Schema** — one new table, `attendance_day`, plus an `attendance_day_status` enum. No existing
column changes. The table is a projection and starts empty; it is rebuilt by recomputation rather
than backfilled.

**Backend** — the `attendance` module gains the projection entity, a pure computation function
(punches + snapshot + holidays → numbers), a recompute service that persists its output, a
controller, and DTOs. `ShiftResolutionService` gains a range-aware read. Nothing in capture
changes.

**Frontend** — none in this slice.

**Invariants** — `attendance_day` carries `company_id` and is read through `CompanyScopeService`
(invariant 1). It is explicitly *not* append-only: it is derived, so a recompute overwrites it —
which is exactly why the ledger it derives from must never be. Its relationship to
`attendance_event` mirrors `stock_balance`'s to `stock_txn` (invariant 3): replaying the ledger
must reproduce the row exactly. Endpoints are gated by permission code (invariant 5), and every
threshold — grace, half-day, overtime floor and rounding — is read from `work_shift` configuration
rather than branched in code (invariant 7). No budget or quota row is written.

**Forward constraint** — these numbers are what a payroll export will eventually carry, and once
exported they must stop moving. This slice does not build period close, but it is the slice that
makes it necessary, and the design records what the row must already carry for close to be
addable without a migration of live history.
