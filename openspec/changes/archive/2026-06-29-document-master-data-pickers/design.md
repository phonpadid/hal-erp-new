## Context

The master-data backend is complete and tested. The document service already accepts a header
`vendorId` and per-line `itemId`, and `writeLines` defaults a line's `gl_account` from
`item.default_gl_account` when no explicit GL is supplied. Company-scoped reads already exist:
`GET /vendors/enabled` and `GET /items/enabled` return the records enabled for the active company,
and these are already consumed by the master-data admin store (`stores/masterData.ts` merges the
enabled flag). The document create/edit form (`CreateDocumentView.vue`) renders fields dynamically
from `form_field` config and has a line-item editor (description/qty/unitPrice/budget); the detail
view (`DocumentDetailView.vue`) renders header + lines + approval log. Neither view references
vendors, items, or GL accounts today.

This slice is pure frontend integration: surface the vendor/item affordances and display the
auto-filled GL. No new endpoints, DTOs, entities, or migrations.

## Goals / Non-Goals

**Goals:**
- Let a `DOC_CREATE` user attach a company-enabled vendor to the document header and a
  company-enabled item to each line, sending `vendorId` and line `itemId` on save.
- Show the item's `default_gl_account` read-only on the line as soon as an item is chosen, so the
  auto-mapping is visible at creation time.
- Show the vendor and each line's item + GL account in the detail view.
- Offer only company-enabled vendors/items, mirroring the server's submit-time guard so the client
  never presents a record the server would reject.

**Non-Goals:**
- No editable/override GL on the line (the field is read-only; the server owns the default). A
  manual GL override is a possible future slice but is explicitly out of scope here.
- No change to vendor/item master CRUD, per-company enablement, or any backend logic.
- No vendor-on-line modelling — vendor is a header concept (matches the `document.vendor` relation);
  items are per-line.
- No new validation rules: vendor and item are optional; the existing submit-time guards stay
  authoritative.

## Decisions

1. **Source pickers from the enabled lists, not the master lists.** The vendor picker reads
   `GET /vendors/enabled` and the item picker reads `GET /items/enabled` for the active company.
   This mirrors `assertVendorEnabled` / `assertItemEnabled`, so the user cannot pick a record that
   would fail submit. Reuse the existing `masterData` store reads rather than adding API surface.

2. **GL is read-only, derived in the UI from the chosen item.** Selecting an item sets the line's
   displayed GL to that item's `default_gl_account` (a `pi`-tagged chip / disabled field). The GL is
   *not* part of the line's editable form state and is *not* sent as an explicit `glAccount` — the
   server resolves the same default in `writeLines`. This guarantees client and server cannot drift
   and keeps the "auto map หมวดบัญชี" intent literal. If an item has no `default_gl_account`, the
   chip shows an em-dash / "—".

3. **Vendor and item are optional.** Documents whose type does not concern procurement simply leave
   them empty; the picker shows a clearable placeholder. We do not gate the pickers on document
   category here (the backend guard already no-ops when there is no vendor/item), keeping the change
   configuration-light; a type-driven show/hide can come later if needed.

4. **Detail view reuses the existing line table.** Add an `Item` column (item name/code) and a
   `GL account` column to the existing lines table, and a vendor row in the header block, formatted
   consistently with the surrounding fields. The detail read already populates the line's `item`
   relation server-side; expose `itemId`/item label and `glAccount` through the existing document
   read mapping (already returned by the service line mapping).

5. **i18n + currency formatting unchanged.** GL account and item are plain strings (not money), so
   no `decimal_places` handling. Add labels to `en` and `la` documents locales.

## Risks / Trade-offs

- **Read-only GL may feel limiting** for edge cases needing a different account than the item
  default. Accepted per the chosen design (purity + no client/server drift); a future "editable
  override" slice can lift it, and the backend already honours an explicit `glAccount` if we ever
  send one.
- **Enabled-list staleness:** if an item is disabled after a draft is created with it, the picker
  won't list it but the saved draft still references it. The server's submit guard catches this and
  rejects, which is the correct authority boundary; the form should surface that rejection rather
  than silently dropping the line. Low risk — same pattern as other enable-gated affordances.
- **Detail of legacy docs:** documents created before this slice have no vendor/item; the columns
  render empty ("—"), which is correct.
