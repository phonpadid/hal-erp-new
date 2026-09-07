## Why

The quarterly budget report counts budgets that were turned down.

On the customer's data today, opening the report for `ພະແນກບໍລິຫານ` shows an annual budget of
**1,792,800,000**. What that department actually holds is **1,092,800,000**:

| status | budgets | total |
| --- | --- | --- |
| `ACTIVE` | 3 | 1,092,800,000 |
| `REJECTED` | 2 | 700,000,000 |

Plan line `1.101` exists three times — once `ACTIVE`, twice `REJECTED`, 350,000,000 apiece — so the
report lists it three times and its group header reads 1,050,000,000. The 700,000,000 the reader is
being shown is two proposals somebody refused.

`REJECTED` is kept rather than deleted for a stated reason: `budget_movement.to_budget_id`
references it, and *"the record of what was refused is the point of routing budgets through approval
at all."* It is a record of a decision, not money. Counting it inflates the ceiling and understates
every utilisation figure derived from it — the department reads 2% consumed where the truth is
closer to 3.2%.

The read simply does not mention status:

```
const where: Record<string, unknown> = { fiscalYear: fy.id };
if (departmentId) where.department = departmentId;
const budgets = await em.find(Budget, where, { … });   // every status
```

The rest of the system does not make this mistake. `listSelectable` filters to `ACTIVE`, and the
budget list puts the refused proposals under their own heading rather than in the total.

## What Changes

- The quarterly report SHALL count only budgets that are, or once were, money in force: `ACTIVE`
  and `CLOSED`.
- `REJECTED` and `DRAFT` SHALL be excluded. Neither was ever spendable — one was refused, the other
  is still waiting to be approved.
- Any other status SHALL be excluded too, so a status added later cannot silently join the ceiling.
- The department options the report offers SHALL be derived the same way, so a department holding
  nothing but refused proposals is not offered a report with no money in it.
- The report SHALL state when it has left budgets out, rather than quietly showing a smaller number
  than it showed yesterday.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-period-reporting`: gains the rule about which budgets the report counts at all — the
  prior requirements define how the annual figure is computed for a budget, never which budgets are
  in scope.

## Impact

- **Capabilities touched**: `budget-period-reporting` only. `budget-control` is unchanged: no
  status is added, removed or re-meant, and no budget's own page changes.
- **The numbers on a screen the customer already reads will move.** `ພະແນກບໍລິຫານ` drops from
  1,792,800,000 to 1,092,800,000 and its utilisation rises. That is the correction, but a figure
  that changes without explanation is indistinguishable from a figure that broke, which is why the
  report has to say what it excluded.
- **Invariant risk**:
  - INVARIANT 3 (derived balances): untouched. This changes WHICH budgets are summed, never how a
    budget's figure is derived — `amount_total` plus the ledger's adjustments, exactly as
    "The Annual Budget A Quarter Is Measured Against Is The Ledger's" already requires.
  - INVARIANT 1: the company scope through `fiscalYear` is unchanged; the status predicate narrows
    it and must never replace it.
- **Ledger**: nothing is written. `budget_txn` is not touched, and no consumption figure changes —
  only the ceiling those figures are measured against.
- **Code**: `BudgetQuarterService` — the budget query and `departmentsOf`.
- **Found while scoping — a status the system does not declare.** `BUDGET_STATUSES` is
  `['DRAFT', 'ACTIVE', 'REJECTED', 'CLOSED']`, but `UpdateBudgetDto.status` is validated only as
  `@IsString() @MaxLength(50)` and the budget edit form offers `INACTIVE`. So an `INACTIVE` budget
  can exist that no declared list contains. This change excludes it — a deactivated budget is not in
  force — but the drift itself is a `budget-control` question and is not fixed here. Naming it so it
  is not rediscovered.
- **Not in scope — the other budget reports.** Utilisation, balance and the reconciliation read were
  not audited for the same defect. If they share it they share it separately, and a blanket edit
  across reports whose data this change has not measured would be a guess.
