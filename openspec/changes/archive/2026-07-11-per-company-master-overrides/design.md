## Context

`item` / `vendor` are group-wide (no `company_id`), enabled per company via `item_company` /
`vendor_company`. Today the group `item` carries `default_gl_account` and the group `vendor`
carries `payment_term_days`. The item GL is the problem: a single group code can't be validated
against any company's chart (charts are per company), so it stays free-text and error-prone. The
junction row is company-scoped — the correct, validatable home for a per-company GL.

## Goals / Non-Goals

**Goals:**
- Item GL lives only on `item_company`, validated against the active company's postable accounts.
- Remove the unvalidated group `item.default_gl_account`, migrating existing values first.
- Per-company vendor payment terms, with the group vendor value kept as a fallback.

**Non-Goals:**
- No move of `item`/`vendor` to per-company ownership — they stay group registries; only the
  per-company *attributes* move to the junction.
- No per-company override of other attributes (name, tax id, unit).
- No change to budget resolution from a GL, only which GL an item contributes.

## Decisions

- **Item GL: per-company only, group field removed.** Chosen over keeping a group fallback
  because the group code cannot be validated and is a latent data-quality hole. An item's GL is
  `item_company.default_gl_account` for the active company, full stop. An item with no
  per-company GL simply "has no GL" — on a `requires_budget` line that is rejected exactly like
  an item "without a default GL" is today. Trade-off accepted: each company sets the GL for the
  items it enables (no inheritance); the migration seeds these from the old group value so there
  is no day-one regression, and if the group's charts are harmonized the seeded values are
  identical everywhere.
- **Validate the item GL on enablement.** A non-null `item_company.default_gl_account` SHALL
  resolve to an active, postable `account` in the active company (the same
  `AccountService.resolvePostable` budgets use); reject otherwise. This is the payoff of moving
  it per-company.
- **Vendor terms: keep the group default + per-company override.** Asymmetric with item GL on
  purpose — payment terms need no chart validation and a universal default (e.g. 30 days) is
  meaningful, so the group `vendor.payment_term_days` stays as a fallback and
  `vendor_company.payment_term_days` overrides it (`override ?? group`).
- **Resolution point unchanged, source swapped.** `ItemService`'s "GL for a line" becomes a
  company-scoped `item_company` lookup (no group read). `DocumentService`'s item-line path and
  its budget resolution/rejection are otherwise untouched.
- **Migration backfills then drops.** For every `item_company` row, set
  `default_gl_account = item.default_gl_account` of its item; then drop `item.default_gl_account`.
  Items enabled nowhere lose their (unused) GL — acceptable, they charge no budget until enabled.
- **Frontend GL picker mirrors budgets.** The per-company GL is chosen from the active company's
  postable accounts, labelled "name (code)"; the group item form drops its GL field.

## Risks / Trade-offs

- **Setup burden without inheritance** → each company sets GL per enabled item. Mitigated by the
  backfill (existing state preserved) and, where charts are harmonized, identical seeded values.
- **An item enabled after the change with no GL set** → its lines can't resolve a budget on a
  `requires_budget` type until an admin sets the GL — same failure mode as a group item with no
  default GL today, just surfaced per company.
- **Backfill for an item enabled in many companies** → one `item_company` update per (item,
  company); a straightforward data migration, no document data touched.
- **Dropping a column is irreversible in place** → the down migration re-adds the column but
  cannot restore per-company divergence to a single value; documented as a one-way data change.

## Migration Plan

- Add the two columns. Backfill `item_company.default_gl_account` from the item's group value for
  every enabled company. Then drop `item.default_gl_account`. Deploy backend + frontend together.
- Rollback: re-add `item.default_gl_account` (empty) and revert resolution to it; per-company GLs
  remain on `item_company` but are no longer read — effectively a forward-only change once live.

## Open Questions

- Should enabling an item require a GL up front for `requires_budget` usage, or allow enabling
  without a GL and reject only at document time? Current decision: allow enabling without a GL
  (reject at document time, as today), so non-budget uses of the item are unaffected.
