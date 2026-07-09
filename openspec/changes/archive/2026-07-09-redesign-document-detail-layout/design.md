## Context

`DocumentDetailView.vue` renders the read-only document page at `/documents/:id`. Today its
"Summary" card is a plain `<dl>` grid (`grid-cols-2 sm:grid-cols-3`) mixing headline numbers
(Total, Base total, Exchange rate) with descriptive fields (Vendor, Rate-locked-at,
Predecessor). Below it sit Fields, Line items, and (conditionally) 3-way matching; a side
column holds Approval history and Attachments.

The codebase already has `front-end/src/components/reports/StatTiles.vue` — a presentational
KPI row (`StatTile[]` = `{ label, value, icon?, tone?, hint? }`, plus `loading`) used by the
reports screens and `QuotaAdminDetailView.vue`. It renders `grid grid-cols-2 lg:grid-cols-4
gap-3` cards with a tinted icon chip, muted label, and large value, using theme tokens
(dark-mode safe). This change adopts it on the document detail page for consistency and
faster scanning.

Currency formatting already exists via `useCurrencyFormat` (`fmt(...)`, `baseCode()`) which
respects each currency's `decimal_places` and treats money as string/Decimal — the tiles must
route all monetary values through it (invariant: money is never a JS number).

Constraint: the document detail payload does **not** carry budget reserved/actual/balance
figures (those live in the budget domain). So the tiles are limited to what the document
itself exposes: total, base total, currency, exchange rate, status, line count, attachment
count.

## Goals / Non-Goals

**Goals:**
- Surface the document's headline figures as a scannable `StatTiles` row at the top of the
  detail body, reusing the existing component (no new KPI component).
- Make the page read top-down: hero header → stat tiles → content sections.
- Keep all existing data on the page; only reorganize presentation.
- Maintain i18n `en`/`la` parity and dark-mode/theme-token styling.

**Non-Goals:**
- No new API, DTO, entity, or store changes; no new network calls.
- No budget/quota figures on the document detail (not in the payload; out of scope).
- No changes to the hero header, action buttons, dialogs, or the two-column content grid
  beyond inserting the tile row and trimming the Summary card.
- No change to `StatTiles.vue` itself (use as-is; extend only if a genuine gap appears).

## Decisions

**1. Reuse `StatTiles` rather than build a new card.**
The component is battle-tested on reports/quota-admin and matches the requested "statCard"
look. Alternative (bespoke cards inline) rejected: duplicates styling and drifts from the
design system.

**2. Build tiles from a `computed<StatTile[]>` in the view.**
Mirror `QuotaAdminDetailView.vue`'s pattern: a computed that reads `docs.current`,
`docs.lines`, `docs.attachments` and pushes tiles conditionally. Foreign-currency-only tiles
(Base total, Exchange rate) are appended only when `doc.currency?.code !== baseCode()`.
Tones: Status tile tone derived from status (e.g. approved→success, rejected→danger,
draft→info) reusing the existing status-accent mapping; money tiles `primary`; counts
`info`. Icons: `pi-dollar`/`pi-money-bill` (total), `pi-flag` (status), `pi-shopping-cart`
(lines), `pi-paperclip` (attachments), `pi-percentage` (rate).

**3. Format money through `useCurrencyFormat`.**
Total → `fmt(doc.totalAmount, doc.currency?.code)`, Base total →
`fmt(doc.baseTotalAmount, baseCode())`. Guarantees `decimal_places` correctness and the
no-JS-number invariant. Status value → the localized `documents.status.*` label already used
by the header.

**4. Trim, don't duplicate, the Summary card.**
Remove from the `<dl>` the fields now shown as tiles (Total, Base total, Exchange rate);
keep Currency, Vendor, Rate-locked-at, Predecessor. If that leaves too little to justify a
card, fold the remaining descriptive fields into the same Summary card but demoted below the
tiles. Decision: keep the Summary card for the descriptive remainder so the predecessor link
and rate-locked timestamp stay discoverable.

**5. Placement.**
Insert the tile row full-width immediately after the hero header and before the
`grid xl:grid-cols-3` content block, so it spans the page and isn't confined to one column.

## Risks / Trade-offs

- **[Redundancy between tiles and Summary card]** → Remove the migrated fields from the `<dl>`
  so each figure appears once; verify visually in both light/dark and both locales.
- **[Status tone/label mapping drift]** → Reuse the existing `statusAccent`/`documents.status.*`
  mappings already in the view rather than inventing a second source of truth.
- **[`StatTiles` fixed 4-col grid may look sparse with 4 tiles / crowded with 6]** → The
  component is responsive (`grid-cols-2 lg:grid-cols-4`); 4 or 6 tiles both wrap cleanly.
  Accept default; only revisit if design review flags it.
- **[i18n parity break]** → New `documents.detail.*` keys (e.g. `lineCount`, `attachmentCount`)
  added to both `en` and `la`; `i18n.parity.spec.ts` will catch omissions.
- **Rollback**: single-view, presentation-only diff — revert `DocumentDetailView.vue` (and the
  added i18n keys) to restore the prior `<dl>` layout. No data or migration risk.

## Open Questions

- Should the Status tile be clickable / show SLA state, or stay a plain figure? Default:
  plain figure (SLA already shown in the Approval history card). Revisit if requested.
