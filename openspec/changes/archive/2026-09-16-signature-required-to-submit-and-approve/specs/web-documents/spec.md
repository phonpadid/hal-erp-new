## ADDED Requirements

### Requirement: A Person Without a Signature Is Sent to Upload One Before Proposing

The web app SHALL read `hasSignature` from the session context and, when it is false, SHALL
disable the affordances that end in a stamped proposer signature — "New document" on the
documents list, "Save & submit" in the create wizard, and "Submit" on a draft's detail — and
SHALL show beside them a message saying a signature must be uploaded first, with a link to the
profile page (`/new/profile`) where the signature panel lives. "Save draft" and editing a draft
SHALL stay available: drafting is not signing. When the server refuses a submit with
`SIGNATURE_REQUIRED` (the context was stale, or the client was bypassed), the same message and
link SHALL be shown and the document SHALL stay `DRAFT`. This is a UX mirror; the server enforces.

#### Scenario: New document is disabled without a signature

- **GIVEN** a `DOC_CREATE` user whose context says `hasSignature: false`
- **WHEN** they open the documents list
- **THEN** "New document" is disabled and a message with a link to the profile page explains why

#### Scenario: Submit is disabled but drafting is not

- **GIVEN** the same user in the create wizard
- **WHEN** they reach the review step
- **THEN** "Save draft" is enabled, "Save & submit" is disabled, and the message with the profile
  link is shown

#### Scenario: The buttons come alive after uploading

- **GIVEN** the same user uploads a signature on the profile page
- **WHEN** they return to the documents list without reloading the app
- **THEN** "New document" is enabled and the message is gone

#### Scenario: A stale client learns from the server

- **GIVEN** a client whose context still says `hasSignature: true` for a user who no longer has one
- **WHEN** the submit is refused with `SIGNATURE_REQUIRED`
- **THEN** the refusal is shown with the profile link and the document stays `DRAFT`
