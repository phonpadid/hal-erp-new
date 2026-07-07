## ADDED Requirements

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
