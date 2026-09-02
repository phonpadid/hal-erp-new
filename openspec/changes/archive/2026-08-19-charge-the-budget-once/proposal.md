# Charge the budget once

## Why

The budget detail screen shows the same money leaving twice. Its summary is right, its chart is
right, and the ledger printed underneath them contradicts both.

On the seeded Office Supplies budget, read off the running app:

```
summary    1,000,000  − reserved 185,000  + released 0   =  available 815,000
                                              of which actually spent 85,000

ledger     ຕັດງົບຈິງ  −35,000   CLAIM-HAL-2026-0002     ← ACTUAL, shown as a deduction
           ຈອງງົບ    −35,000   CLAIM-HAL-2026-0002
           ຕັດງົບຈິງ  −50,000   PR-HAL-2026-0001        ← ACTUAL, shown as a deduction
           ຈອງງົບ    −50,000   PROC-HAL-2026-0001
           ຈອງງົບ    −50,000   PR-HAL-2026-0001
           ຈອງງົບ    −50,000   CLAIM-HAL-2026-0001
                     ─────────
                     −270,000
```

**The column sums to 270,000 against a budget that fell by 185,000.** The 85,000 difference is
exactly `Σ ACTUAL`, counted a second time. A single 35,000 compensation claim appears as two
separate 35,000 deductions and reads as 70,000 gone.

**This is the arithmetic invariant 3 exists to forbid**, in the one place a user can actually read
it: *"ACTUAL is not a deduction: it converts money RESERVE already took out of the budget into money
spent… Subtracting ACTUAL as well charges the budget twice."* The engine never does this — available
is 815,000 and correct. Only the screen does.

**The cause is a two-way answer to a three-way question.** The list classifies each entry with:

```ts
const LEDGER_INFLOW_TYPES = new Set(['ADJUST_INCREASE', 'TRANSFER_IN', 'RELEASE']);
const isLedgerInflow = (txnType) => LEDGER_INFLOW_TYPES.has(txnType);   // everything else subtracts
```

There are seven transaction types and three behaviours, not two. `ADJUST_INCREASE`, `TRANSFER_IN`
and `RELEASE` add to the balance. `ADJUST_DECREASE`, `TRANSFER_OUT` and `RESERVE` subtract from it.
`ACTUAL` does **neither** — it appears nowhere in the balance formula, because it moves money that
has already left the available balance from "committed" into "spent". Given only two buckets, it
falls into the wrong one by default.

**The comment above that code claims the opposite of what the code does.** It reads *"mirrors the
backend balance formula, invariant 3"*. The formula it names has no `ACTUAL` term in it.

**And the same file gets it right twenty lines earlier.** The waterfall rows carry an explicit note:

> `actual` is deliberately absent from this chain: it converts money the RESERVE already took out of
> the budget into money actually spent, so charging it again would double-count the document. It is
> shown below the total as an informational "of which actually spent".

So one screen holds both the correct treatment and its contradiction, a few lines apart, and renders
them one above the other.

**The rule was understood, written down, and tested — for the half that was already right.**
`waterfall.spec.ts` carries a test named *"never charts ACTUAL as a movement — a settled reservation
is charged once"*. `isLedgerInflow` has no test at all; nothing outside the component so much as
references it. The tested half is correct and the untested half is wrong, which is the same shape as
the defect `reserve-only-what-something-can-settle` closed a moment ago: the behaviour was proven in
the place it was easy to prove and left unproven in the place it ships.

**Nobody can currently check the screen against itself.** There is no stated relationship between
the ledger and the balance it explains, so a reader who adds the column up and gets a different
number has no way to know which half to believe.

## What Changes

**The ledger renders three directions, because the ledger has three.** An entry that adds to the
available balance, an entry that subtracts from it, and an entry that converts an existing
commitment into spend without changing the balance at all. `ACTUAL` is the third, and is shown as
what it is rather than borrowing the presentation of the second — no minus sign, no outflow arrow,
and not the colour reserved for money leaving.

**Direction is derived from the balance formula, not from a hand-kept list.** Which types add and
which subtract is already decided by invariant 3; the list in the component is a second copy of that
decision, free to drift from it — and it has. A type added later must get its direction from the one
place that defines it, rather than from whichever bucket it lands in by omission.

**The ledger and the summary are made checkable against each other.** The signed sum of a budget's
ledger entries SHALL equal the difference between its appropriated total and its available balance:

```
Σ(signed ledger)  =  available − amount_total
        −185,000  =  815,000 − 1,000,000        ✓ after
        −270,000  ≠  −185,000                   ✗ today
```

That identity is the thing a reader was trying to verify by adding the column up, and it is what the
missing test asserts. It fails today for exactly the reason the screen is wrong.

## Who this answers

| party | what they see today | after |
| --- | --- | --- |
| anyone reading a budget's history | a column that sums to 270,000 beside a budget that fell by 185,000 | the column sums to what the budget actually lost |
| anyone tracing one document | a 35,000 claim listed as two 35,000 deductions | one deduction when it was committed, one conversion when it was settled |
| whoever is asked "where did the money go" | two numbers on one screen, no way to tell which is right | one story the screen tells consistently |
| whoever adds the next transaction type | a direction decided by which bucket it falls into by default | a direction taken from the balance formula that defines it |

## What This Change Does NOT Do

- **Does not change any balance, or any stored value.** `available`, `reserved`, `actual` and the
  waterfall are all correct and stay exactly as they are. `budget_txn` remains append-only
  (invariant 2) and nothing is recalculated — this is what the screen prints, not what the system
  believes.
- **Does not hide `ACTUAL` from the ledger.** Settlement is the event that turns a commitment into
  spend and belongs in an append-only history. What changes is that it stops being drawn as a
  withdrawal.
- **Does not touch the reconciliation report.** `Budget-to-Ledger Reconciliation` already separates
  `committed` from `consumed` and treats `ACTUAL` correctly.
- **Does not revisit the `CLAIM` and `PROC` reservations behind two of these rows.**
  `CLAIM-HAL-2026-0001` holds 50,000 that can never be released — recorded as known-bad demo data in
  `reserve-only-what-something-can-settle` — and `PROC-HAL-2026-0001` holds 50,000 legitimately in
  flight. Both are reservations, both are shown correctly as deductions, and neither is what this
  change is about.
