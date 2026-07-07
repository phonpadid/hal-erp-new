## MODIFIED Requirements

### Requirement: Permission-Gated Organization Admin

The organization admin SHALL be presented as four separate, sidebar-navigated pages — Companies,
Departments, Fiscal years, and Holidays — grouped under a dedicated **Organization** sidebar
section, rather than as tabs within a single screen. Each page SHALL have its own route and SHALL be
directly linkable. The Organization sidebar group, its page entries, and each action SHALL be shown
by permission code — viewing by the relevant `*_VIEW` code and each mutation by its `*_MANAGE` code
(UX only; the server still enforces). The area is scoped to the active company where applicable. The
legacy `/org-admin` path SHALL redirect to the Companies page so existing links keep working.

#### Scenario: Organization hidden without permission

- **WHEN** a user without any organization permission is signed in
- **THEN** the Organization sidebar group and its pages are not shown

#### Scenario: Each area is its own page

- **WHEN** a permitted user opens the Organization group in the sidebar
- **THEN** Companies, Departments, Fiscal years, and Holidays are listed as separate entries, each
  navigating to its own page rather than switching a tab

#### Scenario: Legacy path redirects

- **WHEN** a user navigates to the legacy `/org-admin` path
- **THEN** they are redirected to the Companies page
