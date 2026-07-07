## Context

The backend exposes everything this UI needs: `GET /currencies` (code, name, symbol,
`decimal_places`, active), `GET/POST /exchange-rates` (the POST DTO already accepts `source` and an
optional `companyId`), `GET /exchange-rates/resolve` (returns `{ rate, source, asOf, rateType }`),
and `POST /documents` whose DTO accepts an optional `currency`. The front-end has a working
`formatAmount(value, decimalPlaces)` util (used today only in budget views) and a currency Pinia
store. What's missing is purely presentational wiring. No backend, DTO, entity, or migration changes.

## Goals / Non-Goals

**Goals:**
- Choose a document currency on create and preview the converted base amount before submit.
- Set `source` and group/company-override scope when adding an exchange rate.
- Format document/line/inbox amounts by the relevant currency's `decimal_places`.
- Show the locked rate + base context on the document detail.

**Non-Goals:**
- No backend changes; no rate-type-at-submit, no FX gain/loss, no new columns.
- The base preview is advisory only — the server locks the authoritative rate at submit (invariant 6).

## Decisions

**1. Base currency comes from the active company context.** The create form and detail need the
company's base-currency `code` + `decimal_places`. Read it from the active-company context (auth /
company store); if absent, look it up once from `GET /currencies` by the company's base code and
cache it in the currency store. The document currency Select lists active currencies and defaults to
the base currency. Chosen so the picker and preview never hardcode a currency.

**2. Base preview via `/exchange-rates/resolve`, advisory.** On currency/line changes, the form calls
`resolve(from = docCurrency, to = baseCurrency, asOf = today)` and shows `sum(lineAmount) × rate`
rounded to the base currency's `decimal_places` (via `formatAmount`, Decimal/string — never a JS
number). It is labelled a preview; the document records its own locked rate at submit. Debounce/guard
the call so it doesn't fire on every keystroke. Same-currency (doc == base) skips the call (rate 1).

**3. Exchange-rate scope as a toggle, not a company list.** The add-rate dialog gets a `source`
input (BOT / bank / manual) and a scope control with two choices: **Group** (send no `companyId`) or
**This company** (send the active company id). This covers the common cases without building a
group-wide company picker; a broader picker can come later. The list already shows scope (company
code or "Group").

**4. Formatting by `decimal_places` via a store lookup.** A small helper resolves a currency code to
its `decimal_places` from the currency store (default 2 if unknown) and feeds `formatAmount`. Applied
to document header total, line amounts (document currency) and base amounts (base currency), and the
approvals inbox base total (base currency). Reuses the existing util — no new formatting logic.

**5. Locked-rate block, no new data.** The detail shows: document currency, locked `exchangeRate`,
base currency label, formatted `baseTotalAmount` (+ formatted line `baseLineAmount`), and the lock
date = `submittedAt`. `rate_type`/`source` are intentionally omitted — the document doesn't store
them (out of scope).

## Risks / Trade-offs

- [Preview rate missing for a pair/date → resolve 404s] → Treat a failed resolve as "no preview"
  (show the document-currency total only) rather than blocking the form; submit still works (the
  server resolves authoritatively, surfacing any genuine missing-rate error there).
- [Preview vs locked rate diverge if FX moves between create and submit] → The preview is explicitly
  labelled advisory; the detail shows the actual locked rate after submit, so there's no false
  promise.
- [Vue-tsc is currently red repo-wide from a pre-existing Zod 3/4 mismatch] → This change adds no Zod
  schemas to currency/document forms beyond what exists; verify via unit tests + `vite build`
  (esbuild), as the type-check gate is already broken independently of this work.

## Open Questions

- Resolved during implementation: the base currency was not in the front-end context and the org API
  is `COMPANY_VIEW`-gated, so `/auth/me` is enriched with the active company's base currency
  (`code` + `decimal_places`) — the single source the auth store exposes to all views.
