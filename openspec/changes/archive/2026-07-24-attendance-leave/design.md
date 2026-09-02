## Context

Three slices have built a self-contained module: configuration, a ledger, and a projection over
them. This one connects it to the rest of the ERP. A leave request is a `document` travelling an
approval workflow, drawing down a `quota_entitlement`, and changing what `attendance_day` says
about the dates it covers.

That makes it the first slice that must modify capabilities already shipped and archived. The
proposal names them; this document explains why each change is the smallest one that works, and in
one case why the change proposed during exploration was wrong.

The decisive constraint arrived from Thai labour law rather than from the code. Sick leave is
payable for up to 30 days a year, but the *entitlement to be absent* is "as long as you are
genuinely sick". Two ceilings, not one — and an employee can cross the paid ceiling in the middle
of a single request.

## Goals / Non-Goals

**Goals:**

- Record a leave request precisely enough that the daily projection can judge a half day: which
  dates, and which half at each end.
- Charge only working days, resolved against the employee's own shift and the company's holidays.
- Let a quota express "allowed up to X, paid up to Y" without a per-row flag and without a sentinel
  value.
- Let a quota decline to block, without changing what every other quota does today.
- Make `LEAVE` a real day status, and make an approved leave reach the projection.
- Make it visible when it has not reached the projection yet.

**Non-Goals:**

- No certified overtime, no correction requests, no period close, no payroll export.
- No leave *balance forecasting* ("if I take these days, what's left in December") beyond the
  existing remaining-balance read.
- No approval-routing changes. Leave routes through `workflow` like any document; nothing here
  special-cases who approves leave.
- No `WEEKLY` quota cycle — dropped, with the reasoning below.
- No frontend.

## Decisions

### 1. `paid_limit_value`, not `is_paid`

The case that settles it:

```
employee has used 28 sick days      requests 5 more
   day 29, 30  -> paid              (inside the statutory 30)
   day 31,32,33 -> unpaid
                ▲
        the boundary falls INSIDE one request
```

An `is_paid` boolean on `quota` cannot express this: the quota is not paid or unpaid, the *usage*
is, and only past a threshold. An `is_paid` on `quota_usage` could, but then something has to
decide the split and write two rows — putting a derived fact into storage, where it can drift from
the ledger it was derived from.

So the quota carries two ceilings and paid/unpaid is computed:

```
quota
  limit_value       how much leave is ALLOWED
  paid_limit_value  how much of it is PAID   (null = the same as limit_value)

paid   = min(net usage, paid_limit_value)
unpaid = max(0, net usage − paid_limit_value)
```

Checked against every leave type this market needs:

| type | limit | paid_limit | meaning |
|---|---|---|---|
| annual | 6 | null | all paid |
| personal | 3 | null | all paid |
| sick | high | 30 | first 30 paid |
| maternity | 98 | 45 | 98 allowed, employer pays 45 |
| unpaid | high | 0 | none paid |

Maternity is the second witness. It has exactly the shape of sick leave — allowed far beyond what
is paid — and any design that cannot express sick leave cannot express it either. A two-quota
workaround (`SICK_PAID` + `SICK_UNPAID`) would need four quotas for these two types, and would
still leave the client to compute the 2/3 split.

Null means "paid up to the limit", so every existing quota keeps its present meaning with no
backfill and no migration of intent.

### 2. `control_policy` on the quota, reusing the budget enum

`quota-usage.service.ts` currently throws unconditionally when a reservation exceeds remaining. For
sick leave that is not a safety rail, it is a bug with legal consequences.

```
HARD_STOP     over remaining -> reject                    (annual leave: gone is gone)
SOFT_WARNING  over remaining -> reserve, return a warning (sick leave: you may be ill)
```

The same enum the budget uses, for the third time in this module, because the situation keeps being
identical in shape: a configured limit, a value beyond it, and a per-row choice between refusing
and recording. Defaulting to `HARD_STOP` means every quota in the system behaves exactly as it does
today until somebody opts one out.

