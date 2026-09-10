## MODIFIED Requirements

### Requirement: Per-Company Enablement

A group-wide vendor or item SHALL be usable in a company only after it is enabled for
that company via `vendor_company` / `item_company`. Enablement records SHALL be
company-scoped, and enabling/disabling SHALL be authorized by `MASTER_MANAGE`. Enabling
a vendor MAY record an `approved_date`.

Enablement rows carry per-company attributes: `item_company` records the **budget** an item defaults
to in that company and the GL account it posts to there, and `vendor_company.payment_term_days`
overrides the group vendor's terms for that company.

The item's budget SHALL be recorded as its place in the plan — `item_company.default_budget_code` —
and NOT as a `budget.id`. `budget` and `budget_node` are keyed by fiscal year, so a stored id would
name a closed year's row as soon as a new year opens, whereas a plan code names the same budget
across years: `budget_node` is unique on `(fiscal_year_id, code)` and `budget.node_id` is unique, so
one code names one budget within one year.

A budget binding SHALL be resolved in the open fiscal year of the active company: the `budget_node`
with that `code` in that `fiscal_year_id`, and the `budget` on that node. Because `fiscal_year` is
company-scoped, a code SHALL only ever resolve inside the active company's own plan (invariant 1).
Setting a binding SHALL be rejected when it resolves to no such budget, or when the resolved
budget's `status` is not `ACTIVE`.

`item_company.default_gl_account` SHALL remain the account the item posts to, and SHALL be stamped
from the resolved budget's `gl_account` when a binding is set — it SHALL NOT be set directly by the
client. It SHALL resolve to an active, postable `account` in the active company (via the
chart-of-accounts resolver, as budgets do) and enablement SHALL be rejected when it does not; it MAY
be left unset (the item then has no GL, and a `requires_budget` line referencing it is rejected at
document time). Clearing a binding SHALL leave the stamped account in place, so an item that posts
today does not stop posting because a label was removed.

An item enabled before this capability existed carries an account and no binding. It SHALL keep
posting to that account, and SHALL NOT be given a binding by back-fill: an account is shared by
several budgets, so no single budget can be derived from it.

The vendor's effective payment terms SHALL be the `vendor_company.payment_term_days` override when
set, otherwise the group `vendor.payment_term_days`.

#### Scenario: Enable a vendor for a company

- **WHEN** an administrator enables a group vendor for company A
- **THEN** a `vendor_company` row for (vendor, A) is created/activated and the vendor
  becomes selectable in company A

#### Scenario: Enablement does not cross companies

- **WHEN** a vendor is enabled for company A only
- **THEN** the `assertVendorEnabled` guard rejects that vendor for company B

#### Scenario: Disable re-blocks selection

- **WHEN** an enabled vendor is disabled for company A (`vendor_company.is_active = false`)
- **THEN** that vendor is no longer selectable in company A

#### Scenario: An item is bound to one budget among several on one account

- **GIVEN** four `budget` rows of the open fiscal year whose `gl_account` is all `612.06`, with plan
  codes `6.101`, `6.102`, `6.103` and `6.107`
- **WHEN** an administrator binds an item to `6.107`
- **THEN** `item_company.default_budget_code` records `6.107`, and reading the item's budget back
  yields `6.107` and no other

#### Scenario: The account is stamped from the bound budget

- **WHEN** an administrator binds an item to a budget whose `gl_account` is `612.06`
- **THEN** `item_company.default_gl_account` is set to `612.06` without the client naming it, and a
  document line carrying that item stamps `612.06` as it did before

#### Scenario: A binding is rejected when it names no budget of the open year

- **WHEN** an administrator sets a plan code with no `budget_node` in the open fiscal year, or whose
  resolved `budget` is not `ACTIVE`
- **THEN** enablement is rejected

#### Scenario: A binding cannot reach another company's plan

- **GIVEN** company B holding a budget with plan code `6.101` and company A holding none
- **WHEN** an administrator sets `6.101` while company A is active
- **THEN** enablement is rejected, because the code is resolved inside company A's open fiscal year

#### Scenario: A binding survives the opening of a new fiscal year

- **GIVEN** an item bound to plan code `6.101`
- **WHEN** a new fiscal year opens carrying its own `budget_node` for `6.101`
- **THEN** the item's budget resolves to the new year's budget with no change to `item_company`

#### Scenario: An item carrying only an account keeps posting

- **GIVEN** an item enabled with a `default_gl_account` and no budget binding
- **WHEN** a document line references it
- **THEN** the line stamps that account as before, and the item's binding stays unset

#### Scenario: Per-company attributes are company-scoped

- **GIVEN** an item with an `item_company.default_gl_account` for company A
- **WHEN** the item's GL is read while company B is active
- **THEN** company A's value does not apply to company B (company B uses its own value, or the
  item has no GL there)

#### Scenario: Vendor payment terms fall back to the group value

- **GIVEN** a vendor enabled for company A with no `payment_term_days` override
- **WHEN** the vendor's effective terms are read for company A
- **THEN** the group `vendor.payment_term_days` is used
