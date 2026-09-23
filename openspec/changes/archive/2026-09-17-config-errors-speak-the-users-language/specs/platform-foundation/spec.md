## ADDED Requirements

### Requirement: A Refusal May Carry A Message Key The Client Translates

An error response SHALL be allowed to carry, alongside `code`, a `messageKey` and a `params` object. `messageKey`
SHALL name the *sentence* a person is shown — stable across rewordings and across languages — and
`params` SHALL carry the values that sentence names (a document-type code, a step number, a
status), so a client can render the refusal in the reader's language with the same facts the
English `message` states. `message` SHALL remain the English text, unchanged in meaning, for logs,
API clients and any client that does not know the key.

`messageKey` is distinct from `code` and SHALL NOT be used in its place: `code` names a situation a
caller *acts on* differently and is a contract; `messageKey` names how a refusal is *worded* and
MAY be added freely to any throw whose text a person reads. An exception that names no key SHALL
produce a response with no `messageKey`, and every other field exactly as before.

`params` SHALL carry names and codes people recognise (`typeCode`, `stepNo`, `status`), never a
database id; a message that can only name an id is a message that names nothing.

#### Scenario: A keyed refusal carries its facts

- **WHEN** a configuration write is refused because document type `CLAIM_RECOVERY` would be left
  without a settlement
- **THEN** the response carries `messageKey` for that refusal, `params.typeCode` = `CLAIM_RECOVERY`,
  the English `message`, and its `code` unchanged

#### Scenario: An unkeyed refusal is untouched

- **WHEN** an exception that names no message key is thrown
- **THEN** the response has no `messageKey` or `params`, and every other field is what it was

#### Scenario: A key never replaces a code

- **GIVEN** a refusal that already carries a code a caller branches on (`SIGNATURE_REQUIRED`)
- **WHEN** it is given a message key
- **THEN** the response carries both, and the code is what it was
