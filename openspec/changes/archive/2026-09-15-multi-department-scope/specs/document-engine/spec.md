## MODIFIED Requirements

### Requirement: Document Reads Are Narrowed To The Reader's Scope

The document list and the single-document read SHALL be filtered by the scope at which the caller
was granted `DOC_VIEW`, applied AFTER the active-company filter and before any caller-supplied
filter. OWN SHALL restrict to documents the caller created; DEPARTMENT to documents whose
`document.department_id` is any of the caller's `department_ids` — every department they hold an
active assignment in for the active company, not the home department alone; COMPANY to the whole
active company. An ungranted code SHALL collapse to OWN. A DEPARTMENT predicate whose set is empty
SHALL match nothing.

This narrows a default; it SHALL NOT remove access a reader has by being party to the document —
see *A Reader Never Loses The Documents They Are Party To*.

The list and the single read SHALL apply the SAME predicate. A document the list omits SHALL answer
not-found when requested by id, and a document the list shows SHALL be readable by id. A not-found
for an out-of-scope document SHALL be indistinguishable from a not-found for a document that does
not exist: reporting that a document exists but belongs to someone else is itself a disclosure.

Scope SHALL narrow reads only. Submit, cancel, edit and the approval actions SHALL keep the guards
they already have, so that narrowing what a user may READ never becomes a second, accidental
authorization rule on what they may DO.

#### Scenario: A requester at OWN scope sees only their own documents

- **GIVEN** a user granted `DOC_VIEW` at OWN scope, and documents raised by several people
- **WHEN** they list documents
- **THEN** only the documents they created are returned

#### Scenario: A department head at DEPARTMENT scope sees their department

- **GIVEN** a user granted `DOC_VIEW` at DEPARTMENT scope
- **WHEN** they list documents
- **THEN** every document of their active department in the active company is returned, and no
  document of another department

#### Scenario: A reader assigned to two departments sees both

- **GIVEN** a user granted `DOC_VIEW` at DEPARTMENT scope, assigned to department X by default and
  to department Y by a second role in the same company, and documents raised in X, Y and Z
- **WHEN** they list documents
- **THEN** the documents of X and of Y are returned and none of Z
- **AND** a document of Y requested by id is readable, and a document of Z answers not-found

#### Scenario: A second assignment's department does not leak across companies

- **GIVEN** a user assigned to department Y of company B and to department X of company A
- **WHEN** they list documents in company A
- **THEN** only documents of X are considered; Y belongs to another company and adds nothing

#### Scenario: A back-office role at COMPANY scope sees everything in the company

- **GIVEN** a user granted `DOC_VIEW` at COMPANY scope
- **WHEN** they list documents
- **THEN** every document of the active company is returned, and none from another company

#### Scenario: A document outside the reader's scope is not readable by id

- **GIVEN** a user at OWN scope and a document raised by somebody else that they have no part in
- **WHEN** they request that document by id
- **THEN** the request answers not-found

#### Scenario: Company isolation still comes first

- **GIVEN** a user granted `DOC_VIEW` at COMPANY scope in one company
- **WHEN** they list documents
- **THEN** no document of another company is returned, whatever the scope

#### Scenario: Narrowing a read does not narrow an action

- **GIVEN** a user at OWN scope who is an eligible approver on somebody else's document
- **WHEN** they approve it
- **THEN** the approval succeeds, exactly as it did before scope was applied to reads
