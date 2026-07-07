# Web User Profile Specification

## Purpose
The authenticated "My Profile" surface in the web app: a page, reached from the
application shell's topbar profile menu, that shows the signed-in user's own
identity and linked employee fields read-only, and hosts a change-password form
backed by the `user-profile` backend. All fields are read-only except the
change-password form, and all copy is i18n-driven.

## Requirements

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

### Requirement: Roles and Permissions Section

The "My Profile" page SHALL display a read-only "Roles & Permissions" section showing
the signed-in user's role name(s) and their resolved permission codes (grouped or tagged
by scope: `OWN`/`DEPARTMENT`/`COMPANY`/`GROUP`) for the active company, sourced from the
read-own-profile response. This section SHALL NOT offer any edit, add, or remove action —
managing roles and permissions remains an `RBAC_MANAGE`-gated admin function elsewhere in
the app. All labels SHALL come from i18n (en + la), never hardcoded strings.

#### Scenario: Roles and permissions render on the profile page

- **WHEN** the profile page loads for a signed-in user
- **THEN** it displays the user's role name(s) and their permission codes with scope for
  the active company

#### Scenario: Section is read-only

- **WHEN** the profile page renders the Roles & Permissions section
- **THEN** no control on that section allows adding, removing, or editing a role or
  permission

#### Scenario: Switching active company updates the section

- **GIVEN** the user switches their active company
- **WHEN** the profile page reloads
- **THEN** the Roles & Permissions section reflects only the new active company's roles
  and permissions

### Requirement: Profile Header

The "My Profile" page SHALL present a header (hero) region above the detail sections that
identifies the signed-in user at a glance. The header SHALL show an avatar, the user's
display name, and — when a linked employee exists — the employee `position` and department
name, plus the email-verified state and the user's role name(s) for the active company. The
avatar SHALL be generated from the user's initials (derived from the linked employee
`full_name` when present, otherwise from `username`); no avatar upload is introduced. The
header MAY include a decorative illustration that is hidden on small viewports and is not
essential to understanding the content. All text SHALL come from i18n (en + la) and all
colors SHALL use PrimeUI theme tokens so light and dark mode both render correctly. The
header SHALL be presentation only and SHALL NOT expose any control that edits identity,
employee, role, or permission data.

#### Scenario: Header identifies the user

- **WHEN** the profile page loads for a signed-in user
- **THEN** the header shows an initials avatar, the user's display name, and the
  email-verified state
- **AND** when a linked employee exists it also shows the employee position and department
  name and the user's role name(s) for the active company

#### Scenario: Avatar falls back to username initials

- **GIVEN** the profile response has no linked employee
- **WHEN** the header renders
- **THEN** the avatar initials are derived from the `username`
- **AND** the display name shown is the `username`

#### Scenario: Decorative illustration is not essential

- **WHEN** the header renders on a small viewport
- **THEN** the decorative illustration is hidden
- **AND** the user's identity information remains fully visible

### Requirement: Scope-Grouped Permissions Presentation

The "My Profile" page SHALL present the resolved permission codes grouped by their scope
(`OWN` / `DEPARTMENT` / `COMPANY` / `GROUP`), showing each scope group with a heading and a
count of the permissions in it. This presentation SHALL remain read-only, offering no
control to add, remove, or edit a permission, and SHALL source its data solely from the
read-own-profile response for the active company. Scope and group labels SHALL come from
i18n (en + la).

#### Scenario: Permissions are grouped by scope with counts

- **WHEN** the profile page renders the permissions
- **THEN** the permission codes are grouped under their scope (`OWN`/`DEPARTMENT`/
  `COMPANY`/`GROUP`)
- **AND** each scope group shows how many permissions it contains

#### Scenario: Grouped presentation stays read-only

- **WHEN** the grouped permissions render
- **THEN** no control allows adding, removing, or editing a permission

### Requirement: Illustrated Empty States

The "My Profile" page SHALL render a friendly empty state — an illustration combined with an
i18n message, rather than a bare sentence — for any profile section that has no data to show
(no linked employee, no roles, or no permissions for the active company). Empty-state
illustrations SHALL be decorative (marked so assistive technology ignores them) and SHALL NOT
be required to convey the meaning, which the i18n message SHALL carry on its own.

#### Scenario: No linked employee shows an illustrated empty state

- **GIVEN** the profile response has no linked employee
- **WHEN** the page loads
- **THEN** the employee section shows an illustrated empty state with an i18n message
- **AND** the illustration is marked decorative for assistive technology

#### Scenario: No roles or permissions shows an illustrated empty state

- **GIVEN** the active company grants the user no roles or no permissions
- **WHEN** the Roles & Permissions section renders
- **THEN** the corresponding empty state shows an illustration with its i18n message
