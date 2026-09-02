# web-documents

## ADDED Requirements

### Requirement: The Review Step Shows Every Value The Wizard Collected

The create wizard's review step SHALL present every document-level value the wizard asked the user
for, alongside the dynamic form fields and the lines it already shows. What is reviewed SHALL be
what is submitted.

Which values these are SHALL be derived from the same document-type configuration that decided
whether to ask for them — the flags governing budget, quota, vendor, payee, warehouse, destination
warehouse and related employee — rather than from a fixed list written into the review step. A
configuration flag that causes the wizard to collect a value therefore causes the review to display
it, and a value added later cannot be omitted by being forgotten here.

Where a required value has not been supplied, the review SHALL continue to mark it as missing.

#### Scenario: A stock document shows its warehouse

- **GIVEN** a document type requiring a warehouse, with one chosen in the wizard
- **WHEN** the review step renders
- **THEN** the chosen warehouse is shown

#### Scenario: An employee-bearing document shows its subject

- **GIVEN** a document type requiring a related employee, with one chosen in the wizard
- **WHEN** the review step renders
- **THEN** the chosen employee is shown

#### Scenario: A transfer shows both ends

- **GIVEN** a document type whose post action transfers stock, with a source and a destination chosen
- **WHEN** the review step renders
- **THEN** both warehouses are shown and are distinguishable

#### Scenario: A value the type does not ask for is not shown

- **GIVEN** a document type that requires no warehouse
- **WHEN** the review step renders
- **THEN** no warehouse is shown
