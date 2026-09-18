## MODIFIED Requirements

### Requirement: Action Feedback and Confirmation

Every user-initiated action SHALL give explicit feedback through a shared feedback seam —
a create / update / submit / approve / cancel / delete and the like: on success a
success **toast**, and on failure an error **toast** carrying the refusal in the reader's language
when the server named a message key the client has a translation for, and the server's message
otherwise. Errors SHALL NOT be shown in a modal dialog. A **confirmation dialog** SHALL be used only to
confirm a destructive or otherwise serious action *before* it runs (e.g. cancelling or
rejecting a document, closing a fiscal year, removing a holiday, revoking access or a role
assignment, cancelling a delegation); the action SHALL proceed only if the user accepts.
This action feedback is distinct from, and SHALL NOT replace, the content-region
loading / empty / error states used for page-load (GET) failures, which remain inline with
their retry affordance. All toast and dialog text SHALL come from i18n with en/la parity and
SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode.

The translation SHALL happen in the one seam every error passes through (`messageOf`), so a screen
that shows an inline refusal and a screen that toasts one read the same words, and a key added on
the server reaches every screen without any screen changing. The translated sentence SHALL carry
the server's `params` (a type code, a step number), never a bare "request failed", and SHALL be
provided in en, la and zh. A key the client does not know SHALL fall back to the server's message,
never to an empty toast or the raw key.

#### Scenario: Successful action shows a success toast

- **WHEN** a user completes an action that succeeds (e.g. creates a record or submits a document)
- **THEN** a success toast is shown confirming the outcome

#### Scenario: Failed action shows an error toast

- **WHEN** a user-initiated action fails (any status)
- **THEN** an error toast is shown with the refusal, and no modal dialog is used to display it

#### Scenario: A keyed refusal reads in the user's language

- **GIVEN** the interface language is Lao
- **WHEN** a configuration write is refused with a message key the client knows and
  `params.typeCode` = `CLAIM_RECOVERY`
- **THEN** the toast reads the Lao sentence for that key with `CLAIM_RECOVERY` in it, not the
  English `message`

#### Scenario: An unknown key falls back to the server's words

- **WHEN** a refusal carries a message key the client has no translation for
- **THEN** the toast shows the server's `message`

#### Scenario: Destructive action is confirmed first

- **WHEN** a user triggers a destructive action (e.g. cancel/reject a document, close a fiscal year, revoke access)
- **THEN** a confirmation dialog appears, and the action runs only if the user accepts and is abandoned if they cancel

#### Scenario: Page-load failure still uses the inline error state

- **WHEN** a page's initial data request (GET) fails
- **THEN** the inline content-region error state with retry is shown (not a toast or dialog)
