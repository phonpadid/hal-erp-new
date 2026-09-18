## ADDED Requirements

### Requirement: Matching And Receiving Are Type Configuration

`document_type` SHALL carry `match_mode` (`NONE` | `TWO_WAY` | `THREE_WAY`, default `THREE_WAY`)
and `receives_goods` (boolean, default `false`). `match_mode` SHALL be validated against that
closed set and enforced by a database check constraint. `DOC_CONFIG_MANAGE` users MAY set both on
create and update. Neither setting SHALL be derived from `post_action`: a `CUT_BUDGET` type MAY be
`NONE`, and a non-settling type MAY be `THREE_WAY`.

#### Scenario: Defaults preserve today's behaviour
- **WHEN** a document type is created without either setting
- **THEN** it has `match_mode` `THREE_WAY` and `receives_goods` `false`

#### Scenario: An unknown match mode is refused
- **WHEN** a type is saved with `match_mode` `FOUR_WAY`
- **THEN** the request is rejected with a validation error

#### Scenario: Both settings round-trip through the config read
- **WHEN** a type is saved with `match_mode` `TWO_WAY` and `receives_goods` `true`
- **THEN** the type read returns both values
