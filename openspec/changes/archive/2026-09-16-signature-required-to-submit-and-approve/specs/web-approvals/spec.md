## ADDED Requirements

### Requirement: Approve Waits for a Signature While Reject and Return Do Not

The web app SHALL disable the Approve action on the document detail when the eligibility check
for the document reports `SIGNATURE_REQUIRED` or the session context says `hasSignature: false`,
and SHALL show a message that a signature must be uploaded first, with a link to the profile
page (`/new/profile`). Reject and Return SHALL remain enabled: they stamp no signature. When the
server refuses an APPROVE with `SIGNATURE_REQUIRED`, the same message and link SHALL be shown and
the document SHALL be left where it was. Approving from the approvals inbox row SHALL follow the
same rule. This is a UX mirror; the server enforces.

#### Scenario: Approve is disabled for an approver without a signature

- **GIVEN** an eligible approver whose context says `hasSignature: false`
- **WHEN** they open a document waiting on them
- **THEN** Approve is disabled with the message and profile link, while Reject and Return are
  enabled

#### Scenario: Approve is enabled once a signature is on file

- **GIVEN** the same approver uploads a signature on the profile page
- **WHEN** they open the document again without reloading the app
- **THEN** Approve is enabled and the message is gone

#### Scenario: The server's refusal is shown in place

- **WHEN** an APPROVE is refused by the server with `SIGNATURE_REQUIRED`
- **THEN** the message with the profile link is shown and the detail still shows the document on
  the same step
