# procurement-receiving Specification

## Purpose
TBD - created by archiving change procurement-post-actions. Update Purpose after archive.
## Requirements
### Requirement: Goods Receipt and Partial Receive

The system SHALL let a `DOC_RECEIVE` user record received quantities against a purchase order's
`document_line` rows, scoped to the active company. Each receipt SHALL accumulate
`document_line.received_qty` and advance `document_line.line_status` from `OPEN` to `PARTIAL`
(when `0 < received_qty < qty`) to `RECEIVED` (when `received_qty >= qty`). A receipt MUST NOT
push `received_qty` above the ordered `qty` (over-receipt is rejected). Concurrent receipts on the
same line SHALL be serialized so quantities are not lost.

#### Scenario: Partial then full receipt advances line status

- **GIVEN** a PO line ordered for qty 10 with `received_qty` 0 (`OPEN`)
- **WHEN** 4 are received, then 6 more
- **THEN** the line is `PARTIAL` at `received_qty` 4, then `RECEIVED` at `received_qty` 10

#### Scenario: Over-receipt is rejected

- **WHEN** a receipt would push `received_qty` above the ordered `qty`
- **THEN** it is rejected and `received_qty` is unchanged

#### Scenario: Concurrent receipts do not lose quantity

- **GIVEN** two receipts of 3 submitted concurrently for the same line ordered for 10
- **WHEN** both commit
- **THEN** `received_qty` is exactly 6 (the line row is locked while updated)

### Requirement: Three-Way Matching Before Disbursement

The system SHALL match a disbursement document — one whose type `post_action` is `CUT_BUDGET` and
which references a purchase order via `ref_document_id` — against the referenced PO before it may be
submitted: invoiced quantity MUST NOT exceed the PO line's `received_qty`, and invoiced amount MUST
NOT exceed the PO line's ordered amount within the configured tolerance (default exact). When
matching fails the submit SHALL be blocked with a per-line reason. The system SHALL also expose a
read of the per-line match result (ordered vs received vs invoiced) for display.

#### Scenario: Paying for more than received is blocked

- **GIVEN** a PO line with `received_qty` 4
- **WHEN** a disbursement referencing the PO is submitted invoicing qty 6 on that line
- **THEN** the submit is blocked with a not-received reason

#### Scenario: Matched disbursement passes

- **GIVEN** a PO whose lines are fully `RECEIVED`
- **WHEN** a disbursement invoices quantities and amounts within received and tolerance
- **THEN** matching passes and the disbursement may be submitted

#### Scenario: Match result is readable

- **WHEN** the match read is requested for a disbursement referencing a PO
- **THEN** it returns per line the ordered, received, and invoiced quantities and amounts

