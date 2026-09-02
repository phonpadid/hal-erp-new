## MODIFIED Requirements

### Requirement: ORM entities mirror the canonical DBML

The backend SHALL define a MikroORM entity for every table in `erp_approval_system.dbml`, using the exact table and column names from the DBML. The DBML SHALL be complete: a table that exists in the database and is not the ORM's own migration bookkeeping SHALL be declared there. Neither this requirement nor any other SHALL state how many tables there are — a count in prose goes stale silently and then reads as a rule.

Every foreign key declared by a `Ref:` line SHALL be modeled as a MikroORM relation, and the DBML enums (`doc_status`, `budget_txn_type`, `doc_category`, `approve_action`, `control_policy`) SHALL be represented as TypeScript enums backed by their string values. An initial migration generated from these entities SHALL produce a schema that matches the DBML.

#### Scenario: All tables have entities

- **WHEN** the entity layer is loaded by MikroORM metadata discovery
- **THEN** there is exactly one entity mapped to each DBML table, with the same table name and column names

#### Scenario: A table in the database is a table in the DBML

- **WHEN** the tables in a migrated database are compared with those declared in the DBML
- **THEN** the only difference is the ORM's own migration-bookkeeping table

#### Scenario: Foreign keys are relations

- **WHEN** an entity references another table per a DBML `Ref:` line (e.g.
  `budget_txn.budget_id > budget.id`)
- **THEN** the owning entity exposes a typed relation to the referenced entity using
  the same FK column

#### Scenario: Migration reproduces the schema

- **WHEN** the initial migration is run against an empty PostgreSQL database
- **THEN** the resulting schema matches the DBML tables, columns, and foreign keys

## ADDED Requirements

### Requirement: A Constraint The Entities Express Is Enforced By The Database

Where an entity constrains a column — a fixed set of permitted values, or a value that must be present — the deployed schema SHALL carry that constraint too.

A rule held in one layer only is not enforced, it is intended. The specs build their schema from the entities and the deployed database is built from the migrations, so a constraint the migrations never learned about is absent from precisely the database that matters, and absent in a way no passing test can reveal.

In particular: a column whose entity declares a fixed set of values SHALL reject a value outside that set, and a column whose entity supplies a default and permits no absence SHALL reject an absent one. Closing such a difference SHALL NOT rewrite existing data — where existing rows would violate the constraint, that is a finding about the data and SHALL be decided on its own terms rather than repaired inside the migration that adds the constraint.

#### Scenario: A status outside the declared set is refused

- **GIVEN** a column whose entity declares a fixed set of statuses
- **WHEN** a value outside that set is written directly to the database
- **THEN** the write is rejected

#### Scenario: An amount the entity always supplies cannot be absent

- **GIVEN** a column whose entity supplies a default and does not permit absence
- **WHEN** a row is written without a value for it
- **THEN** the stored value is the default rather than an absent one

#### Scenario: Closing the difference leaves the data alone

- **WHEN** a migration adds a constraint the entities already expressed
- **THEN** no existing row's values are changed by it
