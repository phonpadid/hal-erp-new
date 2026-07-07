## Why

Feature 9 (central Master Data) is fully built on the backend: the group Vendor and Item
registries, per-company enablement with credit terms (`payment_term_days`), the submit-time
`assertVendorEnabled` / `assertItemEnabled` guards, and the auto-GL line logic
(`document.service.writeLines` defaults a line's `gl_account` from the item's
`default_gl_account`) all exist and are tested. The master-data admin screens expose vendors and
items with their credit terms, GL accounts, and per-company enable toggles.

The gap is the **document UI**. The create form never lets the user choose a vendor for the header
or pick an item on a line, and the detail view never shows which item or GL account a line used.
As a result the headline behaviour of this feature — "pick an item on a PR and have its accounting
category map automatically" — works in the service but is unreachable and invisible end-to-end:
the backend accepts `vendorId` and line `itemId`, yet there is no affordance to send them, and the
auto-filled GL is never displayed back. The data model and business rules are solid; the
user-facing integration is missing.

## What Changes

- **Create/edit draft form** gains an optional **vendor picker** in the header, sourced from the
  vendors *enabled for the active company* (`GET /vendors/enabled`), with the vendor's payment-term
  days shown as advisory context. The chosen `vendorId` is sent on save.
- **Line-item editor** gains an optional **item picker** per line, sourced from the items *enabled
  for the active company* (`GET /items/enabled`). Selecting an item displays its
  `default_gl_account` as a **read-only** GL chip on that line (auto-filled, not editable); the
  line's `itemId` is sent on save and the server remains authoritative for the GL default.
- **Document detail view** shows the **vendor** in the header and an **Item** and **GL account**
  column on each line, formatted alongside the existing line fields, so a reviewer can see which
  item and accounting category each line used.
- Only company-enabled vendors/items are offered, mirroring the server's submit-time guard, so the
  client cannot present a master record the server would reject.
- No backend or data-model change: this slice consumes existing endpoints, DTO fields, and the
  existing auto-GL behaviour. The GL field is presentation-only (read-only), so client and server
  validation cannot drift.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-documents`: the create/edit-draft form SHALL offer a company-enabled vendor picker and a
  per-line company-enabled item picker that displays the item's default GL account read-only; the
  detail view SHALL show the vendor and each line's item and GL account.

## Impact

- Frontend only:
  - `front-end/src/views/documents/CreateDocumentView.vue` — vendor picker (header) + item picker
    and read-only GL chip (lines).
  - `front-end/src/views/documents/DocumentDetailView.vue` — vendor in header; Item + GL columns on
    lines.
  - `front-end/src/api/masterData.ts` / `front-end/src/stores/masterData.ts` — expose the
    company-enabled vendor/item lists to the document views (reuse existing `listEnabled` reads).
  - `front-end/src/i18n/locales/{en,la}/documents.ts` — labels for vendor, item, GL account.
  - Document create/detail Zod/types: ensure `vendorId` (header) and line `itemId` are carried; GL
    is read-only display only.
- Consumes existing backend endpoints (`/vendors/enabled`, `/items/enabled`) and the existing
  `vendorId` / line `itemId` save path — no server, DTO, or migration change.
