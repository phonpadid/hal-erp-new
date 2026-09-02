## ADDED Requirements

### Requirement: Derived-Quantity Types Are Submitted Through Their Own Capability

The system SHALL provide a `derives_quantity` flag on `document_type`, defaulting to false. When a document whose type has `derives_quantity` true is submitted through the generic submit endpoint, the system SHALL reject the submit, write no `quota_usage` or `budget_txn` row, and return an error naming the capability that owns the type. A type whose quantity is stated by the requester SHALL be unaffected.

This exists because a quantity that the system derives is not the client's to state. Generic submit cannot compute such a quantity itself — the rule belongs to a capability built after document-engine, which document-engine cannot import — so it declines instead, driven by configuration on its own table rather than by a dependency.

#### Scenario: A derived-quantity document is refused by generic submit

- **GIVEN** a document whose type has `derives_quantity` true
- **WHEN** it is submitted through the generic submit endpoint
- **THEN** the submit is rejected and no reservation of any kind is written

#### Scenario: The rejection tells the caller where to go

- **WHEN** a derived-quantity document is refused
- **THEN** the error identifies the endpoint that owns the type, rather than failing opaquely

#### Scenario: Ordinary types are unaffected

- **GIVEN** a document whose type has `derives_quantity` false
- **WHEN** it is submitted with a client-stated quantity
- **THEN** it submits exactly as before

#### Scenario: The flag defaults to false

- **GIVEN** a `document_type` created before this flag existed
- **WHEN** a document of that type is submitted
- **THEN** it behaves as it always has

## MODIFIED Requirements

### Requirement: Personal-Quota Beneficiary Resolution at Submit

The system SHALL resolve the beneficiary of each quota reservation server-side, within the submit transaction, before writing `quota_usage`, when a document that has `requires_quota = true` is submitted. For a reservation whose target `quota` is entitlement-scoped (has any `quota_entitlement` row), the system SHALL set the reservation's `employee_id` to the document's `related_employee_id` when the document carries one, and otherwise to the submitting user's own linked `employee` in the active company. The system SHALL in all cases ignore any `employee_id` supplied by the client, so a requester can never reserve against another employee's entitlement by editing the request. A `related_employee_id` MUST belong to the document's own company. If the target quota is entitlement-scoped, the document carries no `related_employee_id`, and the submitting user has no linked employee in the active company, the system SHALL reject the submit with a clear error and write no `quota_usage` row. For a pool quota (no entitlements), the system SHALL reserve with no `employee_id`.

#### Scenario: Personal quota reserves against the submitter's own employee

- **GIVEN** a submitting user linked to an employee, and a `requires_quota` draft with no `related_employee_id` reserving from a personal quota
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with the submitter's own `employee_id`, regardless of any employee id in the request body

#### Scenario: A document naming a related employee charges that employee

- **GIVEN** a `requires_quota` draft whose `related_employee_id` names another employee of the same company
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with that employee, not the submitter — the case where HR files on behalf of staff who have no login account

#### Scenario: The request body still cannot choose a beneficiary

- **GIVEN** a `requires_quota` draft with no `related_employee_id`
- **WHEN** the submit request body supplies an `employee_id` for another employee
- **THEN** it is ignored and the submitter's own employee is charged

#### Scenario: A related employee from another company is rejected

- **WHEN** a document's `related_employee_id` names an employee of a different company
- **THEN** the submit is rejected and no `quota_usage` row is written

#### Scenario: Personal quota with no linked employee is rejected

- **GIVEN** a submitting user with no linked employee in the active company, on a document with no `related_employee_id`
- **WHEN** they submit a `requires_quota` draft reserving from a personal quota
- **THEN** the submit is rejected with a clear error and no `quota_usage` row is written

#### Scenario: Pool quota reserves with no employee

- **GIVEN** a `requires_quota` draft reserving from a pool quota (no entitlements)
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is written with a null `employee_id`
