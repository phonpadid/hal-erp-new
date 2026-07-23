## Why

A reference chain (`PROC → PO → DISB`) is one purchase, but every budget-controlled document in it
took its own RESERVE while settlement only ever converts **one** of them — the reserving ancestor —
so the duplicate hold stayed on the budget forever with no release path (a COMPLETED document is
never auto-released). A 50,000 purchase in the live company charged the budget 100,000 and stranded
half of it. The rule that prevents this exists only in code and tests today; writing it into the
specs is what stops it from being refactored back out.

## What Changes

- A budget-controlled document SHALL NOT reserve a budget that a ref-chain ancestor is still
  holding an outstanding RESERVE on — one hold per chain, taken by the first document in the chain
  to submit, converted to ACTUAL when the settling document is approved.
- A successor whose ancestors hold nothing (never reserved, or already settled) still takes its own
  hold, so a standalone document is unaffected and no chain can be paid without cutting budget.
- The check reads and locks the budgets inside the submitting transaction, so a concurrent settle
  cannot release between the check and the insert.
- GL posting on payment settlement follows the same chain: when the paid document carries no
  ACTUAL of its own it SHALL use the nearest ancestor's, instead of silently posting nothing.
- Create-from copies the predecessor line's `tax_code_id` along with its budget, so a successor's
  VAT total (and the Input VAT posted at payment) matches the predecessor's.
- No **BREAKING** change: existing single-document flows keep their current behavior.

## Capabilities

### New Capabilities
<!-- none: this constrains existing behavior rather than introducing a capability -->

### Modified Capabilities
- `budget-control`: adds the one-reservation-per-reference-chain rule to Reserve on Submit, and
  states that settlement converts the chain's single hold.
- `gl-journal`: Posting on Payment Settlement resolves the expense side from the chain's ACTUAL
  rows, which may belong to an ancestor of the paid document.
- `document-engine`: create-from copies the line's tax code, not only its budget.

## Impact

- Code: `back/src/modules/budget/budget-ledger.service.ts` (new `budgetsHeldByAncestors`),
  `back/src/modules/document/document-submit.service.ts` (skips a held budget),
  `back/src/modules/gl/gl-posting.service.ts` (chain-aware ACTUAL lookup),
  `back/src/modules/document/document.service.ts` (`createFrom` copies `taxCodeId`).
- Tests: `back/src/modules/document/chain-reservation.spec.ts` (new),
  `back/src/modules/gl/gl-posting.service.spec.ts`.
- No schema, migration, API-surface, or permission-code change.
- Invariants: reinforces invariant 3 (a chain is charged exactly once) and invariant 4
  (reserve → actual → release, with no hold left unconvertible). Invariant 2 holds — the fix
  writes fewer rows, never updates or deletes one.
- Existing data: rows stranded before this change are corrected by appending RELEASE rows, not by
  editing history.
