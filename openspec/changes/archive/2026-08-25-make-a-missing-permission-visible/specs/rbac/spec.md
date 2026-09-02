## ADDED Requirements

### Requirement: The Application Reports A Catalog It Cannot Fully Honour

The application SHALL, at startup, compare the permission codes it declares against the rows in the
`permission` table, and SHALL report every declared code that has no row. The report SHALL name the
codes rather than only counting them, because the operator's next question is always which ones.

The application SHALL NOT refuse to start on a short catalog. An installation missing some codes
still serves every capability whose codes are present, and refusing to boot would turn a partial
gap into a total outage. The application SHALL NOT insert the missing rows either: reconciling is a
deliberate, separately invoked act, and a write on every process start would make the catalog
change without anyone asking it to.

This covers the case the reconcile command and the read-only check do not: an environment whose
database arrived without a deploy — a restore, a clone, a snapshot — and so never met either.

#### Scenario: A restored database is short of codes

- **GIVEN** a database restored from an environment older than a slice that declares new codes
- **WHEN** the application starts
- **THEN** it logs a report naming each declared code with no row, and continues serving

#### Scenario: A complete catalog is not reported as a problem

- **GIVEN** an environment whose catalog holds a row for every declared code
- **WHEN** the application starts
- **THEN** no missing-code report is emitted

#### Scenario: Startup writes no permission row

- **GIVEN** an environment whose catalog is short
- **WHEN** the application starts
- **THEN** the `permission` table is unchanged, and the codes are still missing until the reconcile
  command is run

#### Scenario: The comparison has one source

- **WHEN** the startup report and the read-only check command are compared
- **THEN** both derive the declared codes and the missing set from the same functions, so the two
  can never disagree about what an environment is missing

## MODIFIED Requirements

### Requirement: Authorization Read Surface

The system SHALL provide reads, under `RBAC_MANAGE` and scoped to the active company, of: the
company's roles each with their permission grants (`code`, `name`, `scope`); the permission
catalog (`code`, `name`, `module`); and users with their active-company assignments (role,
department, default flag, validity window). User accounts are global; assignments are
company-scoped.

The permission-catalog read SHALL additionally report the declared codes that have no row, so that
an administrator can tell a catalog that is complete from one that is short. A code with no row
cannot be granted to anyone, so its absence is not a detail of the listing — it is the reason a
capability is unreachable for every user in the installation, including an administrator holding
every code the catalog does offer.

#### Scenario: Roles include their grants

- **WHEN** an `RBAC_MANAGE` user lists roles
- **THEN** each active-company role is returned with its granted permission codes and scopes

#### Scenario: Users include their active-company assignments

- **WHEN** an `RBAC_MANAGE` user lists users
- **THEN** each user's assignments in the active company are returned (and not those of other
  companies)

#### Scenario: The catalog read names what it cannot offer

- **GIVEN** an environment whose `permission` table is short of declared codes
- **WHEN** an `RBAC_MANAGE` user reads the permission catalog
- **THEN** the response carries those declared-but-absent codes, distinct from the codes it lists
  as grantable

#### Scenario: A complete catalog reports nothing absent

- **GIVEN** an environment whose catalog holds a row for every declared code
- **WHEN** an `RBAC_MANAGE` user reads the permission catalog
- **THEN** the response reports no absent codes
