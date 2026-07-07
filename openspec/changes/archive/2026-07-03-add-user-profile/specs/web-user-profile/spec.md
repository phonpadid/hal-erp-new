## ADDED Requirements

### Requirement: My Profile Page

The web app SHALL provide an authenticated "My Profile" page, reachable from the
topbar profile menu in the application shell, that displays the signed-in user's own
profile fetched from the read-own-profile endpoint. The page SHALL show the identity
fields (`username`, `email`, email-verified state, `status`) and, when present, the
linked employee's `full_name`, `position`, and department name as read-only content.
The page SHALL NOT allow editing identity or employee fields. All labels SHALL come from
i18n (en + la), never hardcoded strings.

#### Scenario: Profile menu opens the page

- **WHEN** a signed-in user activates the profile entry in the topbar
- **THEN** the app navigates to the "My Profile" page rendered inside the application shell

#### Scenario: Identity and employee fields are shown read-only

- **WHEN** the profile page loads
- **THEN** it displays the user's `username`, `email`, email-verified state, and `status`
- **AND** when a linked employee exists it also shows `full_name`, `position`, and department name
- **AND** none of these fields are editable

#### Scenario: Account without a linked employee renders gracefully

- **GIVEN** the profile response has no employee fields
- **WHEN** the page loads
- **THEN** the identity section renders and the employee section is hidden or shows an empty state

### Requirement: Change-Password Form

The "My Profile" page SHALL host a change-password form with three fields — current
password, new password, and confirm new password — built with `@primevue/forms` and
validated by a Zod schema via `zodResolver` that mirrors the backend change-password DTO.
The schema SHALL enforce the password strength policy, that confirm equals new, and that
new differs from current. On submit the form SHALL call the change-own-password endpoint.
On success it SHALL show a success message and clear the fields; on a wrong-current-password
error it SHALL show an error without revealing account details. Field errors SHALL be shown
via `<Message v-if="$form.<field>?.invalid">`.

#### Scenario: Valid change succeeds

- **WHEN** the user enters the correct current password and a matching, policy-compliant new password
- **THEN** the form submits to the change-password endpoint
- **AND** on success a success message is shown and the password fields are cleared

#### Scenario: Client validation mirrors the server

- **WHEN** the user submits with a too-weak new password, a mismatched confirmation, or a new
  password equal to the current one
- **THEN** the Zod resolver shows a field error and no request is sent

#### Scenario: Wrong current password surfaces an error

- **WHEN** the server rejects the change because the current password is wrong
- **THEN** the form shows an error message and the fields for the new password are not accepted
- **AND** the message does not disclose account or hashing details
