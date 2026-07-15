## 1. Backend — Requester Quota Selection Read

- [x] 1.1 Add a batched `personal` derivation to `QuotaService` (or `QuotaBalanceService`): given quota ids, return the set that has any `quota_entitlement` row (one query, no N+1).
- [x] 1.2 Add `QuotaService.selectableForRequester()`: active-company, `isActive:true` quotas mapped to `{ id, quotaType, unit, resetCycle, personal, remaining }`; `remaining` = pool remaining for pool quotas, and the caller's own current-period remaining (resolve the caller's `Employee`) for personal quotas.
- [x] 1.3 Add `GET /quotas/selectable` in `quota.controller.ts`, authorized by `DocP.DOC_CREATE` (not `QUOTA_VIEW`), returning the selectable list. Place it before `@Get(':id')` so the literal path is not captured by the id route.
- [x] 1.4 Unit test: a `DOC_CREATE`-only caller gets the list; `personal` and `remaining` are correct for a pool quota and for a personal quota with entitlement.

## 2. Backend — Personal-Quota Beneficiary Resolution at Submit

- [x] 2.1 In `document-submit.service.ts`, before the reserve loop, resolve each reservation's quota; for a personal (entitlement-scoped) quota, override `employeeId` to the submitter's own `Employee` (active company) inside the submit transaction, ignoring any client value.
- [x] 2.2 Reject the submit with a clear `BadRequestException` when a personal-quota reservation has no resolvable employee for the submitter; write no `quota_usage` row (whole submit transaction rolls back).
- [x] 2.3 Pool quotas reserve with `employeeId` undefined (unchanged path).
- [x] 2.4 Unit test: personal quota stamps the submitter's employee even when the body carries a different/absent employee id; no-employee submitter is rejected; pool quota reserves with null employee.

## 3. Frontend — API + Store Wiring

- [x] 3.1 Add `SelectableQuota` type and `quotasApi.selectable()` (`GET /quotas/selectable`) to `front-end/src/api/quotas.ts`.
- [x] 3.2 Add a `QuotaReservationInput` type (`{ quotaId; qty }`) to `front-end/src/api/documents.ts` and type the `submit` body's `quotaReservations`.
- [x] 3.3 Thread an optional body through the documents store `submit(id, body?)` to `documentsApi.submit`.

## 4. Frontend — Quota Reservations Editor

- [x] 4.1 Create `front-end/src/views/documents/QuotaReservationsEditor.vue`: `v-model` list of `{ quotaId, qty }`; add/remove rows with accessible remove labels; PrimeUI theme tokens (light/dark).
- [x] 4.2 Populate the quota `Select` from `quotasApi.selectable()`; show the selected quota's `unit` and advisory `remaining`; for a `personal` quota show a read-only "applies to you" note (no employee picker).
- [x] 4.3 Inline per-row validation mirroring `QuotaReservationInput` (`quotaId` set, `qty` numeric string `> 0`), `qty` kept a string; errors shown via `<Message>` gated on the step's `attempted` flag. Matches the sibling `LineItemsEditor` pattern — these in-wizard editors validate through `FormStepper.validateStep`, not a `@primevue/forms` `<Form>`/zodResolver wrapper.

## 5. Frontend — Wizard Integration

- [x] 5.1 In `CreateDocumentView.vue`, add a conditional "Quota" step before Review, shown only when `selectedType()?.requiresQuota`; load selectable quotas on demand.
- [x] 5.2 Add the quota step to `validateStep` / `onStepError`: block advance until at least one reservation has a positive `qty`, focusing the first offending row.
- [x] 5.3 In `save(submitAfter)`, when the type is `requires_quota`, pass `docs.submit(id, { quotaReservations })`; send none otherwise. Surface server errors verbatim, keeping the draft.
- [x] 5.4 Extend the Review step to list each reservation's quota and quantity, derived from the same wizard state that is submitted.

## 6. Frontend — Detail-View Submit Reconciliation

- [x] 6.1 In `DocumentDetailView.vue`, for a `requires_quota` draft route the Submit action into the wizard's quota/review step (edit route with the quota/review step) instead of calling `docs.submit` with an empty body; leave non-quota submit unchanged.

## 7. Tests

- [x] 7.1 Component test: `QuotaReservationsEditor` adds/removes reservations, enforces positive `qty`, keeps `qty` a string, shows advisory remaining, and renders no employee picker.
- [x] 7.2 Wizard test: the Quota step shows only for `requires_quota` types and blocks advance without a valid reservation.
- [x] 7.3 Submit test: a `requires_quota` submit sends `quotaReservations`; a non-quota submit sends none; a server over-quota / no-reservation / no-employee rejection is shown verbatim and the document stays DRAFT.
