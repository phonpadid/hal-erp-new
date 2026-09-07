## Context

Three facts decide the shape of this change.

**1. Who is owed is read from the document, never configured.** `gl-journal/spec.md` is explicit:
"a document carrying a `vendor_id` credits `ACCOUNTS_PAYABLE`, and one without credits
`CLAIM_PAYABLE`". `gl-posting.service.ts` implements exactly that — `isVendorPurchase = !!document.vendor`
picks the payable account, and for a non-vendor document the accrual reads that document's OWN
`budget_txn` ACTUAL rows rather than walking a reference chain, because a compensation has no chain.
The ready-to-pay queue follows the same rule: `owedTo: d.vendor?.name ?? d.relatedEmployee?.fullName`,
with a comment refusing to fall back to the author — "naming the wrong payee is worse than naming
none".

So the ledger already routes a vendor-less obligation to the claim payable and the queue already
names an employee when one is on the document. Nothing in the engine needs to learn anything. What
is missing is a document type that requires the employee to be there.

**2. `CLAIM` cannot be that type.** It is the external integration's type. `docs/claim-integration.md`
describes a carrier's system creating a document over the API, sending the claimant's name, bank and
account number as FORM FIELD VALUES, and attaching the payee's QR code as evidence — precisely
because the ERP holds no record of that person. Setting `requires_employee` on `CLAIM` would make
every one of those submits fail on a field the caller cannot fill.

**3. The flags cannot be set from a screen.** The server side is complete:

```
config.dto.ts        requiresEmployee?: boolean   (create + update)
document-type.service.ts   requiresEmployee: dto.requiresEmployee ?? false
document-submit.service.ts if (docType.requiresEmployee) { ...refuse without one,
                              and refuse an employee of another company }
```

The client side stops short:

```
DocTypeFormFields.vue
const FLAGS = ['requiresBudget','requiresQuota','requiresVendor','requiresItem','requiresPayee']
```

`api/docConfig.ts` does not declare `requiresEmployee`, `requiresWarehouse` or `accruesOnApproval`
either. This is the same defect the capability already fixed once for post-actions — the screen
offering a subset of what the engine runs, and looking complete while doing it.

## Goals / Non-Goals

**Goals:**

- A `DOC_CONFIG_MANAGE` user can configure a type that requires an employee, in the app, without a
  database seed.
- A reimbursement to a person reaches the ready-to-pay queue naming that person.
- A fresh install has a working example of it.

**Non-Goals:**

- Storing an employee's bank account, or paying a person through a `payment_batch`.
- The `ADVANCE → CLEAR_ADVANCE` chain.
- Any change to how `CLAIM` behaves, or to the external claim integration.
- Backfilling the live company's own travel type — the administrator creates it once the screen
  allows it, and this change is what makes that possible.

## Decisions

### D1. A new `TRAVEL` type, not a flag on `CLAIM`

Context 2. `CLAIM` has an external caller that cannot supply an employee. A second type costs one
row and keeps both callers working; a flag on `CLAIM` breaks the integration on the day it ships.

The two also differ in what a reader expects to find on them. A customer compensation identifies its
claimant in form fields, by design. A staff reimbursement identifies its subject in
`related_employee_id`, which is a foreign key the queue, the reports and the permission scope can all
read. Those are different documents wearing the same word.

### D2. `accrues_on_approval` with `CUT_BUDGET`, and why the pair is forced

The obligation to the traveller exists the moment the last approver signs: they are owed whether the
transfer happens today or in three weeks. That is what `accrues_on_approval` records.

The pairing is not free choice. `assertAccrualSettlesItself` refuses a type that reserves its own
budget and accrues at approval unless its post-action settles — because the accrual reads this
document's ACTUAL rows, and a settlement further down a reference chain runs long after the accrual
has recorded a terminal skip. `TRAVEL` has no chain to settle it later, so `CUT_BUDGET` is the only
consistent value. `assertFlagPrerequisites` separately refuses an accruing type with neither budget
nor vendor; `requires_budget` satisfies it.

The resulting posting on full approval, with no code aware of the type code:

```
Dr  travel expense            (from budget.account on this document's ACTUAL rows)
    Cr  CLAIM_PAYABLE         (because document.vendor is absent — derived, not configured)
```

`CLAIM_PAYABLE` is already mapped in the seed, and `accounting-period` already excludes it from FX
revaluation, so nothing downstream needs teaching.

### D3. No `requires_payee`, and the destination is evidenced rather than stored

A payee in this system IS a `vendor_bank_account`: submit refuses one that does not belong to the
document's vendor, the client's picker is loaded from the vendor, and `assertFlagPrerequisites`
refuses `requires_payee` without `requires_vendor` on the grounds that the field could never be
filled. `employee` has no bank columns.

Two rejected alternatives:

- *Register each employee as a vendor.* `vendor` and `vendor_bank_account` are group-wide, not
  company-scoped — the DBML says so where it explains why `VENDOR_BANK_MANAGE` is a separate
  permission. Staff bank details would become visible across every company in the group, and their
  reimbursements would land in `ACCOUNTS_PAYABLE` mixed with trade debt.
- *Add `employee_bank_account` now.* The honest end state, and out of proportion to this change: it
  touches the schema, the submit gate, the batch line snapshot and the export formatter. Named as a
  non-goal so the next proposal can pick it up rather than rediscover it.

What ships instead: a `TRAVEL` document is paid outside the bank file and recorded through
`PaymentService.record`, which already refuses a hand-recorded payment with no evidence. The
destination is not stored, but no payment can exist without a slip proving where the money went.
This is the accepted cost of the change, and it is the same cost `CLAIM` has carried since it was
seeded.

### D4. The screen offers all three missing flags, not only the one this needs

`requires_warehouse` and `accrues_on_approval` are absent for the same reason and with the same
consequence. `assertFlagPrerequisites` tells an administrator who configures a stock post-action to
"require a warehouse" — an instruction the screen gives them no way to follow. Adding one switch and
leaving two would leave a guard whose remedy is still unreachable.

### D5. The form states the cross-flag rules; the server still enforces them

Both rules are already server-side and stay there. The form adds an inline message where the
combination is refusable, following the existing requirement that a configuration screen says when a
setting cannot take effect. The client never becomes the authority — it stops offering a save whose
only outcome is a 400 the user cannot interpret.

## Risks / Trade-offs

- **A reimbursement cannot be batched.** Accepted, D3. Finance sees it in the same queue as
  everything else, marked `CLAIM`, and pays it by hand with a slip. The alternative was a schema
  change or leaking staff bank details across the group.
- **Two types now look similar in the type list.** `CLAIM` and `TRAVEL` differ by one flag. Mitigated
  by D4's badges: the list shows which one requires an employee.
- **An administrator can now set `accrues_on_approval` wrongly.** The two guards that catch the
  meaningless combinations already exist and already return specific messages; D5 surfaces them
  before submit. A flag nobody can set is not safer than one that is guarded — it is only harder to
  diagnose.

## Migration Plan

None. No schema change, no data change to existing rows. The seeded `TRAVEL` type is created by
`upsert` on `(company, code)` like every other type, so re-running the seed is idempotent and no
existing installation loses anything.

## Open Questions

- Should the live company's travel budgets (six of them, under `1.11`) map to `TRAVEL` through
  `dept_doc_type` for every department, or only for those that travel? Configuration, decided by the
  administrator after this ships — not by this change.
