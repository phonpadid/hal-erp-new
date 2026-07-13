## Why

Two enforcement gaps let a budget-controlled document slip through incompletely:

1. **No way to require an item.** `document_type` has `requires_vendor` but no
   `requires_item`, so a procurement-goods line (which needs an item for receiving /
   3-way matching / stock) can be saved as free text — the "should have an item" rule is
   convention, not enforced.
2. **Budget coverage is only partial.** Submit rejects only when a `requires_budget`
   document has **zero** budgeted lines. A document with some budgeted lines and one
   budget-less line submits fine — that line silently reserves nothing, so money can be
   committed without cutting any budget (breaks the reserve-then-actual money rail).

This change makes both enforceable and config-driven (invariant 7).

## What Changes

- Add a `requires_item` flag to `document_type` (new column, default `false`). When true,
  every document line MUST carry an `item_id`; a free-text line is rejected at save/submit.
- Tighten the budget-coverage guard: on a `requires_budget` document, **every** line MUST
  resolve a budget. A line with no `budget_id` is rejected at submit (naming the line),
  replacing the weaker "at least one budgeted line" check.
- Expose `requires_item` in the document-type admin surface (create/edit + the requirement
  filter) alongside the existing flags.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: `document_type` gains a `requires_item` flag; line write and submit
  enforce mandatory items (when configured) and complete per-line budget coverage on
  budget-controlled documents.
- `web-doc-config`: the document-type admin can set `requires_item` and filter the list by
  it, mirroring the existing `requires_budget` / `requires_quota` / `requires_vendor` flags.

## Impact

- **Schema**: add `requires_item boolean [default: false]` to `document_type` in
  `erp_approval_system.dbml` + a migration; add the field to the `DocumentType` entity.
- **Backend**: `CreateDocumentTypeDto` / `UpdateDocumentTypeDto` accept `requiresItem`; line
  writing rejects item-less lines when `requires_item`; submit rejects any budget-less line
  on a `requires_budget` type. New unit tests for both rules.
- **Frontend**: doc-type form adds a `requires_item` toggle; the requirement-flag filter
  adds an "item" option (shared Zod schema updated to match the DTO).
- **Invariants**: reinforces invariant 7 (behavior from `document_type` flags, not
  hardcoded) and the reserve-then-actual money rail (invariants 3–4) by closing the
  budget-less-line hole. No change to how reservations are computed. Backward compatible:
  `requires_item` defaults `false`, so existing types behave exactly as today until an
  admin opts in; the tighter budget-coverage rule only rejects documents that were already
  mis-charging (a budget-less line on a budget type).
