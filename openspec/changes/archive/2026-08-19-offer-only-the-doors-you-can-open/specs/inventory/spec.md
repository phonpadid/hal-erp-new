# inventory

## ADDED Requirements

### Requirement: Requester Warehouse Selection Read

The system SHALL expose a requester-facing warehouse read, authorized by the document-create
permission `DOC_CREATE` (not `INV_VIEW`), mirroring the budget picker read `GET /budgets/selectable`.
It SHALL return the active company's active warehouses, each with its `id`, `code` and `name`, and
nothing else — no stock figures and no balances. The read SHALL be company-scoped and SHALL NOT
require any inventory administration permission.

A document type configured `requires_warehouse` cannot be submitted without naming one, so the
person raising it must be able to list them. Gating that list behind `INV_VIEW` left the required
field empty for exactly the role that raises the document: the picker failed soft, rendered no
options, and the document could never leave `DRAFT`.

The existing administration read SHALL keep `INV_VIEW`. This is an additional, narrower read rather
than a relaxation of the one that returns the full warehouse record.

#### Scenario: A requester lists selectable warehouses without INV_VIEW

- **WHEN** a user holding `DOC_CREATE` but not `INV_VIEW` requests the selectable warehouse read
- **THEN** the active company's active warehouses are returned and no authorization error occurs

#### Scenario: The administration read is unchanged

- **WHEN** a user without `INV_VIEW` requests the full warehouse list
- **THEN** the request is still refused

#### Scenario: Only this company's warehouses are offered

- **WHEN** a requester lists selectable warehouses
- **THEN** only the active company's warehouses appear (invariant 1), and inactive ones do not
