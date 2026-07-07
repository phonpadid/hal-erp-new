## MODIFIED Requirements

### Requirement: Document Reporting

The system SHALL provide a document-summary report over `document` giving volume (count) and
summed locked base amount grouped by document type and status, plus per-status totals; and a
spend-by-vendor report summing `base_total_amount` over committed documents (APPROVED or
COMPLETED) grouped by vendor, ordered high→low with a running cumulative share. The
document-summary report SHALL group by the document's type identity and SHALL return its rows and
per-status totals even when a document's type cannot be fully resolved (e.g. the related type
record is missing), degrading that document's type code/name to a defined fallback rather than
failing the request.

#### Scenario: Document volume grouped by type and status

- **WHEN** the document-summary report runs
- **THEN** each (document type, status) cell reports a count and summed base amount, and per-status totals are returned

#### Scenario: Spend by vendor is ranked with cumulative share

- **WHEN** the spend-by-vendor report runs
- **THEN** vendors are ordered by descending base spend and each carries a running cumulative percentage reaching 100

#### Scenario: A document with an unresolved type does not fail the report

- **WHEN** the document-summary report runs and a document's type cannot be fully resolved
- **THEN** the report still returns its grouped rows and per-status totals without error, and that document is counted under its type identity with a defined fallback type code/name
