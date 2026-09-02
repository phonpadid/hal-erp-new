## Why

Invariant 3 says the same thing three times, in three places, and one of them is wrong.

`ACTUAL` is not a deduction. It converts money that `RESERVE` already took out of the budget into
money spent, so the reserve that was never released *is* the spend. The DBML note on `budget`
says so, `CLAUDE.md` says so, `budget-control`'s `Append-Only Budget Ledger` requirement says so in
as many words ("Subtracting ACTUAL as well SHALL be treated as a defect — it charges the budget
twice for the same document"), and `BudgetBalanceService` implements it correctly in all five of
its summing methods.

Two spec passages disagree, and one report acts on the disagreement.

- `budget-control`'s `Derived-Balance Breakdown Query` scenario asserts
  `available = … − RESERVE − ACTUAL + RELEASE`, which contradicts the requirement four hundred
  lines above it in the same file.
- `reporting`'s `Real-Time Budget Balance Report by Department and Category` and
  `Derived Budget Figures` carry the same `− ACTUAL` formula.
- `ReportingService.budgetUtilization` computes `consumed = Σ RESERVE + Σ ACTUAL`, which
  double-counts every settled document and ignores `RELEASE` entirely.

The drift is worse than the bug it produced. The specs are what a future change — or a future
agent — reads before touching this code, and they currently instruct it to "fix" a correct
implementation into one that charges every budget twice.

The utilization defect is live and visible:

```
budget 1,000,000 · reserve 100,000 · receive 90,000 (ACTUAL 90,000 + RELEASE 10,000)

                  correct     reported
  consumed         90,000      190,000     ← the 90,000 counted twice
  available       910,000      910,000     ← correct, from breakdown()
  reconciles?     ✓            ✗  910,000 + 190,000 = 1,100,000 ≠ 1,000,000
```

The row contradicts itself: `available` comes from `BudgetBalanceService.breakdown` and is right,
`consumed` is computed separately and is not, and the two no longer add up to the budget. The
comment above the method — "Derived from the same budget-balance groups … so it can never disagree
with them" — states an intent the code does not keep. The figure inflates as documents settle, so
a department that has fully received everything it ordered reads as roughly twice as utilized as it
is, which is precisely when someone looks at the report.

The spec's own scenario is why this survived review: it pins `250,000 RESERVE and 0 ACTUAL`, the
one case where `reserved + actual` and `reserved − released` agree.

## What Changes

- `budget-control`'s `Derived-Balance Breakdown Query` scenario drops `− ACTUAL`, matching the
  `Append-Only Budget Ledger` requirement it sits under and the code that already implements it.
- `reporting`'s `Real-Time Budget Balance Report by Department and Category` and `Derived Budget
  Figures` drop `− ACTUAL` from their formulas for the same reason.
- `Derived Budget Figures` states what `consumed` means rather than leaving it to a parenthetical:
  **consumed = Σ RESERVE − Σ RELEASE**, which is outstanding reservations plus settled spend, and
  which reconciles with `available` by construction. Its scenario is restated with a non-zero
  `ACTUAL` and a non-zero `RELEASE`, so the case that was wrong is the case the spec now pins.
- `ReportingService.budgetUtilization` computes `consumed` that way instead of `reserved + actual`.

No API shape changes: `BudgetUtilizationRow` keeps its fields, and `consumed` and `utilizationPct`
start reporting correct numbers. No ledger is touched, no migration is needed, and
`BudgetBalanceService` is not modified — it was right.

Deliberately **out of scope**:

- **The `reserved` and `actual` component subtotals stay on the balance report.** They are the
  breakdown, and a reader wanting "how much is still on order" needs `reserved − released` visible
  in parts. Only the derived `consumed` on the utilization report was wrong.
- **Backfilling or correcting anything.** The figures are derived on every request; fixing the
  formula fixes every past period at the same moment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: `Derived-Balance Breakdown Query`'s scenario is corrected to the invariant the
  capability already states.
- `reporting`: `Real-Time Budget Balance Report by Department and Category` and `Derived Budget
  Figures` are corrected the same way, and the latter gains an explicit definition of `consumed`
  plus a scenario that exercises a settled document.

## Impact

**Backend**

- `back/src/modules/reporting/reporting.service.ts` — `budgetUtilization` (line 512) computes
  `consumed = reserved − released`; the group accumulator carries `released` alongside `reserved`
  and `actual`, which `budgetBalanceByDeptCategory` already returns on every group.
- `back/src/modules/reporting/reporting.service.spec.ts` — a case with a settled document, which no
  existing test covers.

**Frontend**

None. `front-end/src/api/reports.ts` and `BudgetUtilizationReport.vue` read `consumed` and
`utilizationPct` unchanged; only the values they receive change.

**Specs**

`openspec/specs/budget-control/spec.md` and `openspec/specs/reporting/spec.md`. No DBML change —
the `budget` table note is already correct and is one of the sources this change aligns the specs
to.

**Invariants**

Invariant 3 is the whole subject. This change adds nothing to it; it removes two statements that
contradict it and one computation that ignored it.

**Risk**

Low in code, and worth naming in operations: anyone tracking utilization month over month will see
the number drop the day this ships, on every department with settled documents. That is the defect
being removed, not a regression, but it will be noticed and should be announced rather than
discovered.
