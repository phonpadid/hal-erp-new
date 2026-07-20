## 1. History read (the only server work)

- [x] 1.1 Add `VendorBankAccountService.history(id)` — `vendor_bank_account_log` rows for one account, newest first, with the actor populated; reject an unknown account as not found
- [x] 1.2 Expose `GET /vendors/:vendorId/bank-accounts/:id/history` gated on `VENDOR_BANK_MANAGE` — **not** `MASTER_VIEW`: who redirected a payee is more sensitive than the account list itself
- [x] 1.3 Return the before/after values parsed from `before_json`/`after_json` rather than raw JSON strings, so the client does not re-parse what the server already knows the shape of
- [x] 1.4 Unit tests: an edit returns actor + both account numbers, newest-first ordering, a deactivated account still has a history, `MASTER_VIEW` alone is denied, unknown account is not found

## 2. Client API

- [x] 2.1 Add `masterDataApi.vendorBankAccounts.history(vendorId, id)` and its row type beside the existing five calls
- [x] 2.2 Extend the vendor registry read so a vendor with no bank account is distinguishable in the list (server already returns the accounts; decide list-side vs per-row fetch and note why)

## 3. Accounts panel

- [x] 3.1 Add the entry point from a vendor in the registry to its bank accounts, marking a vendor that has none — a disbursement for it cannot be submitted and the registry is where someone looks for the reason
- [x] 3.2 List a vendor's accounts: bank, account number, account name, primary, active — **account number as text, never numeric or right-aligned** (a leading zero is part of the identifier)
- [x] 3.3 Show a deactivated account greyed and unselectable rather than hiding it, so an old document naming it stays traceable
- [x] 3.4 Empty state states plainly that a disbursement for this vendor cannot be submitted until an account exists
- [x] 3.5 Gate add / edit / make-primary / deactivate on `VENDOR_BANK_MANAGE` alone — affordances **absent**, not disabled; the likeliest mistake here is reusing the vendor form's `MASTER_MANAGE` check out of habit

## 4. Add and edit

- [x] 4.1 Add/edit form: bank code, account number (text input), account name, optional currency — Zod schema mirroring `CreateVendorBankAccountDto` so the client refuses what the server would
- [x] 4.2 **No primary field on the form** — promoting is its own action, because the server demotes the previous primary atomically and a field would imply two could be primary between saves
- [x] 4.3 Surface a 409 as a named conflict ("this vendor already has 0001 at BCEL"), not a generic failure
- [x] 4.4 Component tests: required field blocks submit, duplicate reported by name, no primary field, account number survives with its leading zeros

## 5. Promote and deactivate

- [x] 5.1 Make-primary action per active row; the primary is visually distinguished (it is what the payee picker preselects)
- [x] 5.2 No make-primary on an inactive account — the server refuses it, so the UI must not offer it
- [x] 5.3 Deactivate with a confirmation stating it cannot be undone here and that documents already naming the account are unaffected; **no delete anywhere**
- [x] 5.4 Deactivating the primary warns that the vendor will be left with none and the next disbursement will preselect no payee — the person deactivating is not the person who finds out
- [x] 5.5 Component tests: promoting one demotes the other in the rendered list, inactive offers no promote, deactivating the primary warns, no delete control exists

## 6. History

- [x] 6.1 Show an account's history beside the account — actor, time, action, before/after — shown only with `VENDOR_BANK_MANAGE`
- [x] 6.2 Component tests: an edit shows actor + old/new number; **an edit-then-revert shows both changes in order** (the account now reads as it originally did, and the history is the only thing that says otherwise); hidden without the permission

## 7. Ship

- [x] 7.1 i18n for both `en` and `la`, passing the parity spec
- [x] 7.2 ~~Route + nav~~ **N/A — no new route.** The panel opens as a dialog from the vendor row in the existing master-data page, which already gates on `MASTER_VIEW` and already has a breadcrumb. A standalone route was the wrong shape: an account has no meaning apart from its vendor (see design)
- [x] 7.3 Run both suites; **verify failures against pristine HEAD before blaming this diff** — the `DEMO`/`HAL` seed specs, `/api-keys` breadcrumb, `DocTypesView` filters, and the `RefChainEditor` add test all fail on HEAD
- [x] 7.4 Sanity-check the whole loop by hand: add an account to a seeded vendor, raise a `DISB` for it, confirm the payee picker preselects the primary — this change exists because that loop is currently impossible without curl
