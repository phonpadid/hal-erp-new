# web-user-onboarding

## Purpose
The Vue employee-onboarding page for the active company, where an admin holding both
`EMPLOYEE_MANAGE` and `RBAC_MANAGE` walks a stepped form (account → access → review) that, in
one action, creates a login account for an employee and grants that account its first company
access in the active company.

## Requirements

### Requirement: Stepped Employee Onboarding Page

The system SHALL provide an onboarding page, reachable for an employee that has no linked account and shown only
to an admin holding both `EMPLOYEE_MANAGE` and `RBAC_MANAGE`, that collects the account and first-access details
in a multi-step form (account → access → review) and submits them as one onboarding action. The page SHALL NOT
ask for a password. Company SHALL be presented as the active company and SHALL NOT be editable. Department SHALL
default to the employee's department, and role SHALL be chosen from the active company's roles. On success the
page SHALL return to the employee list with the employee shown as having a linked account.

#### Scenario: Step through account then access then review

- **WHEN** the admin opens the onboarding page for an employee with no account
- **THEN** step one collects `username` and `email`, step two collects role and department (company shown
  read-only as the active company), and step three shows a review before a single confirm

#### Scenario: Department defaults to the employee's department

- **WHEN** the admin reaches the access step
- **THEN** the department field is pre-selected with the employee's own department and the role list is that of
  the active company

#### Scenario: Confirm onboards in one action

- **WHEN** the admin confirms the review step
- **THEN** the page submits a single onboarding request and, on success, navigates back to the employee list with
  the employee marked as having an account

#### Scenario: Client validation mirrors the server

- **WHEN** the admin submits an invalid step (missing username/email, or no role selected)
- **THEN** the page shows field-level errors from the shared onboarding schema and does not advance/submit

### Requirement: Onboarding Entry Is Permission-Gated

The onboarding entry point and page SHALL be available only to an admin holding both `EMPLOYEE_MANAGE` and
`RBAC_MANAGE`; an admin lacking either SHALL NOT see the onboarding entry and SHALL NOT be able to reach the page.

#### Scenario: Hidden without both permissions

- **WHEN** an admin holds `EMPLOYEE_MANAGE` but not `RBAC_MANAGE` (or vice versa)
- **THEN** the onboarding entry is not shown and navigating directly to the page is blocked
