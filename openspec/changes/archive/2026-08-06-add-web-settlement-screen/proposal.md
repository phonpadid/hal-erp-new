## Why

The backend already lets finance record how a document that accrues at approval was finally paid — `GET /documents/unsettled`, `POST /documents/:id/settle`, and `GET /documents/:id/settlement` are implemented and specified in `document-engine` ("A Document Accrued At Approval Is Settled Once, With Evidence"). But no web screen calls them. Finance therefore has no way to record a settlement from the UI, and reaches for the Ready-to-Pay screen (`web-payments`) instead — a different mechanism that writes the `payment` table, not `document_settlement`. The two look interchangeable and are not.

The cost is silent: a document "paid" through Ready-to-Pay never gets a `document_settlement` row, so `GET /documents/:id/settlement` keeps returning 404. Any consumer that reads settlement — including the HAL claim system, whose claim can only close once its ERP document is settled — treats the document as approved-but-unpaid forever. The gap surfaced during HAL claim end-to-end testing: an approved CLAIM document could not be closed because the only settlement path available in the UI wrote to the wrong table.

## What Changes

- Add a finance **Settlements** section in the web app that exposes the already-built settlement endpoints:
  - An **unsettled queue** listing accrue-on-approval documents that are fully approved and not yet settled (`GET /documents/unsettled`), gated on `PAYMENT_MANAGE`.
  - A **Record Settlement** action (`POST /documents/:id/settle`) capturing `settlementType` (only `CASH` is offered/accepted today), `settledAt`, an optional `reference`, an optional `note`, and a **required** evidence file. Gated on `PAYMENT_MANAGE`; the affordance is hidden for API-key sessions (the server already denies them — client is UX only).
  - A **settlement read** on a document (`GET /documents/:id/settlement`) showing `settlementType`, `settledAt`, and `reference`; a 404 is rendered as "approved, awaiting settlement" rather than an error.
- Make the UI copy explicitly distinguish this settlement path from Ready-to-Pay so finance does not confuse "record a settlement" (accruing documents → `document_settlement`) with "record a payment" (`CUT_BUDGET` disbursements + FX → `payment`).
- No backend, schema, permission, or ledger changes. This change only adds the web surface for behavior that already exists.

## Capabilities

### New Capabilities
- `web-settlement`: the finance web surface for recording and reading the settlement of a document that accrues its expense at approval — the unsettled queue, the record-settlement form (CASH-only, required evidence), and the read of a document's settled state. Distinct from `web-payments` (the FX payment/Ready-to-Pay flow).

### Modified Capabilities
<!-- None. The settlement behavior, endpoints, permissions, CASH-only rule, single-settlement immutability, required-evidence rule, and API-key denial are already specified in document-engine and unchanged by this change. -->

## Impact

- **Front-end only** (Vue 3 + PrimeVue). New API client bindings for `GET /documents/unsettled`, `POST /documents/:id/settle` (multipart), and `GET /documents/:id/settlement`; a settlements list view; a record-settlement form/dialog; and a settlement panel on the document detail view. Routing and navigation entry gated on `PAYMENT_MANAGE`.
- **No backend change.** Endpoints, permissions (`PAYMENT_MANAGE` to record, `DOC_VIEW` to read), CASH-only enforcement, at-most-one-settlement immutability, required-evidence, and the API-key denial are already implemented and covered by `document-engine`.
- **Cross-capability invariants:** none touched. No `budget_txn`/`approval_log` writes, no company-scope change (the endpoints already scope by the active company), no money math on the client — amounts are displayed as returned. The only adjacency is with `web-payments`, which is deliberately kept separate to avoid the payment-vs-settlement confusion this change exists to fix.
