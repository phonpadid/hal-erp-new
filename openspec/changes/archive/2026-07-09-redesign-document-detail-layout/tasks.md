## 1. Stat tiles data

- [x] 1.1 In `front-end/src/views/documents/DocumentDetailView.vue`, add a `computed<StatTile[]>` (import the `StatTile` type from `@/components/reports/StatTiles.vue`) that reads `docs.current`, `docs.lines`, `docs.attachments`.
- [x] 1.2 Add always-present tiles: Total (`fmt(doc.totalAmount, doc.currency?.code)`, icon `pi-dollar`/`pi-money-bill`, tone `primary`), Status (localized `documents.status.*` label + tone from the existing status mapping), Line items (`docs.lines.length`, icon `pi-shopping-cart`, tone `info`), Attachments (`docs.attachments.length`, icon `pi-paperclip`, tone `info`).
- [x] 1.3 Conditionally append the Base total tile (`fmt(doc.baseTotalAmount, baseCode())`) and Exchange rate tile (`doc.exchangeRate`, icon `pi-percentage`) only when `doc.currency?.code !== baseCode()`.
- [x] 1.4 Route every monetary tile value through `useCurrencyFormat` (`fmt`) so amounts respect `decimal_places` and no money is a JS number.

## 2. Layout & rendering

- [x] 2.1 Import and render `StatTiles` full-width immediately after the hero header and before the `grid xl:grid-cols-3` content block, binding the computed tiles.
- [x] 2.2 Trim the "Summary" `<dl>` card: remove Total, Base total, and Exchange rate (now shown as tiles); keep Currency, Vendor, Rate-locked-at, and Predecessor.
- [x] 2.3 Verify the two-column content grid, hero header, action buttons, and dialogs are unchanged.

## 3. i18n

- [x] 3.1 Add any new `documents.detail.*` label keys needed by the tiles (reused `total`/`baseTotal`/`exchangeRate`/`lineItems`/`attachments`; added `status`) to `front-end/src/i18n/locales/en/documents.ts`.
- [x] 3.2 Add the same keys to `front-end/src/i18n/locales/la/documents.ts` (Lao) to keep parity.
- [x] 3.3 Run the i18n parity test (`i18n.parity.spec.ts`) and confirm it passes.

## 5. Declutter (remove duplicated figures)

- [x] 5.1 Remove the Status tile — status stays only on the hero header badge.
- [x] 5.2 Remove the big Total headline from the hero header — the total lives only in the tile row.
- [x] 5.3 Remove the "Summary" card entirely; relocate its non-duplicated fields (vendor, predecessor) to the hero header meta line.
- [x] 5.4 Fall back the Total tile to the summed line-item total when the header total is unset (no empty dash).
- [x] 5.5 Remove the now-unused `documents.detail.status` key from both locales; re-run parity.

## 6. Reduce table/field noise

- [x] 6.1 Hide line-item columns (item, GL account, description) that are empty across every row so the table isn't a wall of "—".
- [x] 6.2 Hide the base-amount column unless the document is foreign-currency and has base amounts; hide the received/line-status columns unless any line has receipts.
- [x] 6.3 In the Fields card, show only fields that were actually filled in (drop empty "—" fields); hide the card when none are filled.

## 7. "Stamped ticket" visual language (ref: reference/ui/claim-detail-redesign.html)

- [x] 7.1 Add a breadcrumb (Documents / document type / document number) above the header.
- [x] 7.2 Rebuild the hero as a ticket: status-colored left stripe, uppercase document-type label, large document number, a status badge (pulsing dot while SUBMITTED/IN_APPROVAL), the meta line, and the actions as a bordered column on wide screens / wrapping row otherwise. Drop the `DetailHeader` wrapper here.
- [x] 7.3 Tune the stat-tile tones/icons (total → success/wallet, line items → info/list, attachments → warn/paperclip).
- [x] 7.4 Render approval history as a stepper: filled done nodes with connectors and a pulsing active node, built from the approval log + current pending step; empty state when none. Drop `EventTimeline` here.
- [x] 7.5 Show the attachment count in the Attachments card header.

## 4. Verify

- [x] 4.1 Run `npx vue-tsc --noEmit` and confirm no type errors.
- [ ] 4.2 Open a base-currency document and a foreign-currency document; confirm the correct tiles show (foreign shows Base total + Exchange rate; base-currency omits them) with correctly formatted amounts and accurate line/attachment counts.
- [ ] 4.3 Check the page in both light and dark themes and in both `en` and `la` locales for correct tones, labels, and no duplicated figures between the tiles and the Summary card.
