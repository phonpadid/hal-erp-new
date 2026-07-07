## 1. Module scaffolding & DTOs

- [x] 1.1 Create `ApprovalWorkflowModule` (`MikroOrmModule.forFeature([Workflow, WorkflowStep, ApprovalDelegation, ApprovalLog])`; import `BudgetControlModule`, `MultiCompanyModule`, `DocumentEngineModule`; provide `CompanyScopeService`); register in `AppModule`.
- [x] 1.2 Add permission-code constants `WORKFLOW_MANAGE`, `DOC_APPROVE` in a module `permissions.ts`.
- [x] 1.3 Add class-validator DTOs: workflow create; workflow-step create (`stepNo`, `approverRoleId?`/`approverUserId?`, `amountMin?`/`amountMax?`, `approveMode?`, `slaHours?`); delegation create; act DTO (`action`, `remark?`).

## 2. Workflow configuration

- [x] 2.1 `WorkflowConfigService` (`WORKFLOW_MANAGE`): CRUD `workflow` (company-scoped) + `workflow_step` (unique workflow+step_no); create `approval_delegation` (with sane date range / status ACTIVE).
- [x] 2.2 Config controller guarded by `WORKFLOW_MANAGE`, `ParseUUIDPipe` on ids.

## 3. Approver resolution & delegation

- [x] 3.1 `ApproverResolverService.eligible(step, document)`: `approver_user_id` → that user; else `approver_role_id` → holders via active `user_company_role` in the document's company. Returns `{ userId, delegatedFrom? }[]`.
- [x] 3.2 Delegation (one hop): for each principal, an active `approval_delegation` (date range, status ACTIVE, doc-type null/matching, amount-limit null/≥ base) adds the delegate with `delegatedFrom = principal`; a delegate's own delegation is NOT followed (no chaining).

## 4. Routing & actions

- [x] 4.1 `ApprovalRoutingService.applicableSteps(document)`: bound workflow's steps where `base_total_amount` is within `[amount_min, amount_max]`, ordered by `step_no`. `start(documentId)`: SUBMITTED → IN_APPROVAL at first applicable step.
- [x] 4.2 `stepComplete(document, step)` from `approval_log`: SEQUENTIAL/PARALLEL_ANY on first APPROVE; PARALLEL_ALL when distinct principal approvers cover all eligible.
- [x] 4.3 `act(documentId, { action, actingUserId, remark })` in one `inTransaction`: verify `actingUserId` is eligible (capture `delegatedFrom`); **block self-approval** when `actingUserId` or `delegatedFrom` is the creator (invariant 8); insert append-only `approval_log`; branch REJECT→REJECTED+release, RETURN→DRAFT+release, DELEGATE→log, APPROVE→complete/advance.
- [x] 4.4 Reject/return release via `DocumentSubmitService.releaseDocumentHolds`.

## 5. Terminal approval & post-action

- [x] 5.1 On last applicable step complete: set `APPROVED`, run post-action, set `COMPLETED` — same transaction.
- [x] 5.2 `PostActionService.run(document, tem)` dispatch with bounded `retry`: `CUT_BUDGET` → `settle` per budgeted line (base_line_amount); `TRANSFER`/`ADJUST_INCREASE`/`ADJUST_DECREASE` → `executeTransfer`/`executeAdjustment` from the document's `budget_movement`; `UPDATE_EMPLOYEE`/`TERMINATE_EMPLOYEE` → set related employee status; null/`CREATE_PO` → no-op. On persistent failure the transaction rolls back (not stuck).

## 6. SLA

- [x] 6.1 `SlaService.stepDueAt(stepStart, slaHours, companyId)` via `WorkingTimeService`; `escalate(documentId)` advances/flags an overdue step with no active delegation and logs.

## 7. Controllers & wiring

- [x] 7.1 `ApprovalController`: `POST /documents/:id/start` and `POST /documents/:id/actions` (`DOC_APPROVE`); `GET /documents/:id/approval-log` (`DOC_VIEW`). `ParseUUIDPipe`; `JwtAuthGuard` + `PermissionsGuard`.

## 8. Tests

- [x] 8.1 Applicable steps: a 600k document includes the `amount_min=500000` step; a 400k document skips it.
- [x] 8.2 Modes: PARALLEL_ANY advances on first approval; PARALLEL_ALL waits for all eligible.
- [x] 8.3 Role resolution: a role step resolves to the role's holder(s) in the document's company.
- [x] 8.4 Delegation: an active delegation routes to the delegate and logs `delegated_from`; a delegate's own delegation is not chained.
- [x] 8.5 Self-approval blocked: the creator (directly or as delegate) cannot approve.
- [x] 8.6 Reject releases: REJECT → REJECTED and budget/quota holds released.
- [x] 8.7 Append-only: updating an `approval_log` row throws.
- [x] 8.8 Post-action: a CUT_BUDGET document, on full approval, settles (ACTUAL recorded, reservation converted) and reaches COMPLETED.
- [x] 8.9 SLA: `stepDueAt` skips weekends + a company holiday.

## 9. Verify

- [x] 9.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 9.2 Run `openspec validate implement-approval-workflow --strict`.
