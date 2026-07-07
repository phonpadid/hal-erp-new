## Context

Budget-controlled documents (`document_type.requires_budget = true`) require each line to
carry a `budget_id` before submit (invariant 4; `budget-control` "Reserve on Submit"). The
requester of such a document therefore must be able to *select* a budget while filling the
Create Document wizard.

Current state:
- Backend `GET /budgets` (and `:id`, `:id/balance`, `:id/breakdown`, `:id/ledger`) are all
  gated by `BUDGET_VIEW` ([budget.controller.ts](../../back/src/modules/budget/budget.controller.ts)).
- The wizard computes `canBudget = auth.can('BUDGET_VIEW')` and both the `/budgets` fetch
  and the per-line budget column depend on it ([CreateDocumentView.vue](../../front-end/src/views/documents/CreateDocumentView.vue)).

Consequence: a `DOC_CREATE` requester who lacks `BUDGET_VIEW` sees no budget selector and
cannot submit; granting `BUDGET_VIEW` to fix it over-exposes balances, breakdowns, and
ledgers. `BUDGET_VIEW` is intentionally a finance-officer read (`budget-control` requirements
"Derived-Balance Breakdown Query", "Append-Only Ledger Read"); document creation should not
be coupled to it.

Constraint: the fix must not become a side channel that leaks the financial figures
`BUDGET_VIEW` protects, and it must stay company-scoped (invariant 1) and authorize on a
permission code (invariant 6).

## Goals / Non-Goals

**Goals:**
- Let a `DOC_CREATE` user retrieve the minimal set of budgets they can charge a line to,
  without holding `BUDGET_VIEW`.
- Return only selection fields (`id`, `budgetName`, `glAccount`); expose no amount, balance,
  breakdown, or ledger data.
- Keep the selection scoped to the active company and to selectable (`ACTIVE`) budgets.
- Repoint the wizard's per-line budget picker at this read so it appears for budget-
  controlled document types under `DOC_CREATE`.

**Non-Goals:**
- Changing who can view budget balances/ledgers — `BUDGET_VIEW` reads stay exactly as they are.
- Any change to reservation, over-limit policy, or the `budget_txn` ledger.
- Any data-model change — `document_line.budget_id` already exists; no new tables/columns.
- Server-side submit enforcement changes — submit already rejects a budget-controlled
  document with no budgeted lines; that stays authoritative.

## Decisions

**D1 — New dedicated read endpoint, not a relaxed `GET /budgets`.**
Add `GET /budgets/selectable` gated by `DOC_CREATE`, returning a trimmed projection. Rejected
alternative: loosening `GET /budgets` to `DOC_CREATE` or making its response permission-
dependent — that couples two audiences on one route and risks a projection bug leaking
amounts to `DOC_CREATE`-only users. A separate route whose query never selects amount columns
makes "no balance data" a structural property, not a filter that can regress.

**D2 — Projection excludes all money fields at the source.**
The selectable read returns `{ id, budgetName, glAccount }` (plus whatever the client needs to
label/scope). It does not populate `amount_total` or compute a derived balance, so there is no
amount to accidentally serialize. This keeps `BUDGET_VIEW`'s protection intact by construction.

**D3 — Scope through `fiscalYear.company`, mirroring existing budget reads.**
`budget` has no `company_id`; the existing list/get scope through `fiscalYear.company`
(`budget-control` "Company-Scoped Budget Reads"). The selectable read reuses that exact scope
and forks its own EntityManager (`budget-control` "Context-Safe Budget Reads"), so a budget in
another company is never returned.

**D4 — Filter to `status = 'ACTIVE'`.**
Only selectable budgets should appear in a picker; charging a line to an inactive budget is a
data-quality error caught late at submit. Returning only `ACTIVE` budgets keeps the picker
honest. (The full `GET /budgets` list keeps returning all statuses for administration.)

**D5 — Frontend decouples `canBudget` from `BUDGET_VIEW`.**
The wizard sets the per-line budget affordance from `DOC_CREATE` (the create permission the
view already requires) and fetches the picklist instead of `/budgets`. Because the picker only
shows for budget-controlled types and the user is already a creator, no extra permission is
needed. The Budgets pages (`web-budgets`) are untouched and stay `BUDGET_VIEW`-gated.

## Risks / Trade-offs

- **Enumeration of budget names/GL to any creator** → Acceptable: names and GL codes are
  organizational reference data a requester must see to file a document, and no amounts are
  exposed. Scope still limits it to the active company.
- **Two budget-list endpoints to keep in sync** → Mitigation: the selectable read is a thin
  projection over the same entity and company-scope helper; a test asserts its response shape
  contains no amount/balance keys so drift that re-introduces money is caught.
- **A creator could select an inactive/depleted budget conceptually** → Unchanged risk:
  submit already validates budget existence and over-limit policy authoritatively; the picker
  is UX only and now additionally hides inactive budgets.

## Migration Plan

- Additive change: new route + new frontend fetch path; no migration, no breaking change to
  existing `BUDGET_VIEW` routes. Deploy backend first (endpoint available), then frontend.
- Rollback: revert the frontend to `BUDGET_VIEW`-gated fetch; the new endpoint is inert if
  unused. No data to unwind.

## Open Questions

- Route naming: `GET /budgets/selectable` vs `GET /budgets?forDocument=1`. Leaning to a
  distinct path (D1 rationale). Confirm at apply time against existing route conventions.
- Whether to further scope the picklist by the document's department/fiscal year at creation
  time. Deferred: the current wizard offers all active company budgets; narrowing can be a
  follow-up once the department/period is known on the draft.