**Why not just set `limit_value` very high and keep `HARD_STOP`?** Because 999 is a sentinel, and
because it destroys the distinction the business needs: with a high limit there is no over-quota
event at all, so nobody is told that this leave has gone past the statutory paid ceiling. The
warning *is* the product here.

**Consequence for concurrency.** The existing rule — lock the entitlement, exactly one of two
racing requests for the last unit wins — was written when over-quota always lost. Under
`SOFT_WARNING` both succeed, and that is correct: neither is refused, and the ledger records the
overshoot honestly. The lock is still required, because the *balance* both requests compute must
still be serialized, and because `HARD_STOP` quotas keep their old behaviour on the same code path.

### 3. Leave is stored as a range with half-day ends

```
leave_request
  from_date  2026-03-10   from_half  PM
  to_date    2026-03-12   to_half    AM
  total_days 2.0          (computed, working days only)
```

Not a day count, because the projection needs to know *which* half:

```
leave PM on a working day  ->  morning still expected: arriving 08:40 is still late
leave AM on a working day  ->  afternoon expected: arriving 13:00 is NOT late
```

A `0.5` in `quota_usage` cannot answer either question. And it is stored per request rather than
per date because a range is what a person asks for; the per-date interpretation is derivable:

```
date == from_date  -> from_half        (FULL when the request starts full)
date == to_date    -> to_half
otherwise          -> FULL
```

**Why a table rather than `form_field` values?** Because the daily projection has to query this in
a typed way — "is there approved leave covering this date, and which half" — and `doc_field_value`
stores `text`. The precedent is `document_line`: when the system itself must read a document's
meaning rather than just display it, that meaning gets a table. A leave request is the same kind of
object.

### 4. Working days only, via the previous slice's range resolver

A request spanning Monday to Friday with a public holiday on Thursday charges four days, not five.
Deciding that needs, for each date, the employee's shift (does it work this weekday?) and the
company's holidays — which is precisely what `ShiftResolutionService.resolveRange` returns, built
last slice so recomputing a month would not issue a query per day.

```
resolveRange(employee, from, to)  +  holiday set
        │
        └──▶ for each date: working? which half applies? how much of a day is that?
                    │
                    └──▶ total_days, and the per-date map the projection will use
```

A half day on a shorter Saturday is half of *that day's* expected minutes, not half of eight hours
— which falls out of using the resolved per-day hours rather than a constant.

### 5. Beneficiary: `related_employee_id` first, submitter second

The current rule ignores any client-supplied `employee_id` and always charges the submitter. That
protection must survive — it is what stops a requester spending someone else's entitlement — but
its current implementation is too blunt for the case slice 2 already built for: HR recording for
staff who have no login account.

```
document.related_employee_id set?   ->  charge that employee   (HR filing on behalf)
otherwise                           ->  charge the submitter   (self-service, unchanged)
never                               ->  an employee id from the request body
```

`related_employee_id` is safe to trust where the body is not: it is a column on the document, set
at creation, and it travels the same approval workflow as the amount. Someone approving the leave
sees whose leave it is. That is the same argument the payee column made in the payment slice —
put the beneficiary where the approvers can see it, not in the submit call.

### 6. Recompute after approval, outside the transaction, never rolling it back

Approving leave makes the covered days stale. Slice 3 decided capture must not trigger
recomputation; the reasons were mobile latency and never letting a projection bug reject a fact.
The first does not apply to an approval, the second still does:

```
                 recompute INSIDE the approval txn      recompute AFTER commit
────────────────────────────────────────────────────────────────────────────────
on failure       the approval is discarded              the approval stands
worst case       a projection bug stops leave           the day silently stays ABSENT
                 approval company-wide
```

Both are bad; they are bad in different ways. The left is a system that stops working, the right is
a system that lies quietly. The right is recoverable *if it does not stay quiet* — so the decision
is: **commit the approval, then recompute; on failure report it on the approval response and leave
the approval alone.**

Staleness is then detectable with no new state at all:

