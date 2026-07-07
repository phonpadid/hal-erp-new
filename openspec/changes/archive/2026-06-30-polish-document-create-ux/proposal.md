## Why

The Create Document page (`/documents/new`) is a four-step wizard, but the steps feel
unfinished: the Review step only shows the document type and a line count, so users submit
without a full picture; the line-item editor is a cramped flex row that wraps awkwardly and
lacks a running total or per-line feedback; required-field and step errors are easy to miss;
and the layout is not tuned for small screens or theme tokens. Approvals downstream depend on
correct documents, so the moment of submit is exactly where clarity matters most.

## What Changes

- **Review step becomes a real summary.** Before submit, show document type, currency (and the
  advisory base-currency conversion / locked-rate note when foreign), vendor (when the type
  requires one), each dynamic field's label + value, and the full line list with per-line
  amounts and a grand total — all read-only, formatted by the currency's `decimal_places`.
- **Line-item editor is restructured for usability.** Replace the wrapping flex row with an
  aligned, responsive layout: clear column headers, a running document total, an explicit
  empty state with an "add first line" affordance, and per-line numeric feedback for quantity
  and unit price.
- **Validation & feedback are made obvious.** Surface field-level errors inline next to the
  field, mark the wizard step that failed validation, show required-field indicators, and give
  the Save / Submit buttons clear busy/disabled states with the server error surfaced verbatim.
- **Visual & responsive pass.** Tidy spacing and grouping, make the stepper and the wizard body
  reflow on narrow screens, and use only PrimeUI theme tokens (no hardcoded colors) so light
  and dark both render correctly.
- No backend, API, DTO, or schema changes — this is a presentation-layer change only. Money
  remains a string formatted by `decimal_places`; the server stays authoritative for all rules.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-documents`: the "Create and Edit a Draft" requirement gains spec-level behavior for the
  Review step summary, the line-item editor's running total / empty state, per-step validation
  feedback, and responsive/token-based rendering.

## Impact

- **Code (frontend only):** `front-end/src/views/documents/CreateDocumentView.vue` (the wizard
  steps, review template, line editor, validation wiring) and `FormStepper.vue` if step-error
  surfacing is extended; i18n strings in `front-end/src/i18n/locales/{en,la}/documents.ts`.
- **No change** to backend services, REST endpoints, DTOs, the shared Zod/DTO schemas, the
  database, or the `document` / `document_type` data model.
- **Invariants:** none affected. Company isolation, append-only ledgers, locked FX, and
  permission-code gating are untouched; amounts continue to be carried as strings and formatted
  by the currency's `decimal_places`. Client validation stays UX-only with the server
  authoritative.
