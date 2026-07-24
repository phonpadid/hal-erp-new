## Context

Five slices produced a complete picture of what happened, and every part of it is deliberately mutable. `attendance_day` is a projection: the shift slice snapshots the roster onto it, the daily slice recomputes it from the ledger, the leave slice excuses days on it, the overtime slice reads it, and the correction slice moves the ledger under it. Nothing in that arrangement has a notion of "settled", which is correct right up to the moment money is paid against a number.

Two earlier slices left this door open on purpose. `attendance_day.computed_at` is documented as *"where a future period close can anchor without migrating old data"*, and `company.correction_window_days` says outright that *"its real purpose arrives with period close"*. Neither invented a period; both left the seam.

The constraint that shapes everything here: **the ledger must never refuse truth, and a frozen number must never quietly change.** Those pull in opposite directions the moment a punch arrives for a day that has already been paid.

## Goals / Non-Goals

**Goals:**

- A company declares a period as a dated range and closes it, producing one row per employee that payroll can consume and HR can read as a discipline record.
- Closing freezes the projection for that range: the same period read tomorrow reports what it reported at close.
- Anything that could only take effect by changing a frozen day is refused at the point it is raised, not silently accepted.
- Reopening exists, is permission-gated, requires a reason, and is auditable.
- Whether attendance drives pay is configuration at two levels, and is stamped onto the line so an export stays reproducible after the configuration changes.

**Non-Goals:**

- Payroll. No rate, no money, no deduction rule, no gross-to-net. This slice exports minutes and days by kind; multiplying them is another system's job, and keeping rates out is what lets one schema serve a Thai company and a Lao one (invariant 7).
- The paid/unpaid split of leave. That boundary is an annual cumulative rule ("the first 30 days of sick leave in a year are payable"), so it is not answerable from one month's figures. The summary reports days by type and stops there.
- A file format. There is no CSV, no bank layout, no payroll-vendor schema — those belong with an export slice that knows its counterparty.
- Locking `attendance_event`. The ledger stays append-only and stays open.

## Decisions

### 1. A period is an explicit date range, not a month

`period_start` and `period_end` are stored dates. A payroll cut-off of the 26th to the 25th is then as ordinary as a calendar month, and nothing in the code has to know which a company uses.

*Alternative rejected:* store `year` + `month` and derive the range, the way `quota_entitlement` stores a year. It is smaller, and it makes the 26th-to-25th cut-off — which is the common case in Thai payroll, not an exotic one — impossible to express without a second concept layered on top. The quota slice already demonstrated the cost of a period keyed by year: the `WEEKLY` reset cycle turned out to be structurally impossible to express, and the overtime slice had to reframe its weekly ceiling as validation instead.

Periods of one company **may not overlap**, enforced by a range check at create. Without that, "is 2026-07-15 closed?" has more than one answer, and every gate below depends on it having exactly one. Gaps between periods are allowed: a company that does not declare August simply has no closed August.

### 2. The ledger stays open; only the decisions that would do nothing are refused

This is the central choice, and it resolves the tension named in the context.

A punch whose shift date lands in a closed period **is still recorded**. The capture slice's stance is already that attendance data is captured even when it will not be judged — `attendance_required = false` stores the punch anyway, "guarding against data loss, not against writing". A device that uploads yesterday's batch after the close should not lose it, and an inert row that a reopen would pick up is strictly better than a rejected one that is gone.

But a day inside a closed period **is not recomputed**. That is what makes the frozen number stay frozen, and it is the single rule the other three gates follow from: a correction, a leave request, or an overtime claim reaching into a closed period could only take effect by recomputing a day that will not be recomputed. Accepting them would route a human decision into silence. So each is **rejected at the point it is raised**, with a message naming the period.

*Alternative rejected:* block capture too. It is simpler to state — "a closed period accepts nothing" — and it throws away real observations to buy that simplicity. The asymmetry is not an inconsistency: recording what happened and deciding what it means are different acts, and only the second one has anything to be frozen about.

*Alternative rejected:* accept corrections into a closed period and let them apply on reopen. It sounds accommodating and it is a trap: the requester is told yes, the day does not move, and the discrepancy surfaces months later with nobody able to say when it started.

### 3. Overtime in the summary is re-derived per day, not summed from claims

`overtime_claim` carries totals for a date **range**. A claim covering the 24th to the 27th, in a period that ends on the 25th, cannot be split from the claim row alone — the three minute columns are already aggregated.

So the summariser walks the period's dates, asks which of them an approved claim covers (`OvertimeClaimService.claimedDates` already answers exactly this), and sums those days' own `ot_normal_minutes` / `holiday_work_minutes` / `ot_holiday_minutes` from `attendance_day`. A straddling claim then contributes only its in-period days, and the figure remains reproducible from the projection.

The three kinds stay separate all the way to the line, for the reason the DBML gave when `attendance_day` first split them: Thai law pays 1.5×, 2× and 3× for different work, `employment_type` moves holiday work again between monthly and daily staff, and **a total cannot be taken apart again**.

Overtime that was observed but never certified is carried as one `uncertified_ot_minutes` total, deliberately **not** split by kind. Splitting it would invite someone to multiply it by a rate. Its only job is to let HR see that hours went unclaimed.

### 4. Leave days go in a child table, by type

A line cannot carry a column per leave type: leave types are `quota` rows a company configures (invariant 7). `attendance_period_leave` holds `(line, quota, days)`.

