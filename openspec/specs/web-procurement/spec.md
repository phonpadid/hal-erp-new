# web-procurement Specification

## Purpose
TBD - created by archiving change procurement-post-actions. Update Purpose after archive.
## Requirements
### Requirement: Goods Receipt Screen

The web app SHALL let a `DOC_RECEIVE` user record received quantities per line on an approved
document whose type has `receives_goods = true`, showing each line's ordered qty, cumulative
`received_qty`, and `line_status` (OPEN / PARTIAL / RECEIVED), and SHALL surface server-side
rejections (e.g. over-receipt). The receive affordances SHALL be shown only to users holding
`DOC_RECEIVE` and only on documents of a `receives_goods` type (UX only; the server enforces).

#### Scenario: Record a partial receipt

- **WHEN** a `DOC_RECEIVE` user enters a received quantity below the ordered qty and saves
- **THEN** the line shows `PARTIAL` with the updated `received_qty`

#### Scenario: Over-receipt is surfaced

- **WHEN** the user enters a quantity that would exceed the ordered qty
- **THEN** the server rejection is shown and nothing is recorded

#### Scenario: Receive hidden without permission

- **WHEN** a user without `DOC_RECEIVE` views a purchase order
- **THEN** the receive affordances are not shown

#### Scenario: Receive hidden on a type that does not receive goods

- **WHEN** a `DOC_RECEIVE` user views an approved `PR` whose type has `receives_goods = false`
- **THEN** the receive action is not offered

### Requirement: Three-Way Matching Panel

The web app SHALL show a matching panel on a document that references a predecessor and whose
type's `match_mode` is `TWO_WAY` or `THREE_WAY`, comparing, per line, ordered vs received vs
invoiced quantities and amounts, indicating which lines pass or fail, and SHALL surface the
server's block when matching fails on submit. For `NONE` the panel SHALL NOT be shown.

#### Scenario: Panel shows per-line match

- **WHEN** an approver opens a disbursement that references a PO
- **THEN** each line shows ordered, received, and invoiced values and a pass/fail indicator

#### Scenario: Failed match blocks submit in the UI

- **WHEN** a line invoices more than received and the user submits
- **THEN** the server block is surfaced and the document is not submitted

#### Scenario: No panel when the type does not match

- **WHEN** a user opens a `PO` (type `match_mode` `NONE`) that references a `PR`
- **THEN** no matching panel is shown
