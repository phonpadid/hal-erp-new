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
The system SHALL keep items in a group-wide `item` table with a default GL account,
enabled per company via `item_company`.

#### Scenario: Default GL suggests the budget line
- GIVEN an item with a default GL account
- WHEN it is added to a document line
- THEN the line's GL account defaults from the item, editable by the user

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

