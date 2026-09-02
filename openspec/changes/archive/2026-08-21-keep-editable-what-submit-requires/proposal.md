## Why

A draft that is missing one of the selections its own type requires cannot be finished and cannot be
fixed. Those four selections — warehouse, destination warehouse, related employee, vendor — are
written only by `POST /documents`; no route changes them afterwards, so the edit wizard disables
their pickers, while the type-step gate refuses to advance without them. The draft is then
permanently uneditable: blank, greyed out, required, and unanswerable. `ISSUE-HAL-2026-0001` in the
UI-test database is one, and any draft becomes one the moment an administrator turns
`requires_warehouse` or `requires_employee` on for a type that already has drafts — a supported
edit, since `document_type.update` accepts those flags freely.

The payee already has exactly the rule this needs — mutable while `DRAFT`, refused once the document
has left it — and its own `PATCH /documents/:id/payee` to carry it. The other four selections were
simply never given one.

## What Changes

- A new DRAFT-only write surface for the selections a document type asks for: `warehouse_id`,
  `dest_warehouse_id`, `related_employee_id` and `vendor_id`. Modelled on the existing
  `PATCH /documents/:id/payee` and `PATCH /documents/:id/invoice`, including their DRAFT-only rule.
- Each referenced record MUST belong to the document's own company and MUST be one the requester
  could have chosen at create time (an active, company-enabled warehouse / employee / vendor), so
  the correction cannot reach further than creation could.
- Changing the vendor SHALL clear a `vendor_bank_account_id` that no longer belongs to it, rather
  than leaving a payee pointing at another vendor's account for the submit gate to reject later.
- The edit wizard SHALL keep each of these pickers usable while the document is a draft instead of
  disabling it outright, and SHALL persist the choice on save — today the disabled state is load-
  bearing precisely because saving would silently discard the value.
- The change is a correction surface only. Nothing here relaxes what submit requires, and nothing
  becomes editable after a document leaves `DRAFT`.

## Capabilities

### New Capabilities

None. This closes a gap in two existing capabilities rather than introducing a new one.

### Modified Capabilities

- `document-engine`: a new requirement that the type-driven selections are mutable while the
  document is `DRAFT` and refused once it is not — generalising the rule
  `The Approved Payee Is Immutable` already states for the payee alone. Company scope and the
  active/enabled checks that apply at creation apply to the correction.
- `web-documents`: `Create and Edit a Draft` currently promises only that "current field values and
  lines load into the editor and can be changed and saved". The type-level selections are neither
  field values nor lines, and are the ones that can strand a draft; the requirement gains the
  statement that a draft's pickers stay usable and their choices persist.

## Impact

- **Backend** `back/src/modules/document/`: `document.controller.ts` (one new `PATCH` route behind
  `DOC_CREATE`), a new DTO alongside `SetPayeeDto`/`SetVendorInvoiceDto`, and a service method next
  to `setPayee`. No schema change — all four columns exist on `document`. Two of them, `warehouse_id` and
  `dest_warehouse_id`, were shipped in the entity and the migrations without ever being written
  into `erp_approval_system.dbml`; this change records them there so the canonical model states
  what the database already holds.
- **Frontend** `front-end/src/`: `api/documents.ts` (the new call), `stores/documents.ts`
  (`saveDraft` carries the selections, which it does not today), and
  `views/documents/CreateDocumentView.vue` (the `:disabled="isEdit"` bindings on the warehouse,
  destination-warehouse, employee and vendor pickers).
- **Invariants**: company isolation (invariant 1) is the load-bearing check on every referenced id —
  a corrected selection must not reach another company's warehouse, employee or vendor. Permission
  codes, not role names (invariant 5): the route is gated on `DOC_CREATE`, as the payee route is.
  Nothing touches budget or quota: the correction is refused after `DRAFT`, which is before anything
  is reserved, so no ledger row can be affected and invariants 2, 3 and 4 are untouched.
- **Existing behaviour**: unchanged for documents that already carry their selections. The submit
  gates keep refusing a document that names none.
