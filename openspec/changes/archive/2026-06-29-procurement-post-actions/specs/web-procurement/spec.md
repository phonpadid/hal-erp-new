## ADDED Requirements

### Requirement: Goods Receipt Screen

The web app SHALL let a `DOC_RECEIVE` user record received quantities per line on a purchase order,
showing each line's ordered qty, cumulative `received_qty`, and `line_status` (OPEN / PARTIAL /
RECEIVED), and SHALL surface server-side rejections (e.g. over-receipt). The receive affordances
SHALL be shown only to users holding `DOC_RECEIVE` (UX only; the server enforces).

#### Scenario: Record a partial receipt

- **WHEN** a `DOC_RECEIVE` user enters a received quantity below the ordered qty and saves
- **THEN** the line shows `PARTIAL` with the updated `received_qty`

#### Scenario: Over-receipt is surfaced

- **WHEN** the user enters a quantity that would exceed the ordered qty
- **THEN** the server rejection is shown and nothing is recorded

#### Scenario: Receive hidden without permission

- **WHEN** a user without `DOC_RECEIVE` views a purchase order
- **THEN** the receive affordances are not shown

### Requirement: Three-Way Matching Panel

On a disbursement document that references a purchase order, the web app SHALL show a matching panel
comparing, per line, ordered (PO) vs received vs invoiced quantities and amounts, indicating which
lines pass or fail, and SHALL surface the server's block when matching fails on submit.

#### Scenario: Panel shows per-line match

- **WHEN** an approver opens a disbursement that references a PO
- **THEN** each line shows ordered, received, and invoiced values and a pass/fail indicator

#### Scenario: Failed match blocks submit in the UI

- **WHEN** a line invoices more than received and the user submits
- **THEN** the server block is surfaced and the document is not submitted
