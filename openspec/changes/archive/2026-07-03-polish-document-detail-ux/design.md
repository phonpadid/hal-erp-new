## Context

`DocumentDetailView.vue` renders `/documents/:id`: a `DetailHeader` (title + status + actions
slot) followed by a vertical stack of equal-weight `SectionCard` panels — Summary, Fields, Line
items, 3-way Matching, Attachments, Approval history — plus two dialogs (act / create-from) and the
receive dialog. All data comes from the existing `useDocumentsStore` (`current`, `lines`,
`fieldValues`, `attachments`, `approvalLog`, `matching`, `sla`, `refDocument`) and
`useCurrencyFormat` (`fmt`, `fmtBase`, `baseCode`); actions are gated by `auth.can(...)` +
`canActOn(...)` computed on document status. This change re-lays-out that same data and adds no new
data source, API call, or store field.

The shared kit is `DetailHeader.vue` (flex header, title + status Tag + `#actions` slot),
`SectionCard.vue` (PrimeVue `Panel` with `#header`/`#icons`/default slots), `EventTimeline.vue`,
`EmptyState.vue`, and PrimeVue `DataTable`/`Column`/`Tag`. Styling is Tailwind + tailwindcss-primeui
theme tokens (`text-color`, `text-muted-color`, `surface-*`) with PrimeIcons.

## Goals / Non-Goals

**Goals:**
- Make the document's identity, status, headline money, and next action obvious at a glance.
- Group header actions into primary (approval decision) vs secondary (utility) clusters.
- Make the summary and the line/matching tables scannable: emphasized total, right-aligned numerics,
  a line-amount totals row, consistent tag placement, and explicit empty states.
- Reflow cleanly on narrow screens and render correctly in light and dark from theme tokens only.

**Non-Goals:**
- No backend, API, DTO, store, or data-model change; no new endpoint or field.
- No change to which affordances appear or their permission/status gating — only their grouping and
  presentation.
- No change to money handling: amounts stay strings formatted by the currency's `decimal_places`.
- Not a redesign of the create/edit wizard (covered by prior create-UX changes) or of the shared
  layout shell.

## Decisions

**1. Reshape the header instead of adding a new component.** Extend the existing `DetailHeader`
usage: keep title + status Tag, add a subtitle/meta line (doc type, requester, submit/lock date) and
surface the headline total near the status. Split the `#actions` slot into a primary group (Approve
/ Reject / Return, shown when `canAct`) visually separated from secondary utilities (Edit, Submit,
Cancel, Create successor, Receive). *Alternative considered:* a bespoke summary-bar component —
rejected as more surface area than the visual win needs; `DetailHeader` already mirrors `PageHeader`
and is reused across detail pages, so any grouping added there benefits them consistently.

**2. Summary as emphasized definition pairs.** Replace the flat `grid grid-cols-2` key/value block
with labelled definition pairs where the grand total (and base total) are given larger/greater
weight via type scale and token colors, and secondary facts (currency, locked rate, lock date,
vendor, predecessor link) sit below. Keep the predecessor as a `link` Button navigating to the
source document (unchanged behavior).

**3. Table scannability via column alignment + a totals row.** For the line-items table, right-align
qty / unit price / line amount / base line amount, keep the receive-status and matching-result
`Tag`s, and add a footer/summary row showing the summed line amount and base line amount (computed
in the client from `docs.lines`, purely for display — the server total in `doc.totalAmount` remains
the authoritative figure shown in the summary). Same alignment pass for the matching table.

**4. Empty and edge states are explicit.** When a document has no lines, show `EmptyState` inside the
Line Items section rather than an empty table; keep the existing "no approval actions" empty message
on the timeline; keep SLA/overdue tags but emphasize the overdue case.

**5. Responsiveness and tokens.** Header stacks vertically below a small breakpoint (actions wrap
under identity); wide tables scroll within their own container; all colors are PrimeUI theme tokens
so `.dark` works. Keep i18n: any new label goes into both `en` and `la` `documents` locale files.

## Risks / Trade-offs

- **[Client-side line total could disagree with `doc.totalAmount`]** → Display the summed line total
  only as a table footer aid; the summary section's headline figure remains `doc.totalAmount` /
  `doc.baseTotalAmount` from the server, so the authoritative number is never derived on the client.
- **[Layout regressions in dark mode or narrow screens]** → Use only theme tokens and existing
  responsive utilities; verify both themes and a mobile width during implementation.
- **[i18n drift]** → Every new string is added to both `en` and `la` locales in the same task.

## Data-write note

This change writes nothing. It touches no `budget_txn` or `quota_usage` rows, opens no
`em.transactional(...)` boundary, and takes no locks — it is a read-only presentation change over
data the detail endpoint already returns. The reserve→actual→release and locked-FX invariants are
therefore untouched.