Days are counted the way the leave slice already counts them — per date covered by approved leave, at the half stored on the request — so a half-day of a Saturday 08:00–12:00 shift counts 0.5 of *that day*, not half of eight hours. Reusing `countLeaveDays` rather than restating the rule is the point; two implementations of "how many days is this leave" would drift.

### 5. The lines are a snapshot, the log is a ledger

`attendance_period_line` and `attendance_period_leave` are **projections**, like `attendance_day`: a re-close after a reopen must overwrite them, so they stay out of `LedgerGuardSubscriber`. Nothing about them claims to be an audit trail.

`attendance_period_log` **is** append-only and joins `budget_txn` and `approval_log` under the guard. One row per CLOSE and per REOPEN, carrying the actor, the instant and a reason. That is where "who reopened July, and why" is answered — and the reason is mandatory on a reopen, because reopening a paid period is the kind of act that should cost a sentence.

*Alternative rejected:* keep every revision of the lines. It answers "what did the first close report?" and it doubles the model to do it — a revision number on two tables, and every read having to say which revision it means. The log records that a reopen happened and who authorised it; a payroll system that has already paid holds its own record of what it paid.

### 6. Closing takes the period row `FOR UPDATE`

Two concurrent closes would both read `status = DRAFT`, both write a full set of lines, and leave duplicates or a half-merged set. `lockForUpdate` on the period inside `em.transactional`, exactly as the previous four slices did for their own read-then-write hazards — this module has hit that hazard once per slice, and it is cheaper to assume it than to discover it again.

The whole close is one transaction: the status flip, the lines, the leave children and the log row commit together or not at all. A half-closed period is not a state anyone should have to reason about.

### 7. Whether attendance drives pay is two-level configuration

`department.attendance_affects_pay` (not null, default true) with `employee.attendance_affects_pay` (nullable — unset means inherit). This is the shape `department.default_work_shift` established in the shift slice, for the same reason: policy is usually departmental and occasionally personal.

It is **stamped onto the line at close**, alongside `employment_type`. Both are read live everywhere else, but an export produced from a closed period must not change meaning because someone edited a flag afterwards — the same argument the shift snapshot on `attendance_day` makes.

It does not change any computation. Discipline figures are produced for everyone whose attendance is required; the flag only says whether this line is one payroll should act on.

### 8. Four permission codes

`ATTEND_PERIOD_READ` (see periods and lines), `ATTEND_PERIOD_MANAGE` (declare and edit a draft period), `ATTEND_PERIOD_CLOSE`, `ATTEND_PERIOD_REOPEN`.

Reopening is separated from closing rather than folded into it because they are not the same power: closing is routine month-end work, and reopening reaches back into a period someone may already have paid against. A role that closes every month should not thereby be able to reopen last quarter.

## Risks / Trade-offs

**A punch recorded into a closed period is invisible in the figures.** → It is stored, and it is *findable*: a read lists events whose shift date falls in a closed period with no corresponding recompute, so month-end has something to look at rather than a silence. Reopening is the remedy, and it is one call.

**Non-overlap is enforced at create, not by the database.** → A range-overlap exclusion constraint needs `btree_gist`, an extension this schema does not otherwise use. The check runs inside the create transaction with the company's periods locked, which closes the concurrent-insert window; the trade is one extension avoided against a guard that lives in code. Stated here so a future slice can promote it if periods ever become high-volume.

**`claimedDates` and `countLeaveDays` are called per period, per employee.** → For a 31-day period and a few hundred employees that is a few hundred bounded scans, and closing is a month-end action, not a request path. If it becomes slow the fix is a range query per company rather than per employee — a change inside the summariser with no model consequence.

**Reopening loses the previous close's figures.** → Accepted, and documented in decision 5. The log preserves that it happened and who did it. If a company needs the old numbers they exist in whatever consumed the export.

**The period gate must be consulted by four services, and a fifth could forget.** → One `AttendancePeriodGuard` with a single `assertOpen(companyId, date)` — not four copies of the query — and a test that enumerates the services which must call it, in the same shape as the permission spec that enumerates routes.

**A leave request spanning a boundary is refused entirely.** → Correct, and worth stating: leave from the 24th to the 27th across a close on the 25th is refused rather than partially accepted, because half an approved leave is not a thing the leave slice can represent. The requester raises two requests, which is also what the two periods will pay against.

## Migration Plan

Purely additive. Four new tables, two new nullable-or-defaulted columns, two new enums; nothing existing is altered or dropped, and no data is backfilled — a company with no declared periods behaves exactly as it does today, because every gate asks "is this date inside a CLOSED period?" and the answer is no.

Verified forward and back on a scratch database before dev, as the last four slices were. Rollback is `down()`: dropping the four tables and the two columns restores the prior schema exactly, and the only thing lost is periods that were declared after deployment.

## Open Questions

- **Should a period be able to cover only some departments?** A group company might close head office before the factory. Deliberately not modelled: a period is company-wide here, and the moment it is not, "is this date closed?" needs an employee to answer it and every gate signature changes. Worth revisiting only if a real company asks.
- **Should closing require every day in the range to have been computed?** Currently it summarises whatever exists, and a never-computed day contributes nothing. A stricter close would refuse until the range is complete. Left open because the answer depends on whether recompute is scheduled or manual, which is not yet decided.
