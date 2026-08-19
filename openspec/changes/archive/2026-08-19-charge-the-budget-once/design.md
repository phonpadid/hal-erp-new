# Design — Charge the budget once

## Context

A budget's detail screen shows a summary, a waterfall chart, and the append-only ledger the two are
derived from. The summary and the chart treat `ACTUAL` correctly; the ledger draws it as a
withdrawal, so the column sums to 270,000 beside a budget that fell by 185,000.

The classification that decides this — which transaction types add to the balance, which subtract,
and which do neither — is not written down once. It is restated in five places:

```
back  budget-balance.service.ts   ×4   three-way switch, correct in all four
front BudgetDetailView.vue        ×1   two-way Set, ACTUAL falls through to "subtract"
```

Four copies agree and the fifth does not, which is the ordinary fate of a fact kept in five places.
The backend's copies each spell out `case ACTUAL: break;` with a comment explaining why; the
front-end's has a comment claiming it *"mirrors the backend balance formula, invariant 3"* while
doing something the formula does not.

## Goals / Non-Goals

**Goals:**

- The ledger stops presenting a settlement as a second deduction.
- One definition of transaction direction, read by both the balance computation and the screen.
- A stated, testable relationship between the ledger and the balance it explains, so the screen can
  be checked against itself.

**Non-Goals:**

- No change to any balance, derived figure, or stored value. `available` is already right.
- No change to the waterfall, the breakdown, or the reconciliation report — all three already treat
  `ACTUAL` correctly.
- No new ledger data. `budget_txn` stays append-only (invariant 2) and nothing is recomputed; this
  is about what is printed.
- Not a redesign of the ledger table. Columns, ordering, paging and links stay as they are.

## Decisions

### D1. Direction is a three-valued fact, and it lives in `shared`

The balance formula (invariant 3) sorts the seven transaction types three ways:

| | types | effect on available |
| --- | --- | --- |
| adds | `ADJUST_INCREASE`, `TRANSFER_IN`, `RELEASE` | `+ amount` |
| subtracts | `ADJUST_DECREASE`, `TRANSFER_OUT`, `RESERVE` | `− amount` |
| **converts** | `ACTUAL` | **none** — moves committed money to spent |

A two-valued classifier cannot express the third, so whichever bucket is the default swallows it.
The component chose "everything else subtracts", and `ACTUAL` was the everything else.

The definition moves to `shared`, as a mapping from transaction type to one of three directions,
and both sides read it. That is the pattern this repo already uses for the same problem:

> One evaluator (`isFieldVisible`, below) is used by both the Vue renderer and the NestJS submit
> check, so display and enforcement cannot drift.

Alternatives considered:

| | why not |
| --- | --- |
| fix the `Set` in the component | leaves five copies and repairs one. The next type added lands in a default bucket again, and the next reader still cannot tell which copy is authoritative |
| return a direction per entry from the API | the server would answer a question about presentation, and the client would still need the mapping to render a total. It also makes the ledger read the only place the classification is visible, where today it is at least visible in the balance service |
| **one mapping in `shared` (chosen)** | the fact is stated once; the balance service and the ledger become two readers of it rather than two authors |

The backend's four switches are rewritten against the shared mapping so the copies collapse rather
than becoming six. They are already correct, so this is not a behavioural change there — it is what
stops the correctness from being four separate accidents.

### D2. A conversion is drawn as a conversion, not as an absence

Dropping the minus sign is necessary and not sufficient: a row with no sign beside rows that have
one reads as missing data, and the reader who was already confused now has a blank to explain.

So `ACTUAL` gets its own treatment rather than the absence of the other two:

- no `+` or `−`, because it changes no balance
- the neutral/secondary text colour, not the red that means money leaving
- an icon that reads as movement between states rather than the outflow arrow — the same visual
  grammar, a different word in it

The type label already says what happened (`ຕັດງົບຈິງ` / settled). What changes is that the amount
column stops contradicting the label.

Alternatives considered: a separate column for settlements (splits one history into two, and the
timeline is the point of a ledger); hiding `ACTUAL` from the list entirely (it is a real event in an
append-only history and belongs in it — and the proposal's own scenario expects it listed).

### D3. The ledger is tied to the balance by a stated identity

The screen currently offers no relationship a reader can check, which is why the discrepancy went
unnoticed while being fully visible. The change states one:

```
Σ(signed ledger)  =  available − amount_total
```

with `ACTUAL` contributing zero to the sum. On the seeded budget: `−185,000 = 815,000 − 1,000,000`.
It fails today at exactly the 85,000 that `Σ ACTUAL` is worth.

This is the assertion the missing test makes, and it is deliberately phrased over the *rendered*
ledger rather than over the raw rows: the defect was in what was drawn, so a test that reads the
data and re-derives the sign would have passed while the screen stayed wrong.

### D4. The test goes where the untested half is

`waterfall.spec.ts` already asserts *"never charts ACTUAL as a movement — a settled reservation is
charged once"*, and it passes, because the waterfall was the half that was right. `isLedgerInflow`
has no test and no reference outside its own component.

The new coverage is for the ledger specifically — the identity in D3, and a settled document
appearing once as a deduction and once as a conversion rather than twice as a deduction. Extending
the waterfall test would put the assertion in the file that was already correct, which is where it
would have been least useful.

## Risks / Trade-offs

- **A neutral row reads as "nothing happened"** → the icon and the retained type label carry the
  meaning; the amount is still shown at full value, only unsigned. Worth a look on the running app
  before calling it done, because this one is a judgement about legibility rather than arithmetic.
- **Rewriting four correct switches to use the shared mapping risks breaking what works** → they are
  balance computations with existing coverage; the mapping is introduced to match their current
  behaviour exactly, and any divergence should surface as a failing balance test rather than as a
  new one. If it does not, the coverage is thinner than assumed and that is worth knowing.
- **The identity in D3 holds only when the ledger shows a budget's complete history.** The list is
  server-paged, so the assertion is about the whole ledger, not the visible page. A test that sums
  one page of a multi-page budget would be asserting something untrue.
- **`shared` gains a budget concept.** It already carries post-action groupings, field-visibility
  evaluation and money helpers, so this is in keeping — but the reason to put something there is
  that two runtimes must agree on it, not that it is convenient. That reason holds here and should
  be stated where the mapping is defined, or the next addition will not have to justify itself.

## Migration Plan

None required. No schema change, no data change, no stored value recomputed. The change is
presentational plus a refactor of an existing classification into one place; deploying it changes
what the ledger draws and nothing else. Rollback is reverting the commit.

## Open Questions

- **The exact glyph and colour for a conversion row** are a call best made against the running app
  in both themes rather than in this document. The constraint is that it must not reuse the outflow
  treatment and must not read as empty.
- **Whether `RELEASE` deserves the same reconsideration.** It is an inflow and shown as `+`, which
  is right for the balance — but for a reader tracing one document, a release is the tail of a
  settlement rather than new money arriving. Out of scope here; noted because the same screen will
  raise it.
