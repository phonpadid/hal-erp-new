## Why

The supplier tax invoice cannot be corrected on a reopened draft. The server route for it exists and
is complete — `PATCH /documents/:id/invoice`, `DRAFT`-gated, with `SetVendorInvoiceDto` — but the web
app has no client wrapper for it and `saveDraft` never calls it. The wizard still renders
`vendorInvoiceNo` and `vendorInvoiceDate` on the lines step, marks both required with a red asterisk,
validates them client-side, and reports a successful save. The typed value is discarded between the
field and the request.

Submit then refuses the document: `document-submit.service.ts` requires both when the type
`accrues_on_approval` and `tax_total > 0` — *"A supplier invoice number is required for a document
claiming input VAT"*. The screen that shows that refusal contains an editable, required field that
does nothing, so the requester cannot answer it. This is the third instance of one shape: the payee
(RECBL-HAL-2026-0001) and the currency (REC-HAL-2026-0026) were the first two.

Measured, not inferred — the four arguments `saveDraft` actually receives when a reopened draft's
invoice fields are edited:

```
["d-1", [], [], {"currency":…,"vendorId":…,"vendorBankAccountId":…,
                 "warehouseId":…,"destWarehouseId":…,"relatedEmployeeId":…}]
```

Neither `vendorInvoiceNo` nor `vendorInvoiceDate` appears anywhere in it.

## What Changes

- The web app SHALL send `vendorInvoiceNo` and `vendorInvoiceDate` on a draft save, through the
  existing `PATCH /documents/:id/invoice` route, so a correction made on a reopened draft is kept.
- The values SHALL be derived from the wizard's `headerFields` list rather than restated, the way the
  selections payload now is, so the pair cannot drift out of the edit path again.
- The fields SHALL stop being offered once the document has left `DRAFT`, where the server refuses
  the change, matching the selection pickers beside them.
- **No server change.** The route, its DTO, its `DRAFT` gate and its company scope already exist and
  are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-documents`: *Create and Edit a Draft* states that the supplier invoice persists on save in the
  edit path, and is not offered once the document has left `DRAFT`.

## Impact

Touches **web-documents** only. **document-engine** is unchanged — this change exists because the
server side was already right.

- `front-end/src/api/documents.ts` — a `setVendorInvoice` wrapper over the existing route.
- `front-end/src/stores/documents.ts` — `saveDraft` carries the invoice alongside the selections.
- `front-end/src/views/documents/CreateDocumentView.vue` — derives the payload from `headerFields`;
  the two inputs follow `selectionsLocked`.

No migration, no DTO change, no new endpoint.

**Invariant 6 (locked FX)** is untouched: the invoice is not money and carries no rate.
**Invariant 1 (company isolation)** holds: the existing route is already company-scoped.

One deliberate exclusion: `moneyMovedOn` is dropped on the same path for the same reason, but fixing
it needs a server change (no route accepts it at all) and a `DOC_BACKDATE` guard, so it is proposed
separately as `draft-money-moved-on-correctable`.
