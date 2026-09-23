## 1. Backend

- [x] 1.1 `budget.service.ts`: `listSelectable(departmentId?, documentId?)` — when `documentId` is given, read `document_line.budget` for that document in the active company; union ACTIVE ones into the result with `inherited: true` unless already in the caller's set
- [x] 1.2 `budget.controller.ts`: accept `documentId` query param (`ParseUUIDPipe` optional); `SelectableBudget` type gains `inherited?: boolean`
- [x] 1.3 Tests in a new `selectable-inherited.spec.ts` (DB-backed): inherited returned + flagged; sibling ADM budget not returned; own-department budget unflagged; inactive excluded; other-company document adds nothing

## 2. Frontend

- [x] 2.1 `api/budgets.ts`: `selectable(departmentId?, documentId?)`; `SelectableBudget.inherited?`
- [x] 2.2 `CreateDocumentView.vue`: pass `editId` when editing so inherited budgets are in `budgets`
- [x] 2.3 `LineItemsEditor.vue`: group inherited budgets first under `documents.create.line.inheritedBudgets`; tag the option
- [x] 2.4 i18n en/la/zh: `inheritedBudgets` group label
- [x] 2.5 Tests: extend the line-editor grouping spec (inherited group first, no `budgetUnavailable` for an inherited budget); wizard spec asserting `selectable` is called with the edit id

## 3. Verification

- [x] 3.1 Backend + frontend tests, `openspec validate`
- [x] 3.2 Dev stack: as the sandbox requester, open a successor draft carrying a budget outside their department — picker shows it under the inherited group, step proceeds
