## ADDED Requirements

### Requirement: Action Feedback and Confirmation

Every user-initiated action (a create / update / submit / approve / cancel / delete and
the like) SHALL give explicit feedback through a shared feedback seam: on success a
success **toast**, and on failure an error **toast** carrying the server's message. Errors
SHALL NOT be shown in a modal dialog. A **confirmation dialog** SHALL be used only to
confirm a destructive or otherwise serious action *before* it runs (e.g. cancelling or
rejecting a document, closing a fiscal year, removing a holiday, revoking access or a role
assignment, cancelling a delegation); the action SHALL proceed only if the user accepts.
This action feedback is distinct from, and SHALL NOT replace, the content-region
loading / empty / error states used for page-load (GET) failures, which remain inline with
their retry affordance. All toast and dialog text SHALL come from i18n with en/la parity and
SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode.

#### Scenario: Successful action shows a success toast

- **WHEN** a user completes an action that succeeds (e.g. creates a record or submits a document)
- **THEN** a success toast is shown confirming the outcome

#### Scenario: Failed action shows an error toast

- **WHEN** a user-initiated action fails (any status)
- **THEN** an error toast is shown with the server's message, and no modal dialog is used to display it

#### Scenario: Destructive action is confirmed first

- **WHEN** a user triggers a destructive action (e.g. cancel/reject a document, close a fiscal year, revoke access)
- **THEN** a confirmation dialog appears, and the action runs only if the user accepts and is abandoned if they cancel

#### Scenario: Page-load failure still uses the inline error state

- **WHEN** a page's initial data request (GET) fails
- **THEN** the inline content-region error state with retry is shown (not a toast or dialog)
