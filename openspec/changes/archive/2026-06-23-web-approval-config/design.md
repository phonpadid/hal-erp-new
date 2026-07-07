## Context

`ApprovalConfigController` (`@Controller('workflows')`, class `WORKFLOW_MANAGE`) has
`POST /delegations` → `WorkflowConfigService.createDelegation` (sets `status: 'ACTIVE'`,
company from `RequestContext`). `ApprovalDelegation` = `{ id, company, delegator, delegate,
documentType?, amountLimit?, startDate, endDate, reason?, status, createdAt }` (CompanyScoped).
The `ApproverResolverService.activeDelegate` applies a delegation only when `status: 'ACTIVE'`,
within the date window, and within `amountLimit` — one hop, not recursive (invariant 8). Missing
for a UI: a list read and a cancel. The Vue shell + prior admin slices give `can()`, the
typed-api/store pattern, `@primevue/forms` + `zodResolver`, `@erp/shared`, and the existing
`/rbac/users` + `/document-config/document-types` reads for the pickers.

## Goals / Non-Goals

**Goals**
- `WORKFLOW_MANAGE` list + cancel of delegations, active-company scoped.
- Vue delegation admin: list, create, cancel; form validated against a shared Zod schema.
- Tests: backend list/cancel; frontend store + schema.

**Non-Goals**
- Self-service delegation for non-admins, in-place edit, multi-hop delegation, reassigning logged
  actions.

## Decisions

### D1 — Backend list + cancel (WorkflowConfigService)
- `listDelegations()` → active-company `ApprovalDelegation`s (newest first) →
  `{ id, delegatorId, delegatorName, delegateId, delegateName, documentTypeId, documentTypeCode,
  amountLimit, startDate, endDate, status, reason }`, batch-resolving user/doc-type names by id
  (the established pattern, not relation populate).
- `cancelDelegation(id)` → load the delegation, verify `company === active` (else NotFound), set
  `status = 'CANCELLED'`, flush. Soft-cancel preserves the audit row; the resolver already filters
  on `status: 'ACTIVE'`, so a cancelled one simply stops applying. Routes on the existing
  controller: `GET /workflows/delegations`, `POST /workflows/delegations/:id/cancel` (inherit the
  class `WORKFLOW_MANAGE` guard).

### D2 — Shared Zod schema
Add `delegationSchema` to `@erp/shared` mirroring `CreateDelegationDto`: `delegatorId` (uuid),
`delegateId` (uuid), `documentTypeId?` (uuid), `amountLimit?` (decimal string), `startDate`,
`endDate` (ISO), `reason?`. The form uses `zodResolver` (CLAUDE.md parity). `amountLimit` stays a
string (money rule).

### D3 — Frontend data layer
`api/approvalConfig.ts`: delegations (list / create / cancel), plus `users()`
(`GET /rbac/users`) and `documentTypes()` (`GET /document-config/document-types`) for the pickers.
`stores/approvalConfig.ts` (Pinia): `delegations`, `users`, `documentTypes`, `loading`, `error`;
`loadAll()` + mutation wrappers (`createDelegation`, `cancelDelegation`) that refresh; capture
errors.

### D4 — View, routing, nav
`views/admin/ApprovalConfigView.vue`: a delegations `DataTable` (delegator → delegate, doc type,
amount limit, window, status) with a "New delegation" dialog (delegator/delegate `Select`s from
users, optional document-type `Select`, amount-limit text, start/end date inputs, reason) and a
per-row "Cancel" on active rows. Manage controls gated by `can('WORKFLOW_MANAGE')`. Route
`approval-config` (`meta.permission='WORKFLOW_MANAGE'`); a "Delegations" nav item gated by
`can('WORKFLOW_MANAGE')` (layout store `NAV` + i18n la/en).

### D5 — Tests
- Backend (DB-backed, reuse `seedDatabase`): create a delegation (admin→approver) via the service,
  `listDelegations` returns it with resolved names, `cancelDelegation` flips status to CANCELLED,
  and a delegation in a second company is not listed when company A is active.
- Frontend (Vitest): approvalConfig store with a mocked api (loadAll populates; create/cancel call
  the right endpoint and refresh; error captured) + shared-schema validation (valid delegation;
  missing delegate / missing dates rejected).

## Risks / Trade-offs

- **Cross-capability pickers** — delegator/delegate from `/rbac/users` (`RBAC_MANAGE`) and doc type
  from `/document-config/document-types` (`DOC_CONFIG_MANAGE`). Admin holds these; a
  `WORKFLOW_MANAGE`-only user would see empty pickers. Noted (consistent with web-doc-config's role
  picker); a lighter shared "users in company" read could come later.
- **Self-delegation** (delegator == delegate) is pointless but harmless; the resolver's
  self-approval block still protects against a delegate approving their own document. No extra
  client guard this slice.
- **Soft-cancel** keeps history; there is no reopen (recreate instead).

## Migration Plan

`shared`: add `delegationSchema`; build. Backend: add `listDelegations` + `cancelDelegation` +
the two routes + tests. Frontend: add `api/approvalConfig.ts`, `stores/approvalConfig.ts`,
`ApprovalConfigView.vue`, router/nav, tests. `pnpm --filter @erp/shared build`, `pnpm --filter
back build/test`, `pnpm --filter front-end build/test`. Validate `openspec validate
web-approval-config --type change --strict`. Rollback = revert the approval additions and the
`front-end/` + `shared/` additions.

## Open Questions

- Show cancelled/expired delegations or only active? Default: list all with a status column; no
  separate filter this slice.
- Guard delegator == delegate in the form? Default: no (harmless; server self-approval block
  covers the real risk).
