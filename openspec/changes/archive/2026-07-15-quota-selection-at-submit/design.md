## Context

Quota-controlled document types (`document_type.requires_quota = true`) reserve non-money
allowances — leave days, OT hours, asset bookings — at submit. The backend is complete:
`SubmitDocumentDto.quotaReservations: QuotaReservationInput[]`
(`back/src/modules/document/dto/document.dto.ts`) feeds a reserve loop in
`document-submit.service.ts` that calls `QuotaUsageService.reserve` per row inside the same
`inTransaction` as budget reservation, under `LockMode.PESSIMISTIC_WRITE` on the `quota` row (and
the `quota_entitlement` row for personal quotas). If a `requires_quota` document arrives with an
empty array the server throws `Quota-controlled document declares no quota reservations`.

The frontend never sends the array: `CreateDocumentView.vue` calls `docs.submit(id)` and
`DocumentDetailView.vue` calls `docs.submit(id.value)`, both with an empty body. The
`documentsApi.submit(id, body = {})` signature already accepts a body — nothing passes one. So no
quota-controlled type can be submitted from the UI, and there is no screen to choose a quota.

Two constraints surfaced while implementing:

- **No `document_type → quota` link** in `erp_approval_system.dbml`. `requires_quota` says *that* a
  quota is needed, not *which*. The requester therefore selects the quota(s) at submit from the
  company's active quotas.
- **The requester lacks the finance reads.** `GET /quotas` is authorized by `QUOTA_VIEW` and
  `GET /employees` by `EMPLOYEE_MANAGE`; a document requester holds only `DOC_CREATE` / `DOC_SUBMIT`.
  So neither read can populate the wizard. This is the exact shape budget already solved with
  `GET /budgets/selectable` (authorized by `DOC_CREATE`, not `BUDGET_VIEW`) — quota needs the same
  requester-facing read.

## Goals / Non-Goals

**Goals:**
- Let a requester submit a `requires_quota` document from the create wizard by choosing one or more
  quota reservations (`quotaId`, `qty`).
- Give the requester a permission-appropriate quota read (`GET /quotas/selectable`, `DOC_CREATE`).
- Enforce self-only beneficiary for personal quotas on the server, so a client cannot reserve
  against another employee's entitlement.
- Pass reservations to `POST /documents/:id/submit` so the existing reserve loop runs unchanged.
- Show remaining balance as advisory UX and block Submit client-side until a valid reservation
  exists, while keeping the server authoritative for over-quota and all enforcement.
- Cover the reservations in the wizard Review summary and validation feedback.

**Non-Goals:**
- No new `QuotaUsageService.reserve` behavior — the reserve/period/lock logic is reused as-is.
- No employee picker: the personal-quota beneficiary is always the requester (server-resolved).
- No new `document_type → quota` mapping table (would be a separate proposal if ever wanted).
- No release/actual UI — reserve-then-release stays server-driven (invariants 4–5).

## Decisions

**1. Add a conditional wizard step, not a modal.** When the selected document type has
`requires_quota`, insert a "Quota" step before Review, built from a new
`QuotaReservationsEditor.vue` component. Rationale: mirrors the existing conditional shape of the
wizard (budget/vendor/item steps already appear by type config, invariant 7) and keeps the Review
summary and step-validation model intact. Alternative — a dialog on the Submit button — was
rejected because it bypasses the wizard's `validateStep`/review-summary machinery and duplicates
state.

**2. Add `GET /quotas/selectable` authorized by `DOC_CREATE`.** It mirrors `GET /budgets/selectable`:
active-company scoped, `isActive` only, no admin permission required. Each row is
`{ id, quotaType, unit, resetCycle, personal, remaining }`. `personal` is derived in one batched
query — a quota is personal when it has any `quota_entitlement` row. `remaining` is advisory: pool
remaining for a pool quota, and the *requester's own* current-period remaining for a personal quota
(the endpoint knows the caller and resolves their employee). Alternatives rejected: reusing
`GET /quotas` (needs `QUOTA_VIEW`); a type-scoped endpoint (impossible without a type→quota link).

**3. Resolve the personal-quota beneficiary to the requester's employee on the server.** In
`document-submit.service.ts`, before calling `QuotaUsageService.reserve`, for each reservation load
its quota and decide: if the quota is personal (has entitlements), set `employeeId` to the
submitter's own linked employee (`Employee where user = submitter, company = active`) — ignoring any
client-supplied value — and reject with a clear error if the submitter has no employee; if the quota
is a pool quota, reserve with `employeeId` undefined. This makes "self only" a server-enforced
security property, not a client promise, and removes the need for any employee picker in the UI.

**4. Client validation mirrors the server guard, UX only.** The Quota step is not completable, and
Submit is blocked, until at least one reservation has a positive `qty`. `qty` is carried as a string
and validated with Zod (`z.string()` numeric, `> 0`), never coerced to a JS number — consistent with
money handling. The client sends only `{ quotaId, qty }` per reservation; it does not send
`employeeId` (the server resolves it). This stays within `QuotaReservationInput` (all other fields
optional).

**5. Wire reservations through the existing submit call.** `save(submitAfter)` collects the
reservations from wizard state and calls `docs.submit(id, { quotaReservations })`. `documentsApi.submit`
already threads a body; the store's `submit` gains an optional body param. Server errors (over-quota,
missing reservation, no linked employee) surface verbatim through the existing feedback path, the
same way over-budget errors do today.

**Sequence note (writes `quota_usage`).** No new write path is introduced. On submit the server, in
one `inTransaction`: (a) reserves budget, then (b) for each reservation resolves the beneficiary as
in decision 3, locks the `quota` row (`PESSIMISTIC_WRITE`) — plus the `quota_entitlement` row when an
`employeeId` is resolved — recomputes remaining, and inserts an append-only `quota_usage` row with
`usage_type = 'USE'`. The beneficiary resolution reads `Employee` inside the same transaction. The
client only supplies inputs; it performs no ledger writes and must not assume its advisory remaining
matches the locked server value. Reject/cancel later auto-releases via `QuotaUsageService.releaseAll`
(invariant 5) — unchanged and out of scope here.

## Risks / Trade-offs

- **[Advisory remaining is stale by submit]** → The picker's `remaining` is a read, not a lock;
  another document may consume the quota first. Mitigation: the server re-checks under
  `PESSIMISTIC_WRITE` and rejects over-quota; the UI surfaces that error verbatim and keeps the
  draft. The client number is labelled advisory.
- **[Submitter has no linked employee but picks a personal quota]** → the reservation can't resolve
  a beneficiary. Mitigation: the server rejects with a clear message; the advisory `remaining` for
  personal quotas already reflects the caller's own entitlement, so a requester with no entitlement
  sees `0` and is steered away.
- **[Quota list without a type→quota link shows all company quotas]** → the user could pick an
  unrelated quota. Mitigation: acceptable for now (matches the current data model); a future
  type→quota mapping proposal could scope the list. Flagged in Open Questions.
- **[Detail-view submit still sends no reservations]** → submitting a `requires_quota` draft from
  the detail page would fail with the backend's no-reservations error. Mitigation: for a
  `requires_quota` draft, the detail Submit routes into the wizard's Quota/Review step (which owns
  the reservation state) instead of calling `submit` with an empty body.

## Open Questions

- Do we ever want to scope the quota list to the document type (needs a new `document_type_quota`
  mapping table and a separate proposal), or is a free company-scoped pick acceptable long-term?
- Should self-only ever relax to "self or subordinates" (would need a scoped employee read and a
  beneficiary picker)? Out of scope for this change.
