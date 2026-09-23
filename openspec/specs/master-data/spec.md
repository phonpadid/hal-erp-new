# Master Data Specification

## Purpose
Group-wide vendor and item registries with per-company enablement, so masters are
shared once and controlled per company.
## Requirements
### Requirement: Group Vendor Registry
The system SHALL keep vendors in a group-wide `vendor` table with credit terms, and
enable them per company via `vendor_company`.

#### Scenario: Vendor must be enabled for the company
- GIVEN a vendor registered group-wide but not enabled for company A
- WHEN a company A document tries to select that vendor
- THEN the selection MUST be rejected until the vendor is enabled for company A

### Requirement: Group Item Registry
The system SHALL keep items in a group-wide `item` table, enabled per company via
`item_company`. The group `item` carries no GL account; an item's GL is set **per company** on
`item_company.default_gl_account` and validated against that company's chart of accounts.

The group `item` SHALL carry `is_stock_tracked`, defaulting to `false`, marking whether the item is
a physical good whose quantity is tracked in a warehouse. Stockability is a property of the thing
itself, so it lives on the group `item` and not on `item_company`; per-company control is already
expressed by `item_company.is_active`. Only an item with `is_stock_tracked = true` SHALL produce
`stock_txn` rows — a receipt, issue, adjustment, or transfer naming an untracked item SHALL be
rejected, and an untracked item SHALL continue to behave exactly as items do today on every
existing document type.

#### Scenario: Item GL is set and read per company

- GIVEN an item enabled for company A with an `item_company.default_gl_account`
- WHEN it is added to a document line while company A is active
- THEN the line's GL account is set from company A's `item_company.default_gl_account`
  server-authoritatively and is not editable by the requester

#### Scenario: Stock tracking defaults off

- **GIVEN** an item created without specifying `is_stock_tracked`
- **WHEN** it is used on an existing document type
- **THEN** `is_stock_tracked` is false and no stock behavior applies to it

#### Scenario: Only tracked items move stock

- **WHEN** a stock movement names an item whose `is_stock_tracked` is false
- **THEN** the movement is rejected and no `stock_txn` row is written

### Requirement: Master Deactivation

Vendors and items SHALL be deactivated by setting `is_active = false` and SHALL NOT be
hard-deleted, so documents and lines that reference them stay intact. A deactivated
vendor or item MUST NOT be selectable on new documents.

#### Scenario: Deactivate a vendor instead of deleting it

- **WHEN** an administrator with `MASTER_MANAGE` removes a vendor
- **THEN** the `vendor` row is retained with `is_active = false` and no row is deleted

#### Scenario: A deactivated item cannot be selected

- **WHEN** a document line tries to use an item whose `is_active` is false
- **THEN** the selection MUST be rejected

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

### Requirement: Authorized, Company-Scoped Master Endpoints

Every master-data endpoint SHALL authorize on a permission code (never a role name).
Reads of the per-company enablement tables (`vendor_company`, `item_company`) SHALL
return only rows of the active company, and writes targeting another company MUST be
rejected. UUID path parameters SHALL be validated.

#### Scenario: Reads are limited to the active company

- **WHEN** a user whose active company is A lists enabled vendors
- **THEN** only `vendor_company` rows where `company_id = A` are returned

#### Scenario: Missing permission code is forbidden

- **WHEN** a request without `MASTER_MANAGE` calls an enable/disable endpoint
- **THEN** it is rejected with 403 before the handler runs

### Requirement: The Enabled Item Read Carries The Stock-Tracked Flag

The read that lists the items enabled for the active company SHALL include each item's
`is_stock_tracked` value.

A client cannot offer only stock-tracked items — which `web-inventory` requires of the line editor —
unless it can tell which items those are. The flag exists on the group `item` record but has not been
part of this payload, so the line editor offered every enabled item and the user learned the
difference only when the server refused the document at submit.

This is an additive field on an existing response. The permission governing the read SHALL be
unchanged, and no existing field SHALL change meaning.

#### Scenario: The flag reaches the client

- **WHEN** a client lists the items enabled for the active company
- **THEN** each entry reports whether the item is stock-tracked

#### Scenario: The read is otherwise unchanged

- **WHEN** a client lists the items enabled for the active company
- **THEN** the same items are returned as before, with the same permission required

### Requirement: Master Codes Are Issued By The System

The system SHALL issue `vendor.vendor_code` and `item.item_code` itself when a vendor or item is
created through the API, and SHALL NOT accept a caller-supplied code on create — a request
carrying `vendorCode` or `itemCode` SHALL be rejected with a validation error. Codes SHALL come
from a group-wide `master_sequence` row per `kind` (`VENDOR`, `ITEM`), incremented under a
pessimistic row lock (`SELECT … FOR UPDATE`) inside the same transaction as the insert, and
formatted as `V-` / `I-` followed by the number zero-padded to at least five digits. The
migration that introduces `master_sequence` SHALL seed each `current_no` at the highest number
already used by an existing code of the same pattern, so an issued code never collides with a
legacy one. The code SHALL remain immutable after creation and SHALL be returned on the created
record.

#### Scenario: A vendor is created without a code
- **WHEN** a `MASTER_MANAGE` user creates a vendor with a name and no code
- **THEN** the vendor is created with `vendor_code` `V-00001` (or the next number) and the response carries it

#### Scenario: Sequential codes
- **GIVEN** the last issued item code is `I-00041`
- **WHEN** an item is created
- **THEN** its `item_code` is `I-00042`

#### Scenario: A supplied code is refused
- **WHEN** a create request carries `vendorCode` or `itemCode`
- **THEN** the request is rejected with a validation error and nothing is created

#### Scenario: Concurrent creates never share a code
- **WHEN** two vendor creates run concurrently
- **THEN** both succeed with two different consecutive codes

#### Scenario: The sequence starts above legacy codes
- **GIVEN** an existing item whose `item_code` is `I-00001` and a vendor whose `vendor_code` is `BANKPICK-DEMO`
- **WHEN** the migration seeds `master_sequence`
- **THEN** the next item code issued is `I-00002` and the next vendor code is `V-00001`
