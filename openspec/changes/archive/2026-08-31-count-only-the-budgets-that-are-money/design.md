## Context

`budget-period-reporting` already says a great deal about how a quarter's figures are computed, and
nothing at all about which budgets are computed over. Its requirements begin one step too late:

> *"Wherever this capability speaks of the annual budget, it SHALL mean the budget as the ledger now
> states it: `budget.amount_total` plus every `budget_txn` of type `ADJUST_INCREASE` and
> `TRANSFER_IN`…"*

That settles the arithmetic per budget. `BudgetQuarterService` then runs it over every row the
fiscal year holds:

```
const where: Record<string, unknown> = { fiscalYear: fy.id };
if (departmentId) where.department = departmentId;
```

The statuses a budget can hold, and what each means:

| status | what it is | money? |
| --- | --- | --- |
| `DRAFT` | proposed, awaiting the plan's approval — *"not spendable"* | no |
| `ACTIVE` | in force | yes |
| `CLOSED` | *"an appropriation that ran its year"* — keeps `amount_total` and every ledger row | it was |
| `REJECTED` | *"a proposal that was turned down"*, kept because a movement references it | never |
| `INACTIVE` | not in `BUDGET_STATUSES`; reachable only because the update DTO takes any string | undeclared |

## Goals / Non-Goals

**Goals:**

- The quarterly report's ceiling is money that was voted, not proposals that were refused.
- A status invented later cannot join the ceiling by default.
- A reader who saw 1,792,800,000 yesterday can tell why they see 1,092,800,000 today.

**Non-Goals:**

- Changing what any status means, or removing `REJECTED` rows.
- Auditing the other budget reports for the same defect.
- Resolving the `INACTIVE` drift between `BUDGET_STATUSES` and the update DTO.

## Decisions

### Count `ACTIVE` and `CLOSED`; exclude everything else

An allow-list, not a deny-list.

`CLOSED` is in because the entity says what it is: *"set when the fiscal year closes, it keeps
`amount_total` and every ledger row exactly as they are"* and remains *"readable by every report
that asks what was voted and what was spent."* A report on a closed year that excluded closed
budgets would show a year of spending against a ceiling of zero — every row overspent, which the
capability already has a requirement about and would then produce falsely.

`DRAFT` is out: it is a proposal awaiting approval and is explicitly not spendable. A department
mid-way through entering next year's plan would otherwise watch its ceiling climb with each draft.

`REJECTED` is out: it was never money.

*Alternative considered — exclude `REJECTED` only.* Rejected because it is a deny-list, and a
deny-list is wrong by default: the next status somebody adds joins the annual ceiling silently, and
the failure looks exactly like the one being fixed here. `INACTIVE` already exists and is in no
declared list — the deny-list would have missed it today, not hypothetically.

### The department options come from the same rule

`departmentsOf` builds the report's department picker from the same table with no status predicate,
so a department holding two refused proposals and nothing else is offered. Choosing it produces a
report with no money in it, which reads as a broken screen rather than as an empty one. The picker
gets the same predicate as the report — a filter must never offer an option that yields nothing.

### The report says what it left out

A figure that shrinks by 700,000,000 between two openings, with nothing on screen to explain it, is
indistinguishable from a figure that broke. The read reports how many budgets it excluded and their
total, and the screen states it.

This is the same obligation `web-ui-quality` places on a filter and this capability's own
"A Comparison Without A Counterpart Is Labelled, Not Scored" places on a missing quarter: a number
that has had something taken out of it says so.

*Alternative considered — say nothing, since the new number is the correct one.* Rejected: correct
and unexplained is how a user learns to distrust a report. The line costs one sentence and is only
rendered when something was actually excluded.

### The predicate narrows; it never replaces

`{ fiscalYear, status: { $in: [...] } }` and the optional department are `$and`ed onto the same
company-scoped predicate. Company scope (invariant 1) reaches the report through `fiscalYear`, and
the status filter must not be written in a way that can displace it.

## Sequence: what writes `budget_txn`

Nothing. This change writes no row of any table and opens no transaction — it adds a `status`
predicate to two SELECTs and a count to a response. No ledger row is read differently either: the
consumption figures (`Σ RESERVE − Σ RELEASE`) for the budgets that remain are byte-identical to
what they are today. Only the set of budgets summed changes, so there is no locking to specify and
no concurrency surface.

## Risks / Trade-offs

- **[A number the customer reads changes]** → 1,792,800,000 becomes 1,092,800,000 for one
  department, and every utilisation percentage derived from it rises. Mitigation: it is the
  correction, and the excluded-count line is what makes it legible rather than alarming.

- **[`CLOSED` is included on the strength of a comment, not of data]** → this database has no closed
  fiscal year yet, so the behaviour cannot be observed on the customer's own figures. Mitigation:
  covered by a test that builds one, and the entity's own documentation is explicit about what
  `CLOSED` keeps. If the customer's first year-end disagrees, the allow-list is one line.

- **[An allow-list must be maintained]** → a genuinely new spendable status would have to be added
  here or it would be silently excluded. Mitigation: that is the correct default. Being wrongly
  absent from a ceiling is visible; being wrongly present is what this change exists to fix.

## Migration Plan

No schema change, no data change, no migration. Backend and frontend deploy together only because
the screen renders the new excluded-count line; an older client ignoring the extra field would
still show corrected figures. Rollback is a revert, and restores the inflated number.

## Open Questions

None. `INACTIVE` is excluded by the allow-list without this change having to decide what it means —
that question belongs to `budget-control` and is recorded in the proposal.
