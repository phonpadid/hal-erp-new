## ADDED Requirements

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
