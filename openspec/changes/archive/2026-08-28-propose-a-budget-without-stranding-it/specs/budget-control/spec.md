## ADDED Requirements

### Requirement: A Proposed Budget That Lost Its Plan Can Be Proposed Again

The system SHALL let an authorized user raise a plan for an existing `DRAFT` budget that no plan
carries, so a budget stranded by a partial write has an exit through the product.

The budget MUST be `DRAFT`, MUST belong to the active company, and MUST NOT already be carried by a
plan. Each refusal SHALL name which of the three failed — "already active", "another company's" and
"already has a plan awaiting approval" send a reader to three different actions.

Atomic intake makes stranding unreachable going forward; this is for the rows that predate it and
for any caller that does the two steps itself.

#### Scenario: A stranded draft is re-proposed

- **GIVEN** a `DRAFT` budget that no plan carries
- **WHEN** it is proposed again
- **THEN** a plan document is raised carrying it, and it becomes reachable for approval

#### Scenario: An active budget cannot be re-proposed

- **GIVEN** a budget that is already `ACTIVE`
- **WHEN** it is proposed again
- **THEN** it is refused, naming that it is already in force

#### Scenario: A budget already awaiting approval cannot be re-proposed

- **GIVEN** a `DRAFT` budget carried by a plan that is in approval
- **WHEN** it is proposed again
- **THEN** it is refused, naming the plan that already carries it

#### Scenario: Another company's budget is not re-proposable

- **GIVEN** a `DRAFT` budget of another company
- **WHEN** it is proposed in the active company
- **THEN** it is not resolvable (invariant 1)

## MODIFIED Requirements

### Requirement: Budget Plan Intake

A budget SHALL become spendable only through an approved document. The system SHALL let authorized
users (`BUDGET_MANAGE`) create a **budget plan**: a `document` whose `document_type.post_action` is
`ACTIVATE_BUDGET`, carrying one `budget_movement` row per proposed budget with `movement_type`
`ACTIVATE_BUDGET`, `to_budget_id` referencing a `DRAFT` `budget`, `amount` equal to that budget's
`amount_total`, and `reason` carrying the line's note. A plan MAY carry one or many lines; the
whole plan is approved or rejected as one.

The plan's `document_type` SHALL set `requires_budget` to `false`. A plan proposes budget, it does
not consume any, so submitting one SHALL take no reservation and write no `budget_txn`.

Intake SHALL follow the same rules the existing movement documents follow: the type is resolved by
`post_action` within the active company (invariant 7, never by type code), the type MUST be enabled
for the routing department via `dept_doc_type`, and the document number SHALL be issued through the
existing numbering service.

Every `budget` referenced by a plan MUST be `DRAFT` and MUST belong to the active company. A plan
SHALL be rejected when any of its lines references a budget that is already `ACTIVE`, already
`REJECTED`, or belongs to another company.

A plan SHALL name one routing `department`, and every line MUST target that department or one of
its descendants in the `department.parent_dept_id` tree. A plan is exactly as wide as the approvers
who sign it: `document.department_id` is what `dept_doc_type` resolves to a form and a workflow, so
a line outside the routing department's subtree would be approved by people with no authority over
it. A plan covering a whole company is expressed by routing it through the root department, not by
letting any plan reach any department.

Creating a proposed budget and creating the plan that carries it SHALL be one unit of work, written
inside a single transaction. A failure in either SHALL leave the company exactly as it was.

Split across two commits, a failure after the first leaves a `DRAFT` budget no plan carries. The
dimension index refuses a second proposal for the same line, there is no delete for a budget, and
`REJECTED` — the one status that frees the dimension — is not reachable from the product. The money
is neither spendable nor removable.

#### Scenario: A plan is created as a document, not as spendable budget

- **GIVEN** a user with `BUDGET_MANAGE`
- **WHEN** they create a budget plan for a fiscal year with one proposed line
- **THEN** a `DRAFT` document is created with one `budget_movement` of `movement_type`
  `ACTIVATE_BUDGET` pointing at a `DRAFT` `budget`
- **AND** the budget cannot be spent against

#### Scenario: A plan carries many lines under one document

- **WHEN** a plan is created with proposed budgets for several departments in one fiscal year
- **THEN** one document is created carrying one `budget_movement` row per proposed budget

#### Scenario: Submitting a plan reserves nothing

- **GIVEN** a budget plan whose `document_type` has `requires_budget` `false`
- **WHEN** it is submitted
- **THEN** no `budget_txn` row is written and no budget is reserved

#### Scenario: A plan cannot reference an already-active budget

- **WHEN** a plan is created with a line referencing a budget whose `status` is `ACTIVE`
- **THEN** the request is rejected with a 400 naming that budget

#### Scenario: A line outside the routing department's subtree is rejected

- **GIVEN** a plan routed through a department
- **WHEN** one of its lines targets a department that is neither that department nor one of its
  descendants
- **THEN** the request is rejected with a 400 naming that department

#### Scenario: A line for a descendant department is accepted

- **GIVEN** a plan routed through a department that has child departments
- **WHEN** a line targets one of those children
- **THEN** the line is accepted

#### Scenario: Creating a plan is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a budget plan
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: A failed plan leaves no budget behind

- **GIVEN** a proposal whose plan cannot be raised — no `ACTIVATE_BUDGET` type is configured
- **WHEN** the proposal is made
- **THEN** it is refused, and no `budget`, `document` or `budget_movement` row exists from it

#### Scenario: Proposing the same dimension twice is a conflict, not a crash

- **GIVEN** a budget already proposed for a node and department
- **WHEN** the same dimension is proposed again
- **THEN** it is refused as a conflict naming the existing budget
