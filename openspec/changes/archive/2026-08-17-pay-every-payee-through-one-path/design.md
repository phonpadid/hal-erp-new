# Design

## D1. The payment path is already generic; the settlement path is the special case

This is the finding the whole change rests on, so it is worth stating precisely.

```ts
// gl-posting.service.ts — accruedPayable()
const credits = lines.filter((l) => Money.compare(l.credit, '0') > 0);
const account = credits[0].account;          // ← whatever the accrual credited
const amount  = credits.reduce(...);
```

`postForPayment` clears **the account the accrual actually credited**. It was written for
`ACCOUNTS_PAYABLE` and it never learned that name. Point it at a document whose accrual credited
`CLAIM_PAYABLE` and it debits `CLAIM_PAYABLE`, credits cash-clearing through `appendPaymentTail`, and
balances — because for a claim the FX delta is zero and the withheld amount is whatever was withheld.

`postSettlementClearing` does the same thing with the account hard-coded:

```
  postSettlementClearing            postForPayment (accrued branch)
  ──────────────────────            ──────────────────────────────
  resolve CLAIM_PAYABLE             read the accrual's credit account
  read the accrual                  read the accrual
  Dr that account                   Dr that account
  Cr CASH_CLEARING                  Cr CASH_CLEARING (+ WHT, + FX)
```

The right column is the left column with two restrictions removed. Deleting the left one loses
nothing and gains withholding.

## D2. What `payment` has to gain, and nothing more

`document_settlement` carries five fields. Three are already on `payment` under other names, and
three are genuinely missing — and all three are missing for vendor payments too:

| `document_settlement` | on `payment` today | verdict |
| --- | --- | --- |
| `document_id` (unique) | `document_id` (unique) | same cardinality — one payment per document |
| `settled_at` | `paid_at` | same |
| `settled_by` | `created_by` | same |
| `settlement_type` | — | **add `method`** |
| `reference` | — | **add `reference`** |
| `note` | — | **add `note`** |

`method` is not a settlement concept smuggled in. It is the field the evidence rule needs (D4), the
field a bank reconciliation needs to explain a credit that never had a file, and the field every
accounting system records against a payment. That it was only ever asked for on the settlement side
is an accident of which flow was built second.

`reference` is the bank's transfer number. A vendor payment recorded by hand has one too, and today
there is nowhere to put it.

## D3. One predicate, two clauses — because two things can make a document owed

Ready-to-Pay filters `documentType.postAction === 'CUT_BUDGET'`; the unsettled queue filters
`accruesOnApproval`. Two queues, two flags, each blind to the other's documents and both matching
some of the same ones. That is the defect.

The first attempt at this design said the answer is to read the ledger alone. Implementation showed
it is not: the seeded `PR` carries `CUT_BUDGET` and does **not** accrue, so it books nothing at
approval and its expense is recognised by the payment itself. A ledger-only predicate has nothing to
read for it, and every completed PR would have become unpayable.

```
  owed  =  COMPLETED
           AND ( an APPROVAL_ACCRUAL credited a payable account      ← the ledger's answer
                 OR documentType.post_action = 'CUT_BUDGET' )        ← the configuration's answer
           AND no payment record
           AND no open batch holds it
```

Neither clause subsumes the other, and each answers for a case the other cannot:

| document | accrual | `post_action` | what makes it owed |
| --- | --- | --- | --- |
| claim | raises `CLAIM_PAYABLE` | not `CUT_BUDGET` | the ledger |
| PR | none | `CUT_BUDGET` | the configuration |
| DISB | raises `ACCOUNTS_PAYABLE` | `CUT_BUDGET` | either |

**What actually fixes the defect is that there is ONE predicate, not that it reads one source.** Two
queries over two flags can disagree; one query with two clauses cannot be in two places at once. The
queue and the record endpoint share it, so the queue can never offer an action the endpoint refuses
— which is the failure mode the settlements queue shipped with.

`post_action` still answers the question it was made for. It is not being asked what is owed on its
own; it is being asked whether this is a document the company pays, which is exactly what
`CUT_BUDGET` has always meant.

## D4. Evidence follows the trail

The rule is not "which document type is this" but "is there anything else that proves the money
moved":

```
  batch_id present   →  the bank file and the statement are the evidence  →  no slip required
  batch_id absent    →  nothing else exists                               →  slip required
```

Method rides along for the reader — `CASH` is never batched, so it always requires evidence — but the
condition is the batch, because that is the thing that actually leaves a trail.

**Where the check happens.** A payment is recorded and evidenced in one call for a hand-recorded
payment, the way a settlement is today: refusing after the write would leave a payment nobody has to
justify, and the settlement flow already proved the single-call shape works. A batch import records
many payments and attaches nothing, which is correct and stays correct.

This is a strict improvement in both directions: the settlement flow stops demanding a file for
transfers that will one day be batched, and the payment flow stops accepting a hand-typed payment of
any size with no evidence at all.

## D5. Delete rather than deprecate

Nothing is live. There is no `document_settlement` row anywhere, no company has mapped
`CLAIM_PAYABLE`, and no seeded type can produce either. Keeping the tables and the endpoints "for
compatibility" would preserve compatibility with nobody, and would leave two ways to pay a person in
a codebase whose whole argument is that there should be one.

The `web-settlement` capability is removed entirely rather than emptied. A capability whose purpose
was *"Distinct from `web-payments`"* has no residue once the distinction is gone.

What is NOT deleted: the accrual. `accrues_on_approval` and `CLAIM_PAYABLE` remain exactly as they
are, because recognising an obligation to a person at approval is correct and is not what this change
is about. Only the clearing converges.

## D6. A claim is due the day it was raised

`due = accrual.entry_date + vendor.payment_term_days` has no meaning without a vendor.

| candidate | what it reports | why not |
| --- | --- | --- |
| no due date | the row never ages | the oldest debts become the invisible ones |
| a configured default | a term nobody agreed | invents a credit arrangement with a person |
| **the accrual's own date** | **owed since approval** | — |

A consequence worth stating rather than discovering: every unpaid claim lands in an overdue band
immediately and never in `NOT_DUE`. That is what "no terms" means, not a fault in the bucketing.

## D7. The seed has to exercise this

A path that cannot be reached from a fresh install is a path whose tests are the only thing holding
it up. The seed maps `CLAIM_PAYABLE` and carries a claim type — accruing, no vendor, no payee bank
account — so that the flow this change exists to unify is reachable by a person, not only by a spec.

That is also what makes the queue's disjointness demonstrable rather than argued: with both a `DISB`
and a claim in the seeded company, one queue holds both and no second queue exists to hold either
twice.

## D8. What this deliberately leaves for later

| what remains | the tempting fix | why not now |
| --- | --- | --- |
| a claim cannot ride a bank file | let batches carry claims | needs a payee bank account that is not a vendor's — a new table and a new permission, and every claim today is paid by hand |
| vendors are group-level, employees are company-scoped | one business-partner record | a scoping reconciliation of its own; paying a person does not require it |
| claims are outside FX revaluation | revalue them | they carry no foreign-currency amount at all; there is nothing to retranslate |
| `requires_payee` implies a vendor | let a document name a person as payee | only matters once a claim can be transferred rather than handed over |
