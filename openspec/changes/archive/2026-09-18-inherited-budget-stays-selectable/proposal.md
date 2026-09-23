## Why

A PR raised in ADM charges ADM's budget; the PO raised from it in Procurement inherits that
budget on every line — correctly, and the server accepts it. But when Procurement opens the PO
draft to enter prices, the wizard's budget picker offers only the budgets *Procurement* may
charge, ADM's is not among them, and the line is flagged "the budget this line was saved with is
no longer available — choose another", which blocks the step. The only way through was to mark
ADM's budget as shared with the whole company — a workaround that reclassifies the plan to get
past a picker. The rule should be: a document keeps the budgets it inherited, whoever edits it.

## What Changes

- The selectable-budgets read accepts an optional `documentId`. When given, it also returns
  every `ACTIVE` budget currently carried by that document's `document_line` rows (active company
  only), each flagged `inherited: true` unless the caller could select it anyway. Identity only —
  no amounts, as before.
- The create/edit wizard passes the draft's id when editing, so an inherited budget is offered
  back and the "budget unavailable" gate does not fire for it. The line editor shows inherited
  budgets in their own group, labelled as coming with the document.
- Nothing else widens: a Procurement user still cannot pick a *different* ADM budget the PR did
  not name; the server still never validates a line's budget against the editor's department
  (it never did — the block was client-side).

Not in scope: letting a child department charge its parent's budgets in general; changing what
the server accepts on `setLines`.

## Capabilities

Touches `budget-control` (selectable read) and `web-documents` (line editor). Invariants: 1
respected — the document must belong to the active company; no ledger write; no amount leaves the
read.

### New Capabilities

(none)

### Modified Capabilities

- `budget-control`: Selectable Budgets for Document Creation — gains the `documentId` widening
  and the `inherited` flag.
- `web-documents`: Per-Line Budget Selection in the Create Wizard — an inherited budget stays
  selectable on a draft; shown in its own group.

## Impact

- **Backend**: `budget.service.ts` (`listSelectable(departmentId?, documentId?)`),
  `budget.controller.ts` (query param), `SelectableBudget` wire type (+`inherited?`).
- **Frontend**: `api/budgets.ts`, `CreateDocumentView.vue` (pass `editId`),
  `LineItemsEditor.vue` (group + tag), i18n en/la/zh.
- **API**: `GET /budgets/selectable?documentId=…` — additive.
- **Operations**: after deploy, the "shared" mark put on ADM's budget as a workaround can be
  removed.
