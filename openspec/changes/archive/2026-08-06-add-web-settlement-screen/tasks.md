<!-- Front-end-only change: the backend endpoints, entities, migrations, permissions, and ledger
     effects already exist and are specified in document-engine. No backend or migration tasks. -->

## 1. API client bindings

- [x] 1.1 Add `src/api/settlements.ts` with a typed `settlementsApi`: `unsettled()` → `GET /documents/unsettled`, `read(id)` → `GET /documents/:id/settlement`, `record(id, dto, file)` → multipart `POST /documents/:id/settle`.
- [x] 1.2 Define types mirroring the server: `UnsettledRow { id, docNo, totalAmount?, approvedAt?, department }`, `SettlementRead { settlementType, settledAt, reference? }`, `RecordSettlementInput { settlementType: 'CASH', settledAt, reference?, note? }`.
- [x] 1.3 In `read(id)`, return a discriminated result so a `404` resolves to an "unsettled" state instead of throwing/toasting (per design D5); all other errors propagate normally.
- [x] 1.4 Build the multipart body as `FormData` (fields + `file`), following `PaymentSlips.vue`'s upload; send the company-context JWT via the existing client.

## 2. Settlements queue view

- [x] 2.1 Add `src/views/settlements/SettlementsView.vue` listing `settlementsApi.unsettled()` rows with document number, department, total amount (rendered from the decimal string, no math), and approval date.
- [x] 2.2 Empty state: render a "nothing awaiting settlement" message rather than an empty table.
- [x] 2.3 Each row opens the record-settlement dialog; on success, remove the row from the queue without a full reload.
- [x] 2.4 Copy on the view states it is for documents that accrue at approval and is separate from Ready-to-Pay (spec: "Settlement Is Distinct From Ready-to-Pay").

## 3. Record-settlement dialog

- [x] 3.1 Add a record-settlement dialog/component using `@primevue/forms` with a `zodResolver`.
- [x] 3.2 Zod schema mirrors `RecordSettlementDto`: `settlementType` literal `'CASH'`, `settledAt` required date, `reference?` ≤255, `note?` ≤2000 (design D4).
- [x] 3.3 Settlement-type control offers only `CASH`; the form cannot submit any other value.
- [x] 3.4 Require an evidence file — block submission and show a message when none is attached; send no request (spec scenario "Evidence is required").
- [x] 3.5 Gate the submit affordance on `auth.can('PAYMENT_MANAGE')`; on submit call `settlementsApi.record(...)`.
- [x] 3.6 On a server rejection that the document is already settled, surface "already settled" and drop the row from the queue (design risk: settled between load and submit).

## 4. Document detail settlement panel

- [x] 4.1 On `src/views/documents/DocumentDetailView.vue`, add a settlement panel that calls `settlementsApi.read(id)`.
- [x] 4.2 When settled, show `settlementType`, `settledAt`, and `reference`; visible to `DOC_VIEW`.
- [x] 4.3 When the read is the `404`/unsettled state, show "approved, awaiting settlement" with no error surfaced (spec scenario "Approved but unsettled is not an error").
- [x] 4.4 For a `PAYMENT_MANAGE` user on an approved, accrue-on-approval, unsettled document, offer the record action inline (reusing the section-3 dialog); do not offer it once settled.

## 5. Routing and navigation

- [x] 5.1 Register a lazy `settlements` route in `src/router/routes.ts` with `meta.permission: 'PAYMENT_MANAGE'`.
- [x] 5.2 Add a nav entry in `src/layouts/AppShell.vue` with `permission: 'PAYMENT_MANAGE'`, labelled distinctly from Payments.
- [x] 5.3 Confirm `evaluateGuard` redirects a user without `PAYMENT_MANAGE` away from the route (guard is UX-only; server still enforces).

## 6. Copy / i18n

- [x] 6.1 Add i18n strings for the settlements view, dialog, and detail panel under the app's locale files, in the languages the app already ships.
- [x] 6.2 Wording explicitly distinguishes "record a settlement" (accruing documents → `document_settlement`) from "record a payment" (Ready-to-Pay → `payment`).

## 7. Tests

- [x] 7.1 Component test: the queue lists unsettled rows, shows the empty state, and drops a row after a successful record.
- [x] 7.2 Component test: the record dialog blocks submit without a file, offers only `CASH`, and hides the record action without `PAYMENT_MANAGE`.
- [x] 7.3 Component test: the detail panel renders a settled document's fields, and renders the `404` read as "approved, awaiting settlement".
- [x] 7.4 Guard test: a user lacking `PAYMENT_MANAGE` is redirected from the `settlements` route (mirror `router/guard.spec.ts`).