```
stale day  =  attendance_day covered by an approved leave
              whose document.approved_at  >  attendance_day.computed_at
                                              ▲
                        the column slice 3 added "so staleness is visible"
                        turns out to be exactly the outstanding-work marker
```

An outbox in the shape of `pending_successor` (PENDING / DONE / FAILED) is the better long-term
answer and is deliberately **not** built here: it needs a job runner this codebase does not have,
and inventing one inside a leave slice would bury an infrastructure decision where nobody would
look for it.

### 7. Where `LEAVE` sits in the status ladder

The slot was reserved last slice, between `EXEMPT` and `ABSENT`:

```
NO_SHIFT -> HOLIDAY -> DAY_OFF -> EXEMPT -> [LEAVE] -> ABSENT -> INCOMPLETE -> PRESENT
```

Above `ABSENT` because approved leave is the *reason* there are no punches. Below `HOLIDAY` and
`DAY_OFF` because leave taken on a day nobody works is not leave — it charges no quota and the day
was already free, so the more specific reason wins.

A **full** day of leave resolves to `LEAVE` and expects nothing. A **half** day does not change the
status: the other half is still a working half, so the day computes normally with
`expected_minutes` halved, and the employee can still be late for it. That is the whole reason the
half is stored.

### 8. Transactions and locking

Quota reservation already runs inside one `em.transactional(...)` with the quota and entitlement
rows under `LockMode.PESSIMISTIC_WRITE`; nothing here changes that, and it must not, because a
`SOFT_WARNING` quota still needs a serialized balance to report an honest overshoot.

This slice adds no new lock. Recomputation reuses `AttendanceDayService`, which already takes each
projection row `FOR UPDATE`. The one new ordering rule is decision 6: the approval transaction
commits *before* recomputation begins, so the recompute reads committed leave rather than
participating in the approval's transaction.

**This slice writes `quota_usage` and therefore inherits the reserve/release sequencing rule**: the
USE row and the document's status transition commit together, and reject/cancel inserts RELEASE
rows for the outstanding amount in the same period (invariant 4/5). No `budget_txn` is written and
no document number is issued.

### 9. Leave rules are enforced by leave, never inside generic document submit

Three of this slice's rules have to fire *before* a quota reservation is written: the charged
quantity must equal the counted working days, the advance-notice window must hold, and a long sick
leave must carry its certificate. All three are leave rules. None of them can live in
`DocumentSubmitService`, because the build order runs document-engine → … → attendance, and
document-engine cannot import a downstream capability.

The approval case escaped this through an event fired after commit. Submit cannot: it must decide
*before* the write.

```
POST /leave-requests/:documentId/submit        ← attendance owns it
     read leave_request → re-count → check notice → check attachment
     → build quotaReservations itself → DocumentSubmitService.submit()
                          ▲
     attendance → document is the direction the build order allows
```

The residual hole is that the generic `POST /documents/:id/submit` stays callable on a leave
document with a client-chosen quantity. It is closed with configuration rather than a code
dependency: `document_type.derives_quantity`, which generic submit reads from its OWN table and
refuses on, pointing the caller at the owning endpoint. That is the same shape as every other
`requires_*` flag already on `document_type`, and it needs no import.

The general rule this settles, which the overtime and correction slices will need too: **a
capability's own rules are enforced at its own boundary; the generic path only learns, from
configuration, that it must decline.**

### 10. The charge is counted at submit, not at draft

`total_days` is written when the request is recorded, but re-counted and overwritten when it is
submitted. Between the two, a public holiday may be declared or a shift reassigned, and the number
would no longer describe what is being charged.

This is not a new judgement — it is the rule this system already applies to every number that
becomes an obligation. `document.exchange_rate` and `budget_exchange_rate` are both stamped at
submit rather than at draft creation, for exactly this reason: submit is the moment a document
stops being a proposal. The `total_days` written at creation is therefore a preview for the
requester, and the one written at submit is the charge.

### 11. Leave-type settings live in `leave_type`, not on `quota`

Advance notice, backdating window, and the attachment threshold go in a `leave_type` table keyed
one-to-one on `quota_id`, rather than as further columns on `quota`.

