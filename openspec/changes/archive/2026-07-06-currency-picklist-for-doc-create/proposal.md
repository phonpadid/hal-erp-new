## Why

The Create Document wizard loads the currency list (`GET /currencies`) to let the creator
choose the document currency, default to the company base currency, and format amounts. That
endpoint is gated by `CURRENCY_VIEW` — the currency-**admin** read. A requester who holds
`DOC_CREATE` but not `CURRENCY_VIEW` gets a 403 and cannot pick a currency (the wizard's
currency picker is empty and money formatting degrades). This is the same coupling the
budget picklist just fixed: create-wizard reference data locked behind an admin permission.

## What Changes

- Add a minimal, read-only **currency picklist** that returns the active currencies with only
  the fields a document creator needs — `code`, `name`, `symbol`, `decimalPlaces` — and only
  `is_active = true` rows.
- Gate the picklist on **`DOC_CREATE`** (not `CURRENCY_VIEW`). Currency is a global ISO 4217
  registry with no company scope and no sensitive figures, so no scope or amount filtering is
  needed beyond active-only.
- Update the Create Document wizard to populate its currency picker from the picklist instead
  of `GET /currencies`, so a `DOC_CREATE` creator no longer needs `CURRENCY_VIEW`.
- The existing `GET /currencies` (paginated admin list, including inactive) and all
  `CURRENCY_MANAGE` writes remain unchanged; currency administration keeps its own permissions.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-currency`: add a "Selectable Currencies for Document Creation" read requirement — an
  active-only currency picklist authorized by `DOC_CREATE`; clarify that the admin list/write
  reads remain `CURRENCY_VIEW`/`CURRENCY_MANAGE`.
- `web-documents`: the Create Document wizard's currency picker is populated from the picklist
  and available to `DOC_CREATE` creators, not gated on `CURRENCY_VIEW`.

## Impact

- **Backend:** new endpoint on the currency module (e.g. `GET /currencies/selectable`) with a
  trimmed active-only projection; new `DOC_CREATE` gate on that route only.
- **Frontend:** the currency store / create wizard fetches the picklist instead of the admin
  list; the currency-admin views are untouched.
- **Invariants:** authorize on permission codes (invariant 6). No company-isolation concern —
  `currency` is group-global by design. Read-only; no money handled.
- **No data-model change** — reads the existing `currency` table; no new tables/columns.
