## 1. Shared schema

- [x] 1.1 In `@erp/shared`: `delegationSchema` (delegatorId uuid, delegateId uuid, documentTypeId? uuid, amountLimit? decimal string, startDate, endDate ISO strings, reason?); export the inferred type. `pnpm --filter @erp/shared build`.

## 2. Backend: list + cancel (approval-workflow)

- [x] 2.1 `WorkflowConfigService.listDelegations()`: active-company delegations (newest first) → `[{ id, delegatorId, delegatorName, delegateId, delegateName, documentTypeId, documentTypeCode, amountLimit, startDate, endDate, status, reason }]` (batch-resolve user/doc-type names by id).
- [x] 2.2 `WorkflowConfigService.cancelDelegation(id)`: load, verify `company === active` (else NotFound), set `status = 'CANCELLED'`, flush.
- [x] 2.3 `ApprovalConfigController`: `GET /workflows/delegations` and `POST /workflows/delegations/:id/cancel` (inherit class `WORKFLOW_MANAGE`).

## 3. Backend test

- [x] 3.1 DB-backed (reuse `seedDatabase`): create a delegation (admin→approver) via the service; `listDelegations` returns it with resolved delegator/delegate names; `cancelDelegation` flips status to `CANCELLED`; a delegation created under a second company is not listed when company A is active.

## 4. Frontend data layer

- [x] 4.1 `api/approvalConfig.ts`: delegations (list/create/cancel) + `users()` (`/rbac/users`) + `documentTypes()` (`/document-config/document-types`) picker helpers.
- [x] 4.2 `stores/approvalConfig.ts` (Pinia): `delegations`, `users`, `documentTypes`, `loading`, `error`; `loadAll()`; `createDelegation`/`cancelDelegation` wrappers that refresh; capture errors.

## 5. View & shell

- [x] 5.1 `views/admin/ApprovalConfigView.vue`: delegations `DataTable` (delegator → delegate, doc type, amount limit, window, status) + "New delegation" dialog (delegator/delegate Selects, optional doc-type Select, amount-limit text, start/end date inputs, reason) + per-row Cancel on active rows. Gated by `can('WORKFLOW_MANAGE')`.
- [x] 5.2 Dialog uses `<Form :resolver="zodResolver(delegationSchema)">` + `<FormField>` + `<Message>`; amount limit kept as a string.
- [x] 5.3 Routing + nav: route `approval-config` (`meta.permission='WORKFLOW_MANAGE'`); a "Delegations" nav item gated by `can('WORKFLOW_MANAGE')` (layout store NAV + i18n la/en).

## 6. Frontend tests

- [x] 6.1 approvalConfig store (mock `api`): `loadAll` populates delegations/users/documentTypes; `createDelegation`/`cancelDelegation` call the right endpoint and refresh; error captured.
- [x] 6.2 Shared schema: valid delegation accepted; missing delegate and missing dates rejected.

## 7. Verify

- [x] 7.1 `pnpm --filter @erp/shared build`, `pnpm --filter back build` + `pnpm --filter back test`, `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 7.2 Run `openspec validate web-approval-config --type change --strict`.
