## MODIFIED Requirements

### Requirement: Authorized, Company-Scoped Document Operations

Configuration endpoints SHALL require `DOC_CONFIG_MANAGE`; runtime operations SHALL
require `DOC_VIEW` / `DOC_CREATE` / `DOC_SUBMIT` / `DOC_CANCEL` as appropriate, always by
permission code. Documents SHALL be company-scoped — both reads and content mutations
(field values in `doc_field_value`, lines in `document_line`) resolve a `document`
only within the active company. A request whose `:id` belongs to another company SHALL
resolve as not-found, never throw a server error, and never mutate across the
company-isolation boundary. A document is created in the active company with its number
issued from that company's counter. UUID path parameters SHALL be validated.

#### Scenario: Document numbering is per company, type, and year

- **WHEN** two documents of the same type are created concurrently in one company-year
- **THEN** both receive unique, sequential `doc_no` values with no collision

#### Scenario: Submitting without permission is forbidden

- **WHEN** a request without `DOC_SUBMIT` calls the submit endpoint
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Setting field values resolves the document within the active company

- **WHEN** a user sets field values for a document that exists in their active company
- **THEN** the values are persisted to `doc_field_value` for that document without error

#### Scenario: Mutating another company's document is not-found

- **WHEN** a user sets field values or lines for a document `:id` that belongs to a
  different company
- **THEN** the request is rejected as not-found (404) and no `doc_field_value` or
  `document_line` row is written
