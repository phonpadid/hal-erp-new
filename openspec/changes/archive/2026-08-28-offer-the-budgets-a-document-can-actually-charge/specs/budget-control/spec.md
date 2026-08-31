## ADDED Requirements

### Requirement: A Plan Node May Carry Shared Budget

The system SHALL let a `BUDGET_MANAGE` user mark a `budget_node` as carrying shared budget. A budget
SHALL be shared when its own node is marked, or when any ancestor of its node is marked — the same
walk that decides which control points govern a budget.

A shared budget is money the company holds in common and any department may charge; it is not money
that stops belonging to the department that holds it. `budget.department_id` is unchanged by the
mark, so the budget keeps its owner for control-point coverage, for its own page, and for every
report that asks whose appropriation it is.

The mark states in the data what was previously carried only in people's heads. On the customer's
plan, `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` hold the office supplies, the security
guards, the phone bills and the cleaning contract that every department consumes; the workbook that
states the plan has no column that says so, and nothing in the system could.

Marking SHALL be available where the plan tree is shown, and SHALL NOT be offered on the document
form: a requester filling in a document has no business reclassifying the plan.

#### Scenario: Marking a node shares every budget beneath it

- **GIVEN** a node with budgets on it and on its descendants
- **WHEN** a `BUDGET_MANAGE` user marks that node as shared
- **THEN** every budget at or beneath it is shared

#### Scenario: A shared budget keeps its owning department

- **GIVEN** a budget beneath a node marked as shared
- **WHEN** the budget is read
- **THEN** its `department_id` is unchanged, and the control points governing it are unchanged

#### Scenario: Marking is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to mark a node as shared
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Unmarked is the default

- **GIVEN** a node nobody has marked
- **WHEN** its budgets are read
- **THEN** none of them is shared

## MODIFIED Requirements

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). This read is how a line
gets its budget: the budget is named by the requester, never derived from the line's account.

The read SHALL return only selection fields for each budget — its `id`, its node's `code`, its
`budget_name`, its node's `parent_id`, and the `code` and `name` of that parent node — and SHALL NOT
return `amount_total`, any derived balance, breakdown component, or ledger row. It SHALL be scoped
to the active company via the budget's fiscal year / department (invariant 1) and SHALL return only
budgets whose `status` is `ACTIVE`. It SHALL return the budgets the CALLER may charge, decided by
the `Scope` at which `DOC_CREATE` was granted to them: at `DEPARTMENT` their own department's
budgets, at `COMPANY` the active company's. It SHALL additionally be filterable by department, so a
caller who may see more can narrow to less. This read is additive: the
existing amount-bearing budget reads (list, get, derived-balance, breakdown, ledger) remain
authorized by `BUDGET_VIEW` and unchanged.

The parent's `code` and `name` travel with the budget because `parent_id` alone cannot be resolved
by the caller. A budget's parent is usually a CATEGORY node, which holds no money and is therefore
never itself a selectable budget — so it never appears in this response. In the customer's largest
department 85 of 92 budgets have such a parent, leaving the client an identifier that matches
nothing it was given. The category is the only structure in the data that distinguishes budgets
whose own names differ by a single word, and a requester choosing among ninety of them needs it.

A category's `name` is a label, not a financial figure. Returning it SHALL NOT be read as weakening
the rule above: this read carries no money, and it is gated on `DOC_CREATE` rather than
`BUDGET_VIEW` so that a requester who may not read budget figures can still raise a document.

Where a budget's node has no parent, the parent fields SHALL be absent rather than empty strings, so
"has no category" stays distinguishable from "has a category with no name".

The department a caller may see is NOT the client's to choose. It used to be: the read took a
department and the wizard filled it from the signed-in user's own, which hardcoded `DEPARTMENT`
behaviour for everybody however widely they had been granted. The company's budget officer holds
`DOC_CREATE` at `COMPANY`, sits in a department that holds no budget because a budget department
administers the plan rather than spending it, and could therefore submit no `requires_budget`
document at all — offered an empty picker with nothing said.

Budgets carried by a SHARED node SHALL be returned to every caller, whatever their scope and
whatever department they are in. Shared budgets are returned IN ADDITION to what the caller's scope
admits, never instead of them: a department keeps its own budgets and gains the shared ones.

Each returned budget SHALL state whether it is shared, so a caller can tell money its department
owns from money the company holds in common before charging it.

#### Scenario: Creator without BUDGET_VIEW can list selectable budgets

- **GIVEN** a user who holds `DOC_CREATE` but not `BUDGET_VIEW` in the active company
- **WHEN** the user requests the selectable-budgets read
- **THEN** the active company's `ACTIVE` budgets are returned with `id`, `code`, `budgetName`,
  `parentId` and the parent's `code` and `name` only, and the request is not rejected for lacking
  `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: A budget under a category names that category

- **GIVEN** a budget whose node hangs off a category node that holds no budget of its own
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget carries the category node's `code` and `name`, even though the category is
  not itself returned as a selectable budget

#### Scenario: A budget with no parent carries no category

- **GIVEN** a budget whose node has no parent
- **WHEN** a user requests the selectable-budgets read
- **THEN** the parent fields are absent from that budget's entry

#### Scenario: Selectable read is company-scoped

- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** only company A's budgets are returned and no budget belonging to another company
  appears

#### Scenario: A DEPARTMENT-scope caller sees their own department's budgets

- **GIVEN** a user granted `DOC_CREATE` at `DEPARTMENT`
- **WHEN** they request the selectable-budgets read
- **THEN** only their own department's budgets are returned, plus any shared ones

#### Scenario: A COMPANY-scope caller sees the company's budgets

- **GIVEN** a user granted `DOC_CREATE` at `COMPANY`, in a department that holds no budget
- **WHEN** they request the selectable-budgets read
- **THEN** the active company's budgets are returned, and the response is not empty

#### Scenario: A caller cannot widen their own scope

- **GIVEN** a user granted `DOC_CREATE` at `DEPARTMENT`
- **WHEN** they request the selectable-budgets read naming another department
- **THEN** no budget outside their own department is returned that is not shared

#### Scenario: A wider caller may narrow to one department

- **GIVEN** a user granted `DOC_CREATE` at `COMPANY`
- **WHEN** they request the selectable-budgets read naming one department
- **THEN** only that department's budgets are returned

#### Scenario: Inactive budgets are excluded

- **GIVEN** a budget in the active company whose `status` is not `ACTIVE`
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget is not returned

#### Scenario: A shared budget reaches a department that does not own it

- **GIVEN** a budget whose node hangs beneath a node marked as shared, held by another department
- **WHEN** a `DEPARTMENT`-scope user of a different department requests the selectable-budgets read
- **THEN** that budget is returned and is marked as shared

#### Scenario: Shared does not replace a department's own budgets

- **GIVEN** a department that holds budgets of its own, and a shared node elsewhere in the plan
- **WHEN** a `DEPARTMENT`-scope user of that department requests the selectable-budgets read
- **THEN** both its own budgets and the shared ones are returned

#### Scenario: A shared budget of another company is still not returned

- **GIVEN** a node marked as shared in company B
- **WHEN** a user requests the selectable-budgets read while company A is active
- **THEN** no budget beneath it appears (invariant 1)
