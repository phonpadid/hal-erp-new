## ADDED Requirements

### Requirement: Approval Inbox Query

The system SHALL provide a read of the documents a user may currently act on: the active
company's `IN_APPROVAL` documents whose current step lists the user as an eligible actor
(targeted user, or a holder of the targeted role, or that principal's active one-hop
delegate) and that the user did not create. The query SHALL apply the same eligibility and
self-approval rules as acting, so it never lists a document the user cannot actually act on.
The read SHALL require `DOC_APPROVE` and be scoped to the active company.

#### Scenario: Lists only actionable documents

- **WHEN** a `DOC_APPROVE` user requests their pending approvals
- **THEN** the response contains the active company's `IN_APPROVAL` documents for which they
  are an eligible actor on the current step

#### Scenario: Excludes own and non-actionable documents

- **WHEN** the pending list is built
- **THEN** documents the user created, and documents not `IN_APPROVAL` or not targeting the
  user's role/delegation, are excluded

### Requirement: Auto-Start Routing on Submit

When a document is submitted and its mapped workflow has applicable steps, the system SHALL
begin approval routing automatically (transition `SUBMITTED` → `IN_APPROVAL` at the first
applicable step) so it appears in the relevant approvers' inboxes without a manual start.
This SHALL be triggered by the submit event so document handling does not depend on the
approval module. If no applicable step exists, the document SHALL remain `SUBMITTED`.

#### Scenario: Submit routes into approval

- **WHEN** a document with a mapped, applicable workflow is submitted
- **THEN** it transitions to `IN_APPROVAL` at the first step and its approvers can see it

#### Scenario: No workflow leaves it submitted

- **WHEN** a submitted document has no applicable workflow step
- **THEN** it remains `SUBMITTED` and no routing occurs
