## ADDED Requirements

### Requirement: A Department Carries The Abbreviation Stamped On Its Paper Number

`department` SHALL carry an optional `short_name` (varchar): the abbreviation a company stamps in
the department position of a document's paper number (e.g. `ບຫ` for `ພະແນກບໍລິຫານ`). It SHALL be
read and written with the department through the existing company-scoped department endpoints
(invariant 1), validated as a trimmed string of at most 20 characters, and SHALL NOT be required to
be unique. It has no effect on the department tree, scope or routing; consumers that render a
paper-style number SHALL use it when set and `dept_code` otherwise.

#### Scenario: A department stores its abbreviation

- **WHEN** a `DEPARTMENT_MANAGE` user updates a department with `shortName` `ບຫ`
- **THEN** the department reads back with `shortName` `ບຫ` and its `dept_code` is unchanged

#### Scenario: An unset abbreviation falls back to the code

- **GIVEN** a department created without `shortName`
- **WHEN** a consumer renders a paper number for a document of that department
- **THEN** it uses `dept_code`
