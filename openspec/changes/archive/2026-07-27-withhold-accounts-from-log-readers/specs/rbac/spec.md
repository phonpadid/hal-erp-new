## ADDED Requirements

### Requirement: A Stored Password Hash Is Never Serialized

A user's stored password hash SHALL NOT appear in any response, regardless of which endpoint loaded the user or whether that endpoint was written with the hash in mind. The exclusion SHALL be enforced where the property is declared, not at each place a user is returned, so that an endpoint added later inherits it rather than having to remember it.

Code that verifies or replaces a password SHALL continue to read and write the property directly: the exclusion governs what leaves the system, not what the system may hold.

#### Scenario: A serialized user carries no hash

- **GIVEN** a user with a stored password hash
- **WHEN** the user is serialized into a response
- **THEN** the hash is absent while the user's other serialized fields are present

#### Scenario: Authentication still reads the hash

- **GIVEN** a user with a stored password hash
- **WHEN** a password is verified against that user
- **THEN** the verification reads the stored hash and succeeds or fails on its merits
