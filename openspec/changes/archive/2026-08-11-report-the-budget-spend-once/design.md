## Context

One rule, four statements of it, one of them inverted.

```
                                        ACTUAL subtracted?
CLAUDE.md invariant 3                          no    ✓
erp_approval_system.dbml  budget note           no    ✓
budget-control  Append-Only Budget Ledger       no    ✓
budget-control  Derived-Balance Breakdown       YES   ✗   ← same file, 350 lines apart
reporting       Real-Time Budget Balance        YES   ✗
reporting       Derived Budget Figures          YES   ✗
BudgetBalanceService  (5 methods)               no    ✓
ReportingService.budgetUtilization              n/a — computes `consumed` its own way ✗
```

The code is right everywhere it derives a balance. `availableBalance`, `availableFor`,
`breakdown`, `balanceAt` and `balanceAtMany` each carry the same `case ACTUAL: break;` with a
comment explaining why, and `breakdown` reports `actual` as a component without subtracting it.

`budgetUtilization` is the one place that does not derive from those methods. It reads the *group
subtotals* `budgetBalanceByDeptCategory` returns and recombines them:

```ts
// reporting.service.ts:536
const consumed = Money.add(e.reserved, e.actual);
```

`e.reserved` is Σ RESERVE gross and `e.actual` is Σ ACTUAL — and Σ ACTUAL is a draw-down *of* that
same Σ RESERVE, never an addition to it. Adding them counts the settled portion twice, and
`RELEASE` is dropped, so the unused remainder of every partially-received order stays counted as
consumed forever.

## Goals / Non-Goals

**Goals:**

- Every statement of invariant 3 in the repository says the same thing.
- `consumed` and `available` reconcile against the same opening amount on the same row.
- The spec pins the case that was broken, not the case that hid it.

**Non-Goals:**

- Changing `BudgetBalanceService`. It is the reference implementation this change aligns everything
  else to.
- Introducing a stored or cached utilization figure. Derivation on read is the invariant, and the
  projection seam documented in `budget-balance.service.ts` is explicitly not yet warranted.
- Touching the balance report's component subtotals, or the waterfall chart that reads them.

## Decisions

### D1 — `consumed = Σ RESERVE − Σ RELEASE`, not `Σ ACTUAL` and not `amountTotal − available`

Three formulas produce the right number today. They are not equally good.

| form | value | why not |
|---|---|---|
| `Σ RESERVE − Σ RELEASE` | outstanding + settled spend | **chosen** |
| `Σ ACTUAL + outstanding` | same | needs outstanding, which the group rows do not carry |
| `amountTotal − available` | same *only while* adjustments and transfers are zero | silently wrong the moment a budget is adjusted or transferred, because those move the opening figure without being consumption |

The third is the tempting one and the trap: it reads as "consumed is what is gone", but an
`ADJUST_DECREASE` is money removed from the budget that nobody consumed. `Σ RESERVE − Σ RELEASE` is
consumption by definition — every kip a document took and did not give back — and it stays correct
under adjustment and transfer without knowing they exist.

It also reconciles by construction, which is the property the method's comment already claims:

```
available  = amountTotal + adjustIn − adjustOut + transferIn − transferOut − ΣRESERVE + ΣRELEASE
consumed   =                                                                  ΣRESERVE − ΣRELEASE
             ─────────────────────────────────────────────────────────────────────────────────────
available + consumed = amountTotal + adjustIn − adjustOut + transferIn − transferOut
                     = the budget's current ceiling
```

With no adjustments or transfers that is `amountTotal`, which is what `utilizationPct` divides by.
When there are, the two still sum to the ceiling the money actually sits under.

### D2 — `released` is carried on the group, not re-derived

`BudgetBalanceGroup` already accumulates `released` from `breakdown`
(`reporting.service.ts:221`); `budgetUtilization`'s own per-department accumulator is what drops
it, keeping only `reserved` and `actual`. So the fix carries one more string through an existing
loop rather than adding a query. No round-trip is added and no method signature changes.

`actual` stops being used by this computation and is dropped from the internal accumulator.
Keeping it as an unread field was considered — it would make the diff read less like the report
stopped reporting settled spend — and rejected: `BudgetUtilizationRow` never exposed `actual`, so
nothing observable changes, and an accumulated-but-unread `actual` sitting next to `reserved` is
precisely the invitation that produced `reserved + actual` in the first place. The comment above the
method now carries that history instead, where it cannot be recombined by accident.

### D3 — The spec scenario gets a settled document

The existing scenario pins `250,000 RESERVE and 0 ACTUAL`. Under `reserved + actual` that yields
250,000; under `reserved − released` it also yields 250,000. The scenario cannot fail either way,
which is exactly why it did not.

The replacement pins a budget that has reserved, settled part of it, and released the remainder —
the shape every completed purchase produces — so the two formulas diverge and only the correct one
passes.

### D4 — Correct the specs, do not annotate them

An alternative was to leave the `− ACTUAL` passages and add a note that the code deliberately
differs. Rejected: a spec that describes two behaviours describes none, and the repository's own
convention is that `openspec/specs/` is authoritative and drift is a defect. `Append-Only Budget
Ledger` already spells out what subtracting ACTUAL means ("SHALL be treated as a defect"), so the
contradicting passages are not a second opinion — they are stale text.

## Risks / Trade-offs

**The reported number moves.** Every department with settled documents will show a lower
`consumed` and a lower `utilizationPct` from the day this ships. Anyone comparing a saved export
against a fresh run will see a discrepancy they did not cause. Mitigation is announcement, not
code: there is no correct old value to preserve.

**Nothing else consumes `consumed`.** Verified: the field is read by
`front-end/src/api/reports.ts` and the utilization report view, and by no backend caller. There is
no dashboard tile or alerting threshold silently calibrated to the inflated figure.

**The specs are the deliverable.** Roughly half of this change writes no code. That is proportionate
— the wrong sentence in `Derived Budget Figures` is what produced the wrong line in
`budgetUtilization`, and leaving it would leave the defect's cause in place while removing its
symptom.

## Migration Plan

None. No schema, no data, no stored value. Figures are derived on every request, so correcting the
formula corrects every past period at deploy time.

## Open Questions

None.
