## MODIFIED Requirements

### Requirement: Company Context Token
The system SHALL issue an access token bound to the selected company, embedding the
`company_id`, `department_id`, `department_ids`, and the resolved permission codes with their
scope.

`department_id` is the user's **home** department in the active company: the `department_id` of
their `user_company_role` row marked `is_default`, else of their first active assignment. It is the
department a new document is raised in.

`department_ids` is the set of `department_id` values over EVERY active (non-expired) assignment
the user holds in the active company, de-duplicated. It SHALL always contain `department_id`. It is
what DEPARTMENT-scoped reads filter on. Assignments in other companies SHALL NOT contribute.

#### Scenario: Switching company re-issues context
- GIVEN an active session in company A
- WHEN the user switches to company B
- THEN a new token MUST be issued for company B
- AND permissions from company A MUST NOT apply to company B requests

#### Scenario: Several assignments in one company yield one home and a set
- **GIVEN** a user with an `is_default` assignment in department X and a second, non-default
  assignment in department Y of the same company
- **WHEN** a token is issued for that company
- **THEN** `department_id` is X and `department_ids` is {X, Y}

#### Scenario: An expired assignment contributes no department
- **GIVEN** a user whose assignment in department Y has a `valid_to` in the past
- **WHEN** a token is issued for that company
- **THEN** Y is absent from `department_ids`, exactly as its role's codes are absent from the grants

#### Scenario: A single assignment is a set of one
- **GIVEN** a user with exactly one assignment in the company
- **WHEN** a token is issued
- **THEN** `department_ids` equals {`department_id`}

### Requirement: Data Scope Enforcement
Each granted permission SHALL carry a scope of OWN, DEPARTMENT, COMPANY, or GROUP.
Every data query MUST filter by the active company first, then by scope.

DEPARTMENT scope SHALL mean the rows of **any** department in the token's `department_ids` — every
department the reader holds an active assignment in for the active company — not the home
department alone. A reader assigned to two departments is a member of both, and a scope that
honoured only the default assignment would discard configuration the administrator made. When the
set resolves empty the predicate SHALL match nothing.

A scope SHALL narrow a reader's DEFAULT visibility. It SHALL NOT withdraw access a reader has by
being party to the record — the person who raised it, or one the workflow has asked to act on it.
A scope answers "what may this person browse", not "what may this person be shown when the system
itself put the record in front of them", and a rule that confuses the two makes the correct
configuration unable to do its job: an approver at DEPARTMENT scope exists to act on documents from
other departments.

Scope SHALL govern reads. It SHALL NOT be relied on as an authorization rule for actions, which are
decided by permission codes and by the workflow.

#### Scenario: Department scope limits visibility
- GIVEN a user with `DOC_VIEW` at DEPARTMENT scope
- WHEN they list documents
- THEN only documents of their departments in the active company are returned
- AND GROUP scope is the only scope that MAY read across companies (read-only)

#### Scenario: Department scope covers every department the reader is assigned to
- **GIVEN** a user with `DOC_VIEW` at DEPARTMENT scope holding assignments in departments X
  (default) and Y of the active company
- **WHEN** they list documents, and request a document of Y by id
- **THEN** documents of both X and Y are returned, and the Y document is readable by id

#### Scenario: A department the reader is not assigned to stays hidden
- **GIVEN** the same user, and a document of department Z they have no part in
- **WHEN** they request it by id
- **THEN** the request answers not-found

#### Scenario: Own scope limits visibility to what the reader raised
- GIVEN a user with `DOC_VIEW` at OWN scope
- WHEN they list documents
- THEN only the documents they created are returned

#### Scenario: A scope does not hide a record the reader is party to
- GIVEN a user with `DOC_VIEW` at OWN scope who is a recorded approver on a document somebody else
  raised
- WHEN they list documents
- THEN that document is returned alongside their own

#### Scenario: A granted scope is actually applied by the query
- GIVEN a user whose `DOC_VIEW` is granted at OWN scope
- WHEN they list documents through the endpoint the product calls
- THEN the filter is applied by that endpoint, not merely available to it
- AND a scope that no query consults is a scope that does not exist
