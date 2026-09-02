# external-api

## MODIFIED Requirements

### Requirement: API Keys Cannot Approve

A request authenticated by an API key SHALL be permitted to read and to create or submit
documents subject to the bound user's permission codes, but SHALL NOT be permitted to approve,
reject, or return any document, even if the bound user holds the corresponding
approval permission codes. The prohibition SHALL be enforced on the authentication channel and
SHALL NOT be expressible as a grant.

A key MAY withdraw a document the bound user created, subject to `DOC_CANCEL`, and that withdrawal
SHALL append its `CANCEL` row to `approval_log` like any other. The line this requirement draws is
around **deciding somebody else's document**, not around writing to that table: a key that can
create and submit a request can end the same request, and refusing only the ending would leave an
integration able to raise obligations it cannot retract.

#### Scenario: Key may create and submit a document
- **WHEN** an API-key request calls a document create or submit endpoint and the bound user holds the required create/submit permission code
- **THEN** the request is authorized and the document is created or submitted

#### Scenario: Key is denied approval even with the approval grant
- **WHEN** an API-key request calls the approval action endpoint and the bound user holds the corresponding approval permission code
- **THEN** the request is rejected with 403 and no approval, rejection, or return is recorded

#### Scenario: Key may withdraw the document it raised
- **WHEN** an API-key request withdraws a document the bound user created and that user holds `DOC_CANCEL`
- **THEN** the withdrawal succeeds and is recorded as a `CANCEL` row naming that user

#### Scenario: No-self-approval remains intact
- **WHEN** a document is created via an API key bound to user U
- **THEN** the document's creator is user U and no channel exists by which that same key could approve it
