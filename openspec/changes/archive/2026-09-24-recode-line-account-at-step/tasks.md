## 1. Data model, entities, migration

- [x] 1.1 `erp_approval_system.dbml`: add `requires_payment_slip boolean [not null, default: false]` (overdue) and `allows_account_recode boolean [not null, default: false]` to both `workflow_step` and `document_approval_step`, with notes in the file's voice (the route copy says "คัดลอกมาจาก workflow_step ตอน submit — อ่านจากแถวนี้ ไม่ join สด"); add `RECODE_ACCOUNT` to `Enum approve_action` beside `RESTATE_RATE`; extend the `document_line.account_id` note with one sentence saying a person on an allowing step may restate it, attributed in `approval_log`, only while in approval
- [x] 1.2 Add `allowsAccountRecode: boolean = false` to `WorkflowStep` and to `DocumentApprovalStep` in `back/src/modules/approval/approval.entities.ts`, each with a docblock in the shape of `requiresPaymentSlip`'s
- [x] 1.3 Add `RECODE_ACCOUNT = 'RECODE_ACCOUNT'` to `ApproveAction` in `back/src/common/enums/index.ts` with a comment naming the sole writer (`DocumentLineRecodeService.recode()`)
- [x] 1.4 Add `Migration20260911000000`: add both `allows_account_recode` columns (boolean NOT NULL default false); drop and re-add `approval_log_action_check` admitting `RECODE_ACCOUNT` alongside `RESTATE_RATE`, in the shape of `Migration20260906100000`; `down()` drops the columns and re-narrows the check, with the docblock stating the invariant-2 caveat
- [x] 1.5 Declare `DOC_LINE_RECODE` in `back/src/modules/document/permissions.ts` with a docblock saying what it grants and why it is neither `DOC_APPROVE` nor `GL_JV_POST`; confirm `declaredPermissionCodes()` in `back/src/seed/seed-data.ts` picks it up (it spreads `DocumentPermissions`) and that `permission-catalog.spec.ts` / `seed-essentials.spec.ts` still pass
- [x] 1.6 `DocumentRouteService` (`back/src/modules/approval/document-route.service.ts`): copy `allowsAccountRecode` onto the route row beside `requiresPaymentSlip`
- [x] 1.7 Run `DB_PORT=5433 DB_NAME=erp_test pnpm -C back migration:up` against the test database and confirm the migrations build the entities' schema; regenerate `.snapshot-erp.json` if the project keeps it current

## 2. The recode service

