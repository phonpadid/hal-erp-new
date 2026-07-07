## MODIFIED Requirements

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
