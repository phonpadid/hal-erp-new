## Context

`document_type` drives behavior via flags (`requires_budget`, `requires_quota`,
`requires_vendor`, `post_action`). Two completeness rules are missing. First, there is no
`requires_item` flag, so a procurement-goods line can be saved as free text even though it
needs an item for receiving / 3-way matching. Second, the submit guard rejects a
`requires_budget` document only when it has **zero** budgeted lines
([document-submit.service.ts](../../back/src/modules/document/document-submit.service.ts):
`reserveLines.length === 0`), so a mixed document with one budget-less line submits and that
line reserves nothing — money committed without cutting budget. Both are config/enforcement
gaps, not schema-model gaps beyond one new flag.

## Goals / Non-Goals

**Goals:**
- A per-type `requires_item` flag that, when set, forbids item-less lines.
- On a `requires_budget` document, every money-bearing line must resolve a budget.
- Keep everything config-driven (invariant 7); default-off so existing types are unchanged.

**Non-Goals:**
- No change to how budget amounts are reserved/released (invariants 3–5) or to GL/budget
  resolution (that is the prior `pr-gl-account-autofill` change).
- Not making `requires_item` and `requires_budget` imply each other — they are independent
  flags an admin combines.
- No retroactive validation of already-submitted documents.

## Decisions

- **Enforce both rules at submit, not at draft save.** Mirrors the existing
  `requires_vendor` gate: a draft may be saved incomplete, and submit is where completeness
  is enforced — before any budget/quota hold is taken, so a rejected submit leaves the
  document DRAFT. Alternative (reject at line save) would block incremental draft editing
  and diverge from how vendor/required-field completeness already works.
- **`requires_item`: every line must carry an `item_id`.** When the type's flag is set,
  submit rejects if any line has no item, naming the offending line. Alternative (only lines
  with an amount) rejected — an item-less line on an item-mandatory type is always a data
  error regardless of amount.
- **Complete budget coverage targets money-bearing lines.** On a `requires_budget` type,
  submit rejects when any line with `line_amount > 0` has no resolved `budget_id`. Zero-
  amount lines (informational/discount placeholders) reserve nothing and are allowed
  budget-less, so the rule targets exactly the leak — a positive line that would commit
  money without a reservation. This replaces the `reserveLines.length === 0` check.
- **New column, default false, NOT NULL.** `requires_item boolean default false` on
  `document_type`, added to the DBML and via migration. Default-off makes the change
  backward compatible: existing types behave exactly as before until an admin opts in.
- **The two rules compose.** With `requires_item` + `requires_budget` both set, every line
  has an item, so every line resolves a budget at write and the coverage rule is satisfied
  automatically; the coverage rule mainly guards `requires_budget` types that allow
  free-text lines.

## Risks / Trade-offs

- **A type flips to `requires_item` while old drafts hold free-text lines** → those drafts
  can't submit until fixed. Mitigation: the error names the line; the flag is opt-in and
  admins choose when to set it. Drafts stay editable.
- **The tighter budget rule rejects a document that submitted before** → only when it had a
  positive budget-less line, which was the latent money leak; rejecting it is the intended
  correction, surfaced with a clear per-line message.
- **Zero-amount line carve-out could be gamed** (a positive line split so a piece is zero) →
  not a real risk: any positive amount still needs a budget; a zero line reserves nothing.

## Migration Plan

- Add `requires_item` to `erp_approval_system.dbml` and generate a migration adding the
  column with `DEFAULT false NOT NULL`; backfill is implicit (all existing rows → false).
- Deploy backend (entity + DTO + submit guards) and frontend (admin toggle + filter)
  together. No data backfill beyond the column default.
- Rollback: drop the column / revert the guards; no document data changes since only new
  submits are affected.

## Open Questions

- Should `requires_item` also gate the *item picker requirement* in the create wizard (hide
  the free-text-only path) as UX, beyond the server reject? Current scope is server
  enforcement + admin config; the wizard can surface the reject. Revisit if requesters need
  an earlier client-side block.
