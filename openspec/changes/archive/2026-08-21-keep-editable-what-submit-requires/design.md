## Context

Four columns on `document` are written once, by `POST /documents`, and never again:
`warehouse_id`, `dest_warehouse_id`, `related_employee_id`, `vendor_id`. The route table carries
`PUT /documents/:id/fields`, `PUT /documents/:id/lines`, `PATCH /documents/:id/payee` and
`PATCH /documents/:id/invoice` — nothing that touches these four.

The web client mirrors that shape rather than working around it. `documents.saveDraft(id, fields,
lines)` calls only the two `PUT`s, and `CreateDocumentView` binds every one of these pickers
`:disabled="isEdit"`. The disabled state is currently load-bearing: enabling the picker without a
route behind it would let the user choose a warehouse, satisfy the step gate, save, and lose the
value silently — worse than the dead end it replaces.

Meanwhile the type-step gate requires exactly these values when the type asks for them, and submit
refuses a document that lacks one. A draft that has none is therefore blank, greyed out, required
and unanswerable at the same time. `ISSUE-HAL-2026-0001` in the UI-test database is in that state
today. Any draft can enter it later without its author doing anything, because
`DocumentTypeService.update` assigns `requiresWarehouse` and `requiresEmployee` freely and the
flags are read at submit, not frozen at creation.

`setPayee` already solves this exact problem for the fifth selection, with the DRAFT-only rule and
an immediate validity check. This change follows it.

## Goals / Non-Goals

**Goals:**

- One DRAFT-only write surface for the four type-driven selections, so no draft can be stranded by a
  value it is required to have and has no way to supply.
- Refuse a correction that reaches outside the active company or picks a record creation could not
  have picked, at the moment the pick is made.
- Keep the vendor and its payee consistent, so a vendor change cannot leave behind a payee the
  submit gate will reject.
- Make the wizard's pickers usable on a draft and actually persist what they collect.

**Non-Goals:**

- Relaxing any submit gate. Submit keeps refusing a document that names none of what its type asks
  for; this only gives the requester a way to answer.
- Editing anything after `DRAFT`. Returning a document to `DRAFT` remains the only route to a
  change, and re-approval remains required — the rule `The Approved Payee Is Immutable` already
  states for the payee.
- Adding validation to `POST /documents`. Creation's store-as-given behaviour is unchanged here;
  see the decision below.
- Any schema change. All four columns exist on `document` in `erp_approval_system.dbml`.

## Decisions

**One route for the four, not four routes.** `PATCH /documents/:id/selections` taking an optional
`warehouseId`, `destWarehouseId`, `relatedEmployeeId` and `vendorId`, each nullable. They are chosen
together on one wizard step and saved by one press, and a transfer's two warehouses have to be
validated as a pair (they must differ) — splitting them would make that check span two requests with
a window in between where the document names the same warehouse twice. *Alternative considered:*
mirroring `payee`/`invoice` with a route each. Rejected for the pairing, and because four routes
would each repeat the same DRAFT-and-company preamble.

Absent keys mean "leave alone"; an explicitly null value means "clear". `setPayee` already treats
null as a clear, and clearing must stay possible — a type that loses `requires_warehouse` should not
force a warehouse to stay on documents that no longer want one.

**Validate at the PATCH, not only at submit.** Each supplied id is resolved against the active
company before it is assigned: warehouses through `WarehouseService.requireActive`, which already
refuses another company's warehouse and an inactive one and is what submit uses; the employee
through the same company-scoped `Employee` lookup submit performs; the vendor through the
company-enabled vendor read the create wizard's picker is populated from. *Alternative considered:*
storing as given, the way `create` does for these same four columns, and leaving everything to
submit. Rejected: the entire point of the route is to unstick a draft, and a correction that stores
an unusable id just relocates the dead end. Company isolation (invariant 1) also should not depend
on a gate that runs later — a cross-company id must not be persisted at all, even briefly. This
makes correction stricter than creation, which is a deliberate asymmetry and the same one
`setPayee` already has against `create`.

**Vendor change clears an orphaned payee, in the same unit of work.** `vendor_bank_account_id` must
belong to `document.vendor` at submit. Rather than refusing a vendor change while a payee is set —
which would force the requester to clear the payee first, in a specific order, for a reason the
screen does not explain — the service clears a payee whose `vendor` is not the new one and leaves it
alone when it still matches. Both writes flush together, so a document is never observable with a
vendor and a payee that disagree.

**The client sends the selections from `saveDraft`.** `saveDraft` gains the call alongside its two
existing `PUT`s rather than the view calling the API directly, so "save the draft" stays one thing
the view asks for. The order is selections first, then fields, then lines: the selections are what
the later gates read, and a failure to apply them should stop the save before it half-writes.

**The pickers unlock on `DRAFT`, not on emptiness.** `:disabled="isEdit"` becomes a check on the
document's status. Unlocking only an empty picker — the narrower change — would leave a draft that
named the wrong warehouse just as stuck as one that named none, and the wrong warehouse is the more
likely mistake now that the field can be filled in a second sitting.

**Ledger and locking.** This flow writes no `budget_txn` and no `quota_usage` row, and takes no
lock. It is refused outside `DRAFT`, and `DRAFT` is before submit, which is where budget is reserved
under `LockMode.PESSIMISTIC_WRITE`; so there is no reservation in existence for a corrected document
and nothing for a concurrent writer to race against. The service does its reads and its assignment
inside the request's own `em`, flushing once, in the manner of `setPayee` and `setVendorInvoice`.
Invariants 2, 3 and 4 are untouched. The one ordering fact worth stating: because the correction can
only land while the document is `DRAFT`, a document's reserved amount can never disagree with the
selections that were approved.

## Risks / Trade-offs

- **A draft can now change what it is about after being written** → It could always change its field
  values and its lines, which is more of what a document is about than its warehouse is. The
  DRAFT-only boundary is unchanged, and it is the boundary the approval chain actually depends on.

- **Correction validates where creation does not, so an id that `POST /documents` accepts can be
  refused by the PATCH** → Deliberate, and stated in the spec. The failure is loud and immediate at
  the moment of the pick, which is strictly better than the same id failing at submit; and the
  wizard's pickers only ever offer records that pass these checks, so a user meets this only by
  calling the API directly.

- **Clearing an orphaned payee silently loses a value the user chose** → The alternative is a submit
  that fails later for a reason the requester did not cause. The wizard reloads the payee list from
  the new vendor when the vendor changes, so the cleared field is visibly empty and asking to be
  filled, not quietly wrong.

- **A returned-to-`DRAFT` document can have its warehouse changed and be resubmitted** → Intended,
  and identical to what the payee rule already allows: the whole chain approves again. Nothing
  reaches an approved document.

## Migration Plan

Additive. A new route, a new DTO, a new service method, and client wiring — no migration, no schema
change, no change to any existing endpoint's request or response. Deploying the backend first leaves
the client exactly as it is today; deploying the client first would call a route that 404s, so the
backend goes first. Rollback is removing the route: the client's `saveDraft` must tolerate the call
failing without losing the field and line writes it also performs, which is worth a test in its own
right.

`ISSUE-HAL-2026-0001` and any other already-stranded draft need no data fix — they become editable
the moment the route exists.

## Open Questions

- Should the wizard warn when a vendor change is about to clear a payee, rather than clearing it and
  showing the empty field? Left out of scope here; the empty required field is already visible and
  the submit gate already names it.
