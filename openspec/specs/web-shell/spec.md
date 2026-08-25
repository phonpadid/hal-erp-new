# Web Shell Specification

## Purpose
The Vue application shell: authentication, company-context selection, session
persistence, JWT/401 handling, and permission-gated routing — the foundation other
frontend capabilities build on.

## Requirements

### Requirement: Authentication and Session

The web shell SHALL authenticate a user via username + password against the auth API and
hold the resulting company-context token as the session. The token (and active company)
SHALL persist across reloads; logging out SHALL clear the session. Credentials SHALL be
validated client-side with the shared login schema before submission (the server remains
authoritative).

#### Scenario: Successful login with a default company

- **WHEN** a user submits valid credentials and has a default company
- **THEN** the session token is stored and the user is taken to the home route

#### Scenario: Session survives a reload

- **GIVEN** a logged-in user
- **WHEN** the browser reloads
- **THEN** the session is restored from storage and the user is not sent back to Login

#### Scenario: Logout clears the session

- **WHEN** the user logs out
- **THEN** the token and context are cleared and the next protected navigation goes to Login

### Requirement: Company Context Selection

When a user may access more than one company, the shell SHALL let them choose one; a user
with a default company enters it automatically. Switching companies SHALL re-issue the
token via the auth API and refresh the active permissions so the UI reflects the new
company.

#### Scenario: No default company prompts selection

- **WHEN** a user with multiple companies and no default logs in
- **THEN** the accessible companies are presented and no protected screen loads until one is chosen

#### Scenario: Switching company refreshes permissions

- **GIVEN** an active session in company A
- **WHEN** the user switches to company B
- **THEN** a new token is obtained and the UI's permission checks reflect company B

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

### Requirement: Authenticated API Calls and 401 Handling

Every API request SHALL carry the active company-context JWT. A `401` response SHALL clear
the session and return the user to Login so a stale or expired token cannot wedge the app.

#### Scenario: Requests carry the token

- **WHEN** the client makes an API request while authenticated
- **THEN** the request includes the bearer token for the active company

#### Scenario: A 401 forces re-login

- **WHEN** any API call returns 401
- **THEN** the session is cleared and the user is redirected to Login
