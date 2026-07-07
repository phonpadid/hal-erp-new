## MODIFIED Requirements

### Requirement: Form Template and Field Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user, per document type, create a form template, add
fields and publish a template. The forms builder SHALL present a master–detail layout: the user
selects a document type and then a specific template **version** whose status
(DRAFT/PUBLISHED/RETIRED) and field count are clearly shown, with the active selection visually
highlighted. The field editor SHALL support the full field-type set
(`text`, `number`, `date`, `dropdown`, `file`, `line_items`), let the user edit a `dropdown`
field's choices (`options_json`), set a field's show/hide rule (`condition_json`) by referencing
another field on the same template with an operator and value, edit an existing field, and
reorder fields. When adding a field the sort order SHALL be assigned automatically so the user
does not enter an order number by hand. The builder SHALL show a live preview that renders the
selected template's fields as an end user would see them. Published templates are immutable in
the UI; the builder SHALL only offer add/edit/reorder affordances while a template is DRAFT and
otherwise show the template as locked. Further changes create a new version, and a published
template MAY be retired. All field input SHALL be validated client-side against the shared schema.

#### Scenario: Build and publish a form

- **WHEN** the user creates a template for a type, adds fields, and publishes it
- **THEN** the template shows as published with its fields

#### Scenario: Select a template version

- **WHEN** the user picks a document type and then a template version
- **THEN** that version becomes the active selection, its status and field count are shown, and its fields load in the field list and preview

#### Scenario: Fields are listed in order

- **WHEN** the user views a template's fields
- **THEN** they appear ordered by sort order

#### Scenario: Live preview reflects the fields

- **WHEN** the user views a template that has fields
- **THEN** the builder renders a preview of those fields as an end-user form, honoring each field's label, type, and required flag

#### Scenario: Add a field without entering a sort order

- **WHEN** the user adds a field to a DRAFT template
- **THEN** the field is appended after the existing fields with an automatically assigned sort order

#### Scenario: Edit an existing field

- **WHEN** the user edits a field on a DRAFT template and saves changes to its name, label, type, required flag, dropdown choices, or show/hide rule
- **THEN** the changes are persisted and reflected in the field list and preview

#### Scenario: Edit dropdown choices

- **WHEN** the user adds a `dropdown` field and enters its choices
- **THEN** the choices are saved as `options_json` and shown when the field renders

#### Scenario: Set a conditional show/hide rule

- **WHEN** the user gives a field a rule referencing another field's value
- **THEN** the rule is saved as `condition_json` for that field

#### Scenario: Add a file or line-items field

- **WHEN** the user adds a field of type `file` or `line_items`
- **THEN** the field is saved with that type and the document form will capture attachments or line rows accordingly

#### Scenario: Reorder fields

- **WHEN** the user changes a field's position
- **THEN** the new sort order is persisted and reflected in the field list

#### Scenario: Published template is locked

- **WHEN** the user selects a PUBLISHED or RETIRED template version
- **THEN** the builder shows it as locked with no add, edit, or reorder affordances, while still allowing a published template to be retired
