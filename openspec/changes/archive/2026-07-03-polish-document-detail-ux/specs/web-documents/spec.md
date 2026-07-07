## ADDED Requirements

### Requirement: Detail Header Grouping and Action Priority

The document detail header SHALL present the document's identity and state as a scannable summary:
the document number as title, the status as a severity-colored tag, and a meta line carrying the
document type and the document's created date and submit/lock date when present (the requester is
out of scope here because the detail endpoint does not expose it, and this change makes no backend
change). The header SHALL surface the
document's headline total (formatted by the document currency's `decimal_places`) alongside the
status. Header actions SHALL be grouped into a primary cluster — the approval decision actions
Approve / Reject / Return, shown only when the user may act on the document — visually separated
from a secondary cluster of utility actions (Edit, Submit, Cancel, Create successor, Receive). Every
action SHALL remain gated by the same permission code and document status as before; grouping is
presentation only and MUST NOT change which actions appear.

#### Scenario: Header shows identity, status, and headline total

- **WHEN** a user opens a document that has a total amount
- **THEN** the header shows the document number, a status tag, a meta line with the document type and
  the created/submit-lock dates, and the headline total formatted by the document currency's
  `decimal_places`

#### Scenario: Approval actions are grouped ahead of utilities

- **WHEN** an eligible approver opens a document awaiting their action
- **THEN** the Approve / Reject / Return actions are shown as a primary group, visually separated
  from the secondary utility actions

#### Scenario: Grouping does not change gating

- **WHEN** a user lacks the permission or the status precondition for an action
- **THEN** that action is hidden exactly as before, regardless of its group

### Requirement: Detail Summary Emphasis

The detail summary SHALL render the document's currency, locked exchange rate, total, base total,
lock date, vendor (when present), and predecessor link (when present) as labelled definition pairs,
with the grand total and base total given greater visual weight than the secondary facts. Monetary
amounts SHALL be formatted using the relevant currency's `decimal_places`, and the predecessor SHALL
remain a link that navigates to the source document.

#### Scenario: Total is emphasized in the summary

- **WHEN** the user views a document's summary
- **THEN** the grand total and base total are visually emphasized above the secondary facts, each
  amount formatted to its currency's `decimal_places`

#### Scenario: Predecessor link navigates to the source

- **WHEN** the user opens a document that has a predecessor reference and clicks the predecessor link
- **THEN** the app navigates to the source document's detail view

### Requirement: Detail Table Scannability and Totals

The line-item table SHALL right-align its numeric columns (quantity, unit price, line amount, base
line amount) and SHALL show a totals row summing the line and base-line amounts for display; the
summary's headline figure remains the server-provided document total, not the client-summed value.
The 3-way matching table SHALL apply the same numeric alignment and keep its per-line result tag.
When a document has no line items, the line-items section SHALL show an explicit empty state rather
than an empty table.

#### Scenario: Numeric columns are right-aligned with a totals row

- **WHEN** the user views a document that has line items
- **THEN** the numeric columns are right-aligned and a totals row shows the summed line and base-line
  amounts, each formatted to its currency's `decimal_places`

#### Scenario: Document with no lines shows an empty state

- **WHEN** the user opens a document that has no line items
- **THEN** an explicit empty state is shown in place of an empty line-items table

### Requirement: Detail Responsive and Token-Based Rendering

The detail page SHALL reflow on narrow screens — the header stacks and its actions wrap, and wide
tables scroll within their own container without breaking the page layout — and SHALL render using
only PrimeUI theme tokens so that light and dark modes both display correctly. Every user-facing
string introduced by this presentation MUST be localized in both supported languages.

#### Scenario: Detail reflows on a narrow screen

- **WHEN** the detail page is viewed at a narrow (mobile) width
- **THEN** the header stacks with its actions wrapping and wide tables scroll within their container
  without horizontal overflow of the page

#### Scenario: Dark mode renders from theme tokens

- **WHEN** the detail page is viewed with dark mode active
- **THEN** all sections render from theme tokens with no hardcoded colors

#### Scenario: New strings are localized in both languages

- **WHEN** the detail page is viewed in either supported language
- **THEN** every label introduced by this change is shown localized, with no missing-key fallback
