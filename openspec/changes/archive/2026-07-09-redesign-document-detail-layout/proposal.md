## Why

The document detail page (`/documents/:id`) presents its key figures — total, base total,
currency, exchange rate, status, line/attachment counts — as a dense `<dl>` label/value
grid buried inside the "Summary" card. Users scanning a document have to read prose-style
pairs to find the numbers that matter. The app already ships a polished, reusable KPI
component (`StatTiles`) used across the reports and quota-admin screens, but the document
detail never adopted it, so this high-traffic page looks inconsistent and is slower to scan.

## What Changes

- Add a **stat-tile row** at the top of the document detail body (below the hero header)
  that surfaces the at-a-glance figures — Total, Base total, Status, Line items, Attachments,
  and (when relevant) Exchange rate — using the existing `StatTiles` component, with
  tones/icons consistent with the rest of the app.
- **Reorganize the detail layout** so the page reads top-down: hero header → stat tiles →
  content sections. The "Summary" card is slimmed to the remaining descriptive fields
  (vendor, rate-locked date, predecessor) that don't belong in a KPI tile, or removed if
  fully subsumed by the tiles.
- Keep the existing two-column responsive grid (main content + side column for approval
  history and attachments); no behavioral or data-fetching changes.
- Add the small number of new `documents.detail.*` i18n keys the tiles need, in both `en`
  and `la` (parity is test-enforced).

This is a **presentation-only** change to the Vue web layer. No API, DTO, entity, or
server behavior changes; the server remains authoritative.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-documents`: the "Document List and Detail" requirement's presentation of the detail
  view changes — the key document figures SHALL be presented as a scannable stat-tile row
  (reusing the shared KPI component) in addition to the existing field/line/attachment
  detail. The data shown is unchanged; only how the headline figures are laid out changes.

## Impact

- **Code (frontend only):**
  - `front-end/src/views/documents/DocumentDetailView.vue` — add a `computed<StatTile[]>`
    and render `StatTiles`; trim the `<dl>` Summary panel.
  - Reuses `front-end/src/components/reports/StatTiles.vue` (no change) and existing store
    state in `front-end/src/stores/documents.ts` / `api/documents.ts` (no change).
  - `front-end/src/i18n/locales/en/documents.ts` and `.../la/documents.ts` — new
    `documents.detail.*` label keys (parity enforced by `i18n.parity.spec.ts`).
- **No impact** on backend, database, budget/quota ledgers, or any core invariant — the
  page is read-only and does not touch company scope, budget math, numbering, or FX.
- **Build order:** sits in the web layer of the `document-engine` capability; depends only
  on already-built document detail data.
