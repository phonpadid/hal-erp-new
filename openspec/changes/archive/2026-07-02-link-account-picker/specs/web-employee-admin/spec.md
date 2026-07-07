## MODIFIED Requirements

### Requirement: Link Employee to a Login Account

The screen SHALL let an `EMPLOYEE_MANAGE` user link an employee to an existing `app_user`
account and unlink it, and SHALL indicate for each employee whether a login account is linked.
When linking to an existing account, the screen SHALL present a **searchable picker of unlinked
accounts** (showing each account's `username` and `email`) and submit the chosen account's id — the
admin SHALL NOT be required to type or paste an `app_user` id. The screen SHALL also let an
`EMPLOYEE_MANAGE` user create a new login account and link it to an employee in one step, by
entering only a `username` and `email` — no password is entered in the UI (the server sets the
initial password from `USER_PASSWORD`). The create-and-link action SHALL be offered only for an
employee that has no linked account.

#### Scenario: Show linked-account status

- **WHEN** the admin views the employee list
- **THEN** each row indicates whether the employee has a linked login account

#### Scenario: Create a new account and link it in one step

- **WHEN** the admin opens the link dialog for an employee with no account, chooses "create new
  account", enters a valid `username` and `email`, and confirms
- **THEN** a new login account is created and linked to the employee, the row shows the employee as
  having a linked account, and the admin is never asked for a password

#### Scenario: Link an existing account from the picker

- **WHEN** the admin chooses to link an existing account, searches the picker by `username` or
  `email`, and selects an unlinked account
- **THEN** the employee is linked to that account and the row shows the employee as having a linked
  account

#### Scenario: Picker excludes already-linked accounts

- **WHEN** the admin opens the existing-account picker
- **THEN** only accounts not already linked to an employee are offered for selection

#### Scenario: Unlink a login account

- **WHEN** the admin unlinks an employee from its login account
- **THEN** the employee is shown as having no linked account, and the user's role assignments are
  unaffected
