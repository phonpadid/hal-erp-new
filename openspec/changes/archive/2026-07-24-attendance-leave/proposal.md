## Why

`attendance-daily` computes a verdict for every day, and for anyone on approved leave that verdict
is currently **`ABSENT`** — because leave does not exist yet. The projection is right about what it
can see and wrong about the world, which makes absence reporting unusable until this lands.

Leave is also the slice where the module stops being self-contained. Everything so far read
configuration and wrote its own tables; this one draws down an entitlement, travels an approval
workflow, and feeds a figure that eventually reaches payroll. It is therefore the first slice that
must change capabilities already shipped, and the proposal says exactly where and why rather than
discovering it during implementation.

## What Changes

- **New `leave_request` table**, one row per leave document. Stores the request as a *range with
  half-day ends* — `from_date` / `from_half`, `to_date` / `to_half` — not as a number of days. A
  half day is not 0.5 of a quota; it is a specific morning or afternoon, and the daily projection
  cannot decide whether a 13:00 arrival was late without knowing which half was taken.
- **Leave consumes working days only.** A request spanning a public holiday or a shift day off
  charges neither. Counting them requires the shift *and* the holiday calendar for every date in
  the range — which is exactly what `ShiftResolutionService.resolveRange` was built for in the
  previous slice.
- **`quota.control_policy` added**, reusing the existing `HARD_STOP` / `SOFT_WARNING` enum. Thai
  law entitles an employee to sick leave *for as long as they are actually sick*; a system that
  blocks at the paid ceiling is not implementing the law, it is contradicting it.
- **`quota.paid_limit_value` added** — the ceiling up to which leave is *paid*, separate from the
  ceiling up to which it is *allowed*. This replaces the `is_paid` flag floated earlier, which
  cannot express the case that actually decides the design: an employee at 28 sick days requesting
  5 more takes 2 paid and 3 unpaid, so the paid/unpaid boundary falls **inside a single request**
  and cannot be a property of the quota as a whole. Maternity leave has the same shape (98 days
  allowed, 45 paid), which is the second witness that this is the right axis.
- **`related_employee_id` becomes the quota beneficiary when set.** Today the submit path always
  charges the *submitter's* employee. That is correct for self-service but wrong for the case slice
  2 already built for — HR acting on behalf of staff with no login account — where it would charge
  the leave to HR.
- **`LEAVE` becomes a reachable day status**, slotting between `EXEMPT` and `ABSENT` exactly where
  `attendance-daily` reserved it. A half day of leave halves the day's expected minutes rather than
  excusing the whole day, so an employee on afternoon leave who never arrives in the morning is
  still short.
- **Approving leave triggers recomputation of the covered dates**, after the approval commits and
  without rolling it back on failure. A human decision must not be discarded because a derived
  number could not be written.
- **A stale-day read** answers "which approved leave has not reached the projection yet", using the
  `computed_at` the previous slice put on every row against the document's `approved_at`. No new
  table and no flag — the staleness was already detectable, it just had no query.
- **New permission code** `LEAVE_MANAGE` for administering leave types; requesting leave is
  governed by the existing document permissions, because a leave request *is* a document.
- **`erp_approval_system.dbml` updated** with the new table and the two new `quota` columns.

Explicitly dropped from the earlier plan: a `WEEKLY` reset cycle. `quota_entitlement` is keyed
`(quota, employee, year)` and allows one row per year, so a weekly personal quota has nowhere to
store 52 entitlements. The statutory 36-hour weekly overtime ceiling it was meant to serve is not
an entitlement anybody is granted — it is a validation rule over hours already recorded in
`attendance_day`, and it belongs to the overtime slice with no quota row at all.

Also not in this slice: certified overtime, correction requests, period close, payroll export, and
any frontend.

## Capabilities

### New Capabilities
- `attendance-leave`: the `leave_request` range-with-halves record, working-day counting against
  the shift and holiday calendar, paid/unpaid apportionment across the paid ceiling, leave-aware
  day status, recomputation on approval, the stale-day read, and `LEAVE_MANAGE`.

### Modified Capabilities
- `quota-management`: **Over-Quota Enforcement** stops being an unconditional `MUST block` and
  becomes policy-dependent; **Quota Definition** gains `control_policy` and `paid_limit_value`;
  **Concurrency-Safe Quota Reservation** must state what a `SOFT_WARNING` quota does under
  contention, since "exactly one wins" is no longer the whole answer.
- `document-engine`: **Personal-Quota Beneficiary Resolution at Submit** resolves to
  `related_employee_id` when the document carries one, falling back to the submitter. The
  protection it exists for is preserved — a client-supplied `employee_id` is still ignored.
- `attendance-daily`: **Day Status Resolution** gains the `LEAVE` branch it reserved a slot for,
  and half-day leave reduces the day's expected minutes.

## Impact

**Schema** — one new table (`leave_request`), two new nullable columns on `quota`. Both columns are
additive with defaults that preserve today's behaviour exactly: `control_policy` defaults to
`HARD_STOP`, so every existing quota keeps blocking, and a null `paid_limit_value` means "paid up
to the limit", which is what every existing quota already implies.

**Backend** — a new leave service and controller in the `attendance` module; `QuotaUsageService`
gains policy-aware enforcement and a paid/unpaid split; `DocumentSubmitService` changes beneficiary
resolution; `AttendanceDayService` gains a leave input.

**Frontend** — none in this slice.

**Invariants** — `leave_request` is company-scoped through its document (invariant 1). Quota
reservation stays inside one transaction with the entitlement locked (the concurrency rule), and
reject/cancel still auto-releases (invariant 4/5). `quota_usage` remains the truth and paid/unpaid
is *derived* from it against `paid_limit_value` rather than stored per row — the same
derived-balance discipline as invariant 3. Leave behaviour is read from `document_type` and `quota`
configuration, not branched per company (invariant 7). No budget row, no FX, no document numbering
is touched.

**Risk concentration** — this is the first slice to weaken a shipped `MUST`. Every existing quota
is unaffected by default, and the loosening is opt-in per quota, but the change is to a code path
every quota in the system runs through, so its tests carry more weight than the new table's.
