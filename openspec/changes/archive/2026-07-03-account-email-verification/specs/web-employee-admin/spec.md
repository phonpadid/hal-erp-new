## ADDED Requirements

### Requirement: Verify An Account From The Employee Table

For an employee that has a linked login account, the employee-admin table SHALL show a verification control
(a toggle switch) indicating whether the account's email is verified. An `EMPLOYEE_MANAGE` admin SHALL be
able to turn it on to mark the account verified (no email involved) — the escape hatch when the verification
mail does not arrive. The control SHALL be **verify-only**: an already-verified account shows it on and
disabled, and it cannot be used to un-verify. Employees with no linked account SHALL NOT show the control.

#### Scenario: Toggle shows verification state

- **WHEN** the admin views the employee list
- **THEN** each employee that has a linked account shows a verification toggle reflecting whether the
  account's email is verified

#### Scenario: Admin verifies from the table

- **WHEN** the admin turns the verification toggle on for an unverified account
- **THEN** the account is marked verified, the toggle stays on, and the user can then log in

#### Scenario: Verified toggle is one-way

- **WHEN** an account is already verified
- **THEN** its toggle is shown on and disabled, so it cannot be turned back off from the table
