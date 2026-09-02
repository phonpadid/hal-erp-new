## MODIFIED Requirements

### Requirement: Data Scope Enforcement
Each granted permission SHALL carry a scope of OWN, DEPARTMENT, COMPANY, or GROUP.
Every data query MUST filter by the active company first, then by scope.

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
- THEN only documents of their department in the active company are returned
- AND GROUP scope is the only scope that MAY read across companies (read-only)

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
