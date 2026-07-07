## ADDED Requirements

### Requirement: Per-User Settings Persistence

The system SHALL store one set of UI settings per user — theme `preset`, `primary`, `surface`,
`dark_theme`, `menu_mode`, and `locale` — in a `user_setting` row keyed by the user. Settings are
per user (not per company): a user keeps the same settings across all their companies.

#### Scenario: Settings persist across sessions

- **WHEN** a user saves their settings and signs in again later
- **THEN** their previously saved settings are returned

### Requirement: Read Own Settings

The system SHALL return the signed-in user's settings, identified by their token. When the user
has never saved settings, it SHALL return the defaults rather than an error. The response shape
SHALL wrap the settings as `{ data: <setting> }`.

#### Scenario: Defaults when none saved

- **WHEN** a user with no saved settings requests their settings
- **THEN** the default settings are returned

### Requirement: Upsert Own Settings with Partial Patch

The system SHALL upsert the signed-in user's settings from a partial payload — creating the row on
first save and updating only the provided fields thereafter. A user SHALL only be able to read and
write their own settings.

#### Scenario: Partial update changes only sent fields

- **WHEN** a user PUTs a payload containing only `primary` and `dark_theme`
- **THEN** those fields are updated and the user's other settings are unchanged

#### Scenario: First save creates the row

- **WHEN** a user with no settings row PUTs any field
- **THEN** a settings row is created for that user with that field set
