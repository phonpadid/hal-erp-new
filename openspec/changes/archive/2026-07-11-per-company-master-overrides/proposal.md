## Why

`item` and `vendor` are group-wide masters enabled per company via `item_company` /
`vendor_company` (already many-to-many). The junction rows carry only `is_active`, so a
company cannot vary the master's attributes. Two are genuinely per-company:

- An item's **GL account**. The group-level `item.default_gl_account` is one shared code that
  cannot be validated against any company's chart (charts are per company) — an unvalidated
  string that different companies may need to post differently. GL belongs **on the junction**,
  where it is company-scoped and can be validated against and picked from that company's
  postable accounts.
- A vendor's **payment terms**. Each company negotiates its own terms with the same vendor.

## What Changes

- **Remove `item.default_gl_account`** from the group `item` table. An item's GL now lives
  only on `item_company.default_gl_account`, set and validated per company. **BREAKING** for
  the group item form/DTO, which drop the GL field.
- Add `payment_term_days` to `vendor_company` as a per-company override of the group vendor's
  terms (the group `vendor.payment_term_days` stays as a sensible universal default — payment
  terms need no chart validation, so a group fallback is kept for vendors, unlike item GL).
- Enablement (`MASTER_MANAGE`) sets these. The item GL SHALL resolve to an **active, postable
  account in the active company** (the chart-of-accounts resolver, as budgets do); a
  non-postable code is rejected. An item with no per-company GL has no GL — on a
  `requires_budget` line it is rejected exactly as an item "without a default GL" is today.
- An item line's GL is derived from the active company's `item_company.default_gl_account`
  (no group fallback).
- The per-company management UI sets the item GL from a **postable-account picker** (labelled
  name + code) and the vendor terms; effective values are shown.
- Migrate existing `item.default_gl_account` values into `item_company` rows for every company
  the item is enabled in, then drop the column.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `master-data`: the group `item` no longer carries a GL; `item_company.default_gl_account`
  (validated against the active company's postable accounts) is the item's GL, and
  `vendor_company.payment_term_days` overrides the group vendor's terms.
- `document-engine`: an item line's GL is derived from the active company's
  `item_company.default_gl_account`; an item with none is rejected on a `requires_budget` line.
- `web-master-data`: the enablement affordance sets the per-company item GL (postable-account
  picker) and vendor terms; the group item form no longer has a GL field.

## Impact

- **Schema (BREAKING)**: add `default_gl_account` to `item_company` and `payment_term_days` to
  `vendor_company`; a migration backfills `item_company.default_gl_account` from
  `item.default_gl_account` (per enabled company) and then drops `item.default_gl_account`.
- **Backend**: remove `defaultGlAccount` from the `Item` entity + item DTOs; add it to
  `ItemCompany` (validated on enable via `AccountService.resolvePostable`); add
  `paymentTermDays` to `VendorCompany`; `ItemService` GL resolution becomes the per-company
  lookup; `DocumentService` item-line GL uses it; the company-enabled vendor read exposes the
  effective terms.
- **Frontend**: drop the GL field from the group item form; add the per-company GL picker +
  vendor-terms input to the enablement UI; update shared item schema and API types.
- **Invariants**: strengthens company isolation (invariant 1 — GL is company-scoped) and lets
  GL finally be validated. Backward compatible for behavior after the backfill: each company
  keeps the GL it had via the migrated `item_company` row.
