## MODIFIED Requirements

### Requirement: The Item Master Reads Budgets Well Enough To Name One

The system SHALL offer the item registry a read of the budgets an item may be bound to: the `ACTIVE`
budgets of the active company's open fiscal year. Each row SHALL identify ONE budget well enough to
be named on its own — the plan code (`budget_node.code`, unique within a fiscal year), the budget's
name, the department that holds it, and its `gl_account`. Rows SHALL NOT be merged by `gl_account`:
one account carries many budgets, and a caller that cannot tell them apart cannot bind one.

The read SHALL be authorized by `MASTER_VIEW`, not `BUDGET_VIEW` — whoever maintains the item
registry names the budget an item belongs to and need not be able to read what any budget is worth —
and SHALL be scoped to the active company (invariant 1). It SHALL return identifying fields only: a
read that feeds a picker has no business carrying figures.

WHICH budgets are offered SHALL follow the scope the caller was granted `MASTER_VIEW` at, applied
AFTER the company filter and never in its place — the same rule the selectable read applies to
`DOC_CREATE`:

- `DEPARTMENT` SHALL return the budgets held by the caller's own department
  (`budget.department_id`), PLUS every budget carried by a shared node (`budget_node.is_shared`,
  its own or an ancestor's, as the shared-budget requirement defines). Shared widens; it never
  replaces. The caller SHALL NOT be able to widen the list by naming a department.
- `COMPANY` and `GROUP` SHALL return every budget of the company, as before.

Each returned row SHALL state whether it is shared (`isShared`), so the registry can label money the
company holds in common apart from money the caller's department owns.

A `DEPARTMENT`-scoped caller in a department that holds no budget SHALL receive only the shared
budgets, which MAY be none. An empty list under this rule means the caller's department holds no
budget, not that the fiscal year holds none.

#### Scenario: Each budget is identified individually

- **GIVEN** four `ACTIVE` budgets of the open fiscal year whose `gl_account` is all `612.06`
- **WHEN** the item registry reads the budgets an item may be bound to
- **THEN** four rows are returned, each carrying its own plan code, budget name and department

#### Scenario: Read with the permission that maintains the registry

- **GIVEN** a user holding `MASTER_VIEW` and not `BUDGET_VIEW`
- **WHEN** they read the budgets an item may be bound to
- **THEN** the active company's budgets are returned, carrying no amounts

#### Scenario: Another company's budgets are never returned

- **GIVEN** budgets in companies A and B
- **WHEN** the read is made while company A is active
- **THEN** only company A's budgets are returned

#### Scenario: A department-scoped registrar sees their own department's budgets

- **GIVEN** a user granted `MASTER_VIEW` at `DEPARTMENT` scope in department D, and `ACTIVE`
  budgets held by D and by another department E, none shared
- **WHEN** they read the budgets an item may be bound to
- **THEN** only D's budgets are returned, and none of E's

#### Scenario: A shared budget reaches a department-scoped registrar who does not own it

- **GIVEN** a user granted `MASTER_VIEW` at `DEPARTMENT` scope in department D, and a budget held
  by department E whose node hangs beneath a node marked as shared
- **WHEN** they read the budgets an item may be bound to
- **THEN** that budget is returned, marked `isShared`, alongside D's own budgets, which are not

#### Scenario: Shared widens rather than replaces

- **GIVEN** a `DEPARTMENT`-scoped user whose department holds budgets of its own, and a shared node
  elsewhere in the plan
- **WHEN** they read the budgets an item may be bound to
- **THEN** both their department's budgets and the shared ones are returned

#### Scenario: A company-scoped registrar still sees every budget

- **GIVEN** a user granted `MASTER_VIEW` at `COMPANY` scope, and budgets held by several departments
- **WHEN** they read the budgets an item may be bound to
- **THEN** every `ACTIVE` budget of the open fiscal year is returned, whichever department holds it

#### Scenario: A shared budget of another company is still not returned

- **GIVEN** a node marked as shared in company B
- **WHEN** a `DEPARTMENT`-scoped user reads the budgets an item may be bound to while company A is
  active
- **THEN** no budget of company B is returned, shared or not

#### Scenario: A department holding no budget is offered only the shared ones

- **GIVEN** a `DEPARTMENT`-scoped user in a department that holds no budget, and no shared node
- **WHEN** they read the budgets an item may be bound to
- **THEN** an empty list is returned, and the request is not rejected
