## Context

The daily projection already computes overtime and splits it into the three kinds Thai law prices
differently. What it cannot do is say whether anyone agreed to pay for it — the spec calls those
minutes raw observations on purpose.

This slice adds the agreement. Structurally it is the leave slice again: a document whose quantity
the system derives, submitted through the capability that owns it because document-engine cannot
import a capability built after it. That pattern was settled last slice and this one should not
re-litigate it — the interesting decisions here are the ones leave did not face.

Three of those. Overtime is certified **after** the fact, where leave is requested before, which
inverts what "already counted" means. The same evening can be claimed twice unless something stops
it, where a leave range naturally cannot. And the statutory weekly ceiling is a limit on the
employer, not an allowance to the employee — which the exploration established rules out the quota
machinery entirely.

## Goals / Non-Goals

**Goals:**

- Turn recorded overtime into a claim that travels an approval workflow, without letting the
  claimant state the hours.
- Make it impossible to claim the same day's overtime twice.
- Enforce the statutory weekly ceiling from what attendance actually recorded, with no quota row.
- Keep `attendance_day` a pure projection: nothing about claiming may be written onto it.
- Preserve the split by kind all the way to the claim, since that is what an export prices.

**Non-Goals:**

- No pay rates, multipliers, or amounts. Hours by kind go out; whatever prices them applies the
  law of its own jurisdiction.
- No pre-approval of overtime ("may I work late on Thursday"). That is a different document with a
  different shape, and nobody has asked for it.
- No correction of the underlying attendance — a claim that looks wrong is fixed by correcting the
  punches (slice 6), not by editing the claim.
- No period close, no payroll export, no frontend.

## Decisions

### 1. Claim status is derived, not stamped on the day

The obvious implementation is a `claimed` flag or an `ot_claim_id` on `attendance_day`. It is
wrong for the reason that table exists: it is a projection, and recomputation must be able to
rebuild it from the ledger and configuration alone. A claim reference written onto it would be a
fact that recomputation cannot reproduce and would therefore destroy.

```
attendance_day   ← rebuildable from ledger + config, always
overtime_claim   ← names an employee and a date range
        │
        └─ "is this day claimed?"  =  a join, evaluated when asked
```

The cost is a join wherever claim status is displayed. That is cheaper than the alternative, which
is a projection that can no longer be thrown away.

### 2. A claim covers a date range, and the guard is against overlap

A claim names `from_date` / `to_date` in shift days. Claiming the same day twice is prevented by
rejecting a claim whose range overlaps an existing claim for that employee whose document is not
rejected or cancelled.

Pending claims block too, not just approved ones. A claim awaiting approval is a claim in flight;
allowing a second over the same evening would mean the first approver and the second are deciding
about the same hours without either knowing.

The overlap check reads sibling claims and then writes, so — for the third time in this module — it
runs inside one transaction with the employee row under `LockMode.PESSIMISTIC_WRITE`. The lesson
from slice 1 stands: a read-then-write at READ COMMITTED is not safe on its own, and the
concurrency test must be written so it would fail without the lock.

### 3. The claimed hours are summed from the days, by kind

```
for each shift day in the range:
    ot_normal_minutes        ─┐
    holiday_work_minutes     ─┼─ summed separately, never totalled
    ot_holiday_minutes       ─┘
```

Kept separate to the end because Thai law pays them at 1.5×, 1× or 2×, and 3× respectively, and
because `employee.employment_type` changes the holiday-work multiple again for daily-paid staff.
A single total cannot be un-split, which is why slice 3 stored three columns rather than one.

A claim whose days sum to zero overtime is rejected: there is nothing to certify, and accepting it
would put an empty document through an approval chain.

### 4. The weekly ceiling is a validation over `attendance_day`, not a quota

Thai law caps overtime plus holiday work at 36 hours a week. The exploration established why this
cannot be a quota, and the reason is structural rather than stylistic:

```
quota_entitlement  unique (quota_id, employee_id, year)
                              ▲
        one row per YEAR. A weekly personal quota needs 52.
        `quota_usage` could carry the period; the entitlement has nowhere to put it.
```

And it is the wrong shape anyway: 36 hours is identical for everyone, is never carried forward, is
not granted to anybody, and nobody asks "how much overtime do I have left". It is a limit on what
an employer may ask for — a validation rule, and every minute it counts is already in
`attendance_day`.

