## Context

The Create Document wizard needs the active currency list to render its currency picker,
default to the company base currency, and format amounts / preview the converted base amount
([CreateDocumentView.vue](../../front-end/src/views/documents/CreateDocumentView.vue) →
`cur.loadCurrencies()`). Today the only list read is `GET /currencies`, gated by `CURRENCY_VIEW`
([currency.controller.ts](../../back/src/modules/currency/currency.controller.ts)). A
`DOC_CREATE` requester without `CURRENCY_VIEW` gets a 403.

`currency` is a group-global ISO 4217 registry (code is the PK; no `company_id`) with only
`code`, `name`, `symbol`, `decimal_places`, `is_active`. There is nothing company-scoped and
nothing financially sensitive — unlike budgets, whose balances `BUDGET_VIEW` protects. So this
is a pure permission-coupling fix, not a data-exposure concern.

This mirrors the just-shipped `add-budget-picklist` change: a create-wizard reference read that
should be reachable by document creators rather than admins.

## Goals / Non-Goals

**Goals:**
- Let a `DOC_CREATE` user fetch the active currencies (`code`, `name`, `symbol`,
  `decimalPlaces`) without holding `CURRENCY_VIEW`.
- Repoint the wizard's currency picker at this read.
- Keep the currency-admin surface (paginated list incl. inactive, create/update/deactivate)
  exactly as it is.

**Non-Goals:**
- Changing currency administration, rates, or rounding behavior.
- Any company scoping (currency is group-global by design).
- Broadening `GET /currencies` itself or changing who can view inactive currencies.
- Any data-model change.

## Decisions

**D1 — New dedicated read endpoint, not a relaxed `GET /currencies`.**
Add `GET /currencies/selectable` gated by `DOC_CREATE`, returning active currencies only.
Rejected alternative: loosening `GET /currencies` to also accept `DOC_CREATE` — that endpoint is
paginated and can return inactive rows (`includeInactive`), which is an admin concern; a
separate, active-only route keeps the two audiences and their query shapes cleanly apart.
Consistent with the budget-picklist precedent (D1 there).

**D2 — Active-only, trimmed projection.**
The read returns `{ code, name, symbol, decimalPlaces }` for `is_active = true` rows, ordered
by `code`. Currencies carry no sensitive fields, but returning only active rows keeps the picker
honest (a creator should not pick a retired currency) and the projection small.

**D3 — Reference `DOC_CREATE` from the document module.**
Import the `DOC_CREATE` code from the document permissions catalog rather than redefining it in
the currency module (invariant 6 — authorize on codes, single source of truth). Same approach as
the budget controller now uses.

**D4 — Frontend fetches the picklist for creation.**
The create wizard (via the currency store or a direct call) loads `/currencies/selectable`
instead of the admin list. The currency-admin views keep using the paginated `CURRENCY_VIEW`
list. Add a separate `selectableCurrencies` state + `loadSelectableCurrencies()` so the admin
list state and the creation picklist don't clobber each other.

**D5 — `useCurrencyFormat` uses the picklist too (implementation refinement).**
Discovered during apply: the shared `useCurrencyFormat` composable auto-loads the admin
`loadCurrencies()` (`CURRENCY_VIEW`) to resolve a currency's `decimal_places`, and the wizard
invokes it at setup — so that auto-load, not just the explicit wizard call, is the real source
of the reported `/currencies?limit=100` 403. Repoint the composable to `loadSelectableCurrencies()`
(a formatting helper only needs active currencies' decimal places, exactly what the picklist
provides) and have `decimalPlacesOf` read `selectableCurrencies` first, falling back to the admin
list. This is fallback-safe (base-currency formatting comes from `auth.baseCurrency`, and unknown
codes default to 2 dp) and leaves the admin currency pages untouched.

## Risks / Trade-offs

- **Currency names/symbols visible to any creator** → Non-issue: this is public reference data a
  requester must see to file a document; no amounts or company data involved.
- **A second currency-list path to maintain** → Mitigation: the selectable read is a thin
  active-only projection over the same entity; a test asserts it returns only active rows and
  only the four picker fields.
- **Store state duplication** (admin list vs picklist) → Mitigation: keep them in distinct state
  so neither read overwrites the other; the wizard only needs the picklist.

## Migration Plan

- Additive: new route + new frontend fetch path. Deploy backend first, then frontend. No
  migration, no breaking change to the admin endpoints.
- Rollback: revert the wizard to the `CURRENCY_VIEW` list; the new endpoint is inert if unused.

## Open Questions

- Route naming: `GET /currencies/selectable` vs `GET /currencies/active`. Leaning to
  `selectable` to match the budget picklist naming.
- Whether other pages that format money already have currency metadata embedded in their
  payloads (so only the create wizard truly needs this read). Belief: yes — detail/list reads
  embed the base currency — so scope stays limited to the wizard. Confirm at apply time.
