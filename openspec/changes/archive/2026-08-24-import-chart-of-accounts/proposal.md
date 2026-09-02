## Why

The customer's chart of accounts exists, in use, in two Excel files in `data/account/`: a
4,083-account tree they post to every day. The system has no way to take it. Every screen that
resolves a GL account — budget creation, document lines, the posting engine — is being tested
against a seed of a dozen invented codes, so nothing has yet been exercised against a real chart,
and nobody can be shown their own accounts on screen.

Measured against the files rather than assumed:

| | |
|---|---|
| `ບັນຊີ (3).xls` — the parent chart | 3,341 accounts |
| `ສາລະບານບັນຊີ 2026 (3).xls` — the company's own accounts | 742 accounts |
| Codes appearing in both files | **0** — the union is clean |
| Company-chart rows whose parent lives in the parent chart | **742 / 742** |
| Merged | **4,083 accounts**, roots `1`–`7`, 4 levels deep |
| Header accounts (have children) / leaves | 184 / 3,899 |
| Child whose `account_type` differs from its parent's | **46** |

The last row is the reason this change touches a spec and not only a script.

## What Changes

- A **one-off CLI importer**, `pnpm import:accounts`, that reads one or more `.xls`/`.xlsx` chart
  files and creates `account` rows for one company. It is run by an operator from the repo, not
  exposed as a route: this is a bootstrap step for a company being set up, and a permanent upload
  endpoint is a product feature with its own permissions, file limits and result screen.
- Files are merged before anything is written. The parent of an account is the **longest existing
  code prefix** among the accounts being imported, which resolves 4,076 of 4,083 and leaves the
  seven roots parentless. Nothing is inferred from how many dots a code has.
- `is_postable` is **derived**: an account that turns out to have children is a header and is not
  postable; a leaf is. The files carry no such column — the one that looked like it (`ຂອດວຽກ`)
  is spread evenly across headers and leaves and means something else.
- `--dry-run` prints exactly what would be written, and every row it cannot place, without
  touching the database. It is the default posture: the run that writes is the one that asked to.
- Re-running is safe: an account whose code already exists in the company is left alone and
  counted, never duplicated or overwritten.
- **BREAKING (spec)**: an account's parent no longer has to carry the same `account_type` as the
  child. The customer's own chart puts `752.01 ຊັບສິນ` (asset) under `752 ລາຍຮັບ` (revenue) and
  `1213183.20 ໜີ້ສິນ` under `1213 ຊັບສິນ` — contra accounts filed under the head they offset,
  which is ordinary bookkeeping. The rule would reject 46 of their accounts, and nothing in this
  system rolls a figure up the account tree, so the rule costs real data and buys nothing today.
  Cycles and same-company remain enforced.

## Capabilities

### New Capabilities
- `chart-of-accounts-import`: taking an existing chart of accounts into a company from the
  customer's own files — merging several files, deriving the hierarchy and postability, refusing
  to write anything it could not place, and being safe to run twice.

### Modified Capabilities
- `chart-of-accounts`: the Account Type and Hierarchy Integrity requirement drops the
  same-type-as-parent rule and states why the tree does not constrain type.

## Impact

- **New**: `back/src/modules/accounting/chart-import/` (reader, merge + tree derivation, writer),
  a `back/package.json` script, and a `xlsx` (or `exceljs`) dependency — the repo currently has
  no Excel reader at all.
- **Changed**: `AccountService.requireValidParent` stops comparing types; its spec and tests
  change with it. `back/src/modules/accounting/account.service.spec.ts` asserts the rejection
  today.
- **Not changed**: the posting engine, the resolver contract (`resolvePostable` still refuses a
  non-postable account), and every company-scope rule. Imported accounts are ordinary rows.
- **Invariants**: company isolation (1) is the one this could break — the importer takes a company
  and every row it writes carries it; a run naming no company is refused rather than defaulted.
  Nothing here touches an append-only ledger, budget arithmetic, or FX.
- **Out of scope, deliberately**: the budget plan (`data/budget/`) and the 5,715-row spend history
  are separate changes; balances and opening figures are not imported — the files carry a
  normal-balance column (`ໜີ້`/`ມີ`), not amounts.
