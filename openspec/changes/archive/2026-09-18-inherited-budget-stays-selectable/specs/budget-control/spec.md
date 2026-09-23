## MODIFIED Requirements

### Requirement: Selectable Budgets for Document Creation

The system SHALL expose a read that returns the budgets a document creator may charge a line
to, authorized by the `DOC_CREATE` permission code (not `BUDGET_VIEW`). This read is how a line
gets its budget: the budget is named by the requester, never derived from the line's account.

The read SHALL return only selection fields for each budget — its `id`, its node's `code`, its
`budget_name`, its node's `parent_id`, the `code` and `name` of that parent node, and the budget's
own `gl_account` — and SHALL NOT return `amount_total`, any derived balance, breakdown component, or
ledger row. It SHALL be scoped to the active company via the budget's fiscal year / department
(invariant 1) and SHALL return only budgets whose `status` is `ACTIVE`. It SHALL be filterable by
department, so a requester is offered their own department's budgets rather than every budget in the
company. This read is additive: the existing amount-bearing budget reads (list, get, derived-balance,
breakdown, ledger) remain authorized by `BUDGET_VIEW` and unchanged.

The `gl_account` travels with each budget so a client can tell which budgets carry a given account
without a second read. It SHALL be absent, rather than empty, for a budget that records none — a
budget whose spending posts to several accounts records no single one, and "spans several accounts"
must stay distinguishable from "posts to an account named by the empty string". Returning it SHALL
NOT be read as reinstating derivation: `budget.gl_account` is an account code, not a figure and not
an instruction, and the requirement above still stands — the server derives no budget from a line's
account, and a client that uses this field to offer a default still sends an explicit `budget_id`
that the server validates on its own terms.

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

The read MAY be given a `documentId`. When it is, the response SHALL also include every `ACTIVE`
budget carried by that document's `document_line` rows, provided the document belongs to the
active company (invariant 1); a document of another company adds nothing. A budget added only
because the document carries it SHALL be flagged `inherited: true`; one the caller could select
anyway SHALL appear once, unflagged. A successor raised by create-from carries its predecessor's
budgets, and the person completing it — often in another department — MUST be able to keep them:
the budget was chosen and approved on the predecessor, and a picker that cannot offer it back
turns a correct line into a blocked one. The widening SHALL be exactly the document's own budgets:
it SHALL NOT admit other budgets of the predecessor's department.

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
  `parentId`, the parent's `code` and `name`, and `glAccount` only, and the request is not rejected
  for lacking `BUDGET_VIEW`

#### Scenario: Selectable read exposes no financial figures

- **WHEN** any user requests the selectable-budgets read
- **THEN** the response contains no `amountTotal`, available balance, breakdown, or ledger data
  for any budget

#### Scenario: A budget names the account it posts to

- **GIVEN** a budget whose `gl_account` is set
- **WHEN** a user requests the selectable-budgets read
- **THEN** that budget's entry carries that `gl_account`

#### Scenario: A budget spanning several accounts names none

- **GIVEN** a budget whose `gl_account` is null because its spending posts to several accounts
- **WHEN** a user requests the selectable-budgets read
- **THEN** the `glAccount` field is absent from that budget's entry rather than an empty string

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

#### Scenario: A successor keeps the budget it inherited

- **GIVEN** a PR raised in ADM charging ADM's budget, and a PO created from it whose lines carry that budget
- **WHEN** a `DEPARTMENT`-scope Procurement user requests the selectable-budgets read naming the PO
- **THEN** ADM's budget is returned, flagged `inherited`, alongside Procurement's own budgets

#### Scenario: Inheritance does not open the predecessor's department

- **GIVEN** the same PO, and a second ADM budget the PR never named
- **WHEN** the Procurement user requests the read naming the PO
- **THEN** that second budget is not returned

#### Scenario: A budget the caller could select anyway is not flagged

- **GIVEN** a PO whose line carries a budget of the caller's own department
- **WHEN** the caller requests the read naming the PO
- **THEN** that budget appears once and is not flagged `inherited`

#### Scenario: An inactive inherited budget stays unavailable

- **GIVEN** a draft whose line carries a budget whose `status` is no longer `ACTIVE`
- **WHEN** the read is requested naming the draft
- **THEN** that budget is not returned

#### Scenario: A document of another company adds nothing

- **WHEN** a user in company A requests the read naming a document of company B
- **THEN** the response is exactly what it would be without `documentId`
