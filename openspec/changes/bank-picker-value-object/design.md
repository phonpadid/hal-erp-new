## Context

Two unrelated screens each record a bank as typed text:

- `views/accounting/BankAccountsView.vue` — the company's own accounts. Field `bankName`, a plain
  `<InputText>`, POSTed to `POST /bank-accounts` as a required string.
- `components/master-data/VendorBankAccountsPanel.vue` — a vendor's payee accounts. Field
  `bankCode`, an `<InputText>` inside a `@primevue/forms` `<FormField>`, validated by a Zod schema
  that mirrors `CreateVendorBankAccountDto` (`min(1).max(255)`).

`front-end/public/banks/` already holds six logos — `acleda`, `bcel`, `indochina`, `jdb`, `ldb`,
`stb` — which no code currently references. The set of banks a Lao company pays through is small
and changes on the order of years.

Two constraints shape the whole design:

1. **The server contract stays as it is for both bank fields.** No DTO, entity, migration, or route
   changes; the picker is a front-end input concern that resolves to the same single string.
2. **Rows already exist in production** carrying whatever was typed (the screenshots show
   `BCEL - 0101…` under a vendor). Those strings are not being rewritten by this change, so every
   surface must keep rendering and re-saving a value the catalog has never heard of.

A third fact is not visible from the forms but decides the currency half of the change: at HAL the
role holding `VENDOR_BANK_MANAGE` is `ພະແນກການເງີນ`, which holds neither `DOC_CREATE` nor
`CURRENCY_VIEW`, and `GET /currencies/selectable` requires `DOC_CREATE`.

## Goals / Non-Goals

**Goals:**

- One bank catalog, defined once, rendered identically by both forms, with the bank's logo.
- Neither form lets a bank be typed.
- The bytes on the wire for both bank fields are exactly what they are today: one string.
- An account whose stored bank is outside the catalog can still be opened, edited and saved without
  its bank changing.
- The vendor form's currency is picked, not typed, and still optional.

**Non-Goals:**

- Server-side validation that a bank string is in the catalog. The catalog is a front-end
  convenience; the server keeps accepting the same free string, and a stricter server would reject
  rows it already stores.
- A `bank` table, an admin screen for it, or an endpoint that serves it.
- Backfilling or normalising the bank values already recorded, and touching the payment-batch
  export's `bank_code` snapshot.
- Changing which of `bankName` / `bankCode` each row stores. The two columns keep their distinct
  meanings.

## Decisions

### The catalog is frozen front-end data, not a table

`front-end/src/shared/banks.ts` exports a readonly array of
`{ code, name, fullName, logoFile }`, one entry per logo file, plus lookups by code and by name.

*Alternative — a `bank` table with a master-data screen:* rejected. It buys per-company
configurability nobody asked for, and costs a migration, an endpoint, a permission code, a
maintenance screen, and an upload path for logos — for six rows that change when a bank opens in
Vientiane. The logos are already shipped as static assets; the names belong beside them.

*Alternative — put it in the `@erp/shared` workspace package:* rejected for now. Nothing on the
server reads it, and `@erp/shared` is imported from its built CommonJS `dist` by the backend, so
adding a browser-only asset concern there buys a build step for no consumer. If the server ever
validates the field, moving the array is a rename.

### Each form sends the field its column is named for

The company form sends the entry's **`name`** as `bankName`; the vendor form sends the entry's
**`code`** as `bankCode`. They differ because the columns differ: `vendor_bank_account` is unique on
`(vendor_id, bank_code, account_no)` and the payment-batch export snapshots `bank_code` for the bank
to read, so a short stable token is what belongs there; `bank_account.bank_name` is displayed as the
bank's name in the accounts table and in reconciliation.

*Alternative — send the whole object, or a JSON string:* rejected outright. It is the thing the
constraint above forbids, and it would make every existing row a different shape from every new one.

*Alternative — send `code` in both:* rejected. It would silently redefine what `bank_name` means
against rows that already hold a name, and the accounts table would start reading `BCEL` where it
read `Banque Pour Le Commerce Extérieur Lao`.

### An unrecognised stored value becomes a passthrough option

