## Why

The Document Detail page (`/documents/:id`) works but reads as a flat stack of equal-weight
`SectionCard` panels: the header buttons crowd together with no visual grouping, the summary is a
bare two-column key/value grid, monetary totals do not stand out, and the line-item and matching
tables run edge-to-edge with little scannability. For a page that is the record of truth for an
approval — where an approver decides to approve/reject and a requester tracks status — the layout
should make the document's identity, money, status, and next action obvious at a glance.

## What Changes

- **Header becomes a clear summary bar.** Group the status, key identity (doc type, requester,
  submit/lock date), and the headline amount into a prominent, scannable header region; separate
  primary approval actions (Approve / Reject / Return) from secondary actions (Edit, Submit,
  Cancel, Create successor, Receive) so the decision buttons don't compete with utilities.
- **Summary section is restructured for readability.** Present the currency, locked rate, totals,
  base total, vendor, and predecessor as labelled definition pairs with the grand total visually
  emphasized; keep amounts formatted by the currency's `decimal_places`.
- **Line-item and matching tables are made scannable.** Right-align numeric columns (qty, unit
  price, line/base amounts), add a totals row for line amounts, tidy column spacing, and give the
  receive-status / matching-result tags consistent placement. Provide an explicit empty state when
  a document has no lines.
- **Approval timeline and attachments get clearer affordances.** Emphasize the SLA/overdue state,
  and keep an explicit empty state for "no approval actions yet".
- **Responsive & theme pass.** Sections reflow on narrow screens (header stacks, tables scroll),
  and only PrimeUI theme tokens are used so light and dark both render correctly.
- No backend, API, DTO, or schema changes — this is a presentation-layer change only. Money remains
  a string formatted by `decimal_places`; the server stays authoritative for all rules, and every
  affordance stays gated by the same permission codes and document status as today.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-documents`: the "Document List and Detail" requirement gains spec-level behavior for the
  restructured detail header (grouped identity/money/status, primary-vs-secondary actions), the
  emphasized summary and line/matching totals, empty states, and responsive/token-based rendering.

## Impact

- **Code (frontend only):** `front-end/src/views/documents/DocumentDetailView.vue` (header,
  summary, line/matching tables, timeline layout) and the shared detail components it uses
  (`DetailHeader.vue`, `SectionCard.vue`) if the grouping is extended; new/updated i18n strings in
  `front-end/src/i18n/locales/{en,la}/documents.ts`.
- **No change** to backend services, REST endpoints, DTOs, the shared Zod/DTO schemas, the
  database, or the `document` / `document_type` data model.
- **Invariants:** none affected. Company isolation, append-only ledgers, locked FX, reserve→actual
  →release, and permission-code gating are all untouched; amounts continue to be carried as strings
  and formatted by the currency's `decimal_places`. Client rendering stays UX-only with the server
  authoritative.
