## ADDED Requirements

### Requirement: Documents Record The External Source They Came From

A document created by an external system MAY carry the source that produced it, as `document.source_type` naming the feed and `document.source_id` holding that system's own identifier for the record. The pair SHALL be optional and SHALL be supplied together — a request carrying one without the other SHALL be rejected. A document created without them SHALL behave exactly as it does today. The values SHALL be treated as opaque to this system: nothing SHALL derive them from the authentication source or infer them when they are absent.

#### Scenario: A document is created from a feed

- **WHEN** a caller creates a document supplying `source_type` and `source_id`
- **THEN** the document records both, in addition to everything a document normally records

#### Scenario: A document is created in the web app

- **WHEN** a caller creates a document supplying neither
- **THEN** the document is created as before, with both columns empty

#### Scenario: Only one of the pair is supplied

- **WHEN** a request carries `source_type` without `source_id`, or the reverse
- **THEN** the request is rejected and no document is created

### Requirement: Creating A Document Twice For One Source Yields One Document

The system SHALL hold at most one document per `(company, source_type, source_id)`. A create request naming a source that already has a document SHALL return that existing document rather than creating another, and SHALL consume no document number and write no new row. The uniqueness SHALL be enforced by the database as well as by the service, so that two requests arriving together cannot both create one. The existing document SHALL be returned unmodified: field values carried by the repeated request SHALL NOT be applied to it.

#### Scenario: A caller retries after a timeout

- **GIVEN** a document already created for `('CLAIM', 'CLM-B-8842')` in the active company
- **WHEN** the same caller sends the same create request again
- **THEN** it receives that same document, no second document exists for that source, and no document number was consumed

#### Scenario: Two retries arrive at the same time

- **WHEN** two create requests naming the same source are processed concurrently and both find no existing document
- **THEN** exactly one document exists for that source afterwards, and both callers receive it

#### Scenario: A repeated request carries different values

- **GIVEN** a document already created for a source
- **WHEN** a create request names that source but carries different field values
- **THEN** the existing document is returned with its stored values unchanged

#### Scenario: The same identifier in another company

- **GIVEN** a document for `('CLAIM', 'CLM-1')` in one company
- **WHEN** a document is created for `('CLAIM', 'CLM-1')` in a different company
- **THEN** it is created normally, because the key is scoped by company

#### Scenario: A submitted duplicate reserves budget once

- **GIVEN** a document created and submitted for a source, holding a budget reservation
- **WHEN** the create request for that source is retried
- **THEN** the existing document is returned and no further `budget_txn` row is written