When a form opens on a value that no catalog entry matches (by the field's own key) and the value is
non-empty, the options list gains a synthetic entry carrying that raw string as both value and
label, with no logo. It sorts last and is never offered for a new record.

Without this, PrimeVue's `<Select>` renders a value outside its options as blank, and a user
opening an account to fix a digit would save it having silently changed banks. The passthrough makes
the odd value visible as odd — no logo, raw text — which is also the nudge to correct it.

### PrimeVue `<Select>` with slots, not a wrapper input component

Both forms use `<Select :options>` with `#value` and `#option` slots rendering a small
presentational `BankOption.vue` (logo + name). The bank picker is **not** a custom input component
wrapping `<Select>`.

The reason is the vendor form: `@primevue/forms`'s `<FormField>` clones its slot child and injects
the model wiring. Every field in this codebase that lives inside a `FormField` is a stock PrimeVue
input, and `<Select>` is already used that way elsewhere. Introducing the app's first custom
component into that position would put the change's risk in the forms library rather than in the
feature. `BankOption.vue` renders and emits nothing, so it is safe anywhere.

### Logos resolve through `import.meta.env.BASE_URL`

`bankLogoUrl(bank)` returns `` `${import.meta.env.BASE_URL}banks/${bank.logoFile}` ``. A literal
`<img src="/banks/x.png">` is rewritten by Vite's asset transform to include the app's `base`, but a
**bound** `:src` is not — and this SPA is served from `/new/`, so the bare path 404s in production
while working in dev. The `<img>` carries the bank's name as `alt`, so a missing file degrades to
text rather than a gap.

### The currency picker read widens with an any-of gate

`PermissionsGuard` today reads one metadata key and requires **every** code in it. A second key is
added, set by a new `@RequireAnyPermission(...)` decorator, and satisfied when the user holds **at
least one** of its codes. Both keys are read in the same guard and both must pass when both are
present, so no existing endpoint changes behaviour. `GET /currencies/selectable` then becomes
`@RequireAnyPermission(DOC_CREATE, CURRENCY_VIEW, VENDOR_BANK_MANAGE)`.

*Alternative — a bespoke currency read under `MASTER_VIEW`:* rejected. A second endpoint returning
the same four fields is the same widening with more surface to keep in step.

*Alternative — leave the guard alone and let the picker fall back to a text box on 403:* rejected.
It delivers the free-text field the change exists to remove, to precisely the role the form is for.

*Alternative — grant `DOC_CREATE` to the finance role:* rejected. It is a data fix for a code
problem, it grants the right to raise documents in order to read a currency list, and it would have
to be repeated in every company of the group.

This also closes a live defect: `useCurrencyFormat` calls this same read on every screen that
formats money, so that role has been getting a silent 403 and formatting every currency at two
decimal places.

## Risks / Trade-offs

- **A bank the catalog omits cannot be entered at all** → The catalog covers the six banks the app
  ships logos for; adding a seventh is one entry and one PNG, no deploy of the server and no
  migration. This is the accepted cost of removing free text, and the passthrough option means
  existing rows naming an absent bank still open and save.
- **`bankName` and `bankCode` now carry values from one list but in two shapes**, so the same bank
  reads `Banque Pour Le Commerce Extérieur Lao` on one screen and `BCEL` on another → Intended: the
  columns already meant different things, and the catalog is what makes them consistently derived
  from one source rather than from two people's typing.
- **Widening the currency read is a real authorization change**, not a refactor → It is additive
  (no endpoint loses a gate), it names codes rather than roles, and the payload is four public
  fields of active currencies that any of these users already sees on documents. It gets its own
  guard tests and its own spec scenarios.
- **Logos are unversioned static files** → They are decorative; `alt` carries the bank name, and a
  404 costs a broken image, never a wrong bank.

## Migration Plan

No schema change, no data migration, no rollback step. The two forms and one guard ship together;
reverting the front-end commit restores the text inputs and the strings already written stay valid,
because the change never wrote anything the old form could not have written.

## Sequencing and transactions

No path in this change writes `budget_txn` or `quota_usage`, reserves budget, or issues a document
number, so no transaction boundary or lock is introduced and none is owed a concurrency test. The
widened read is a read.

## Open Questions

- The six catalog names are being written from the logo filenames (`ACLEDA Bank Lao`, `BCEL`,
  `Indochina Bank`, `JDB Bank`, `Lao Development Bank`, `ST Bank`). If the company writes any of
  them differently on its own paperwork, the `name` and `fullName` fields are the only place to fix,
  and existing rows are unaffected either way.
