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
cloud that grows the row vertically.

The full set of a role's grants SHALL be viewed and edited in a dedicated manage-permissions
surface that presents the **whole catalog as a multi-select diff editor**: every catalog
permission is listed, grouped by `module`, with a checkbox whose checked state means "this role
holds this permission". Ticking an unheld permission stages a grant; unticking a held one stages a
detach. A checked row SHALL expose that grant's data-visibility scope, defaulting to `DEPARTMENT`
for a newly staged grant and showing the stored scope for a held one; changing that scope SHALL be
staged as part of the edit. The surface SHALL offer a control that applies one scope to all
currently checked rows.

The surface SHALL group rows by `module`, offer a text filter over permission code and name,
confine the list to a fixed-height **scroll** region, and show a running summary of staged changes
(counts of grants to add, grants to remove, and scopes to change) before they are committed. The
staged edit SHALL be committed in **one** request via the bulk role-permission write surface, and
the client SHALL reload role state **once** per commit rather than once per changed permission.
Committing an edit that stages a detach SHALL require confirmation. Discarding the surface without
committing SHALL leave the role's grants unchanged.

All chrome (summary, group headers, filter placeholder, staged-change counts, scope control, empty
states) SHALL come from i18n with en/la parity and use PrimeUI theme tokens so it renders correctly
in light and dark mode.

#### Scenario: Create a role and grant a permission

- **WHEN** an `RBAC_MANAGE` user creates a role, ticks a permission, sets its scope, and commits
- **THEN** the role appears with that grant reflected in its grant summary and in its manage view

#### Scenario: Grant many permissions in one commit

- **WHEN** the user ticks several permissions in the manage surface and commits once
- **THEN** all of them are granted in a single request and the roles list reflects every new grant

#### Scenario: Detach a grant

- **WHEN** the user unticks a held permission, confirms, and commits
- **THEN** that grant no longer appears on the role

#### Scenario: Add and remove in the same commit

- **WHEN** the user ticks two unheld permissions, unticks one held permission, confirms, and commits
- **THEN** the two are granted and the one is detached, and the role's other grants are unchanged

#### Scenario: Change the scope of a held grant

- **WHEN** the user changes a held permission's scope from `DEPARTMENT` to `COMPANY` and commits
- **THEN** that grant is shown with scope `COMPANY` and no duplicate grant appears for that code

#### Scenario: Apply one scope to every checked permission

- **WHEN** the user has several permissions checked and applies a scope with the bulk scope control
- **THEN** every checked row shows that scope as staged, and unchecked rows are unaffected

#### Scenario: Discarding leaves the role unchanged

- **WHEN** the user stages several ticks and unticks and then closes the surface without committing
- **THEN** the role's grants are exactly as they were before the surface was opened

#### Scenario: Roles list stays bounded with many grants

- **WHEN** a role has many permission grants and its row is shown in the roles table
- **THEN** the cell shows a bounded summary (count plus a "+N more" / manage affordance) and the row
  height does not grow with the number of grants

#### Scenario: Surface offers the full catalog grouped by module

- **WHEN** the user opens the manage-permissions surface for a company with more permissions than
  one catalog page
- **THEN** every catalog permission is listed, grouped by `module`, filterable by text, confined to
  a fixed-height scroll region, and none are silently truncated

### Requirement: User Role Assignments

The web app SHALL let an `RBAC_MANAGE` user list users with their assignments in the active
company, assign roles to a user, remove a single assignment, and revoke all of a user's access to
the active company.

The assign surface SHALL collect the assignment context **once** — department, an optional default
flag, and an optional validity window of `valid_from`/`valid_to` behind an "acting / temporary"
affordance — and SHALL then let the user select **multiple roles** by checkbox in one pass. Roles
the user already holds in the active company SHALL be shown as already-held and SHALL NOT be
offered as a new selection. Committing SHALL create one assignment per selected role against that
shared context in a **single** request via the bulk assignment write surface, and the client SHALL
reload user state **once** per commit rather than once per role. Assigning roles under a different
department means committing a second batch with that department selected.

The surface SHALL reject a window where `valid_to` precedes `valid_from`, and SHALL NOT submit when
no role is selected. Each listed assignment SHALL display its validity window when set, and SHALL
visibly flag assignments that are expired or expiring.

#### Scenario: Assign a role to a user

- **WHEN** the user selects a department, checks one role, and commits
- **THEN** the assignment appears under that user for the active company

#### Scenario: Assign several roles in one commit

- **WHEN** the user selects a department, checks three roles, and commits
- **THEN** three assignments appear under that user, all with that department, created in a single
  request

#### Scenario: Acting window applies to every selected role

- **WHEN** the user enables the acting affordance, sets a `valid_from` and `valid_to`, checks two
  roles, and commits
- **THEN** both assignments appear with that same validity window shown

#### Scenario: Already-held roles are not offered

- **GIVEN** a user who already holds role A in the active company
- **WHEN** the admin opens the assign surface for that user
- **THEN** role A is shown as already held and cannot be selected for a new assignment

#### Scenario: Invalid validity window is rejected

- **WHEN** the user sets a `valid_to` earlier than `valid_from`
- **THEN** the form shows a validation error and does not submit

#### Scenario: No selection does not submit

- **WHEN** the user opens the assign surface and commits without checking any role
- **THEN** the form shows a validation error and no request is sent

#### Scenario: Remove an assignment

- **WHEN** the user removes one of a user's assignments
- **THEN** that assignment no longer appears
