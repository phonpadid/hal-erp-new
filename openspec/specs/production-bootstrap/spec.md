# Production Bootstrap Specification

## Purpose
How a production database goes from "migrated and seeded" to "a person can sign in": the one
command that creates the minimum graph — a company, a department, an administrator role wired to
the permission catalog, an account, and the membership binding them — what it demands as input,
and when it must refuse. It exists because every ordinary way in requires a token, which requires
an account, and it is deliberately narrow: it takes no defaults, writes nothing when the database
already holds an account, is never reachable over the network, and is never run by a pipeline.

## Requirements

### Requirement: A Migrated Database Can Be Made Loginable By One Command

The system SHALL provide a command that takes a migrated database carrying the essential rows
(`permission`, `currency`, `notification_template`) to a state in which a named person can
authenticate and administer the system. The command SHALL create, in one invocation, a `company`,
a `department` in that company, a `role` in that company, the `role_permission` rows that give
that role its authority, an `app_user`, and the `user_company_role` binding the account to the
company, the department and the role.

The membership SHALL be marked as the account's default company, so that a single-company
installation issues a company-context token on login without a further selection step.

#### Scenario: A fresh production database becomes loginable

- **GIVEN** a database whose migrations and essentials seed have run, holding no `app_user` row
- **WHEN** the bootstrap command runs with all required inputs supplied
- **THEN** exactly one `company`, `department`, `role`, `app_user` and `user_company_role` row
  exist, and `POST auth/login` with the supplied credentials returns a company-context token for
  that company

#### Scenario: The created account can reach the administration surface

- **WHEN** the bootstrapped account authenticates
- **THEN** the token it receives carries the permission codes required to create roles, grant
  permissions, and assign users to companies through the product

### Requirement: The Bootstrap Refuses A Database That Already Holds An Account

The command SHALL abort without writing when the `app_user` table holds any row, regardless of
whether that account is an administrator, is active, or is reachable. It SHALL exit with a
non-zero status and a message stating that the database is already bootstrapped.

A database with accounts already has a way in. A command that mints an additional
all-permissions account beside the existing ones is a standing back door rather than a bootstrap,
and the answer to an administrator nobody can sign in as is a targeted grant against the known
account.

#### Scenario: A populated database is refused

- **GIVEN** a database holding at least one `app_user` row
- **WHEN** the bootstrap command runs
- **THEN** it exits non-zero, no `company`, `department`, `role`, `role_permission`, `app_user` or
  `user_company_role` row is written, and the existing rows are unchanged

#### Scenario: Refusal does not depend on the state of the existing account

- **GIVEN** a database whose only `app_user` row is inactive, unverified, or holds no membership
- **WHEN** the bootstrap command runs
- **THEN** it is refused on the same terms

### Requirement: The Bootstrap Takes Its Credentials From The Operator And Fails Closed

The command SHALL read the account username, the account email, the account password, the company
code, the company name and the company's base currency code from the environment, and SHALL abort
before opening a write transaction when any of them is absent or empty, naming the missing variable.
It SHALL NOT supply a default for any of them.

The base currency is required rather than inferred because more than one currency is seeded, and a
company created against the wrong one is not an error but every budget it holds denominated in a
currency nobody chose.

The password SHALL be validated against the same policy the product enforces when a user changes
their own password, and SHALL be stored as a hash produced by the application's password service.
The command SHALL NOT write the password to its output, on success or on failure.

The department SHALL NOT be an input: it exists only because `user_company_role` requires one, and
its code and name are already fixed by the shared company-provisioning routine.

#### Scenario: A missing credential aborts before any write

- **GIVEN** a database with no `app_user` row
- **WHEN** the bootstrap command runs with the password variable unset
- **THEN** it exits non-zero naming that variable, and no row is written

#### Scenario: A password the product would reject is refused here

- **WHEN** the bootstrap command runs with a password that fails the product's password policy
- **THEN** it exits non-zero and no `app_user` row is created

