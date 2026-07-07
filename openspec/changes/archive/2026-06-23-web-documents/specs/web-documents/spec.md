## ADDED Requirements

### Requirement: Document List and Detail

The web app SHALL show the active company's documents (with status) to users holding
`DOC_VIEW`, and a detail view with the document's header, field values, line items,
attachments, and approval log. Reads are scoped to the active company by the server.

#### Scenario: List shows the company's documents

- **WHEN** a user with `DOC_VIEW` opens the documents list
- **THEN** the active company's documents are shown with their status

#### Scenario: Detail renders fields and lines

- **WHEN** the user opens a document
- **THEN** its header, field values, line items, and approval log are displayed

### Requirement: Create and Edit a Draft

The web app SHALL let a `DOC_CREATE` user create a document of a type enabled for their
department, rendering the form dynamically from the type's `form_field` configuration (not
hardcoded), capture line items, and save it as a draft. Required fields SHALL be validated
client-side before save (the server remains authoritative).

#### Scenario: Form is rendered from configuration

- **WHEN** the user picks a creatable document type
- **THEN** the form fields shown come from that type's template configuration

#### Scenario: Required field blocks save

- **WHEN** the user tries to save with a required field empty
- **THEN** the client shows a validation error and does not submit

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user cancel an
own document, reflecting the resulting status. Server-side submit errors (over-budget,
missing field, closed period, vendor/item not enabled) SHALL be surfaced to the user.

#### Scenario: Successful submit advances status

- **WHEN** a valid draft is submitted
- **THEN** the document moves out of DRAFT and the detail reflects the new status

#### Scenario: Server submit error is shown

- **WHEN** submit is rejected by the server (e.g. over budget)
- **THEN** the error message is shown and the document stays DRAFT

### Requirement: Permission-Gated Document Affordances

Document actions SHALL be shown by permission code and document status: create only with
`DOC_CREATE`, submit only with `DOC_SUBMIT` on a DRAFT, cancel only with `DOC_CANCEL`.
Affordances the user lacks are hidden (UX only; the server still enforces).

#### Scenario: Submit hidden without permission

- **WHEN** a user without `DOC_SUBMIT` views their draft
- **THEN** the Submit action is not shown
