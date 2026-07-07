## 1. Header grouping and action priority

- [x] 1.1 In `DocumentDetailView.vue`, extend the `DetailHeader` usage with a meta line (document
      type + created / submit-lock dates; requester omitted — the detail endpoint does not expose it)
      and surface the headline total next to the status, formatted by the document currency's
      `decimal_places`
- [x] 1.2 Split the header `#actions` slot into a primary group (Approve / Reject / Return, shown when
      `canAct`) visually separated from secondary utilities (Edit, Submit, Cancel, Create successor,
      Receive); keep every existing `v-if` permission/status guard unchanged
- [x] 1.3 If needed for the grouping, extend `DetailHeader.vue`/`SectionCard.vue` in a
      backward-compatible way (new optional slots/props only)

## 2. Summary emphasis

- [x] 2.1 Restructure the Summary `SectionCard` into labelled definition pairs, giving the grand total
      and base total greater visual weight than the secondary facts (currency, locked rate, lock date,
      vendor, predecessor)
- [x] 2.2 Keep the predecessor as a link that navigates to the source document's detail view; keep all
      amounts formatted via `fmt`/`fmtBase` by `decimal_places`

## 3. Table scannability and totals

- [x] 3.1 Right-align the numeric columns (qty, unit price, line amount, base line amount) in the
      line-items `DataTable` and add a display-only totals row summing line and base-line amounts
- [x] 3.2 Apply the same numeric alignment to the 3-way matching table and keep its per-line result tag
- [x] 3.3 Show an `EmptyState` in the line-items section when the document has no lines
- [x] 3.4 Confirm the summary headline figure still uses the server `doc.totalAmount` /
      `doc.baseTotalAmount`, not the client-summed total

## 4. Timeline, attachments, and responsive/theme pass

- [x] 4.1 Emphasize the SLA/overdue state and keep the existing "no approval actions" empty message on
      the timeline
- [x] 4.2 Ensure the header stacks and its actions wrap on narrow screens, and wide tables scroll within
      their own container without page overflow
- [x] 4.3 Verify all sections use only PrimeUI theme tokens (no hardcoded colors) and render correctly
      in light and dark mode

## 5. Localization and verification

- [x] 5.1 Add every new user-facing string to both `front-end/src/i18n/locales/en/documents.ts` and
      `.../la/documents.ts` with no missing-key fallback
- [x] 5.2 Manually verify the detail page for a money document (with lines, vendor, predecessor,
      matching, and approval history) in both languages, both themes, and at a mobile width
- [x] 5.3 Run the frontend lint/type-check and any existing document view smoke tests