#### Scenario: The stored credential is a hash

- **WHEN** the bootstrap command completes
- **THEN** `app_user.password_hash` holds a hash that verifies the supplied password, and the
  supplied password appears nowhere in the command's output

### Requirement: The Bootstrapped Account Is Created Verified

The command SHALL set `app_user.email_verified_at` on the account it creates, because login
refuses an unverified account, verification is delivered by email, and a freshly provisioned
server has no mail transport configured.

This SHALL remain confined to the bootstrap: accounts created through the product's own
account-creation flow continue to require verification.

#### Scenario: The bootstrapped account logs in without a verification step

- **WHEN** the bootstrapped account authenticates with its credentials
- **THEN** login succeeds rather than failing with `EMAIL_NOT_VERIFIED`

### Requirement: The Bootstrap Role Carries The Permission Catalog At Company Scope

The command SHALL grant every ACTIVE code in the `permission` table to the created role, at
`COMPANY` scope, except the group-consolidated reporting code, which SHALL be granted at `GROUP`
scope, that being the only scope at which group reporting is meaningful.

The company graph — the role, its grants, the department and the membership — SHALL be produced by
the same routine the company-admin endpoint uses, so that the definition of what an administrator of
a new company may do exists in exactly one place. A second copy would not fail when the two
disagree; it would grant the wrong scope silently.

Granting less would reproduce the problem one level down, since an administrator who cannot reach
the authorization screens cannot create the roles that would grant them access. Granting `COMPANY`
rather than `GROUP` for everything else keeps the first administrator inside the single company the
bootstrap created.

#### Scenario: The role is granted the whole catalog

- **WHEN** the bootstrap command completes
- **THEN** a `role_permission` row exists for every active `permission` row, all at `COMPANY` scope
  except the group reporting code at `GROUP` scope

#### Scenario: A catalog that has grown is fully granted

- **GIVEN** an essentials seed that has added permission codes since the previous release
- **WHEN** the bootstrap command runs
- **THEN** the added codes are granted too, because the grant is driven by the table rather than by
  a list held in the command

### Requirement: The Bootstrap Is All-Or-Nothing

The command SHALL perform its writes within a single database transaction, so that a failure at any
point leaves the database exactly as it was.

A partial bootstrap is worse than none: a run that created the company but not the account would
leave a database that still answers "no accounts", and the next run would create a second company
beside the first.

#### Scenario: A failure part-way leaves nothing behind

- **GIVEN** a database with no `app_user` row
- **WHEN** the bootstrap command fails after creating the company but before the account is
  committed
- **THEN** no `company`, `department`, `role`, `role_permission`, `app_user` or `user_company_role`
  row remains

#### Scenario: Two simultaneous runs produce one bootstrap

- **WHEN** two invocations run concurrently against the same empty database
- **THEN** exactly one completes and the other fails without writing, the unique constraints on
  `app_user.username`, `app_user.email` and `company.code` deciding the outcome

### Requirement: The Bootstrap Verifies Its Prerequisites Before Writing

The command SHALL abort, naming the missing prerequisite and the command that supplies it, when
the `permission` table is empty or no `currency` row exists.

Both produce a bootstrap that reports success and is unusable — a role with no grants, or a
company with no base currency — and a silent failure on this database is the most expensive kind.

#### Scenario: An unseeded database is refused

- **GIVEN** a migrated database on which the essentials seed has not run
- **WHEN** the bootstrap command runs
- **THEN** it exits non-zero naming the essentials seed command, and no row is written

### Requirement: The Bootstrap Is Reachable Only From The Host

The bootstrap SHALL be exposed as a command run on a machine that already holds database
credentials, and SHALL NOT be exposed as an HTTP endpoint or any other network-reachable surface.

#### Scenario: No route creates the first administrator

- **WHEN** the application's routes are enumerated
- **THEN** none of them creates a company, a role, or an account without an authenticated,
  permission-bearing caller
