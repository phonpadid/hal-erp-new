# go-live-configuration Specification

## Purpose

The commands that report and reconcile the per-company configuration a migrated, loginable database
needs before anyone can raise a document — document-type routing, form publication, approval chains,
and exchange rates.

A migration and a bootstrapped admin do not make a system usable. Every decision this capability
covers is the customer's to make, and this capability exists to ask for them and to record them —
never to supply them.
## Requirements
### Requirement: An Environment Can Be Asked What Configuration It Still Lacks

The system SHALL provide a read-only command that reports, per company, every decision standing
between a migrated, loginable database and one in which people can raise documents. It SHALL NOT
write to the database.

A migrated database with a bootstrapped account is not a usable one. Routing lives in
`dept_doc_type`, and an active `document_type` with no mapping cannot be raised by anyone — the
create wizard does not offer it, and `createDraft` cannot resolve a form or a workflow for it. The
customer's own database holds eleven such types, all of them the disbursement types the system was
bought for, and nothing in the product says so.

The report SHALL name, for the active company or every company:

- each active `document_type` with no active `dept_doc_type` mapping, and therefore no department
  that can raise it;
- each `dept_doc_type` whose `form_template` is not `PUBLISHED`;
- each `workflow` reachable from a mapping whose steps target individual users rather than roles,
  since such a chain stops when one named person leaves or is away;
- each `currency` appearing on an existing `document` for which no `exchange_rate` resolves, since
  a new document in that currency is refused at submit;
- each active `document_type` whose `post_action` places its content outside `document_line` and
  `doc_field_value` and which carries no `authoring_route`.

The command SHALL exit non-zero when anything is reported, so a pipeline can gate on it, and SHALL
say what would fix each item rather than only that it is wrong.

It SHALL be able to emit its findings as a configuration file template, pre-populated with the
subjects it found and blank slots for the decisions, so the answers are edited into a file rather
than composed from nothing.

#### Scenario: An unmapped type is reported

- **GIVEN** an active `document_type` with no active `dept_doc_type` row
- **WHEN** the check is run
- **THEN** it names that type as raisable by nobody, and exits non-zero

#### Scenario: A draft template behind a live mapping is reported

- **GIVEN** a `dept_doc_type` whose `form_template.status` is `DRAFT`
- **WHEN** the check is run
- **THEN** it names that mapping and its template

#### Scenario: A currency in use with no rate is reported

- **GIVEN** a `document` carrying a currency for which no `exchange_rate` resolves
- **WHEN** the check is run
- **THEN** it names that currency, because a new document in it would be refused at submit

#### Scenario: A person-targeted approval chain is reported

- **GIVEN** a workflow reachable from a mapping whose every step names an `approver_user_id`
- **WHEN** the check is run
- **THEN** it names that workflow, since the chain stops when that person is absent

#### Scenario: A fully configured company reports nothing

- **GIVEN** a company whose active types are all mapped to published templates, whose workflows
  target roles, and whose in-use currencies all resolve a rate
- **WHEN** the check is run
- **THEN** it reports nothing for that company and exits zero

#### Scenario: The check writes nothing

- **WHEN** the check is run against any database
- **THEN** no row is created, updated or deleted

### Requirement: Configuration Is Recorded From A Declarative File, Never Guessed

The system SHALL provide a command that reconciles a company's configuration to a declarative file:
`dept_doc_type` mappings, form-template publication, workflows and their steps, exchange rates, and
`document_type.authoring_route`.

The file is the record of what the customer decided. The command SHALL NOT supply a decision the
file omits: a document type the file does not mention SHALL be left exactly as it is and reported,
never mapped to a default department or a default workflow. Which department raises a disbursement
type, who approves it, and above what amount a further signature is required are answerable only by
the organisation being configured, and eleven wrong routes can be installed faster than one right
one.

Applying SHALL be idempotent: a file applied twice SHALL leave the database as the first
application left it, so the same file can be run against staging, reviewed, and run again against
production.

Applying SHALL be all-or-nothing per company. A file naming a department, workflow, form template or
currency that does not exist SHALL be refused before any write, so a single bad line cannot leave a
half-written routing table that no screen would reveal.

It SHALL write through the services that own each table rather than by direct SQL, so the rules
those services enforce — company isolation (invariant 1), a retired template cannot be mapped, a
reservation must be settleable — apply to a configuration file exactly as they apply to an
administrator using the screens.

#### Scenario: Applying a mapping makes a type raisable

- **GIVEN** an active `document_type` with no mapping, and a file naming its department, form
  template and workflow
- **WHEN** the file is applied
- **THEN** the mapping exists, the type is raisable by that department, and the check no longer
  reports it

#### Scenario: Applying twice changes nothing the second time

- **GIVEN** a file already applied to a database
- **WHEN** it is applied again
- **THEN** no row is created, updated or deleted

#### Scenario: A type the file omits is left alone

- **GIVEN** a file that mentions some but not all unmapped types
- **WHEN** it is applied
- **THEN** the omitted types keep exactly the configuration they had, and are reported as still
  unconfigured

#### Scenario: An unknown reference is refused before writing

- **GIVEN** a file naming a department that does not exist in the company
- **WHEN** it is applied
- **THEN** the command fails naming that department, and no row from the file has been written

#### Scenario: A cross-company mapping is refused

- **GIVEN** a file mapping a document type of one company to a department of another
- **WHEN** it is applied
- **THEN** it is refused, as the same mapping made through the configuration screen is refused

#### Scenario: Publication is part of reconciliation

- **GIVEN** a file naming a form template that is `DRAFT`
- **WHEN** it is applied
- **THEN** that template is `PUBLISHED`, and applying again leaves it `PUBLISHED`

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

