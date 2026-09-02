## Why

`attendance-daily` already counts overtime, split into the three kinds Thai law prices
differently, and the spec is explicit that those minutes are **raw observations**: they confer no
entitlement, reserve no quota, and carry no pay rate. Somebody stayed late; nobody has agreed to
pay for it.

This slice supplies the missing half — the act of agreeing. An employee or their supervisor
certifies overtime that was actually worked, it travels the approval workflow, and only on approval
does it become a claim anyone owes anything for. It is the last slice that adds a new kind of
document to attendance; everything after it is correction and frontend.

It also brings the statutory weekly ceiling, which the exploration established is **not** a quota:
36 hours of overtime and holiday work per week is a limit on what an employer may ask, not an
allowance an employee is granted, and every minute it counts is already recorded in
`attendance_day`.

## What Changes

- **New `overtime_claim` table**, one row per overtime document, naming the employee and the range
  of shift days it certifies. Certification is retrospective by definition: you cannot certify
  hours that have not been worked, so a claim always points at days the projection has already
  computed.
- **A claim's hours come from `attendance_day`, never from the claimant.** The same rule leave
  settled: the quantity is derived, so the document type carries `derives_quantity` and the generic
  submit endpoint refuses it. `POST /overtime-claims/:documentId/submit` re-reads the days, sums
  the raw minutes by kind, and reserves that.
- **Only unclaimed minutes may be claimed.** A day already covered by an approved or pending claim
  cannot be claimed again — otherwise the same evening is paid twice. The check is against existing
  claims, not a flag on the day, so the projection stays a pure function of the ledger.
- **`attendance_day` gains `ot_claim_id`-free reporting of what has been certified**, derived by
  joining claims rather than stored, keeping the projection rebuildable.
- **The statutory weekly ceiling is enforced at submit, from `attendance_day`.** The sum of
  `ot_normal_minutes + holiday_work_minutes + ot_holiday_minutes` across the ISO week containing
  each claimed day is checked against a configured limit. No `quota` row, no `WEEKLY` reset cycle —
  `quota_entitlement` is keyed `(quota, employee, year)` and cannot hold 52 weekly entitlements,
  which is what ruled that approach out.
- **Approved claims consume the `OT_HOURS` quota** where a company chooses to track one, using the
  quota machinery unchanged. A company that does not track OT as an allowance simply has no such
  quota and the claim still works.
- **Approval recomputes nothing.** Unlike leave, certifying overtime does not change what any day
  *was* — the minutes were already there. What changes is whether they are claimed, which is a
  property of the claim, not of the day.
- **New permission codes** `OT_CLAIM_MANAGE` (certify on someone's behalf, configure the ceiling)
  and reuse of the existing document codes for raising one's own.
- **`erp_approval_system.dbml` updated** with the new table.

Not in this slice: pay rates or amounts of any kind — the export carries hours by kind and whatever
prices them applies the multipliers, because this platform spans jurisdictions whose rates differ.
Also not here: correction requests, period close, payroll export, and frontend.

## Capabilities

### New Capabilities
- `attendance-ot`: the `overtime_claim` record, derivation of claimable hours from
  `attendance_day`, the double-claim guard, the statutory weekly ceiling checked from recorded
  attendance rather than from a quota, the owning submit endpoint, and `OT_CLAIM_MANAGE`.

### Modified Capabilities
- `attendance-daily`: the raw-overtime requirement currently says those minutes carry no
  entitlement and are not claimable. Half of that stays true — they still carry no rate — but
  "not claimable" stops being true here, and the requirement must say what makes a minute claimed.

## Impact

**Schema** — one new table, `overtime_claim`. No existing column changes; the daily projection is
untouched, which is the point of deriving claim status rather than stamping it.

**Backend** — a new overtime service and controller in the `attendance` module, reusing the
leave-shaped pattern: `derives_quantity` on the type, an owning submit endpoint, rules enforced at
that boundary. `AttendanceDayService` gains a read of claimable minutes; nothing about how days are
computed changes.

**Frontend** — none in this slice.

**Invariants** — `overtime_claim` carries `company_id` and is read through `CompanyScopeService`
(invariant 1). Quota reservation, where a company uses one, runs unchanged inside one transaction
with the entitlement locked, and reject/cancel auto-releases (invariants 4/5). `attendance_day`
stays a pure projection of the ledger — claim status is derived by joining, never written onto it
(invariant 3). The weekly ceiling is configuration, not a hardcoded 36 (invariant 7), because Lao
law differs from Thai.

**Sequencing note** — this slice writes `quota_usage` when a company tracks an OT quota, so it
inherits the reserve/release rule: the USE row and the document's status transition commit
together, and reject inserts RELEASE rows for the outstanding amount in the same period.
