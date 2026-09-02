## ADDED Requirements

### Requirement: Document Reads Are Narrowed To The Reader's Scope

The document list and the single-document read SHALL be filtered by the scope at which the caller
was granted `DOC_VIEW`, applied AFTER the active-company filter and before any caller-supplied
filter. OWN SHALL restrict to documents the caller created; DEPARTMENT to documents of the caller's
active department; COMPANY to the whole active company. An ungranted code SHALL collapse to OWN.

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

### Requirement: A Reader Never Loses The Documents They Are Party To

A document SHALL remain visible to a user, whatever their granted scope, when either is true:

- the `approval_log` records an action they took on it, or
- a live `document_approval_step` on it records them among the actors it opened for.

Approving is, by definition, work on documents other people raised in other departments. Without
this rule the correct configuration — a department head at DEPARTMENT scope — could not open the
disbursement they are being asked to sign, and the only way to make approval work would be to grant
every approver the whole company, which is the visibility this scoping exists to remove.

The two sources are read together on purpose: `approval_log` is append-only, so a document someone
approved stays findable to them permanently, while the recorded actors make a document visible as
soon as it reaches their queue and before they have acted on it.

This rule SHALL widen visibility only. It SHALL NOT grant any action, and it SHALL NOT cross the
company boundary.

#### Scenario: An approver can open a document from another department

- **GIVEN** a user at OWN scope who is the recorded actor on the open step of a document somebody
  else raised in another department
- **WHEN** they list documents, and open that one
- **THEN** it appears in the list and its detail is readable

#### Scenario: A document stays visible after it has been approved

- **GIVEN** a user at OWN scope who approved a document a month ago
- **WHEN** they list documents
- **THEN** that document is still returned, because the log of their action is permanent

#### Scenario: Refusing a document keeps it findable too

- **GIVEN** a user at OWN scope who rejected or returned a document
- **WHEN** they list documents
- **THEN** that document is returned — the record is of the action, whatever the action was

#### Scenario: A document that has not reached the approver yet stays hidden

- **GIVEN** a user at OWN scope named on a LATER step of a document whose route has not reached
  that step
- **WHEN** they list documents
- **THEN** the document is not returned, because no step has opened for them and no action is logged

#### Scenario: Being party to a document confers no action

- **GIVEN** a user who approved a document and holds no `DOC_CANCEL`
- **WHEN** they attempt to cancel it
- **THEN** the request is refused, because visibility is not authority

#### Scenario: Involvement never crosses a company

- **GIVEN** a user whose approval history is in one company
- **WHEN** they list documents in another company they belong to
- **THEN** only that company's documents are considered, and their history elsewhere adds nothing

### Requirement: The Document List Can Be Narrowed To What The Reader Raised

The document list SHALL accept a `mine` filter which, when set, returns only documents the caller
created. It SHALL combine conjunctively with every other filter, and it SHALL be applied INSIDE the
visibility predicate: a filter narrows and never widens, so `mine` SHALL NOT return a document the
reader could not otherwise see, and omitting it SHALL NOT hide one they could.

This is a filter and not a scope, deliberately. What a reader is ALLOWED to see is an
administrator's decision and must not be bypassable; what they WANT to look at right now is their
own, changes through the day, and must be. Granting OWN scope to express "just mine" would answer
the first question with the second and take away the department view a requester needs to see
whether a colleague has already raised the same request.

#### Scenario: A reader narrows the list to their own documents

- **GIVEN** a user at DEPARTMENT scope whose department holds documents raised by several people
- **WHEN** they list documents with `mine` set
- **THEN** only the documents they created are returned

#### Scenario: The filter narrows a company-wide reader too

- **GIVEN** a user at COMPANY scope
- **WHEN** they list documents with `mine` set
- **THEN** only the documents they created are returned

#### Scenario: The filter cannot widen visibility

- **GIVEN** a user at DEPARTMENT scope
- **WHEN** they list documents with `mine` unset
- **THEN** the result is their department's documents plus those they are party to, and nothing more

#### Scenario: The filter combines with the others

- **WHEN** the list is requested with `mine` and a `status` filter together
- **THEN** only the caller's own documents in that status are returned
