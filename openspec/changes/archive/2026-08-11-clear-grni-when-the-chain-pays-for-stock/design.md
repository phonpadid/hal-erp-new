## Context

The settlement posting needs two things per line: **how much** of it is stock-tracked, and **which
account** that amount was cut against. It gets the first from the paying document's own lines and
the second from those lines' budgets — and on a chained document only the first is there.

```
PR (requires_budget = true)              DISB (requires_budget = false)
  line 1  item A  budget → 5100            line 1  item A  budget → null
  line 2  item B  budget → 5200            line 2  item B  budget → null
     │                                          │
     └── budget_txn ACTUAL written here ────────┘  settlementActuals walks the chain and finds them
                                                   stockPortionByAccount does not, and finds nothing
```

Three places in this codebase already need "the budget behind a chained settlement line", and each
solved it separately:

| where | how it resolves the budget |
|---|---|
| `PostActionService.cutBudget` | `reservingAncestorBudgetByLine` — ancestor's line at the same `lineNo` |
| `GlPostingService.settlementActuals` | walks `ref_document_id` for `budget_txn` ACTUAL rows |
| `GlPostingService.stockPortionByAccount` | **does not** — reads `line.budget` and gives up |

The third is this change. It is the same problem the first two solved, in the one place nobody
noticed because no test reached it.

## Goals / Non-Goals

**Goals:**

- A chain-settled stock purchase clears GRNI, exactly as a self-settled one does.
- The requirement's scenarios become tests, so the next configuration change cannot quietly undo it.

**Non-Goals:**

- Changing what a settlement document is. The lines carrying no budget is a modelling decision that
  works and is compensated for elsewhere.
- Correcting entries already posted. Append-only means a correction is a new entry, and which
  historical purchases deserve one is a bookkeeping call.
- Touching the receipt side or the issue side. Both are correct.

## Decisions

### D1 — Reuse the walk `settlementActuals` already made, rather than walking again

**Revised during implementation.** The first version walked `ref_document_id` for the nearest
ancestor carrying a `RESERVE` — mirroring `PostActionService.reservingAncestorBudgetByLine`. Writing
the test showed why that is the wrong mirror: `postForPayment` has *already* walked the chain, in
`settlementActuals`, and the document it landed on is the one whose ACTUAL rows `perAccount` is
keyed by. A second, independent walk can in principle land somewhere else, and the requirement is
that the stock figure and the cut **agree**, not that two derivations currently match.

So `settlementActuals`' answer is passed down: `stockPortionByAccount` takes the charged document's
id and reads its lines when the paying document's own carry no budget. One walk, one answer, and the
accounts are the same objects `perAccount` uses because they come from the same rows.

It is also less code — the second traversal disappears rather than being written.

Three ways to get an account for a chained line, then:

| approach | verdict |
|---|---|
| the item's `default_gl_account` → `AccountService` (already injected) | rejected |
| an independent walk to the nearest ancestor that reserved | rejected — a second answer to a question already answered |
| the lines of the document `settlementActuals` charged | **chosen** |

The item route is shorter and lands on the same account *today*, because `resolveLineGlAndBudget`
picked the budget from that very GL when the ancestor was created. But it re-derives the answer
from configuration that can drift: change an item's default GL after the PR was approved and the
payment would clear a different account than the budget was cut on, silently, with the entry still
balancing. The spec is explicit that the two figures must agree — *"at the same
`budget_base_line_amount` basis the budget was cut on, so the two figures always agree"* — and
agreement is a property of reading the same source, not of two sources currently matching.

The ancestor's budget is what `budget_txn` ACTUAL names, which is what `perAccount` is keyed by.
Reading it is what makes the `capped` guard below meaningful.

### D2 — The cap stays, and only now does anything

```ts
const capped = Money.compare(stockShare, amount) > 0 ? amount : stockShare;
```

Today `stockShare` is always `'0'` on a chained document, so the cap never binds. Once the share is
real the guard does its job: the stock portion cannot exceed what was actually cut on that account,
so a mismatch between the document's lines and the ancestor's cut can never produce a GRNI debit
larger than the expense it displaces. It is left exactly as written.

### D3 — Match by `lineNo`, the assumption the budget ledger already runs on

`create-from` copies a chain 1:1 with `lineNo` preserved, which is what lets
`reservingAncestorBudgetByLine` work. This change adopts the same assumption rather than inventing a
second matching rule — and it is not a new risk: a chain that broke `lineNo` alignment would strand
the budget reservation as RESERVE forever, long before the GL was reached, so the failure would be
loud and elsewhere.

Sharing the assumption also means sharing the fix if it ever proves wrong.

### D4 — The tests are the larger half

The fix is one fallback in one function. The requirement has three written scenarios and zero
implementations, and that is why a defect this consequential — a purchase charged to profit and
loss twice — sat in the mainstream procurement path unnoticed.

The suite needs a fixture it does not have: a document with stock-tracked items whose lines carry
budgets, and a chained pair where only the ancestor does. `gl-posting.service.spec.ts`'s `settle`
helper builds neither, so extending it is most of the work.

## Risks / Trade-offs

**The books change shape for chained stock purchases.** Payments posted after this ships debit GRNI
where they used to debit expense. Anyone comparing month over month sees expense fall and GRNI
start clearing. That is the defect being removed, and it should be announced rather than found.

**Historical GRNI stays wrong.** Every chained stock purchase settled before this credited GRNI at
receipt and never cleared it, so the account carries a balance that no future payment will reduce.
This change does not touch it. Clearing it is a deliberate journal entry someone has to decide on —
and there is no manual journal entry in this system yet, which makes the cleanup a real dependency
rather than a footnote.

**Nothing else that reads `line.budget` on a settlement document was audited.** Out of scope by
choice; named here so the next person knows the search was not done rather than assuming it came
back empty.

## Migration Plan

None. No schema, no data, no configuration.

## Open Questions

None.
