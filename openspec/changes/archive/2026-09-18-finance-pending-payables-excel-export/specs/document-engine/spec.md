## ADDED Requirements

### Requirement: A Document Type Carries The Abbreviation Stamped On Its Paper Number

`document_type` SHALL carry an optional `short_name` (varchar): the abbreviation a company stamps
in the type position of a document's paper number (e.g. `ຈຊຈ` for a purchase request). It SHALL
be read and written with the type through the existing company-scoped document-type endpoints
(invariant 1), validated as a trimmed string of at most 20 characters, and SHALL NOT be required to
be unique — two types may legitimately stamp the same abbreviation. It has no effect on routing,
numbering (`document.doc_no` is unchanged), budget or approval; consumers that render a paper-style
number SHALL use it when set and the type's `code` otherwise.

#### Scenario: A type stores its abbreviation

- **WHEN** a `DOC_CONFIG_MANAGE` user updates a document type with `shortName` `ຈຊຈ`
- **THEN** the type reads back with `shortName` `ຈຊຈ` and its `code` and issued document numbers
  are unchanged

#### Scenario: An unset abbreviation is null, not the code

- **GIVEN** a document type created without `shortName`
- **WHEN** it is read
- **THEN** `shortName` is null, and a consumer rendering a paper number uses the type's `code`
