## ADDED Requirements

### Requirement: Every System Role Can Be Read With Its Mapping

The system SHALL expose, for the active company, every account role it resolves — the role, what it
is for, and the account it currently points at, or nothing where it points at none.

The list SHALL come from the roles the code actually resolves, not from a list maintained beside
them: a role the GL asks for and the screen never shows is a posting that fails with nowhere to fix
it, which is the defect this capability exists to remove.

Reading SHALL require `COA_VIEW`.

#### Scenario: The roles and their accounts are readable

- **WHEN** a `COA_VIEW` user reads the account roles
- **THEN** every role the system resolves is listed, each with its mapped account or none

#### Scenario: A company sees only its own mappings

- **GIVEN** two companies that both map the cash clearing role
- **WHEN** one company's roles are read
- **THEN** only that company's mapping is returned

### Requirement: A Role Is Mapped To An Account Of The Same Company

The system SHALL let a `COA_MANAGE` holder point a role at an account, and change where it points.

The account SHALL belong to the active company and SHALL be active and postable; anything else is
refused by name. A role SHALL have at most one account per company, so setting it again replaces the
mapping rather than adding a second one the resolver would have to choose between.

An unknown role SHALL be refused by name rather than stored.

#### Scenario: A role is pointed at an account

- **WHEN** a `COA_MANAGE` user maps the cash clearing role to an account of their company
- **THEN** the mapping is stored and reading the roles returns it

#### Scenario: Re-mapping replaces rather than duplicates

- **GIVEN** a role already mapped to one account
- **WHEN** it is mapped to another
- **THEN** it points at the new account and only one mapping exists for that role

#### Scenario: Another company's account is refused

- **WHEN** a role is mapped to an account belonging to a different company
- **THEN** the request is refused and no mapping is written

#### Scenario: An unpostable or inactive account is refused

- **WHEN** a role is mapped to an account that is inactive, or that is a header rather than a
  postable account
- **THEN** the request is refused naming the reason, because a posting to it could never succeed

#### Scenario: Mapping a role writes no ledger row

- **WHEN** any role is mapped or re-mapped
- **THEN** no `journal_entry` and no `budget_txn` is written — the mapping only makes a future
  posting resolvable

### Requirement: A Company Is Told Which Roles Its Own Configuration Needs

The system SHALL report, per role, whether this company's configuration requires it, so the roles
that matter can be told from the ones that do not.

A role is required when something the company has configured will resolve it: paying anything
requires the cash clearing role; a VAT tax code requires the input VAT role; a document type that
accrues on approval requires a payable role; a stock-moving type requires the inventory roles. A
company that has configured none of those SHALL NOT be told it is missing them.

Requirement SHALL be derived from configuration, never from a fixed list of "important" roles — a
list maintained beside the rules it describes is a list that stops describing them.

#### Scenario: An unused role is not reported as missing

- **GIVEN** a company with no stock-moving document type
- **WHEN** its account roles are read
- **THEN** the inventory roles are shown as not required

#### Scenario: A configured need makes a role required

- **GIVEN** a company with an active VAT tax code
- **WHEN** its account roles are read
- **THEN** the input VAT role is shown as required, and as unmapped where nothing maps it
