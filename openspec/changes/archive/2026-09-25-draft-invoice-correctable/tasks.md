## 1. Client — call the route that already exists

- [x] 1.1 Add a `VendorInvoiceInput` interface (`vendorInvoiceNo?: string | null;
      vendorInvoiceDate?: string | null`) and a `setVendorInvoice` wrapper over
      `PATCH /documents/:id/invoice` to `front-end/src/api/documents.ts`, mirroring `setSelections`.
- [x] 1.2 Extend `saveDraft` in `front-end/src/stores/documents.ts` to take an optional `invoice`
      alongside `selections` and call `documentsApi.setVendorInvoice` for it, inside the same
      try/catch so a refused invoice write turns the whole save red.
- [x] 1.3 In `CreateDocumentView.vue`, add `INVOICE_KEYS` beside `SELECTION_KEYS` and build the
      invoice payload from `headerFields` the same way — not a hand-written object, which is what put
      this value (and the payee, and the currency) in this state.
- [x] 1.4 Pass it from the edit branch of `save()`, gated on `selectionsLocked` like the selections,
      since the server applies the same `DRAFT`-only rule to both.
- [x] 1.5 Disable the `inv-no` and `inv-date` inputs on `selectionsLocked`.

## 2. Client — tests

- [x] 2.1 Component test: reopening a draft, correcting the invoice number and date, and saving sends
      both to `setVendorInvoice`.
- [x] 2.2 Component test: a save whose invoice write is refused surfaces the error and does not
      report success.
- [x] 2.3 Component test: saving a draft whose invoice fields are hidden still sends the restored
      values, so an unrelated edit does not clear a stored invoice.
- [x] 2.4 Component test: both inputs are disabled for a document that has left `DRAFT`.
- [x] 2.5 Regression test: the selections payload is unaffected — the currency and the four
      selections still travel on the same save.

## 3. Verify

- [x] 3.1 Confirm no server file is touched by this change (`git diff --stat` shows `front-end/` only).
      Confirmed: this change's four files are all under `front-end/`. The `back/` entries in the
      working tree belong to `draft-currency-correctable`, which is not yet archived.
- [x] 3.2 Run the `front-end/` unit suite.
- [x] 3.3 Re-run the probe that measured the original drop and confirm the invoice pair now appears
      in what `saveDraft` receives.
