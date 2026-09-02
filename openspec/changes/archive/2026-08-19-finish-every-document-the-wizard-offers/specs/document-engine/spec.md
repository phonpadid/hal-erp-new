# document-engine

## ADDED Requirements

### Requirement: A Document Type Declares Where Its Content Is Authored

`document_type` SHALL carry a nullable `authoring_route`. `null` means the generic create form
authors this type's content. A value names the screen that does.

Some types keep their content outside `document_line` and `doc_field_value`, where the generic form
cannot reach it: a budget plan, adjustment and transfer carry `budget_movement` rows, and a journal
voucher carries `journal_voucher` lines. A generic form offered for such a type produces a document
that is well-formed and empty — it submits, enters the approval queue, and is refused by its
post-action when an approver finally acts on it.

The route SHALL NOT be derived from `post_action`. That column answers what full approval does, which
is a different question from where the content is written, and deriving one from the other puts the
answer in code rather than configuration (invariant 7).

Absence of a `dept_doc_type` mapping SHALL NOT be used to express this. Every document is created
through that mapping — including documents a dedicated screen creates — so a type without one cannot
be raised at all.

#### Scenario: A generically authored type carries no route

- **GIVEN** a document type whose content is document lines and field values
- **WHEN** its configuration is read
- **THEN** its `authoring_route` is null

#### Scenario: A type authored elsewhere names its screen

- **GIVEN** a document type whose content lives on `budget_movement` or `journal_voucher`
- **WHEN** its configuration is read
- **THEN** its `authoring_route` names the screen that authors it

#### Scenario: The mapping is still required

- **GIVEN** a document type whose `authoring_route` is set
- **WHEN** a document of that type is created by the screen that owns it
- **THEN** the department mapping still supplies its form template and workflow

### Requirement: A Document Type May Require an Employee

`document_type` SHALL carry `requires_employee`, defaulting to `false`. When `true`, a document of
that type MUST name a `related_employee` of the active company before it can be submitted. An
employee of another company SHALL be rejected (invariant 1).

The HR post-actions act on `document.related_employee` and are a logged no-op when it is absent. That
is correct for a post-action handed a document with no subject, and it is the wrong outcome to reach
from a form: a promotion that names nobody routes through every approval step, is approved, reaches
its terminal state, and changes no employee record. The approver is told it succeeded.

This flag SHALL be independent of `post_action`, like the other requirement flags: which document
names a person is a separate question from what approving it does.

#### Scenario: A promotion without an employee cannot be submitted

- **GIVEN** a document type with `requires_employee` true
- **WHEN** a document of that type is submitted naming no employee
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: An employee of another company is rejected

- **WHEN** a document names a `related_employee` belonging to another company
- **THEN** the submit is rejected

#### Scenario: requires_employee defaults off

- **GIVEN** a document type created without specifying `requires_employee`
- **WHEN** a document of that type is submitted naming no employee
- **THEN** the submit is not rejected for a missing employee

### Requirement: A Document Whose Post-Action Needs Content It Lacks Is Refused At Submit

A document SHALL carry the content its post-action will need before it can be submitted. A budget
movement post-action (`ACTIVATE_BUDGET`, `TRANSFER`, `ADJUST_INCREASE`, `ADJUST_DECREASE`) requires
at least one `budget_movement` row; `POST_JOURNAL` requires a `journal_voucher`.

The post-actions already refuse these documents. Refusing them at submit instead moves the cost from
an approver to the person who can fix it: today such a document enters the queue, cannot be approved
however many times the approver tries, and leaves only by being withdrawn.

The submit check SHALL be a strict subset of what the post-action validates — that the content
exists — and SHALL NOT replace the post-action's own refusal, which still runs at the moment it acts.

#### Scenario: An empty budget plan is refused at submit

- **GIVEN** a budget plan document with no `budget_movement` rows
- **WHEN** it is submitted
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: An empty voucher is refused at submit

- **GIVEN** a document whose type carries `POST_JOURNAL` and which has no `journal_voucher`
- **WHEN** it is submitted
- **THEN** the submit is rejected

#### Scenario: The post-action keeps its own refusal

- **GIVEN** a budget document whose movements were removed after it was submitted
- **WHEN** it is fully approved
- **THEN** the post-action still refuses and the approval rolls back
