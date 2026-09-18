## ADDED Requirements

### Requirement: The Document Type Form Configures Matching And Receiving

The document-type form SHALL offer a `match_mode` choice (`NONE`, `TWO_WAY`, `THREE_WAY`) with a
hint per value, defaulting to `THREE_WAY`, and a `receives_goods` switch with a hint that it
enables the receive-goods action on that type's documents. Both SHALL persist through the create
and update requests and read back on edit. The controls SHALL show and hide by the
`DOC_CONFIG_MANAGE` permission code; the client guard is UX only.

#### Scenario: Setting a PO to skip matching
- **WHEN** a `DOC_CONFIG_MANAGE` user edits the `PO` type, chooses `NONE` and saves
- **THEN** the type's `match_mode` is `NONE` and the edit form shows `NONE` when reopened

#### Scenario: Defaults on a new type
- **WHEN** the user opens the new-type form
- **THEN** `match_mode` shows `THREE_WAY` and `receives_goods` is off
