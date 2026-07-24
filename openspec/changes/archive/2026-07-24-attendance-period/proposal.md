## Why

Five slices have made attendance *observable* — punches, days, leave, overtime, corrections — but nothing has ever made it **final**. Every number in `attendance_day` is a projection that any later approval can move, which is exactly right until the moment payroll pays on it. After that, a retroactive correction silently changes what someone was already paid for, and nobody can answer "what did July report?" because July is still moving.

The correction slice named this gap in its own code: `company.correction_window_days` carries the comment *"its real purpose arrives with period close"*, and `attendance_day.computed_at` was documented from the start as *"where a future period close can anchor without migrating old data"*. This is that slice.

It is also the destination the whole module was built toward: a per-employee, per-period figure that payroll consumes — and, for the people whose pay attendance does not drive, the same figures read as a discipline record instead.

## What Changes

- **A period is a dated range a company declares**, not a calendar month the code assumes. Explicit `period_start` / `period_end` so a 26th-to-25th payroll cut-off is as ordinary as a calendar month. Periods of one company may not overlap — otherwise "is this date closed?" has no answer.
- **Closing snapshots every employee's totals** into `attendance_period_line`: expected vs worked minutes, days present / absent / on leave, late minutes AND late occurrences (Thai discipline counts *times*, payroll counts *minutes* — keeping one loses the other), early-leave minutes, and certified overtime split by the three statutory kinds.
- **Leave days are carried by type**, in a child table rather than fixed columns, because leave types are configuration (invariant 7). The summary does **not** decide paid versus unpaid: that boundary is an annual cumulative rule, unanswerable inside one month.
- **Overtime in the summary is CERTIFIED overtime**, re-derived per day from `attendance_day` for the dates an approved claim covers — so a claim straddling the period boundary splits correctly. Observed-but-never-certified overtime is carried as a single total, deliberately unsplit: nobody will multiply it by a rate.
- **The ledger stays open; the decisions that would silently do nothing are refused.** A punch for a closed day is still recorded — the ledger never refuses truth, and losing a late device upload would be worse than storing an inert row. But a day inside a closed period is not recomputed, and therefore a correction, a leave request, or an overtime claim reaching into a closed period is **rejected** rather than accepted into ineffectiveness.
- **Reopening is allowed and audited.** Payroll periods do get reopened when something surfaces before the money leaves. Every close and every reopen is an append-only log row with an actor and a reason.
- **Whether attendance drives pay becomes configuration**, set on the department and overridable per person — the two-level pattern `department.default_work_shift` already established. It is stamped onto the line at close, so an export stays reproducible after the flag changes.
- Four permission codes, because closing, reopening, configuring and reading are four different powers: `ATTEND_PERIOD_READ`, `ATTEND_PERIOD_MANAGE`, `ATTEND_PERIOD_CLOSE`, `ATTEND_PERIOD_REOPEN`.

## Capabilities

### New Capabilities

- `attendance-period`: declaring a payroll/attendance period, closing it into a per-employee snapshot, reopening it under audit, and the rule that a closed period is not recomputed.

### Modified Capabilities

- `attendance-daily`: a shift date inside a closed period SHALL NOT be recomputed — the projection is frozen where a period has been closed over it.
- `attendance-correction`: a correction whose `shift_date` falls in a closed period is rejected, in addition to the existing rolling window. This is the enforcement `correction_window_days` was written in anticipation of.
- `attendance-leave`: leave overlapping a closed period cannot be raised or submitted, because approving it could not excuse an absence already reported.
- `attendance-ot`: an overtime claim covering dates in a closed period is rejected, for the same reason.
- `employee-registry`: an employee gains whether their attendance drives pay, inheriting from their department when unset.

## Impact

**New tables** (canonical DBML first): `attendance_period`, `attendance_period_line`, `attendance_period_leave`, `attendance_period_log` (append-only). **New columns**: `department.attendance_affects_pay`, `employee.attendance_affects_pay` (nullable — unset means inherit). **New enums**: `attendance_period_status`, `period_action`.

**Backend**: a new `AttendancePeriodService` (declare, close, reopen, read), a summariser that folds `attendance_day` + approved leave + approved overtime claims into lines, and a closed-period gate that `AttendanceDayService`, `TimeCorrectionService`, `LeaveRequestService` and `OvertimeClaimService` consult. `attendance_period_log` joins `budget_txn` and `approval_log` in `LedgerGuardSubscriber`; the lines do **not** — like `attendance_day` they are a snapshot a re-close must be able to overwrite.

**Invariants**: company isolation holds — a period, its lines and its log are all `company_id`-scoped and a period never spans companies. Invariant 2 is honoured by the log being append-only; the lines are explicitly a projection, not a ledger, and the design says so. No money appears anywhere in this slice: minutes and days by kind are exported and the rate is multiplied downstream, which is why Thai and Lao rates never enter the schema (invariant 7). No budget or quota is reserved, so no new concurrency test on numbering — but closing a period takes the period row `FOR UPDATE`, since two concurrent closes would otherwise both write lines.

**Not in scope**: payroll itself, money, pay rates, deduction rules, and any file-format export. This slice produces the figures; what multiplies them is another system.
