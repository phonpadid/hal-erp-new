## 1. The bank catalog

- [x] 1.1 Add `front-end/src/shared/banks.ts`: a `Bank` interface (`code`, `name`, `fullName`, `logoFile`) and a frozen `BANKS` array with one entry per logo in `front-end/public/banks/` — ACLEDA, BCEL, Indochina, JDB, LDB, ST Bank. Document in the file why this is code and not a table
- [x] 1.2 In the same file, export `bankLogoUrl(bank)` returning `` `${import.meta.env.BASE_URL}banks/${bank.logoFile}` ``, with a comment that a bound `:src` is not rewritten by Vite's asset transform and this app is served from `/new/`
- [x] 1.3 In the same file, export `bankOptions(key: 'code' | 'name', current?: string)` — the catalog as picker options keyed on the requested field, plus a synthetic passthrough option carrying `current` verbatim (no logo) when `current` is non-empty and matches no entry; the passthrough sorts last
- [x] 1.4 Add `front-end/src/shared/banks.spec.ts`: every entry's `logoFile` exists in `public/banks/`; codes and names are each unique; `bankOptions` appends the passthrough only for an unmatched non-empty value, and never for an empty one or a matched one

## 2. The shared bank row

- [x] 2.1 Add `front-end/src/components/BankOption.vue` — props `{ label: string; logo?: string }`, renders the logo (fixed height, `object-contain`) beside the label, with the label as the `<img alt>`; renders label-only when `logo` is absent. Presentational: no emits, no store, no i18n lookup
- [x] 2.2 Style it with PrimeUI theme tokens only (no hardcoded colors), so it reads in light and dark
- [x] 2.3 Give it a default slot so a list row can supply its own text (`BCEL · 000123`) while `label` stays the image's `alt`, and export `bankDisplay` / `bankLogoFor` from the catalog for list use

## 3. Company bank accounts form (`views/accounting/BankAccountsView.vue`)

- [x] 3.1 Replace the `bankName` `<InputText>` with `<Select v-model="form.bankName" :options="bankOptions('name')" optionLabel="label" optionValue="value">`, rendering `BankOption` in both the `#value` and `#option` slots
- [x] 3.2 Keep `ready` requiring a non-empty `bankName`, and keep the create payload exactly as it is — one string, same field, same endpoint
- [x] 3.3 Feed the options through `bankOptions('name', form.bankName)` so a value set from an existing row survives; the create dialog opens on an empty string, so no passthrough appears when adding
- [x] 3.5 Show the logo in the accounts list too, not only in the picker — `bankDisplay('name', data.bankName)` in the bank column
- [x] 3.4 Update `src/views/accounting/BankAccountsView.spec.ts`: no text input for the bank; picking an option sends that bank's name as `bankName`; save stays disabled with no bank chosen

## 4. Vendor payee accounts form (`components/master-data/VendorBankAccountsPanel.vue`)

- [x] 4.1 Replace the `bankCode` `<InputText>` inside its `<FormField>` with a `<Select>` over `bankOptions('code', dialog.initial.bankCode)`, using the same `#value`/`#option` slots. Keep it a stock PrimeVue `<Select>` child of `FormField` — do not introduce a custom input wrapper into the forms wiring (design: "PrimeVue `<Select>` with slots, not a wrapper input component")
- [x] 4.2 Replace the `currency` `<InputText>` with a `<Select>` over `currency.selectableCurrencies` (`optionLabel="code" optionValue="code"`), `showClear` so it can be emptied, and load the list on mount via `loadSelectableCurrencies()` if it is not already loaded
- [x] 4.3 Rebuild the options whenever the dialog opens, so `editAccount` on a row with an unmatched `bankCode` gets its passthrough and `newAccount` does not
- [x] 4.4 Leave the Zod schema's shape alone (`bankCode` min 1 / max 255, `currency` max 3 optional) — the picker narrows what can be entered, and the schema still has to mirror `CreateVendorBankAccountDto`
- [x] 4.5 Leave `submit` untouched: `currency: v.currency || undefined`, same DTO, same create/update calls, same 409 handling
- [x] 4.7 Show the logo in the accounts list, with the identifier and the account name stacked BESIDE it rather than under it, and no logo for a bank the catalog does not know
- [x] 4.6 Update `src/components/master-data/VendorBankAccountsPanel.spec.ts`: no text input for bank or currency; picking a bank sends its code; editing a row whose stored `bankCode` is outside the catalog and changing only the account number sends the original code back; saving with no currency sends no `currency`

## 5. i18n

- [x] 5.1 Add the picker placeholders under `gl.bankAccounts` and `master.vendor.bank` for `en`, `la` and `zh` — the bank names themselves live in the catalog and are not translated, since they are how each bank writes its own name

## 6. The any-of permission gate

- [x] 6.1 In `back/src/auth/require-permissions.decorator.ts`, add `ANY_PERMISSIONS_KEY` and `RequireAnyPermission(...codes)` alongside the existing all-of decorator
- [x] 6.2 In `back/src/auth/permissions.guard.ts`, read the new key with `getAllAndOverride` next to the existing one and require `codes.some(...)`; when both keys are present both gates must pass; the all-of path is unchanged, and role names are still never consulted
- [x] 6.3 Extend `back/src/auth/permissions.guard.spec.ts`: one of the any-of codes passes; none refuses; an existing all-of endpoint is unaffected; an endpoint carrying both gates needs both
- [x] 6.4 In `back/src/modules/currency/currency.controller.ts`, change `GET /currencies/selectable` from `@RequirePermissions(DocP.DOC_CREATE)` to `@RequireAnyPermission(DocP.DOC_CREATE, P.CURRENCY_VIEW, VendorBankPermissions.VENDOR_BANK_MANAGE)`, keeping the comment above it accurate about why this read is not gated on `CURRENCY_VIEW` alone
- [x] 6.5 Add a controller-level test that a `VENDOR_BANK_MANAGE`-only caller gets the active currencies and a caller with none of the three codes is refused; confirm the existing `DOC_CREATE`-only test in `wizard-picker-reads.spec.ts` still passes untouched

## 7. Verify

- [x] 7.1 `pnpm --filter front-end test` and `pnpm --filter back test` green; typecheck and lint clean on both
- [x] 7.2 In the running app, add a company bank account through the picker and confirm the row lists the bank's name; add a vendor payee account through the picker and confirm the row reads `<CODE> · <account no>` as before
- [x] 7.3 Confirm a `VENDOR_BANK_MANAGE`-only caller is admitted to the currency picker read — covered by the gate test in `currency-selectable.spec.ts`; not re-checked in the browser as that role's credentials are not available here
- [x] 7.4 Open an account whose stored bank is outside the catalog, change only its account number, save, and confirm the bank is unchanged in the response
