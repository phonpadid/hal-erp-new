## MODIFIED Requirements

### Requirement: Permission-Gated Master-Data Affordances

Browsing SHALL require `MASTER_VIEW`; create, edit, and enable/disable affordances SHALL be shown
only with `MASTER_MANAGE` (UX only; the server still enforces). A vendor's **bank-account**
affordances SHALL be gated on `VENDOR_BANK_MANAGE` instead, never on `MASTER_MANAGE`: redirecting a
payee account needs no approval, leaves no document, and pays out on the next run, so it MUST NOT
ride along with editing a vendor's contact details.

#### Scenario: Manage actions hidden without permission

- **WHEN** a user with `MASTER_VIEW` but not `MASTER_MANAGE` opens master data
- **THEN** the create / edit / enable / disable controls are not shown

#### Scenario: Vendor editing does not confer bank-account editing

- **WHEN** a user with `MASTER_MANAGE` but not `VENDOR_BANK_MANAGE` opens a vendor
- **THEN** they may edit the vendor, and the vendor's bank-account controls are not shown

## ADDED Requirements

### Requirement: A Vendor's Bank Accounts Are Reachable From the Registry

The web app SHALL offer a `MASTER_VIEW` user a way from a vendor in the registry to that vendor's bank accounts. The entry point SHALL indicate when a vendor has no account at all, because a disbursement for such a vendor cannot be submitted and the registry is where someone would look for the reason.

#### Scenario: Reaching a vendor's accounts

- **WHEN** a `MASTER_VIEW` user opens a vendor in the registry
- **THEN** they can get to that vendor's bank accounts

#### Scenario: A vendor with no account is distinguishable

- **GIVEN** a vendor with no bank account
- **WHEN** the vendor registry is read
- **THEN** that vendor is marked as having none, so the reason a disbursement for it cannot be submitted is visible where the vendor is
