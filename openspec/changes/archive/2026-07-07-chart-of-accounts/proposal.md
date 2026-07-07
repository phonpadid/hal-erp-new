## Why

Today `gl_account` is a free-form `varchar` scattered across `budget`, `document_line`,
and `item.default_gl_account` — any non-empty string ≤255 chars is accepted, with no
master record, no account type, no hierarchy, and no referential integrity. This blocks
every downstream accounting capability (a real general ledger, VAT/WHT, financial
statements) and lets typos silently create orphan budget buckets. This change introduces
a managed **Chart of Accounts** master as the foundation the rest of accounting will build
on, without yet adding double-entry posting.

## What Changes

- Introduce a company-scoped `account` master table (chart of accounts): `code`, `name`,
  `account_type` (ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE), `parent_id` for
  hierarchy, `is_postable`, `is_active`. Code is unique per company.
- Add REST CRUD for accounts behind new permission codes (`COA_VIEW`, `COA_MANAGE`),
  company-scoped, with an admin UI to manage the chart.
- Validate that a budget's GL account references an **active, postable** account in the
  budget's company at write time — replacing the "any string" behavior. **BREAKING** for
  API clients that posted arbitrary GL strings on budgets.
- Keep the stored value as the account **code** string on the existing row (no column-type
  churn on ledgers) but enforce it against the master; add a nullable `account_id` FK on
  `budget` for integrity, backfilled from the seeded codes.
- Seed a minimal default chart per company (including the existing `5000` expense code)
  and backfill existing `budget` references so no current data is orphaned.
- **Item GL is deferred**: `item` is a group-wide master (no `company_id`), so its
  `default_gl_account` cannot be resolved against a per-company chart in this slice. It
  stays a free string and is validated later when it flows onto a company-scoped document
  line (same deferral as `document_line.gl_account`).

## Capabilities

### New Capabilities
- `chart-of-accounts`: the account master (types, hierarchy, per-company codes,
  postable/active flags), its CRUD API, permission codes, and the validation contract
  other capabilities call to resolve a GL code to a real account.

### Modified Capabilities
- `budget-control`: a budget's `gl_account` MUST reference an active, postable account in
  the budget's company; the `(fiscal_year, department, gl_account)` uniqueness is unchanged
  but the GL side is now validated. No change to the balance formula or ledger invariants.

## Impact

- **Data model**: new `account` table; nullable `account_id` FK added to `budget`
  (DBML update + migration). No change to append-only ledgers (`budget_txn`).
- **Backend**: new `accounting`/`chart-of-accounts` module (entity, service, controller,
  DTOs, permission codes, seed); budget-create calls the account-resolution guard.
- **Frontend**: new Chart of Accounts admin view (list + create/edit), and the GL field
  on the budget form becomes Select-from-accounts instead of free text; shared Zod schema
  for the account form.
- **Invariants**: preserves all core invariants. Company isolation (#1) extends to the new
  table; authorization uses new permission codes (#6). Append-only ledgers (#2, #3) and
  reserve→actual→release (#4) are untouched — this slice adds a master + validation only,
  no posting.
- **Migration risk**: existing free-text GL values must be backfilled to seeded accounts;
  any value with no matching account is flagged for manual mapping before enforcement.
