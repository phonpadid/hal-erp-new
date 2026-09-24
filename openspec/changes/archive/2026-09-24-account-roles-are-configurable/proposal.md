## Why

Nothing this company has ever paid has reached the general ledger, and no screen in the product can
fix that.

The GL resolves system accounts by ROLE — which account is the cash clearing account, which is input
VAT — from `account_role`. The live company has **zero** rows in that table and three accounts in its
whole chart, all expenses. Every payment posting therefore fails:

```
PAYMENT  FAILED  5/5   No active account mapped for role 'CASH_CLEARING' in company …
PAYMENT  FAILED  5/5   No active account mapped for role 'VAT_INPUT'     in company …
```

The sweeper retried each five times and parked it, exactly as designed — its own comment says *"an
unmapped account will not map itself"*. It is right, and it has nobody to say it to:

- `AccountRoleService` exposes `resolve()` and nothing else. **There is no endpoint and no screen
  that can create or change a mapping.** The only way to record one is to write SQL against the
  production database.
- `golive:check` — the tool whose entire purpose is listing the decisions a customer has not yet
  recorded — does not look at account roles. It reported five findings for this database and none of
  them was the one that has silenced the ledger.

Accounts themselves are fully manageable (`COA_VIEW` / `COA_MANAGE`, a REST resource, a screen). Only
the mapping from role to account has no way in.

## What Changes

- **A role-mapping surface.** Read every role the system resolves, what each one is for, and which
  account it currently points at; set or change one. Gated on `COA_MANAGE` to write and `COA_VIEW` to
  read — this is chart-of-accounts configuration and belongs with the accounts it maps.
- **A screen for it**, beside the chart of accounts, showing which roles are unmapped and which of
  them this company's own configuration actually needs — so somebody setting the system up can see
  what is still missing rather than discovering it from a failed posting weeks later.
- **`golive:check` reports unmapped roles**, as a new `UNMAPPED_ACCOUNT_ROLE` finding, and only for
  the roles a company's configuration actually requires: a company with no VAT tax code is not asked
  for a VAT account, and one with no stock-moving document type is not asked for an inventory one.
  A checklist that asks for sixteen accounts nobody needs is a checklist people learn to skip.
- Nothing about how the GL resolves a role changes. `resolve()` and its failure are exactly as they
  are; this change is about who can answer it.

Deliberately NOT in this change:

- **Creating the accounts themselves.** That already works, and which accounts a company's chart
  needs is its accountant's decision, not a default worth inventing.
- **Retrying the parked postings.** The requeue action already exists on the undelivered-postings
  screen; once the roles are mapped, the existing button replays them.
- **Guessing a mapping.** A role pointed at a plausible-looking account is a wrong ledger that
  balances, which is worse than a ledger that visibly stopped.

## Capabilities

### New Capabilities

- `account-role-mapping`: which account plays each system role for a company — read, set, and the
  rules about what may be mapped.
- `web-account-roles`: the screen that records those mappings and shows what is still missing.

### Modified Capabilities

- `go-live-configuration`: unmapped account roles become a reported finding, scoped to the roles the
  company's configuration actually needs.

## Impact

- **Data model**: none. `account_role` already exists with the right shape (company, role, account).
- **Backend**: `AccountRoleService` gains list/set operations beside `resolve`; a controller under
  the accounting module's permissions; `golive/inspect.ts` gains one more finding source.
- **Frontend**: a role-mapping screen under Accounting, its API client and store, i18n in three
  locales.
- **Invariants**: company isolation applies — a mapping names an account of the same company, and
  the write refuses an account belonging to another. Nothing touches a ledger: mapping a role writes
  no `journal_entry` and no `budget_txn`; it only makes a future posting resolvable.
- **What it unblocks**: once the roles are mapped, the five parked payment postings requeue and the
  journal shows what has already been paid.
