# web-account-roles Specification

## Purpose
TBD - created by archiving change account-roles-are-configurable. Update Purpose after archive.
## Requirements
### Requirement: The Roles Panel Shows What Is Mapped And What Is Missing

The chart-of-accounts screen SHALL show every system account role with the account it points at, on
that screen and not on one of its own.

A role mapping is a fact ABOUT the chart — which of these accounts is the clearing account — so it
belongs beside the accounts it names, under the same permission. A separate menu entry would be a
second place to remember for a decision that is part of setting up the chart.

A role this company's configuration requires and nothing maps SHALL be marked as missing and be
distinguishable at a glance from a role nobody needs. That distinction is the point of the screen:
the person setting the system up has to be able to see what will fail before it fails.

Each role SHALL be shown with what it is for, not only its code. `GRNI` names nothing to the person
who has to choose an account for it.

#### Scenario: Missing required roles stand out

- **GIVEN** a company that requires the cash clearing role and maps nothing to it
- **WHEN** a `COA_VIEW` user opens the chart-of-accounts screen
- **THEN** that role is shown as missing, and distinct from roles that are not required

#### Scenario: It is reached where the accounts are

- **WHEN** a `COA_VIEW` user opens the chart of accounts
- **THEN** the roles are on that screen, and no separate menu entry exists for them

#### Scenario: A mapped role shows its account

- **GIVEN** a role mapped to an account
- **WHEN** the screen is opened
- **THEN** the account's code and name are shown against that role

### Requirement: A Role Is Mapped From The Chart Screen

The panel SHALL let a `COA_MANAGE` holder choose an account for a role from that company's postable,
active accounts, and SHALL show the choice as saved once the server has confirmed it.

Without `COA_MANAGE` the panel SHALL remain readable and offer no way to change a mapping, mirroring
the server — the client guard is UX only.

The panel SHALL NOT offer to create an account. The table above it already does, and mixing the two
would blur what is being decided: which accounts exist, and which of them plays which part.

#### Scenario: Choosing an account records the mapping

- **WHEN** a `COA_MANAGE` user picks an account for a role and saves
- **THEN** the mapping is sent to the server and the screen shows the role as mapped to it

#### Scenario: A reader cannot change a mapping

- **GIVEN** a user with `COA_VIEW` and not `COA_MANAGE`
- **WHEN** they open the chart of accounts
- **THEN** the mappings are readable and no control offers to change one

#### Scenario: Only postable accounts are offered

- **WHEN** the account picker is opened for a role
- **THEN** it offers the company's active, postable accounts and no header accounts

