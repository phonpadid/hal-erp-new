## ADDED Requirements

### Requirement: Uploading a Signature Clears the Gates That Waited on It

The signature panel on the profile page SHALL, after a successful upload, update the session
context's `hasSignature` to true without requiring a reload, so every affordance elsewhere in
the app that was disabled for want of a signature (new document, submit, approve) becomes
available the moment the upload completes. The panel SHALL say, when no signature is on file,
that submitting and approving documents needs one — the reason a person arrived there.

#### Scenario: The context follows the upload

- **GIVEN** a signed-in user with no signature whose context says `hasSignature: false`
- **WHEN** their upload on the profile page completes
- **THEN** the context says `hasSignature: true` and no reload has happened

#### Scenario: The empty panel says why it matters

- **WHEN** a user with no signature opens the profile page
- **THEN** the signature panel states that a signature is required to submit and approve
  documents
