## ADDED Requirements

### Requirement: Personal-Quota Beneficiary Resolution at Submit

The system SHALL resolve the beneficiary of each quota reservation server-side, within the submit
transaction, before writing `quota_usage`, when a document that has `requires_quota = true` is
submitted. For a reservation whose target `quota` is entitlement-scoped (has any
`quota_entitlement` row), the system SHALL set the reservation's `employee_id` to the submitting
user's own linked `employee` in the active company — ignoring any `employee_id` supplied by the
client — so a requester can never reserve against another employee's entitlement. If the target
quota is entitlement-scoped and the submitting user has no linked employee in the active company,
the system SHALL reject the submit with a clear error and write no `quota_usage` row. For a pool
quota (no entitlements), the system SHALL reserve with no `employee_id`.

#### Scenario: Personal quota reserves against the submitter's own employee

- **GIVEN** a submitting user linked to an employee, and a `requires_quota` draft reserving from a
  personal quota
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with the submitter's own `employee_id`, regardless
  of any employee id in the request body

#### Scenario: Personal quota with no linked employee is rejected

- **GIVEN** a submitting user with no linked employee in the active company
- **WHEN** they submit a `requires_quota` draft reserving from a personal quota
- **THEN** the submit is rejected with a clear error and no `quota_usage` row is written

#### Scenario: Pool quota reserves with no employee

- **GIVEN** a `requires_quota` draft reserving from a pool quota (no entitlements)
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is written with a null `employee_id`
