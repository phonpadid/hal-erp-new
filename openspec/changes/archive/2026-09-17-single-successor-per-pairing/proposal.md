## Why

A `PR → PO → DISB` chain reserves budget once (at the `PR`) and settles it once (at the first
`DISB` approval, which converts ACTUAL and releases the whole remainder). Nothing stops a second
`PO` from being created from the same `PR`, or a second `DISB` from the same `PO`: `assertPredecessor`
checks only that the predecessor is approved and the pairing is configured. The second chain looks
fine until its `DISB` is approved, where `settle()` finds an outstanding reserve of 0 and refuses —
an approval that fails at the last step, after every approver has signed. Production hit the
neighbouring case this week (a `PO` auto-created at 0 from an unpriced `PR`, then priced at the
`DISB`); the fix for that case is to cancel the bad `PO` and raise a new one, which this change
must keep possible.

## What Changes

- A predecessor SHALL have **at most one live successor per pairing**: for a given
  `ref_document_id` and successor `document_type_id`, at most one `document` whose `status` is
  not `REJECTED` or `CANCELLED`. Creating a second one — by manual create-from or by the
  `CREATE_SUCCESSOR` outbox — is refused with a validation error naming the existing successor.
- A rejected or cancelled successor does not count, so a `PR` whose `PO` was cancelled can get a
  new `PO`.
- The rule is enforced at the database as a partial unique index so two concurrent create-froms
  cannot both succeed; the service turns the violation into a 409.
- The successor outbox treats "a live successor of this type already exists" as the obligation
  being **met** (row → `DONE`), not as a failure to retry: somebody created the `PO` by hand before
  the sweep ran, and the world has the one `PO` it should.
- The document detail reports the document's live successors (`id`, `docNo`, type code, status)
  so the web app can hide the create-successor action for a pairing that is already taken and link
  to the existing successor instead.
- The web document detail hides "Create successor" for a taken pairing and shows the existing
  successor; the server error is surfaced when the race is lost anyway.

Not in scope: partial `PO`s (splitting a `PR`'s quantity across several `PO`s) or partial
invoicing of a `PO`. Those need remaining-quantity tracking and a settlement that releases only
when the chain closes; until then 1:1 is the only shape the ledger honours, and this change makes
the engine say so up front instead of at the last approval.

## Capabilities

Touches `document-engine` (reference chain), `successor-outbox`, and `web-documents`.
Invariants: strengthens invariant 4 (reserve → actual → release) by refusing the chain shape that
strands a settlement; invariant 1 unaffected (the uniqueness is per `ref_document_id`, which is
already company-scoped); invariant 7 respected — the rule is expressed on the pairing table's
semantics, not per document-type code.

### New Capabilities

(none)

### Modified Capabilities

- `document-engine`: **Document Reference Chain** gains the one-live-successor-per-pairing
  requirement (service check + partial unique index, rejected/cancelled excluded, concurrency
  behaviour) and the detail exposes live successors.
- `successor-outbox`: fulfilment treats an already-existing live successor of the owed type as
  the obligation met (`DONE`), not a failed attempt.
- `web-documents`: the create-successor affordance is hidden for a pairing already taken and the
  existing successor is linked.

## Impact

- **Migration**: partial unique index `document_live_successor_uq` on
  `document (ref_document_id, document_type_id) WHERE ref_document_id IS NOT NULL AND status NOT IN
  ('REJECTED','CANCELLED')`. **Pre-check**: the migration must fail loudly if existing rows already
  violate it (two live `PO`s from one `PR`) — production data must be inspected before deploy.
- **DBML**: index note on `document`.
- **Backend**: `document.service.ts` (`assertPredecessor`, `createDraft` flush error mapping,
  `detail`), `successor-sweeper.service.ts` (`fulfil`), specs.
- **Frontend**: `DocumentDetailView.vue` create-successor gate, `api/documents.ts` detail type,
  i18n (en/la/zh).
- **API**: `GET /documents/:id` gains `successors[]`; `POST /documents/from/:refId` (create-from)
  can now return 400 (already has a live successor) and 409 (lost the race).
