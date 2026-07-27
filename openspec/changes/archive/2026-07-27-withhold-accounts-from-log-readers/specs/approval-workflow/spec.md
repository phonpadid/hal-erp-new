## ADDED Requirements

### Requirement: The Approval History Identifies Approvers Without Exposing Their Accounts

A caller entitled to read a document SHALL be able to read its approval history, receiving for each entry the step number, the action taken, the remark written, the time it was taken, the approver, and the approver who delegated the authority where one did. The approver and the delegator SHALL each be identified by id and username and by nothing else.

The response SHALL be assembled from an explicit shape rather than serialized from the stored entity, so that a field added to a user or to a log row cannot widen what a caller receives without someone deciding that it should. In particular the response SHALL carry no credential material, no contact detail, no account status, and neither the stamped signature nor the nested document.

This read is available to an external API key holding the permission that reads a document, so the shape above is a contract with callers outside the company, not only a convenience for the web client.

#### Scenario: An approval entry names its approver

- **GIVEN** a document approved at a step by a user
- **WHEN** its approval history is read
- **THEN** the entry carries the step number, the action, the remark, the time, and an approver identified by id and username

#### Scenario: No account material reaches the caller

- **WHEN** a document's approval history is read
- **THEN** no entry carries a password hash, an email address, an account status, or a verification timestamp

#### Scenario: The stamped signature stays internal

- **GIVEN** a document approved by a user with a signature on file
- **WHEN** its approval history is read
- **THEN** the response carries no signature reference

#### Scenario: A delegated approval names both parties

- **GIVEN** an entry recorded by a delegate acting for a principal
- **WHEN** the history is read
- **THEN** both the acting approver and the delegating approver are identified by id and username

#### Scenario: An approval taken in the approver's own right reports no delegator

- **GIVEN** an entry recorded by an approver acting for themselves
- **WHEN** the history is read
- **THEN** the delegating approver is reported as absent rather than omitted from the entry
