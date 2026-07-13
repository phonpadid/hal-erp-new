## Why

On a budget-controlled type that allows free-text (item-less) lines — utilities, petty
cash, reimbursements — the requester still has to pick a budget for every line, because a
line with no item has no GL to resolve from. Many such types always charge the same GL
(e.g. a "Utility Payment" type always hits `5210`). Letting the **document type** carry a
default GL means the requester just types the description and amount, and the server
resolves the budget the same way it does for items — closing the last case where a
requester touches budget selection.

## What Changes

- Add an optional `default_gl_account` to `document_type` (new column). When set, an
  **item-less** line of a `requires_budget` document resolves its `budget_id` from that GL +
  the document's department + fiscal year — the same resolver used for items — and stamps
  the line's `gl_account` from the type default.
- Resolution is **best-effort and non-blocking**: an explicitly chosen `budgetId` still wins,
  and if the type default resolves no active budget the line degrades to the manual picker
  (the submit-time budget-coverage rule from `line-item-budget-enforcement` still applies).
  This differs from an item-backed line, which is rejected when its GL resolves no budget.
- Expose `default_gl_account` in the document-type admin (a GL-code field, like the item
  master's default GL).
- In the Create wizard, an item-less line whose type default GL resolves shows the resolved
  budget read-only (like an item line) instead of the picker, and is not flagged for a
  missing budget.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: `document_type` gains `default_gl_account`; item-less line resolution
  uses it (best-effort) to derive GL + budget before falling back to an explicit pick.
- `web-doc-config`: the document-type admin can set `default_gl_account`.
- `web-documents`: the Create wizard shows the type-default-resolved budget read-only for an
  item-less line and does not require a manual pick when it resolves.

## Impact

- **Schema**: add `default_gl_account varchar [null]` to `document_type` in
  `erp_approval_system.dbml` + a migration; add the field to the `DocumentType` entity.
- **Backend**: `Create/UpdateDocumentTypeDto` accept `defaultGlAccount`; the doc-type
  service persists it and the creatable-types read returns it; `DocumentService.writeLines`
  resolves an item-less line's budget from the type default (best-effort) before the explicit
  `budgetId` fallback. New unit tests.
- **Frontend**: doc-type form adds a `default_gl_account` field (shared Zod schema updated);
  `LineItemsEditor` / `CreateDocumentView` treat a resolvable type default like an item's
  resolved budget (read-only, not flagged).
- **Invariants**: reinforces invariant 7 (behavior from `document_type` config). No change to
  reservation/GL posting; budget balance is still derived (invariant 3). Backward compatible:
  `default_gl_account` is nullable/absent by default, so existing types behave exactly as
  today.
