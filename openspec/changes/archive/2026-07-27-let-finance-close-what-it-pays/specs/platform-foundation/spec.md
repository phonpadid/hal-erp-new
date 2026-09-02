## ADDED Requirements

### Requirement: The Seeded Finance Roles Can Record A Payment

The seeded baseline SHALL grant the finance roles the permissions that read the ready-to-pay queue and record a payment against it, so that a freshly seeded system can carry a disbursement from approval to settlement without the administrator account.

The seeded baseline SHALL NOT grant those roles the permission to delete a payment slip. A slip is the audit record of a payment, and the authority to record one is a separate decision from the authority to destroy the evidence of one; a company that wants them held by the same people SHALL grant that deliberately rather than inherit it.

#### Scenario: Finance can reach its own worklist

- **GIVEN** a freshly seeded database
- **WHEN** a user holding the finance role reads the list of approved-but-unsettled documents
- **THEN** the list is returned rather than refused

#### Scenario: Finance can close out an approved disbursement

- **GIVEN** a fully approved document awaiting settlement
- **WHEN** a user holding the finance role records the payment
- **THEN** the settlement is recorded

#### Scenario: Recording is not permission to erase

- **GIVEN** a freshly seeded database
- **WHEN** the finance roles' permissions are examined
- **THEN** they carry no permission to delete a payment slip