So: at submit, for each ISO week touched by the claim, sum all three overtime columns across that
week's days and reject if the total exceeds the configured ceiling. The ceiling is configuration
per company, not the constant 36, because Lao law differs and this platform serves both.

**Counted from recorded attendance, not from claims** — an employee who worked 40 hours of overtime
and claims only 20 has still worked 40, and the ceiling is about hours worked. That also means the
check can fail for a claim that is itself modest, which is correct and needs a clear message.

### 5. Approval changes nothing about the day

Leave needed a recompute-on-approval listener because approving leave changes what a day *was* —
`ABSENT` becomes `LEAVE`. Overtime does not: the minutes were recorded when they happened and
approval does not alter them. What changes is whether they are claimed, and by decision 1 that is
derived rather than stored.

So this slice adds **no listener**, and the seam leave opened stays as it is. Worth stating
explicitly, because the symmetry with leave invites copying a listener that would have nothing to
do.

### 6. The OT quota is optional

Where a company tracks `OT_HOURS` as an allowance, the claim reserves against it through the
unchanged quota machinery. Where it does not, there is no such quota and the claim still works.

This is deliberate: the statutory ceiling (decision 4) is the rule that actually binds, and it is
enforced without a quota. An OT quota is a company's own budget for overtime spending, a different
and optional concern. Making the claim depend on one would force every company to model a
constraint only some of them have.

### 7. Transactions and locking

**This slice writes `quota_usage`** when an OT quota is configured, so it inherits the
reserve/release sequencing rule: the USE row and the status transition commit together, and
reject/cancel inserts RELEASE rows for the outstanding amount in the same period (invariants 4/5).
That path is the existing one and is not modified.

Two boundaries are this slice's own:

- **The overlap guard** (decision 2): employee row `FOR UPDATE`, check, insert, one transaction.
- **The submit path**: the ceiling check, the hour summation and the reservation are one
  transaction, so a claim cannot be reserved against a ceiling that a concurrent claim has since
  consumed.

No budget row is written and no document number is issued beyond the engine's own.

## Risks / Trade-offs

- **Deriving claim status means a join wherever it is shown** → Accepted. The alternative writes an
  unreproducible fact onto a projection whose whole value is that it can be rebuilt. If the join
  becomes a cost, it is a materialised read model on top, not a column on `attendance_day`.

- **The weekly ceiling can reject a small claim because of unclaimed hours elsewhere in the week**
  → Correct but surprising, so the error must say which week and what the recorded total was.
  Counting only claimed hours would let an employer stay under the cap by simply not certifying —
  which is the abuse the cap exists to prevent.

- **A claim spanning a week boundary is checked against two weeks** → Intended, and both must pass.
  Worth a test, because the off-by-one that treats the boundary week as one is easy to write.

- **Pending claims block later ones over the same days** → A claim stuck unapproved therefore
  blocks its days indefinitely. Mitigated by cancellation being available, and by the fact that the
  alternative — letting two approvers each decide about the same evening — is worse.

- **Slice 3's overtime split has never been exercised by anything downstream until now** → The
  three columns were written on the argument that a total cannot be un-split. This slice is the
  first consumer and therefore the first real test of whether they were split usefully.

## Migration Plan

1. **Forward migration**, additive only: create `overtime_claim` with its foreign keys, an index on
   `(company_id, employee_id, from_date)` for the overlap check, and a check that
   `to_date >= from_date`.
2. **Update `erp_approval_system.dbml`**.
3. **Seed** an overtime document type with `requires_quota` false and `derives_quantity` true, plus
   a company weekly-ceiling setting, so the refusal path and the ceiling are both visible in dev
   data.
4. No backfill — claims start empty, and existing `attendance_day` rows are already claimable by
   virtue of having recorded minutes.

**Rollback:** drop the table. `attendance_day` is untouched by design, so nothing about the
projection depends on this slice having run.

## Open Questions

- Where does the weekly ceiling live — a column on `company`, or a row in a per-company settings
  table this codebase does not yet have? A column is the smaller change and matches `timezone`,
  which went on `company` for the same reason.
- Should a supervisor be able to certify overtime for someone with no login account, as HR can
  record their attendance? The beneficiary machinery from leave would carry over unchanged; the
  question is whether that workflow is wanted.
- Whether a claim should be allowed to cover only *part* of a day's overtime. This design says no —
  a claim takes a day's recorded minutes whole — because partial certification invites the argument
  about which minutes were "real" that the ledger exists to end.
