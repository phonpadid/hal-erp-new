## Context

Settlement of an accrue-on-approval document is fully built and specified server-side in `document-engine` ("A Document Accrued At Approval Is Settled Once, With Evidence"). The endpoints exist and are used today only over the raw API:

- `GET /documents/unsettled` — `PAYMENT_MANAGE` — accrue-on-approval, `COMPLETED` documents with no `document_settlement` row (`settlement.service.ts#listUnsettled`).
- `POST /documents/:id/settle` — `PAYMENT_MANAGE`, `ApiKeyDenyGuard`, multipart — body `RecordSettlementDto { settlementType, settledAt, reference?, note? }` + one required `file`; writes the `document_settlement` row, the evidence attachment, and the ledger effect together.
- `GET /documents/:id/settlement` — `DOC_VIEW` — returns `{ settlementType, settledAt, reference }`, or `404` when unsettled.

The web app never binds these. Finance therefore uses the Ready-to-Pay screen (`web-payments`), which is a different mechanism — it records a `payment` (with FX) for `CUT_BUDGET` disbursements — and leaves `document_settlement` empty. Consumers that read settlement (the HAL claim system) never see the document as paid. This change adds only the missing Vue surface.

Front-end constraints from `project.md`: Vue 3 `<script setup>`, PrimeVue 4, Tailwind + tailwindcss-primeui, `@primevue/forms` with `zodResolver`, Pinia for the active company + permissions, a typed API client carrying the company-context JWT, and money carried as decimal **strings** — never a JS number, never client-side math.

## Goals / Non-Goals

**Goals:**
- Give `PAYMENT_MANAGE` finance a web screen to see the unsettled queue and record a `CASH` settlement with required evidence, calling the existing endpoints unchanged.
- Show a document's settled state on its detail view, treating `404` as "approved, awaiting settlement".
- Keep settlement visually and structurally distinct from Ready-to-Pay so the two are never confused.

**Non-Goals:**
- No backend, schema, permission, migration, or ledger change. `document_settlement`, the CASH-only rule, single-settlement immutability, the required-evidence rule, and the API-key denial are already implemented and specified.
- No settlement types beyond `CASH` (the server refuses others; the form offers only `CASH`).
- No change to `web-payments` / Ready-to-Pay behavior.
- No editing or reversing a settlement (server makes it immutable; a correction is a new ledger entry, out of scope here).

## Decisions

**D1 — A dedicated `settlements` API module and views, not folded into `payments`.** Add `src/api/settlements.ts` (`unsettled()`, `record(id, dto, file)`, `read(id)`) and `src/views/settlements/SettlementsView.vue` + a record dialog, mirroring the shape of `src/api/payments.ts` and `src/views/payments/ReadyToPayView.vue`. Rationale: the confusion this change fixes is precisely that settlement and payment look alike; giving settlement its own module, route, and nav entry keeps them apart in the code the same way the UI keeps them apart for finance. Alternative considered — adding a "settle" affordance onto Ready-to-Pay — rejected: it re-merges the two flows the change exists to separate.

**D2 — Reuse the permission-code route guard; gate on `PAYMENT_MANAGE`.** Register the route in `src/router/routes.ts` with `meta.permission: 'PAYMENT_MANAGE'` and a nav entry in `src/layouts/AppShell.vue` with the same code; `evaluateGuard` (`src/router/index.ts`) already redirects when the code is missing. Record affordances call `auth.can('PAYMENT_MANAGE')`, matching `PaymentSlips.vue`. This is UX only — the server authorizes and scopes by the active company (invariant 6).

**D3 — Multipart upload mirrors `PaymentSlips.vue`.** Build a `FormData` with the fields and the file and POST it through the typed client, exactly as the slip upload already does; do not invent a new upload path.

**D4 — Form validation with one Zod schema mirroring `RecordSettlementDto`.** `settlementType` a literal `'CASH'`, `settledAt` a required date, `reference`/`note` optional (≤255 / ≤2000), and a required file guarded in the submit handler (file inputs sit outside the resolver). The client rules are a mirror of the server DTO, not a second authority — the server still enforces.

**D5 — `404` on the settlement read is a state, not an error.** The detail-view settlement panel maps `404` to "approved, awaiting settlement" and shows the settlement only when the read returns 200. This matches how `document-engine` describes the read and how the HAL side already treats it. The API client must not surface that `404` as a global error toast.

**D6 — The web app is inherently a JWT session, so the API-key affordance requirement is met by construction.** The web client authenticates with the user's company-context JWT; API keys never drive the web UI. The record action is still guarded by `auth.can('PAYMENT_MANAGE')`, and the server's `ApiKeyDenyGuard` remains the real enforcement. No client-side "is this an API key?" branch is needed or added.

**D7 — Display amounts as returned; no client math.** `totalAmount` from the queue and any amount on the detail view are rendered from their decimal strings. Settlement records no money on the client and performs no FX — that is the payment flow's concern, deliberately not this one.

## Risks / Trade-offs

- **[Two finance screens invite the same confusion in reverse]** → The settlements queue lists only accrue-on-approval documents awaiting settlement and never `CUT_BUDGET` disbursements; labels and helper copy state which flow each is for (spec requirement "Settlement Is Distinct From Ready-to-Pay").
- **[A document could be settled between load and submit]** → The server rejects a second settlement (at-most-one, immutable); the client surfaces that rejection as "already settled" and refreshes the row out of the queue rather than retrying.
- **[Client CASH-only / required-evidence rules could drift from the server]** → The Zod schema mirrors `RecordSettlementDto` and the CASH-only rule; both are server-enforced, so a drift degrades UX, never correctness.
- **[Ledger safety]** → Not applicable on the client: recording a settlement writes `document_settlement`, its attachment, and its ledger entry **server-side, in one `em.transactional`** (already implemented in `settlement.service.ts#record`); this change issues a single `POST /documents/:id/settle` and writes no `budget_txn` or `quota_usage` itself. There is no client-side transaction boundary or lock to specify.

## Migration Plan

- Additive, front-end only. Ship the new route, nav entry, API module, views, and the detail-view settlement panel. No data migration, no backend deploy, no config change.
- Rollback is removing the route/nav/views; the endpoints they call are pre-existing and unaffected, and any settlement already recorded stays valid.

## Open Questions

- Where the settlement panel belongs on `DocumentDetailView.vue` relative to attachments and approval history — placement/ordering only, no behavior impact; resolve during implementation.
- Whether the nav entry sits under an existing "Finance" grouping in `AppShell.vue` or as a sibling of Payments — cosmetic; pick whichever reads clearest alongside the Payments entry.
