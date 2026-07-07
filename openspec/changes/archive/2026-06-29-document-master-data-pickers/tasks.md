## 1. Wire the company-enabled master lists into the document views

- [x] 1.1 In `stores/masterData.ts` (or a thin reuse), expose the active company's enabled vendors
      (`GET /vendors/enabled`) and enabled items (`GET /items/enabled`) for consumption by the
      document views; ensure each item carries `defaultGlAccount` and each vendor carries
      `paymentTermDays`.
- [x] 1.2 Confirm `api/masterData.ts` already has the `listEnabled` reads (vendors + items); add only
      if missing. No new backend endpoints.

## 2. Create/edit draft — vendor header picker

- [x] 2.1 Add an optional vendor picker to the header of `CreateDocumentView.vue`, options sourced
      from the company-enabled vendors, with a clearable placeholder.
- [x] 2.2 Show the selected vendor's `paymentTermDays` as advisory text (e.g. "credit: 30 days").
- [x] 2.3 Carry `vendorId` in the create/edit form state and send it on save; load it back when
      reopening a draft.

## 3. Create/edit draft — per-line item picker + read-only GL

- [x] 3.1 Add an optional item picker to each line in the line-item editor, options sourced from the
      company-enabled items, clearable.
- [x] 3.2 On item selection, display that item's `defaultGlAccount` as a read-only chip/disabled
      field on the line; show an em-dash/empty when the item has no default GL or no item is chosen.
- [x] 3.3 Send the line's `itemId` on save (NOT an explicit `glAccount` — the server resolves the GL
      default); load `itemId` back when reopening a draft. Keep GL out of editable form state so
      client/server cannot drift.

## 4. Detail view — vendor + line item/GL display

- [x] 4.1 In `DocumentDetailView.vue`, show the document's vendor in the header block when present.
- [x] 4.2 Add an `Item` column and a `GL account` column to the lines table, rendering empty ("—")
      for lines without an item/GL; ensure the document read maps `itemId`/item label and
      `glAccount` onto each line.

## 5. i18n + types

- [x] 5.1 Add vendor / item / GL-account / credit-terms labels to `i18n/locales/en/documents.ts` and
      `i18n/locales/la/documents.ts`.
- [x] 5.2 Ensure the document create/detail TS types (and any Zod form schema) carry header
      `vendorId` and line `itemId`; GL account is display-only (no schema field), so client and
      server validation do not drift.

## 6. Verification

- [x] 6.1 `vue-tsc` type-check passes (no new errors).
- [ ] 6.2 Manual/e2e walk-through (run in a live stack): create a PR, pick a company-enabled vendor
      (credit terms shown), add a line, pick an item, see its GL auto-fill read-only; save; reopen the
      draft and confirm vendor + item persist; open the detail view and confirm vendor + line item +
      GL render. — code path verified; not yet click-tested against a running app/DB.
- [x] 6.3 Confirm only company-enabled vendors/items appear in the pickers (an un-enabled record is
      not offered), matching the server's submit-time guard.
