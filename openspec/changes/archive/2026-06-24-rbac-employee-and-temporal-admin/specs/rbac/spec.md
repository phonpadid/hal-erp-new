## ADDED Requirements

### Requirement: Cross-Company Assignment Read

The system SHALL provide a read-only surface that, given a `userId`, returns that user's **active**
`user_company_role` assignments across companies — but only those companies in which the requester
holds `RBAC_MANAGE`. The result SHALL include, per assignment, the company, role, department, and
validity window (`valid_from`/`valid_to`). This surface SHALL NOT permit any write and SHALL NOT
return assignments in companies the requester is not authorized to administer.

#### Scenario: Requester sees only companies they administer

- **GIVEN** a target user with active assignments in companies A, B, and C
- **AND** a requester who holds `RBAC_MANAGE` in companies A and B only
- **WHEN** the requester reads the target user's cross-company assignments
- **THEN** assignments in A and B are returned and the assignment in C is omitted

#### Scenario: Only active assignments are returned

- **WHEN** the cross-company read runs for a user whose company A assignment has a past `valid_to`
- **THEN** that expired assignment is excluded from the result

#### Scenario: Read surface performs no writes

- **WHEN** the cross-company read is invoked
- **THEN** no `user_company_role`, `app_user`, or other row is created, updated, or deleted
