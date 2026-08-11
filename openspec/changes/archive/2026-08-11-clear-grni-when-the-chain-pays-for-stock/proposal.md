## Why

`Settling a Stock Purchase Clears GRNI Rather Than Expense` is implemented for a document that
settles itself, and silently not implemented for one that settles through a reference chain — which
is the shape almost every real purchase has.

The split reads the paying document's own lines and takes the account from the budget on each line:

```ts
// gl-posting.service.ts, stockPortionByAccount
const accountId = line.budget?.account?.id;
```

A settlement type does not carry budgets on its lines. `document.service.ts` returns early for an
item-backed line when the type is not budget-controlled:

```ts
if (!docType.requiresBudget) return { glAccount: itemGl };   // no budget stamped
```

and `post-action.service.ts` states the configuration this assumes as the norm: *"A settlement type
(post_action CUT_BUDGET, e.g. DISB) is typically requires_budget=false … only the reserving
ancestor's lines carry it."* The budget path already compensates — `cutBudget` falls back to the
reserving ancestor's line at the same `lineNo` — but the GRNI split never got the same treatment.

So on a `PR → PO → DISB` purchase of stock, `stockPortionByAccount` finds no account on any line,
returns an empty map, `grniTotal` stays zero, and the whole amount debits the expense account:

```
                            what happens              what the requirement says
receipt      Dr INVENTORY / Cr GRNI      ✓            Dr INVENTORY / Cr GRNI
payment      Dr EXPENSE   / Cr CASH      ✗            Dr GRNI      / Cr CASH
issue        Dr EXPENSE   / Cr INVENTORY ✓            Dr EXPENSE   / Cr INVENTORY
             ────────────────────────────
             the purchase goes through profit and loss twice, and GRNI —
             credited at every receipt — is never cleared by anything
```

That is precisely the outcome the requirement was written to prevent: *"Goods that were capitalized
into `INVENTORY` when they were received are expensed once, when they are issued; charging expense
again at payment would put the same purchase through profit and loss twice."*

It survived because **the requirement has no test at all**. Its three scenarios have no
counterparts in the suite: `GRNI` appears only in `stock-posting.spec.ts`, which covers the receipt
side, and the one chain test in `gl-posting.service.spec.ts` uses no items, so it can never reach
the split. A behaviour with three written scenarios and zero implementations of them was free to
be wrong in the one configuration that matters.

This is also a prerequisite for the accounts-payable work, not merely adjacent to it. That design
moves `stockPortionByAccount` from the payment posting to the approval accrual; moving it as it
stands carries the defect forward and makes it harder to see, because the payable would be raised
for the right total with the wrong debit.

## What Changes

- `stockPortionByAccount` resolves each line's budget account the way the rest of the settlement
  path already does: the document's own line budget when it has one, otherwise the budget on the
  nearest reference-chain ancestor that reserved, matched by `lineNo`. This is the same fallback
  `PostActionService.reservingAncestorBudgetByLine` performs for the budget ledger, applied to the
  ledger that mirrors it.
- The `capped` guard is unchanged and becomes meaningful rather than vacuous: the stock share still
  cannot exceed what was actually cut on that account.
- The requirement gains the scenario it was missing — a **chain-settled** stock purchase clears
  GRNI — and its three existing scenarios get implementations.

Deliberately **out of scope**:

- **Making settlement types carry budgets on their lines.** That would fix this by changing what a
  document is, ripple through budget reservation, three-way matching and the coverage invariant,
  and re-litigate a modelling decision that is working. The chain fallback is the pattern this
  codebase already chose for exactly this gap.
- **A broader audit of what else reads `line.budget` on a settlement document.** Worth doing, and
  it is a different change: this one closes a defect whose consequence is a double charge to profit
  and loss, and widening it would delay that behind an unbounded search.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gl-journal`: `Settling a Stock Purchase Clears GRNI Rather Than Expense` states that the
  stock-tracked portion is resolved through the reference chain when the paying document's own
  lines carry no budget, and gains a scenario for the chain-settled case.

## Impact

**Backend**

- `back/src/modules/gl/gl-posting.service.ts` — `stockPortionByAccount` gains the ancestor fallback.
  Its caller, the amounts, the cap and the GRNI role resolution are untouched.
- `back/src/modules/gl/gl-posting.service.spec.ts` — the requirement's three scenarios plus the
  chain case. The fixture needs stock-tracked items and budgeted lines, which that file's `settle`
  helper does not build today.

**Specs**

`openspec/specs/gl-journal/spec.md`. No DBML change, no migration, no new permission.

**Invariants**

None are touched. No `budget_txn` is written (invariant 6), the entry stays balanced and
append-only, and the basis remains `budget_base_line_amount` — the same figure the budget was cut
on, which is what keeps the two ledgers agreeing.

**Risk**

The fallback relies on `create-from` copying lines 1:1 with `lineNo` preserved. That is not a new
assumption: `cutBudget` already depends on it to settle a chained document at all, so a chain that
broke it would strand the budget reservation long before it reached the GL.

The change makes the posting for chained stock purchases different from what it was. Entries
already posted are not corrected — they are append-only, and deciding which historical purchases to
reverse is a bookkeeping judgement per company, not a migration. The proposal states this rather
than leaving it to be discovered: **GRNI balances accumulated before this ships stay wrong until
someone clears them deliberately.**
