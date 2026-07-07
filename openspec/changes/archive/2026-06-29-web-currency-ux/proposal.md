## Why

The multi-currency backend is robust — an ISO 4217 registry with per-currency `decimal_places`,
an exchange-rate resolver (identity → company override → group → inverse) honoring `rate_type` and
`source`, locked rates stamped at submit, and base-currency conversion at header and line level — but
the **web UI can't actually drive it**. You cannot pick a document's currency when creating it, the
exchange-rate admin form has no `source` or company-override fields (so overrides/sources can only be
set via the API), document amounts are shown as raw strings (not formatted to the currency's decimal
places), and the locked rate is shown without its base-currency context. This change closes the
front-end gaps so a user can transact in a foreign currency end to end.

## What Changes

- **Document currency picker + base preview.** The create/edit form SHALL let the user choose the
  document currency (from active currencies, defaulting to the company base) and SHALL show a live
  preview of the converted base amount (via the existing `/exchange-rates/resolve` read), making the
  conversion visible before submit. The chosen currency is sent on `createDraft`.
- **Exchange-rate admin completeness.** The add-rate form SHALL include a `source`
  (BOT / bank / manual) field and a scope control — group-wide (no company) vs an override for the
  active company — wiring the `source` and `companyId` the backend DTO already accepts.
- **Amount formatting by `decimal_places`.** Document header/line amounts and the approvals inbox
  base total SHALL be formatted using the relevant currency's `decimal_places` (JPY 0, THB 2) via the
  existing `formatAmount` util, instead of raw strings.
- **Locked-rate context on detail.** The document detail SHALL present the document currency, the
  locked exchange rate, the base-currency label, the formatted base total (and line base amounts), and
  the lock date (the submit date), so a multi-currency document is auditable at a glance.

## Capabilities

### New Capabilities
<!-- None — all changes refine existing web capabilities. -->

### Modified Capabilities
- `web-documents`: the create/edit form gains a currency picker + live base preview; the detail
  presents the locked rate, base currency, and amounts formatted by `decimal_places`.
- `web-currency-admin`: the add-exchange-rate form gains a `source` field and a group/company-override
  scope control.
- `web-approvals`: the inbox base total is formatted by the base currency's `decimal_places`.

## Impact

- **Frontend (`front-end`) only:** `CreateDocumentView.vue` (currency select + base preview),
  `DocumentDetailView.vue` (locked-rate block + formatted amounts), `CurrencyAdminView.vue`
  (source + scope fields on the rate dialog), `ApprovalInboxView.vue` (formatted base total); the
  documents + currency Pinia stores / API clients (send `currency`; resolve a preview rate; look up
  `decimal_places`); reuse of the existing `formatAmount` util and `/exchange-rates/resolve`.
- **Backend:** one minimal addition — `/auth/me` SHALL include the active company's base currency
  (`code` + `decimal_places`) so the UI can default the document currency, target the base preview,
  and format base amounts. No new tables, DTO fields on write paths, or migrations; the rate engine,
  the resolve read, and the currency registry already exist.
- **Invariants:** money stays decimal/string (the base preview is advisory; the server still locks the
  rate at submit — invariant 6); affordances stay gated by `CURRENCY_MANAGE` / `DOC_CREATE` /
  `DOC_APPROVE` (UX only; the server enforces); no change to budget, FX-to-accounting, or locking.

## Out of Scope

- Backend rate-type semantics (e.g. budget control on `BUDGET_RATE`) and FX gain/loss at actual
  payment — deferred to separate proposals. Locked-rate `rate_type`/`source` are not shown on the
  detail because the document does not store them (would need new columns).
