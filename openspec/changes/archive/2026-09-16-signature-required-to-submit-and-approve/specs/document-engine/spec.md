## ADDED Requirements

### Requirement: A Stamp Records Only What Was On File At The Act

`document.submitted_signature_id` SHALL only ever reference a `user_signature` that existed at the
document's `submitted_at`. For documents submitted before the stamp existed, the system SHALL
recover the stamp once, by data migration, as the latest `user_signature` of `document.created_by`
whose `uploaded_at` is at or before `submitted_at`; a document whose proposer had no signature on
file when they submitted SHALL keep a null stamp, however many signatures they upload afterwards,
and SHALL print a line to sign by hand. A later-uploaded image printed as the signature given at
submit would make the column untrue of some rows, and a stamp that is sometimes recovered and
sometimes invented is evidence of nothing. A `user_signature` referenced by any document's stamp
SHALL NOT be deletable, for the same reason one referenced by an `approval_log` row is not.

#### Scenario: A pre-existing document whose proposer had a signature at submit is stamped once

- **GIVEN** a document submitted before the stamp column existed, whose proposer had uploaded
  signature S1 before `submitted_at` and S2 after
- **WHEN** the backfill migration runs
- **THEN** `submitted_signature_id` = S1, and running the migration again changes nothing

#### Scenario: A proposer who uploaded only after submitting is not stamped

- **GIVEN** a document submitted before the stamp column existed, whose proposer's first signature
  was uploaded after `submitted_at`
- **WHEN** the backfill migration runs
- **THEN** `submitted_signature_id` stays null and the proposer block prints a ruled line

#### Scenario: A stamped signature cannot be deleted

- **GIVEN** a `user_signature` referenced by some document's `submitted_signature_id`
- **WHEN** its owner asks to delete it
- **THEN** the request is refused and the row and file remain

## MODIFIED Requirements

### Requirement: Document Submit Lifecycle

On submit the system SHALL, in a single transaction: validate that every required **and visible**
`form_field` has a value — a field whose `condition_json` evaluates to hidden is neither required
nor persisted; resolve and **lock** the FX rate at the submit date, stamping `exchange_rate`,
`base_total_amount`, and each line's `base_line_amount`; compute per-line input VAT from each
line's `tax_code` and stamp the line `tax_amount` and the document totals `sub_total` / `tax_total`
/ `grand_total` (a line with no tax code contributes `tax_amount` 0), with `base_total_amount`
reflecting the tax-inclusive grand total while the budget basis `budget_base_line_amount` stays
pre-tax (invariants 3, 4); reject the submit if the document's date falls in a CLOSED fiscal
period; reject any vendor or item not enabled for the active company; and then transition the
document from `DRAFT` to `SUBMITTED`. If any step fails, no holds are created and the document
stays `DRAFT`.

A submit made by a signed-in person SHALL additionally require that the submitter has a signature
on file: when `app_user.current_signature_id` of the submitting user is null the submit SHALL be
refused with the stable reason `SIGNATURE_REQUIRED` — before any hold is reserved, so the document
stays `DRAFT` with nothing to release — and the refusal SHALL name where a signature is uploaded.
When present, that signature SHALL be stamped on `document.submitted_signature_id` in the same
transaction and SHALL never be recomputed: like the FX rate, it records who put their name to the
request at the moment they did, and a later signature change does not rewrite it. A submit
authenticated by an API key (`external-api`) is a system speaking, not a person signing: it SHALL
NOT be refused for want of a signature and SHALL stamp `submitted_signature_id` null. A document
submitted before this column existed is stamped only with what its proposer had on file at the
time (see "A Stamp Records Only What Was On File At The Act") and remains valid either way.

#### Scenario: Submit locks the FX rate and base amounts

- **WHEN** a foreign-currency document is submitted
- **THEN** `exchange_rate` and `base_total_amount` are stamped from the rate resolved at
  the submit date, and a later rate change does not alter them

#### Scenario: Submit computes VAT and document totals

- **GIVEN** a document with lines of net 1000 and 2000, each with a 7% VAT code
- **WHEN** it is submitted
- **THEN** `sub_total` is 3000, `tax_total` is 210, and `grand_total` is 3210, while the reserved
  budget uses the pre-tax line base

#### Scenario: Missing required field blocks submit

- **GIVEN** a required `form_field` with no `doc_field_value`
- **WHEN** the document is submitted
- **THEN** submission is rejected and the document remains `DRAFT`

#### Scenario: Hidden required field does not block submit

- **GIVEN** a required `form_field` whose `condition_json` evaluates to hidden for the document's values
- **WHEN** the document is submitted without a value for that field
- **THEN** submission is not blocked by that field and any stored value for it is ignored

#### Scenario: Submit into a closed period is rejected

- **WHEN** a budget-consuming document dated in a CLOSED fiscal year is submitted
- **THEN** submission is rejected with a closed-period error

#### Scenario: Submit stamps the submitter's signature

- **GIVEN** a person whose `app_user.current_signature_id` references signature S1
- **WHEN** they submit their draft
- **THEN** `document.submitted_signature_id` = S1, and replacing their signature with S2 afterwards
  leaves the document pointing at S1

#### Scenario: A person without a signature cannot submit

- **GIVEN** a person with no current signature and a valid `requires_budget` draft
- **WHEN** they submit it
- **THEN** the submit is refused with reason `SIGNATURE_REQUIRED`, no `budget_txn` RESERVE row is
  written, and the document remains `DRAFT`

#### Scenario: An API key submits without a signature

- **GIVEN** a valid draft created by an external system
- **WHEN** an API-key request submits it
- **THEN** the submit proceeds as before and `document.submitted_signature_id` is null
