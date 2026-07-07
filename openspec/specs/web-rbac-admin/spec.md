# web-rbac-admin

## Purpose
The Vue access-administration area for the active company: a single screen where an
`RBAC_MANAGE` user manages roles and their permission grants — each grant pairing a
permission code from the catalog with a data-visibility scope — and assigns roles to
users (with department, an optional default, and a validity window). Roles and
assignments are company-scoped (user accounts are global, but their access is
per-company), so switching the active company changes what is shown and managed. The
navigation, lists, and actions are gated by the `RBAC_MANAGE` permission code as a
UX-only guard; the server remains authoritative and enforces company scope.

## Requirements

### Requirement: Role and Permission Management

The web app SHALL let an `RBAC_MANAGE` user list the active company's roles, create a role, view
a role's permission grants, add a grant (a permission code with a data-visibility scope), and
detach a grant. Available permission codes SHALL come from the permission catalog, and the picker
SHALL offer the **complete** catalog (paging the catalog endpoint to exhaustion rather than a
single capped page) so every code is selectable; picker options SHALL be grouped by permission
`module`.

A role's grants SHALL be presented so the roles list stays usable for **any** number of grants:
the roles table cell SHALL show only a **bounded summary** (a grant count plus at most a few grant
labels and a "+N more" / manage affordance) with a constant row height, never an unbounded chip
cloud that grows the row vertically. The full set of a role's grants SHALL be viewed and edited in
a dedicated manage-permissions surface that groups grants by permission `module`, offers a text
filter over grants, confines the list to a fixed-height **scroll** region, removes a grant in
place, and adds a grant without leaving that surface. All chrome (summary, group headers, filter
placeholder, empty states) SHALL come from i18n with en/la parity and use PrimeUI theme tokens so
it renders correctly in light and dark mode.

#### Scenario: Create a role and grant a permission

- **WHEN** an `RBAC_MANAGE` user creates a role and adds a permission code with a scope
- **THEN** the role appears with that grant reflected in its grant summary and in its manage view

#### Scenario: Detach a grant

- **WHEN** the user detaches a permission from a role
- **THEN** that grant no longer appears on the role

#### Scenario: Roles list stays bounded with many grants

- **WHEN** a role has many permission grants and its row is shown in the roles table
- **THEN** the cell shows a bounded summary (count plus a "+N more" / manage affordance) and the row
  height does not grow with the number of grants

#### Scenario: Manage a role's grants grouped and scrollable

- **WHEN** the user opens a role's manage-permissions surface
- **THEN** the role's grants are listed grouped by `module`, filterable by text, and confined to a
  fixed-height scroll region, with a remove control on each grant and an add-grant control in the
  same surface

#### Scenario: Picker offers the full catalog grouped by module

- **WHEN** the user opens the add-grant permission picker for a company with more permissions than
  one catalog page
- **THEN** the picker lists every catalog permission, grouped by `module`, with filtering, and none
  are silently truncated

### Requirement: User Role Assignments

The web app SHALL let an `RBAC_MANAGE` user list users with their assignments in the active
company, assign a role (role + department, optional default and a validity window of
`valid_from`/`valid_to` for temporary or acting authority), remove a single assignment, and revoke
all of a user's access to the active company. The assign form SHALL expose `valid_from` and
`valid_to` date inputs (e.g. behind an "acting / temporary" affordance) and SHALL reject a window
where `valid_to` precedes `valid_from`. Each listed assignment SHALL display its validity window
when set, and SHALL visibly flag assignments that are expired or expiring.

#### Scenario: Assign a role to a user

- **WHEN** the user assigns a role and department to a user
- **THEN** the assignment appears under that user for the active company

#### Scenario: Assign acting authority with a validity window

- **WHEN** the user assigns a role with a `valid_from` and `valid_to`
- **THEN** the assignment appears with that validity window shown

#### Scenario: Invalid validity window is rejected

- **WHEN** the user sets a `valid_to` earlier than `valid_from`
- **THEN** the form shows a validation error and does not submit

#### Scenario: Remove an assignment

- **WHEN** the user removes one of a user's assignments
- **THEN** that assignment no longer appears

### Requirement: Company-Scoped Access Administration

Roles and assignments shown and managed SHALL be those of the active company; switching the
active company SHALL change the roles and assignments shown. User accounts are global, but their
assignments are per-company.

#### Scenario: Roles are scoped to the active company

- **WHEN** the admin views roles while a company is active
- **THEN** only that company's roles are listed

### Requirement: Permission-Gated Access Administration

The access-admin navigation, lists, and actions SHALL be shown only to users holding
`RBAC_MANAGE` (UX only; the server still enforces).

#### Scenario: Access admin hidden without permission

- **WHEN** a user without `RBAC_MANAGE` is signed in
- **THEN** the access-admin navigation entry is not shown

### Requirement: Cross-Company Assignments View

The web app SHALL let an `RBAC_MANAGE` user open a read-only view of a single user's active
assignments across the companies the requester may administer, showing for each the company, role,
department, and validity window. The view SHALL NOT offer cross-company edit actions.

#### Scenario: View a user's authority across companies

- **WHEN** the admin opens the cross-company assignments view for a user
- **THEN** the user's active assignments in companies the admin administers are listed with company,
  role, department, and validity window

#### Scenario: View is read-only

- **WHEN** the admin opens the cross-company assignments view
- **THEN** no edit or delete action is offered within that view
