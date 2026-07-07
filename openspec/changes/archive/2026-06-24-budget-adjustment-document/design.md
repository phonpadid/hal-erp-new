## Context

The on-approval half of budget adjustment already exists: `PostActionService.adjust` reads the
document's `budget_movement` and calls `BudgetLedgerService.executeAdjustment`, which writes one
`ADJUST_INCREASE` / `ADJUST_DECREASE` under `PESSIMISTIC_WRITE` inside `em.transactional`. What is
missing is the front of the flow:

- **No `budget_movement` is ever created** — there is no `em.create(BudgetMovement, …)` anywhere, so
  `adjust()` would throw `No budget_movement for document …`.
- **No adjustment `document_type`** — seed configures only `CUT_BUDGET`. `post-action.service`
  branches on the type's `post_action` string, so direction must come from there.
- **No UI** — `BudgetDetailView` only displays balance + ledger.

`budget_txn.document_id` is `NOT NULL` (DBML) and `budget_txn` is append-only, so an adjustment must
be tied to a document and the txn must be written exactly once, on approval. The user has chosen the
spec-aligned, approval-gated path (not a direct `POST /budgets/adjust`). Transfer is the sibling with
the same missing front-of-flow; this change scopes to adjustment only.

## Goals / Non-Goals

**Goals**
- An authorized user can start a budget adjustment from the budget screen; it becomes an approvable
  document and, on full approval, raises/lowers the budget via a single ADJUST txn.
- Direction (increase/decrease) is configuration (`post_action`), not hardcoded.

**Non-Goals**
- No direct, approval-bypassing adjust UI; no change to the manual `POST /budgets/adjust` stopgap.
- No transfer UI (separate change). No DBML/schema migration.
- No change to the derived-balance formula or append-only rules.

## Decisions

**Decision: a create-adjustment endpoint on the budget module.**
`POST /budgets/:id/adjustments` with body `{ direction: 'INCREASE' | 'DECREASE', amount: string,
reason: string }`, guarded by `BUDGET_MANAGE`. In one `em.transactional`, it:
1. resolves the adjustment `document_type` for `direction` (see below) and the budget's department,
2. issues a document number (reuse `NumberingService`, `PESSIMISTIC_WRITE`) and creates the `document`
   in DRAFT for the active company, pinning the dept's template + workflow via `DeptDocTypeService`,
3. creates the `budget_movement` (`to_budget` = the target budget, `amount`, `reason`,
   company = active company),
4. returns the new document id.
It writes **no** `budget_txn` row. The client then routes to the document and submits it; the
existing submit → approval → `PostActionService.adjust` chain writes the single ADJUST on full approval.
- *Alternative — extend the generic document create (`CreateDocumentView` / `createDraft`)*: rejected;
  the generic path is field/line based and has no concept of a `budget_movement`. A dedicated
  endpoint keeps the movement creation atomic and the budget-screen UX direct.

**Decision: two adjustment document types, direction via `post_action`.**
Seed `BUDGET_ADJ_INC` (`post_action = ADJUST_INCREASE`) and `BUDGET_ADJ_DEC`
(`post_action = ADJUST_DECREASE`), each mapped (`dept_doc_type`) to a department + approval workflow.
The endpoint picks the type by `direction`. This honors invariant 7 (behavior from configuration) and
needs no change to `post-action.service`, which already switches on the `post_action` string.
- *Alternative — one type + direction on the movement*: would require `adjust()` to read direction
  from the movement instead of `post_action`; more code change for no real benefit.

**Decision: gate the create endpoint with `BUDGET_MANAGE`.**
The action is initiated from the budget screen and is a budget operation, matching the user's intent
and the existing `BUDGET_MANAGE` transfer/adjust endpoints. Approval itself remains permission-gated
by the workflow, and no-self-approval is enforced by the approval engine — so an over-broad creator
still cannot unilaterally raise a budget.

**Decision: frontend dialog with a Zod schema.**
`BudgetDetailView` gets an Adjust button (`v-can="'BUDGET_MANAGE'"`) → dialog with direction
(SelectButton/RadioButton), amount (InputText/InputNumber kept as string), reason (Textarea). One Zod
schema validates `{ direction, amount: positive decimal string, reason: non-empty }`; on success it
calls `budgetsApi.createAdjustment(id, …)` and routes to `document-detail`.

## Sequence note (touches `budget_txn`)

Creation transaction: `document` + `budget_movement` only — **no `budget_txn`**. The ADJUST txn is
written later, by `PostActionService.adjust` → `executeAdjustment`, inside the approval's
`em.transactional` under `PESSIMISTIC_WRITE` on the budget row. Thus the ledger is written exactly
once, on full approval, preserving append-only + approval-gating.

## Risks / Trade-offs

- [Which department/workflow approves the adjustment?] → Use the budget's `department` (a budget
  belongs to a fiscal year + department); the adjustment doc type must be enabled for that department
  with a workflow. Seed wires this for the demo company. → Mitigation: if no mapping exists, the
  create endpoint returns a clear error rather than creating an unroutable document.
- [Amount precision] → carried as a Decimal/string end to end; never a JS number (DTO uses
  `@IsNumberString`, client keeps a string).
- [Company isolation] → both `document` and `budget_movement` are created for the active company and
  the target budget is verified to belong to it before creating the movement.
- [Decrease below available] → out of scope to hard-block at creation; the spec blocks transfers on
  insufficient balance but adjustment decrease policy is not specified. Flagged as an open question;
  default is to allow creation and let approval/policy decide.

## Migration Plan

Backend code + idempotent seed additions (upsert the two adjustment doc types + their dept/workflow
mappings). No DB migration. Rollback = revert the endpoint/service/UI; seeded config is inert if the
UI is removed.

## Open Questions

- Should a decrease be rejected at creation when it would push available below zero, or only flagged?
  (Default: allow; revisit if a policy is specified.)
- Which approval workflow should the seeded adjustment types use — the same one as PR, or a dedicated
  budget-control workflow? (Default: reuse the demo company's existing workflow.)
