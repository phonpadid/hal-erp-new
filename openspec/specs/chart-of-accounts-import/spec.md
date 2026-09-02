# chart-of-accounts-import Specification

## Purpose
TBD - created by archiving change import-chart-of-accounts. Update Purpose after archive.
## Requirements
### Requirement: Chart Import Command

The system SHALL provide an operator-run command that reads one or more spreadsheet files holding
a chart of accounts and creates `account` rows for a single named company. The command SHALL
require the target company to be named explicitly and SHALL refuse to run without one; it SHALL
NOT default to a company, however few exist.

The command SHALL accept both BIFF (`.xls`) and OOXML (`.xlsx`) workbooks, because the customer's
own exports are of both kinds.

This is a bootstrap step for a company being set up, not a route: an upload endpoint carries a
permission, a file-size limit and a result screen, and none of those is what a one-off chart load
needs.

#### Scenario: A company must be named

- **WHEN** the command is run without naming a company
- **THEN** it refuses and writes nothing

#### Scenario: An unknown company is refused

- **WHEN** the command names a company code that does not exist
- **THEN** it refuses, names the code, and writes nothing

#### Scenario: Both workbook formats are read

- **WHEN** the command is given a `.xls` file and a `.xlsx` file in one run
- **THEN** both are read and their accounts are merged into one chart

### Requirement: The Header Row Is Located, Not Assumed

The reader SHALL locate the header row by its labels — `ເລກບັນຊີ` or `Acct. No.` — and SHALL take
each field's column position from that row. It SHALL NOT assume a fixed row or column offset. A
file in which no header row can be located SHALL be refused, naming the file.

The customer's two exports put the header on different rows, and every one of these files opens
with a title block of merged cells. A fixed offset reads the wrong columns of the next export
without failing.

#### Scenario: Files with the header on different rows both load

- **GIVEN** one file with its header on row 14 and another on row 13
- **WHEN** both are read
- **THEN** both yield accounts, with code, name and type taken from the located columns

#### Scenario: A file with no recognizable header is refused

- **WHEN** a file contains no row holding `ເລກບັນຊີ` or `Acct. No.`
- **THEN** the run is refused naming that file, and no account is written from any file

### Requirement: Files Are Merged Before Anything Is Written

When several files are given, the importer SHALL merge them into a single set of accounts keyed by
code, and SHALL derive the hierarchy over that merged set rather than per file. A code appearing in
more than one file with conflicting values SHALL be reported and the run refused.

The customer's company-specific chart holds accounts whose parents exist only in the parent chart;
deriving per file would leave every one of them parentless.

#### Scenario: An account's parent may come from another file

- **GIVEN** a file holding `1017.0001` and another holding `1017`
- **WHEN** both are imported in one run
- **THEN** `1017.0001` is created with `1017` as its `parent_id`

#### Scenario: A code appearing twice with different content refuses the run

- **WHEN** two files hold the same code with different names or types
- **THEN** the run is refused, naming the code and both values, and nothing is written

### Requirement: Hierarchy Derived From the Longest Existing Code Prefix

The importer SHALL set an account's `parent_id` to the account whose code is the **longest proper
prefix** of the child's code among the accounts in the merged set, considering the code with its
dotted tail removed and then with digits trimmed one at a time. An account for which no such
account exists SHALL be created with no parent.

Depth SHALL NOT be inferred from the shape of a code — from its length, or from how many separators
it contains. Only membership in the imported set decides.

#### Scenario: The nearest existing ancestor wins

- **GIVEN** a set containing `1`, `12`, `1213` and `1213110.20` but not `1213110`
- **WHEN** the hierarchy is derived
- **THEN** `1213110.20` is given `1213` as its parent, not `1` or `12`

#### Scenario: A class head has no parent

- **WHEN** an account's code has no proper prefix in the set
- **THEN** it is created with `parent_id` null

#### Scenario: Shape is not read as depth

