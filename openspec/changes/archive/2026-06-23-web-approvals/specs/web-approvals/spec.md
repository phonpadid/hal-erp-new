## ADDED Requirements

### Requirement: Approval Inbox

The web app SHALL show a `DOC_APPROVE` user the documents in the active company that are
awaiting their approval — those `IN_APPROVAL` where they are an eligible actor for the
current step and are not the creator — with enough context to triage (document number, type,
requester, base total, current step, age). Each item links to the document.

#### Scenario: Inbox lists actionable documents

- **WHEN** a `DOC_APPROVE` user opens the approvals inbox
- **THEN** documents awaiting their action are listed, and documents they created are not

#### Scenario: Empty inbox

- **WHEN** the user has nothing awaiting them
- **THEN** the inbox shows an empty state rather than an error

### Requirement: Act on a Document

The web app SHALL let an eligible approver Approve, Reject, or Return a document with an
optional remark, and reflect the resulting status. Server-side rejections (not eligible, not
in approval, self-approval) SHALL be surfaced.

#### Scenario: Approve advances the document

- **WHEN** an eligible approver approves a document on its final step
- **THEN** the document becomes COMPLETED and the action appears in its approval log

#### Scenario: Reject releases and stops routing

- **WHEN** an eligible approver rejects a document
- **THEN** the document becomes REJECTED and the detail reflects it

### Requirement: No Self-Approval in the UI

The approval action affordances SHALL be hidden when the signed-in user is the document's
creator, even if they hold `DOC_APPROVE` (UX mirror of invariant 8; the server still
enforces).

#### Scenario: Creator sees no approve action

- **WHEN** a user who created a document views it while it is IN_APPROVAL
- **THEN** the Approve / Reject / Return actions are not shown to them

### Requirement: Permission-Gated Approval Affordances

The approvals inbox and the act buttons SHALL be shown only to users holding `DOC_APPROVE`
(UX only; the server enforces on every action).

#### Scenario: Inbox hidden without permission

- **WHEN** a user without `DOC_APPROVE` is signed in
- **THEN** the Approvals navigation entry and inbox are not shown
