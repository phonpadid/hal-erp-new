## ADDED Requirements

### Requirement: Unmapped Account Roles Are Reported

The go-live inspection SHALL report each account role that a company's configuration requires and
nothing maps, as an `UNMAPPED_ACCOUNT_ROLE` finding naming the role and what it is for.

It belongs in this report by the report's own definition: a decision nobody has recorded, which
leaves somebody unable to do something. Until it is recorded every posting that resolves the role
fails, retries to its bound and parks — and the only place that says so is a screen nobody visits
until the ledger is already months empty.

The inspection SHALL stay read-only, and SHALL report only roles the company's configuration
requires, on the same derivation the mapping surface uses — asking for every role the system knows
would fill the report with accounts nobody needs and teach people to skim it.

#### Scenario: A company that pays but maps no clearing account is reported

- **GIVEN** a company whose document types settle payments and that maps no cash clearing account
- **WHEN** the go-live inspection runs
- **THEN** it reports an `UNMAPPED_ACCOUNT_ROLE` finding naming that role

#### Scenario: A role the company does not need is not reported

- **GIVEN** a company with no VAT tax code and no input VAT mapping
- **WHEN** the inspection runs
- **THEN** no finding is raised for the input VAT role

#### Scenario: A mapped role is not reported

- **GIVEN** a company that maps every role its configuration requires
- **WHEN** the inspection runs
- **THEN** no `UNMAPPED_ACCOUNT_ROLE` finding is raised for it

#### Scenario: The inspection still changes nothing

- **WHEN** the inspection runs against a database missing every mapping
- **THEN** no row is written in any table, including `account_role`
