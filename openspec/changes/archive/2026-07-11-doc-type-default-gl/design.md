## Context

`pr-gl-account-autofill` made an item-backed line resolve its budget from the item's GL +
department + fiscal year (the unique `budget` key). An item-less line still requires an
explicit `budgetId`. `line-item-budget-enforcement` then made every positive line on a
`requires_budget` type need a budget. So a free-text line always costs the requester a budget
pick. `document_type` is global (no `company_id`), so it cannot carry a `budget_id` (budgets
are per company/department/year) — but it can carry a **GL code**, exactly like
`item.default_gl_account`, and the existing per-company resolver turns that code into a
budget at document time.

## Goals / Non-Goals

**Goals:**
- A `document_type.default_gl_account` that lets an item-less line auto-resolve its budget.
- Requester types description + amount only; no budget pick when the default resolves.
- Reuse the existing GL→budget resolver; no new resolution logic.

**Non-Goals:**
- No `default_budget_id` on `document_type` (impossible for a global, company-agnostic row).
- No validation of the GL code against a company chart-of-accounts at config time (accounts
  are per company; the code is a plain string like `item.default_gl_account`). Resolution to
  a real budget happens per document.
- No change to reservation, GL posting, or the item-backed line path.

## Decisions

- **Store a GL code, resolve per document.** `default_gl_account varchar` (nullable) on
  `document_type`. At line write, an item-less line uses it as the GL and resolves the budget
  via the same `(fiscal_year, department, gl_account)` unique key as items. Alternative
  (default budget id) is impossible for a global type row.
- **Precedence: explicit pick → type default → nothing.** If the line carries a `budgetId`,
  it wins (requester override). Else if the type sets `default_gl_account`, resolve from it.
  Else the line has no budget (the manual picker / submit-coverage rule applies).
- **Type-default resolution is best-effort, NOT blocking.** Unlike an item-backed line
  (rejected when its GL resolves no active budget), an item-less line whose type default does
  not resolve simply degrades to the manual picker; the submit-time coverage rule still
  rejects a positive budget-less line. Rationale: an item is an explicit "buy this" selection
  (a missing budget is a real error), whereas the type default is a background convenience —
  degrading gracefully beats blocking draft save on a setup gap.
- **GL still stamped from the default even without a budget.** An item-less line with a type
  default sets `gl_account` to that default (useful for later posting) whether or not a budget
  resolves; an explicit `budgetId` instead stamps the GL from the chosen budget.
- **Client mirrors the server.** The wizard, given the type's `default_gl_account` and the
  loaded selectable budgets, treats an item-less line whose default GL matches a budget like
  an item line: shows the resolved budget read-only, hides the picker, and does not flag it
  for a missing budget. When it does not match, the picker returns. UX-only; server
  authoritative.

## Risks / Trade-offs

- **A type default GL with no matching budget in a department** → the line degrades to the
  manual picker and, if left empty and positive, is rejected at submit with the existing
  coverage message. No silent budget-less spend.
- **Client and server disagree on whether the default resolves** (client only has the loaded
  budget list) → worst case the client shows the picker while the server would have resolved,
  or vice-versa; the server stays authoritative and re-resolves at write/submit, so this
  degrades to a clear message, never a wrong charge.
- **Stale GL on a line when the requester later picks a different budget** → the explicit
  `budgetId` path re-stamps `gl_account` from the chosen budget, so precedence keeps them
  consistent.

## Migration Plan

- Add `default_gl_account` to `erp_approval_system.dbml` and a migration adding a nullable
  column (no backfill; existing rows → null → unchanged behavior).
- Deploy backend + frontend together. Rollback drops the column / reverts the resolution
  branch; no document data changes.

## Open Questions

- Should the config UI validate the GL code shape (e.g. numeric) or offer a picker sourced
  from a reference chart? Current scope: a free-text GL-code field mirroring the item master.
  Revisit if admins want a guided picker.
