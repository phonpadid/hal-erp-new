## MODIFIED Requirements

### Requirement: Permission-Gated Routing and UI

The shell SHALL redirect unauthenticated users to Login, and SHALL gate routes and nav
affordances by permission **code** (never role name) from the active company. Client gating
is UX only — the server still enforces authorization.

A navigation refused for want of a permission SHALL tell the user that it was refused and name the
permission code it required. Redirecting to the home page in silence makes four different
situations look identical: a mistyped address, a page that has been retired, a permission this user
lacks, and a permission that no user can hold because the catalog has no row for it. The last of
these is how an entire capability — closing an accounting period — sat unreachable for every user
in an installation with nothing on any screen to say so.

Naming the code is what makes the message actionable: it is the string an administrator searches
for, grants, or discovers is absent from the catalog. A message that says only "you do not have
permission" sends the reader back to guessing.

#### Scenario: Unauthenticated access is redirected

- **WHEN** an unauthenticated user navigates to a protected route
- **THEN** they are redirected to Login

#### Scenario: Missing permission hides the affordance

- **GIVEN** a user whose active company lacks `DOC_CREATE`
- **WHEN** the shell renders
- **THEN** the create-document affordance is not shown

#### Scenario: A refused navigation says so

- **GIVEN** a signed-in user whose active company lacks the permission a route requires
- **WHEN** they navigate to that route
- **THEN** they are told the navigation was refused for want of a permission, and the required code
  is named

#### Scenario: A refusal is distinguishable from a route that does not exist

- **WHEN** a signed-in user navigates to an address that matches no route
- **THEN** what they see differs from what a permission refusal shows

#### Scenario: The refusal survives a direct address

- **GIVEN** a user who pastes the address of a route they may not open
- **WHEN** the shell resolves it
- **THEN** the refusal is shown, rather than the home page appearing as though the address had been
  wrong
