# web-master-data

## Purpose
The Vue vendor and item registry for end users: a single "Master data" area that browses
vendors and items, each row indicating whether the record is enabled for the active company.
Records are created and edited through `@primevue/forms` validated client-side against shared
Zod schemas that mirror the backend DTOs (the single source of truth), and they can be enabled
or disabled per active company so they become usable on (or are removed from) that company's
documents. Browsing is gated by the `MASTER_VIEW` permission code and create / edit /
enable / disable affordances by `MASTER_MANAGE` (client-side UX only; the server remains
authoritative and enforces company scope).

## Requirements

### Requirement: Vendor and Item Registry

The web app SHALL show a `MASTER_VIEW` user the vendor and item registries, each row indicating
whether the record is enabled for the active company. The registries SHALL be reachable from a
single "Master data" area.

#### Scenario: Lists vendors and items with enabled state

- **WHEN** a `MASTER_VIEW` user opens master data
- **THEN** vendors and items are listed, each showing whether it is enabled for the active company

### Requirement: Create and Edit Master Records

The web app SHALL let a `MASTER_MANAGE` user create and edit vendors and items through a form
validated client-side against a schema that mirrors the backend DTO (shared as the single source
of truth). Invalid input SHALL be blocked before submit.

#### Scenario: Required field blocks save

- **WHEN** the user submits a vendor or item form with a required field empty
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: Valid record is created

- **WHEN** the user submits a valid new vendor or item
- **THEN** it is created and appears in the registry

### Requirement: Enable or Disable for the Active Company

The web app SHALL let a `MASTER_MANAGE` user enable or disable a vendor or item for the active
company, and reflect the new state. Enabling makes the record usable on that company's documents;
disabling removes it from the enabled set. For an enabled item, the user SHALL set the item's GL
account for the active company from that company's postable accounts (a picker labelled
name + code, mirroring the budget picker; validated server-side); the group item form no longer
carries a GL field. For an enabled vendor, the user MAY set a per-company payment-term days that
overrides the group vendor's terms. The UI SHALL show the effective value in use.

#### Scenario: Enabling makes a record usable

- **WHEN** the user enables a vendor for the active company
- **THEN** the vendor appears as enabled and is available to that company's document lines

#### Scenario: Disabling removes it from the enabled set

- **WHEN** the user disables an item for the active company
- **THEN** the item no longer shows as enabled for that company

#### Scenario: Set the per-company item GL from the chart

- **WHEN** the user sets an item's GL for the active company from the postable-account picker
- **THEN** the chosen account's code is saved as `item_company.default_gl_account` and shown as
  the item's GL for that company

#### Scenario: Set a per-company vendor payment term

- **WHEN** the user sets a vendor's payment-term days for the active company
- **THEN** the value is saved as `vendor_company.payment_term_days` and shown as the effective
  terms; clearing it falls back to the group vendor's terms

#### Scenario: The group item form has no GL field

- **WHEN** the user creates or edits a group item
- **THEN** no GL field is shown there; the GL is set only per company on the enablement row

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

### Requirement: A Vendor's Bank Accounts Are Reachable From the Registry

The web app SHALL offer a `MASTER_VIEW` user a way from a vendor in the registry to that vendor's bank accounts. The entry point SHALL indicate when a vendor has no account at all, because a disbursement for such a vendor cannot be submitted and the registry is where someone would look for the reason.

#### Scenario: Reaching a vendor's accounts

- **WHEN** a `MASTER_VIEW` user opens a vendor in the registry
- **THEN** they can get to that vendor's bank accounts

#### Scenario: A vendor with no account is distinguishable

- **GIVEN** a vendor with no bank account
- **WHEN** the vendor registry is read
- **THEN** that vendor is marked as having none, so the reason a disbursement for it cannot be submitted is visible where the vendor is

### Requirement: Job-Level Management Surface

The web app SHALL provide a job-level management surface within the "Master data" area where a
`JOB_LEVEL_VIEW` user can list the active company's `job_level` rows (showing `code`, `name`,
`rank`, and active state) and a `JOB_LEVEL_MANAGE` user can create, edit, and deactivate them.
Create and edit SHALL use a form validated client-side against a shared Zod schema that mirrors
the backend DTO (the single source of truth), rejecting a duplicate `code` within the company and
a missing `code`/`name`/`rank` before submit. Deactivation SHALL set the row inactive rather than
delete it. The surface SHALL be scoped to the active company; switching the active company SHALL
reload the list. The affordances SHALL be gated by permission code as a UX-only guard, with the
server remaining authoritative for company scope and permission enforcement.

#### Scenario: List job levels for the active company

- **WHEN** a `JOB_LEVEL_VIEW` user opens the job-level surface
- **THEN** the active company's `job_level` rows are listed with `code`, `name`, `rank`, and
  active state

#### Scenario: Create a job level

- **WHEN** a `JOB_LEVEL_MANAGE` user submits a valid new job level (unique `code`, a `name`, and
  a `rank`)
- **THEN** it is created and appears in the list

#### Scenario: Duplicate code is blocked before submit

- **WHEN** the user enters a `code` that already exists in the active company
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: Deactivate a job level

- **WHEN** a `JOB_LEVEL_MANAGE` user deactivates a job level
- **THEN** it is marked inactive in the list and no longer offered as an assignable option in the
  employee and workflow-step editors

#### Scenario: Job-level management is permission-gated

- **WHEN** a user without `JOB_LEVEL_MANAGE` attempts to create, edit, or deactivate a job level
- **THEN** the affordances are unavailable and the server rejects any such request

#### Scenario: Job levels are scoped to the active company

- **WHEN** the user switches the active company
- **THEN** the job-level list reloads to show only that company's levels
