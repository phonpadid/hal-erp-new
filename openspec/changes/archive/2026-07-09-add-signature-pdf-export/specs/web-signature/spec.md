## ADDED Requirements

### Requirement: Signature Panel on Own Profile

The frontend SHALL provide, on the signed-in user's own profile page, a panel that shows
the user's current signature (or an empty state) and lets them upload or replace it. The
panel SHALL call only the self-scoped signature endpoints (no user id in the path), submit
the image as multipart, and enforce the same client-side image type and size limits the
server enforces so the two do not drift. On success the panel SHALL reflect the new
signature without a full page reload.

#### Scenario: User uploads a signature from their profile

- **WHEN** a user with no signature selects a valid PNG in the signature panel and submits
- **THEN** the client uploads it to the self-scoped endpoint and the panel then shows the
  uploaded signature

#### Scenario: Client rejects an invalid file before upload

- **WHEN** the user selects a non-image or oversized file
- **THEN** the panel shows a validation message and does not call the server

#### Scenario: Replacing shows the new signature

- **GIVEN** a user with an existing signature displayed in the panel
- **WHEN** they upload a replacement
- **THEN** the panel updates to show the new signature without a page reload

### Requirement: Per-Step Signature Toggle on Workflow Step Config

The frontend SHALL expose, on the workflow-step configuration page, a toggle bound to
`workflow_step.show_signature_on_pdf` that lets an admin include or exclude that step's
signature from the exported PDF. The toggle SHALL persist through the existing step
configuration save and SHALL be gated by the workflow-configuration permission code
(UX-only; the server still enforces).

#### Scenario: Admin excludes a step's signature from the PDF

- **GIVEN** an admin editing a workflow step with the signature toggle on
- **WHEN** they turn the toggle off and save
- **THEN** the step is persisted with `show_signature_on_pdf` = false and that step no longer
  produces a signature block on exported PDFs

#### Scenario: Toggle hidden without workflow-config permission

- **GIVEN** a user without the workflow-configuration permission code
- **WHEN** the workflow-step page renders
- **THEN** the signature toggle is not shown

### Requirement: Export PDF Action on Document Detail

The frontend SHALL provide an Export-PDF action on the document detail view that requests
the document's PDF from the export endpoint and delivers it to the user as a download. The
action SHALL be shown only when the active-company permission context allows reading the
document (mirroring the server guard, UX-only). While the PDF is being generated the action
SHALL indicate progress and SHALL surface an error message if the export fails.

#### Scenario: User exports a document to PDF

- **GIVEN** a user viewing a document they may read
- **WHEN** they trigger Export PDF
- **THEN** the client requests the export endpoint and the browser downloads the returned PDF

#### Scenario: Action hidden without read permission

- **GIVEN** a user whose active-company permissions do not include reading the document
- **WHEN** the document detail view renders
- **THEN** the Export-PDF action is not shown

#### Scenario: Export failure is surfaced

- **WHEN** the export request fails
- **THEN** the view shows an error message and does not download a file
