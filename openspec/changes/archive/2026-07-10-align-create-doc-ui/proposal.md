## Why

Two shipped changes moved the server ahead of the Create Document UI, so the wizard no
longer mirrors what the server does (CLAUDE.md: the client guard is UX; it must not drift
from the server):

- `pr-gl-account-autofill`: the requester picks the item and the server derives GL + budget;
  the explicit budget picker is only a fallback for item-less lines.
- `line-item-budget-enforcement`: `document_type.requires_item` forbids item-less lines, and
  every positive-amount line on a `requires_budget` type must resolve a budget.

Today the wizard gates the budget affordance on the `DOC_CREATE` permission alone
(`canBudget = auth.can('DOC_CREATE')`), so a budget picker appears on item-less lines of
**every** type — even non-budget types — and nothing reflects `requires_item`. A requester
only learns of a missing item or a budget-less line when the server rejects the submit.

## What Changes

- Show budget affordances (the item-less fallback picker and the resolved-budget chip) only
  when the selected type has `requires_budget`; a non-budget type shows no budget control.
- When the selected type has `requires_item`, mark the line item picker as required and
  block save/submit client-side on any item-less line, surfacing the reason inline
  (mirroring the server reject).
- Mirror complete budget coverage client-side: on a `requires_budget` type, a positive-amount
  line with no item **and** no selected budget is flagged inline before submit.
- Consume the `requiresItem` flag now returned by the creatable-types read.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-documents`: the Create Document wizard gates budget affordances on
  `requires_budget`, enforces the item requirement client-side when `requires_item`, and
  flags a positive budget-less line before submit — keeping the wizard in step with the
  server's item/budget rules.

## Impact

- **Frontend only** — no backend, DTO, or schema change. `CreateDocumentView.vue` passes the
  selected type's `requiresBudget` / `requiresItem` into `LineItemsEditor.vue`; the editor
  gates the budget UI on `requiresBudget` and marks the item required under `requiresItem`;
  the wizard's line validation adds the item-required and budget-coverage checks. New i18n
  strings for the inline messages.
- **Invariants**: reinforces the client/server parity rule (CLAUDE.md frontend conventions) —
  the client validation mirrors the server rules from the two prior changes and remains
  UX-only; the server stays authoritative.