- [x] 2.1 Create `back/src/modules/document/document-line-recode.service.ts` — `DocumentLineRecodeService.recode(documentId, lineNo, accountId)` — with a docblock in `DocumentRateService`'s voice explaining what narrows "never re-derived" and why this is not an `act()` action
- [x] 2.2 Inside `inTransaction`: `SELECT document FOR UPDATE` with the company filter ON (another company's document is 404); then gates in the design's order — `IN_APPROVAL`; current route step via `DocumentRouteService.routeStep` has `allowsAccountRecode`; acting user in `ApproverResolverService.eligible(step, document)` (principal or delegate, keep `delegatedFrom`); no `JournalEntry` with `sourceId = documentId`; the line exists on this document with `line_amount > 0`; the target `Account` is in the active company, `isActive` and `isPostable`; the target differs from the line's current account. Each refusal is a coded error naming its reason; none writes anything
- [x] 2.3 Then write: `line.account = account`, `line.glAccount = account.code`; persist one `ApprovalLog` (`stepNo = document.currentStepNo`, `approver`, `delegatedFrom`, `action = RECODE_ACCOUNT`, `remark = "line <n>: <old code> → <new code>"`, `actedAt`) in the same transaction. Touch nothing else on the line, no `budget_txn`, no `quota_usage`
- [x] 2.4 Return `{ lineNo, from: { id, code }, to: { id, code } }` so the endpoint can answer without a second read
- [x] 2.5 Register the service in `document.module.ts`; confirm the document module already imports what it needs from the approval module (`DocumentRouteService`, `ApproverResolverService`) without a circular import — if it does not, export them from `ApprovalWorkflowModule` the way `applicableSteps` is reached today

## 3. Endpoint and detail read

- [x] 3.1 `POST documents/:id/lines/:lineNo/recode-account` on `document.controller.ts`, `@RequirePermissions(DOC_LINE_RECODE)`, `ApiKeyDenyGuard` like `actions`, body DTO `{ accountId: uuid }` with class-validator; `lineNo` via `ParseIntPipe`
- [x] 3.2 Detail read (`document.service.ts`, beside `slipRequired` / `canRestateRate`): add `accountRecodeAllowed` (the current route step's `allowsAccountRecode`) and `canRecodeAccount` (`IN_APPROVAL` && allowed && the viewer is eligible for the current step — reuse whatever `can-act` reads; do not add a second eligibility rule). Add both to the detail response type
- [x] 3.4 `GET /accounts/selectable` accepts `DOC_LINE_RECODE` as well as `COA_VIEW` (`RequireAnyPermission`), with a guard spec — found on the first live try: the accountant's picker was empty
- [x] 3.3 Approval-log read surface (`approval.controller.ts` `approval-log`): confirm a `RECODE_ACCOUNT` row comes back in the same shape as `RESTATE_RATE` with `remark`; widen `docs/claim-integration.md` if it enumerates actions

## 4. Posting reads the posted document's line first

- [x] 4.1 In `gl-posting.service.ts` `expenseByAccount`: load the lines of `documentId` once, keyed by `lineNo`; per charged line take `posted.get(l.lineNo)?.account ?? l.account ?? l.budget?.account`. When `documentId === chargedId` the map is the same lines and behaviour is unchanged — state that in the comment
- [x] 4.2 Keep the `budgetHasNoAccount` failure path and its `blocked_by_budget_id` exactly as it is when all three reads are null
- [x] 4.3 Read `stockPortionByAccount` once more and confirm its own-first order matches 4.1, so the GRNI split and the expense side key the same accounts; no code change expected

## 5. Step configuration carries the flag

- [x] 5.1 Add `allowsAccountRecode?: boolean` (`@IsBoolean() @IsOptional()`) to the create and update step DTOs in `back/src/modules/approval/dto`, defaulting to false on create
- [x] 5.2 Persist and return it in `workflow-config.service.ts` (create, update, read) inside the existing transaction and company resolution, beside `requiresPaymentSlip`
- [x] 5.3 `shared/src/index.ts`: add `allowsAccountRecode: z.boolean().default(false)` to the step schema next to `requiresPaymentSlip` so client and server do not drift; rebuild `@erp/shared`

## 6. Backend tests

- [x] 6.1 `document-line-recode.spec.ts` (DB-backed, shape of `mid-approval-slip.spec.ts`): the happy path writes `account_id`, `gl_account` and one `RECODE_ACCOUNT` log row and nothing else — assert `budget_id`, every amount, `budget_txn` count, `item_company.default_gl_account`, `budget.account_id` unchanged
- [x] 6.2 Every refusal in the design's order, each asserting no line change and no `approval_log` row: not in approval (DRAFT, COMPLETED); step flag off; flag turned on at `workflow_step` after submit is not read; ineligible user; eligible user without `DOC_LINE_RECODE` (controller/guard test); a `journal_entry` already names the document; zero-amount line; account inactive / not postable / other company; same account
- [x] 6.3 **Concurrency test:** a recode racing the final APPROVE on the last step — run both concurrently; assert either (recode committed → the accrual entry debits the recoded account) or (approval committed → recode refused as not in approval); never an entry on a pre-recode account with the line since changed
- [x] 6.4 **Concurrency test:** two recodes of one line racing — both commit, the line carries the later one, two log rows in that order
- [x] 6.5 `gl-posting` tests for the four new gl-journal scenarios: re-coded line on a chained DISB debits the new account; a DISB's own differing stamp outranks the PR's; a DISB line with no stamp falls back to the PR's; a non-chained document with one re-coded line posts both accounts and balances
- [x] 6.6 Route test: submit copies `allows_account_recode` onto `document_approval_step`; step-config tests: round-trips create/update/read, omitted stores false, other company refused
- [x] 6.7 Detail read test: `accountRecodeAllowed` / `canRecodeAccount` for an eligible viewer, an ineligible viewer, a step with the flag off, a completed document
- [x] 6.8 Run `DB_PORT=5433 DB_NAME=erp_test pnpm -C back test` under Node 22 (`nvm use`) and confirm green

## 7. Web: step editor and workflow detail

- [x] 7.1 `WorkflowStepCreateView.vue`: add the `allowsAccountRecode` `<FormField>` + `ToggleSwitch` beneath the slip one, `v-can="'WORKFLOW_MANAGE'"`, `data-testid="allows-recode-field"`, helper text in the approver's terms (which account each line is expensed to; budget and amounts do not move; every change is in the history)
- [x] 7.2 Add the "your configured approver holds no `DOC_LINE_RECODE`" notice, computed like the slip's `PAYMENT_MANAGE` check against `cfg.roles`, shown without refusing the save
- [x] 7.3 Zod schema for the step form: `allowsAccountRecode: z.boolean().default(false)` (from `@erp/shared` if the form already uses the shared step schema); `api/docConfig.ts` types carry it
- [x] 7.4 `WorkflowDetailView.vue`: show the allowance per step beside the evidence requirement
- [x] 7.5 Spec: extend `step-slip-requirement.spec.ts` or add `step-recode-allowance.spec.ts` covering default off, authored on, and the notice

## 8. Web: document detail

- [x] 8.1 `api/documents.ts`: add `accountRecodeAllowed`, `canRecodeAccount` to the detail type; add `recodeLineAccount(documentId, lineNo, accountId)`
- [x] 8.2 `DocumentDetailView.vue`: on the lines table's GL column, when `canRecodeAccount && can('DOC_LINE_RECODE')` render the code with an edit affordance that opens a small dialog: an account `Select` (from `api/accounts.ts`, filtered `isPostable && isActive`, showing code — name), the current account shown, confirm/cancel; on success refetch the detail; on failure show the server's message
- [x] 8.3 When `accountRecodeAllowed` is false on an `IN_APPROVAL` document and the viewer can act, state that this step does not allow re-coding; when the viewer cannot act, say nothing
- [x] 8.4 Approval history: add `RECODE_ACCOUNT` to the `action` label map and render `remark` for it (as for `RESTATE_RATE`), in `la`, `en`, `zh`
- [x] 8.5 i18n keys for the field, helper, notice, dialog, refusal reasons and the history label in `la`, `en`, `zh`; keep amounts as strings throughout
- [x] 8.6 Vitest spec for the detail: control offered to the eligible permitted viewer, absent without the permission, absent with the flag off with the reason shown, server refusal rendered and line unchanged

## 9. Wrap-up

- [x] 9.1 Fold the deltas into the source specs (`approval-workflow`, `document-engine`, `gl-journal`, `web-doc-config`, `web-approvals`) — the slip and stamped-account deltas were archived without folding, so fold those two alongside where this change's text depends on them
- [x] 9.2 Deploy notes: migration → `permissions:sync` → release on both `origin` and `production`; then, through the admin screens, turn the flag on for HAL's accounting step(s) and grant `DOC_LINE_RECODE` to the accounting role(s) — an operational step, not a migration

## Deploy runbook (9.2)

1. Push to `origin` (test) and `production` — each deploy runs `migration:up` then `permissions:sync`
   (`.github/workflows/deploy.yml`); `Migration20260911000000` adds the two columns and widens the
   `approval_log` check, and the sync creates the `DOC_LINE_RECODE` row.
2. Verify: `GET /api-new/admin/permissions` (or the startup log) reports no missing code.
3. In the admin UI, as `WORKFLOW_MANAGE`: open each disbursement workflow → the accounting step →
   turn on "ໃຫ້ຂັ້ນນີ້ແກ້ໄຂເລກບັນຊີ…" (allowsAccountRecode). Documents submitted after this carry it.
4. In RBAC admin: grant `DOC_LINE_RECODE` to `ຫົວໜ້າບັນຊີ` and/or `ພະນັກງານ (ບັນຊີ)` — HAL's call.
5. Documents already in approval keep their recorded route (no recode on them); a RETURN + resubmit
   picks up the flag.

