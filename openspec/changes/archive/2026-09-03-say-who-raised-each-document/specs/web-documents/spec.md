## ADDED Requirements

### Requirement: The Document List Names Who Raised Each Document

The document list SHALL show, for each row, who raised the document — the creator's employee full
name in the active company, and their account username when they have no employee record there — and
that employee's own department.

The department SHALL be empty exactly when the creator has no employee record in the company, since
an employee always has a department. It is the PERSON's department and not the document's, which the
list already filters by; the two describe different facts and MAY differ for a creator who has since
transferred.

The name SHALL be resolved by the same rule the detail view applies, so a reader who opens a row from
the list is not shown a different name for the same person.

The list SHALL NOT return the creator's user id, nor any field of their account beyond that name. A
list read is not an occasion to hand every `DOC_VIEW` holder an identifier to key on, and the reason
the detail view resolves the name from partial reads rather than populating the relation — that
populating it serializes the whole account — applies here unchanged.

Both columns SHALL be secondary ones, collapsing on narrow screens with the other secondary columns
rather than crowding out the document number.

#### Scenario: The list names an employee by their full name

- **GIVEN** a document raised by a user who is an employee of the active company
- **WHEN** a `DOC_VIEW` user opens the documents list
- **THEN** that document's row names the employee's full name and their department

#### Scenario: A creator with no employee record is named by username

- **GIVEN** a document raised by a user with no employee record in the active company
- **WHEN** the list is read
- **THEN** that row names the account username and leaves the department empty

#### Scenario: The list and the detail agree

- **WHEN** a user opens a document from the list
- **THEN** the detail names the same person the row did

#### Scenario: The row carries no account identifier

- **WHEN** the list is read
- **THEN** no row carries the creator's user id or any other field of their account
