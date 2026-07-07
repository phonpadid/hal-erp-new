## Why

`approval-workflow` drives a submitted document through its bound workflow to a terminal
state and triggers the downstream money effects. document-engine pins a `workflow` at
submit and reserves budget/quota; this capability routes the document through
`workflow_step`s (by amount band and approval mode), records every action in the
append-only `approval_log`, enforces delegation safeguards (no self-approval, no chained
delegation — invariant 8), and on full approval runs the type's `post_action`: budget
`settle` (reserve → actual), transfer/adjustment execution, and employee updates. On
reject/return it releases the document's holds (invariant 4) via the engine's
`releaseDocumentHolds`.

## What Changes

- **`ApprovalWorkflowModule`** registering `workflow`, `workflow_step`,
  `approval_delegation`, `approval_log`, importing budget, multi-company, and
  document-engine to consume their services.
- **Workflow configuration** (`WORKFLOW_MANAGE`): CRUD for `workflow` + `workflow_step`
  (approver role/user, `amount_min`/`amount_max`, `approve_mode`, `sla_hours`) and
  `approval_delegation` records.
- **Routing**: `start` initializes routing on a SUBMITTED document → IN_APPROVAL at the
  first applicable step. **Applicable steps** are the bound workflow's steps whose
  `amount_min`/`amount_max` band contains the document's `base_total_amount` (so a CFO step
  above 500,000 is included only when warranted).
- **Approver resolution**: a step targets a specific user (`approver_user_id`) or a
  company **role** (`approver_role_id`) resolved to its current holders in the document's
  company via `user_company_role`. Active `approval_delegation` reroutes a pending item to
  the delegate (within amount-limit + doc-type scope + date range), logged with
  `delegated_from`.
- **Step completion by mode**: SEQUENTIAL / PARALLEL_ANY complete on the first approval;
  PARALLEL_ALL requires every eligible approver. Completion is derived from `approval_log`.
- **Delegation safeguards** (invariant 8): block approval when the acting user — or the
  delegator they act for — is the document's creator (no self-approval, directly or via
  delegation); a delegate's own delegation is never followed (no chaining).
- **Actions** (`DOC_APPROVE`): APPROVE advances/finishes routing; REJECT → `REJECTED` +
  release holds; RETURN → back to `DRAFT` + release holds (requester revises and
  resubmits, re-reserving from step 1); DELEGATE reassigns. Every action writes an
  append-only `approval_log` row.
- **Post-action engine**: on full approval set `APPROVED`, run `post_action` atomically
  with a bounded retry, then `COMPLETED`. Handlers: `CUT_BUDGET` → `settle` budget actuals
  per line; `TRANSFER` / `ADJUST_INCREASE` / `ADJUST_DECREASE` → execute the
  `budget_movement`; `UPDATE_EMPLOYEE` / `TERMINATE_EMPLOYEE` → set the related employee's
  status. A failed post-action rolls back the terminal transition, never leaving a stuck
  state.
- **SLA**: compute a step's working-hour due time via `WorkingTimeService` (skips weekends
  + company holidays) and an `escalate(documentId)` operation for overdue items.

No schema change — all four entities already match the DBML.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `approval-workflow`: adds the concrete routing/enforcement requirements the existing
  nine implied but did not pin down — the routing lifecycle + step completion, delegation
  & self-approval enforcement, append-only authorized actions with hold release, and
  atomic post-action execution. The nine existing requirements are unchanged.

## Impact

- **Affected capability**: `approval-workflow` (unblocks notifications, which reacts to
  pending/overdue/terminal events).
- **Invariants exercised**: **2** (append-only `approval_log`), **8** (no self-approval,
  no chained delegation), **4** (reject/return release holds), **7** (post_action from
  config), **1** (company-scoped routing), **5** (`WORKFLOW_MANAGE` / `DOC_APPROVE`).
- **Code**: new `back/src/modules/approval/` services, controllers, DTOs, module;
  consumes `BudgetLedgerService` (`settle` / `executeTransfer` / `executeAdjustment`),
  `DocumentSubmitService.releaseDocumentHolds`, and `WorkingTimeService`. Registered in
  `AppModule`.
- **New permission codes**: `WORKFLOW_MANAGE`, `DOC_APPROVE`.
- **Consumers (later)**: notifications listens for step-assignment, SLA-overdue, and
  reject/approve outcomes.

## Out of Scope

- The **scheduler** that periodically fires SLA escalation — this slice delivers the
  due-time computation + a manual `escalate`; the cron/queue lands with notifications.
- `condition_json` free-form workflow selection — the workflow is bound at submit
  (document-engine); routing here filters its steps by amount band.
- Async post-action retry **queues** — post-action runs inline with a bounded synchronous
  retry inside the approval transaction (atomic), which satisfies "no stuck state".
- `CREATE_PO` document generation (a document-engine reference-chain concern) — treated as
  a no-op post-action here.