`quota` is a general allowance: leave days, overtime hours, asset bookings. Putting "how many days
of sick leave before a medical certificate is required" on it would mean a meeting-room booking
quota carries a column about medical certificates. That is precisely the coupling decision 9 just
refused to accept between document-engine and leave, and it would be inconsistent to accept it here.

It also matches how the rules actually vary in this market — each leave type has a different
profile, and they differ on axes that mean nothing to a booking quota:

| type | advance notice | backdating | attachment |
|---|---|---|---|
| annual | 1 day | none | none |
| sick | none | allowed, bounded | over 3 consecutive days |
| maternity | none | allowed | always |
| ordination | long | none | required |

Two integers express the timing rather than a boolean plus a number: `advance_notice_days` (how
long before the leave starts it must be filed) and `backdate_limit_days` (how long after it started
it may still be filed, 0 meaning not at all). A boolean plus a limit would leave "backdating
allowed, limit unset" meaning nothing in particular.

## Risks / Trade-offs

- **Weakening a shipped `MUST` is the highest-risk change in the module so far** → Mitigated by
  default: `control_policy` defaults to `HARD_STOP`, so every existing quota behaves identically
  and the loosening is opt-in per row. But the code path is shared by every quota in the system, so
  its tests matter more than the new table's — the task list weights them accordingly.

- **Changing beneficiary resolution touches every `requires_quota` document type, not just leave**
  → The change is strictly narrowing: it only differs when `related_employee_id` is set, which no
  current quota-reserving type populates. The protection against a client-supplied `employee_id` is
  unchanged, and a test asserts it still holds.

- **`ABSENT` days already computed will not become `LEAVE` until recomputed** → True for leave
  approved before this slice ships, of which there is none, and for any day whose recompute failed.
  The stale-day read exists to find exactly these.

- **Half-day leave is only two-valued (AM / PM)** → A quarter day or an hourly leave has no
  representation. Deliberate: hourly leave is a different product with different quota units, and
  guessing at it now would shape the table around a requirement nobody has stated.

- **Paid/unpaid is derived, so a change to `paid_limit_value` silently reprices history** →
  Symmetrical to the holiday-calendar decision last slice, and correct for the same reason: the
  ceiling is a statement about what the law or policy *is*, not a decision made on a date. Period
  close is what will eventually freeze the figures; `computed_at` is already the anchor for it.

## Migration Plan

1. **Forward migration**, additive only: create `leave_request`; add `quota.control_policy`
   (`not null default 'HARD_STOP'` with a check constraint) and `quota.paid_limit_value`
   (nullable decimal).
2. **Update `erp_approval_system.dbml`** in the same change.
3. **No backfill.** `HARD_STOP` is what every quota does today, and a null `paid_limit_value`
   already means "paid up to the limit" — the defaults *are* the existing behaviour, stated.
4. **Seed** a leave document type with `requires_quota`, plus `ANNUAL_LEAVE` and `SICK_LEAVE`
   quotas configured to demonstrate both policies, so the difference is visible in the dev data.

**Rollback:** drop the table and the two columns. No existing behaviour depended on them, so the
down migration cannot lose anything — the worst case is that a quota which had been opted into
`SOFT_WARNING` reverts to blocking, which is the pre-slice behaviour by definition.

## Open Questions

- Should a `SOFT_WARNING` overshoot be visible to the *approver* as well as the requester? It is
  recorded on the reservation either way, but surfacing it in the approval view is a frontend
  decision and there is no frontend yet.
- Backdating is allowed for sick leave and requires one day's notice for annual and personal leave,
  as a per-document-type setting. That default is a policy guess, not law — the law only requires
  that sick leave may be reported on return.
- A medical certificate for three or more consecutive sick days is a right the employer *may*
  exercise, not a duty. Modelled as a configuration flag, defaulted off, rather than enforced.
- `carry_forward` remains a boolean. Capping it ("carry at most 5 days") needs another column and
  no one has asked for it; noted so the omission is a decision rather than an oversight.
