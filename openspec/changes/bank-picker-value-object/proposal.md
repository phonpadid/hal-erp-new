## Why

Both places where a bank is recorded ask a person to type its name into a free-text box: the
company's own bank accounts (`bank_account.bank_name`) and a vendor's payee accounts
(`vendor_bank_account.bank_code`). Laos has a handful of banks — six of which this app already
ships logos for at `front-end/public/banks/` — so what the field really holds is one of a short,
known list, and typing it invites `BCEL`, `bcel`, `BCEL Bank` and `ບີຊີອີແອວ` to become four banks.
The damage is not cosmetic: `vendor_bank_account` is unique on `(vendor_id, bank_code, account_no)`,
so a spelling variant defeats the duplicate check that stops the same payee account being entered
twice, and the payment batch export snapshots `bank_code` verbatim for the bank to read.

The vendor form has the same problem in a second field: its currency is a free-text box, while the
company bank-account form two screens away already picks a currency from the active list.

## What Changes

- A bank catalog is added **on the front end only** — a frozen value object per bank
  (`code`, `name`, `fullName`, `logo`), one entry per logo already in `front-end/public/banks/`:
  ACLEDA, BCEL, Indochina, JDB, LDB, ST Bank. No table, no migration, no new endpoint: the list of
  banks in a country is not per-company configuration, and inventing a table for six rows would put
  a maintenance screen between a user and a logo file.
- **Both forms replace the free-text bank input with a picker** showing the bank's logo and name.
  Typing a bank is no longer possible.
- **The wire is unchanged.** Each field keeps its own meaning and still carries a single string:
  the company bank-account form sends the entry's `name` as `bankName`; the vendor form sends the
  entry's `code` as `bankCode` — which is what that column is called, what the uniqueness index is
  built on, and what the batch export snapshots. No DTO, entity, or endpoint changes for the bank.
- **A value already stored that the catalog does not know stays selected and re-savable**, shown as
  the raw text without a logo. Without this, opening an existing account to fix its number would
  silently rewrite its bank to whatever the picker defaulted to.
- **The vendor form's currency becomes a picker** over the active currencies, the same source the
  company bank-account form already uses, and keeps being optional.
- **The selectable-currencies read widens from `DOC_CREATE` alone to any of `DOC_CREATE`,
  `CURRENCY_VIEW`, or `VENDOR_BANK_MANAGE`.** This is the one server change here, and the currency
  picker does not work without it: at HAL the role that manages vendor bank accounts
  (`ພະແນກການເງີນ`) holds `VENDOR_BANK_MANAGE` and neither of the other two, so the picker would be
  empty for exactly the people the form is for. The same 403 already hits `useCurrencyFormat`,
  which reaches for this read on every screen that formats money — that role has been silently
  falling back to two decimal places for every currency. Widening a read that returns four public
  fields of active currencies grants nothing that user cannot already see on a document.

Explicitly out of scope: validating the bank string on the server, backfilling the bank values
already stored, and the payment-batch export's snapshot of `bank_code` — all three would change
what is already recorded, and this change only governs what a person can enter next.

## Capabilities

### New Capabilities

None. Every behaviour here belongs to a capability that already exists.

### Modified Capabilities

- `web-payments`: the company bank-account form picks its bank from the catalog rather than
  accepting typed text (Requirement: Bank Accounts Are Configurable From The App).
- `web-vendor-bank-account`: the add/edit form picks its bank from the catalog and its currency
  from the active currencies, and an unrecognised stored bank survives an edit
  (Requirement: Add and Edit an Account).
- `multi-currency`: the selectable-currencies read authorizes any of `DOC_CREATE`,
  `CURRENCY_VIEW`, or `VENDOR_BANK_MANAGE` instead of `DOC_CREATE` alone
  (Requirement: Selectable Currencies for Document Creation).

## Impact

**Schema** — none. No migration.

**Backend** — `auth/permissions.guard.ts` and its decorator gain an any-of gate alongside the
existing all-of one; `currency.controller.ts` uses it on `GET /currencies/selectable`. Nothing else
on the server is touched: the two bank fields keep their DTOs, entities, and validation.

**Frontend** — a new `src/shared/banks.ts` (the catalog) and a small presentational component for a
bank row (logo + name), used by `views/accounting/BankAccountsView.vue` and
`components/master-data/VendorBankAccountsPanel.vue`; the vendor panel's Zod schema; the existing
specs for both components; i18n for `en`, `la`, `zh`. The bank logos are read from `public/banks/`
through `import.meta.env.BASE_URL` — a bound `:src` is not rewritten by Vite's asset transform, and
this app is served from `/new/`, so a bare `/banks/x.png` would 404 in production.

**Invariants** — untouched. The catalog is a rendering and input concern with no company scope of
its own; no `budget_txn` or `quota_usage` is written on any path here; authorization stays on
permission codes, and the one widened gate names codes rather than roles. The account number stays
a string in a text input, leading zeros intact.

**Concurrency** — nothing here reserves budget or issues a document number, so no concurrency test
is owed.