- **GIVEN** two codes of equal length whose only difference is where a separator falls
- **WHEN** the hierarchy is derived
- **THEN** neither is made the other's parent on account of its shape

### Requirement: Postability Derived From Having Children

The importer SHALL set `is_postable = false` on every imported account that has at least one child
in the merged set, and `is_postable = true` on every account that has none. It SHALL NOT read
postability from a column of the source file.

A summary node is not a posting target, and the resolver every other capability calls already
refuses one. The source files carry no postable column; the column that resembles one is spread
evenly across accounts that do and do not have children, so it means something else.

#### Scenario: A header is not postable

- **GIVEN** account `1017` with children `1017.0001` and `1017.0002`
- **WHEN** the import completes
- **THEN** `1017` has `is_postable = false` and both children have `is_postable = true`

#### Scenario: A leaf is postable

- **WHEN** an imported account has no child in the merged set
- **THEN** it is created with `is_postable = true`

### Requirement: Account Type From the Source, With a Stated Fallback

The importer SHALL map the source's account-class column to `account_type`. When a row's class is
not one the system holds, the importer SHALL take the `account_type` of the nearest ancestor whose
class is one the system holds. When no such ancestor exists, the importer SHALL skip the row and
SHALL name it in the report.

A row skipped this way SHALL NOT be created with a guessed type: filing a real account under a
class its owner did not put it in is worse than leaving it out and saying so.

#### Scenario: A row's own class is used when the system holds it

- **WHEN** a row's class is one of the mapped classes
- **THEN** the account is created with the matching `account_type`

#### Scenario: An unmapped class inherits from the nearest typed ancestor

- **GIVEN** a row whose class is unmapped and whose parent is an `ASSET`
- **WHEN** the import runs
- **THEN** the account is created as `ASSET`

#### Scenario: A row with no typed ancestor is skipped and named

- **GIVEN** a row whose class is unmapped and whose ancestors are all unmapped
- **WHEN** the import runs
- **THEN** no account is created for it, and the report names the code and its class

### Requirement: Dry Run Writes Nothing

The command SHALL support a dry run that reports exactly what a real run would do — the counts to
be created, each derived parent, every skipped row with its reason, and every child whose
`account_type` differs from its parent's — while opening no write transaction.

#### Scenario: A dry run leaves the database untouched

- **WHEN** the command is run with the dry-run flag against a company holding no accounts
- **THEN** the report is produced and the company still holds no accounts

#### Scenario: The dry run reports what the real run reports

- **WHEN** a dry run and then a real run are made over the same files
- **THEN** the counts reported by the two runs agree

### Requirement: Import Is Idempotent by Company and Code

An account whose `(company_id, code)` already exists SHALL be left unchanged and counted as
unchanged. The importer SHALL NOT update, rename, re-parent or duplicate an existing account.

An import is not a synchronisation. Overwriting a name someone corrected in the application,
because a stale export still carries the old one, is a worse failure than doing nothing.

#### Scenario: A second run creates nothing

- **GIVEN** a company whose chart was imported from a set of files
- **WHEN** the same files are imported again
- **THEN** no account is created, none is modified, and every row is reported as unchanged

#### Scenario: A later file adds only what is new

- **GIVEN** a company holding an imported chart
- **WHEN** a file holding both existing codes and new ones is imported
- **THEN** only the new codes are created and the existing rows are untouched

### Requirement: All Or Nothing, Scoped to One Company

The importer SHALL write every account of a run inside a single database transaction, so that a
failure part-way leaves the company's chart as it was. Every account it writes SHALL carry the
named company (invariant: company isolation), and a run SHALL NOT write an account to any other
company.

#### Scenario: A failure part-way writes nothing

- **GIVEN** a run that fails while linking parents
- **WHEN** the failure is raised
- **THEN** the company holds no account from that run

#### Scenario: Accounts land in the named company only

- **WHEN** a chart is imported for company A while company B also exists
- **THEN** every created account belongs to company A and company B's chart is unchanged

