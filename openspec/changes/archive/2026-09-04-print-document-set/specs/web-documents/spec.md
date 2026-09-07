## ADDED Requirements

### Requirement: Print Dialog Offers This Document Or The Whole Set

The document detail screen's print action SHALL open a dialog offering exactly two choices —
this document only, or the whole reference chain (PR + PO + Receipt) — with this document only
preselected, plus a confirm and a cancel action. Confirming SHALL request the export with the
matching `parts` argument and download the returned PDF; cancelling SHALL request nothing. The
action SHALL remain gated on the same permission that gates it today, SHALL show progress while
the export runs, and SHALL surface a failed export as a message without downloading anything.
The chain choice SHALL be offered whether or not the document has a predecessor, because a
document's successors are not visible from it and the server decides what the set contains.

#### Scenario: Printing only the open document

- **GIVEN** a user on a completed document's detail screen
- **WHEN** they open the print dialog, keep the preselected choice and confirm
- **THEN** the export is requested for that document alone and the PDF is downloaded

#### Scenario: Printing the whole set

- **GIVEN** the same screen
- **WHEN** the user selects the whole-set choice and confirms
- **THEN** the export is requested for the reference chain and the returned PDF is downloaded

#### Scenario: Cancelling asks for nothing

- **WHEN** the user opens the print dialog and cancels
- **THEN** no export is requested and no file is downloaded

#### Scenario: A failed export is reported, not downloaded

- **GIVEN** an export request that fails
- **WHEN** the user confirms the dialog
- **THEN** an error message is shown and no file is downloaded

#### Scenario: The print action stays permission-gated

- **GIVEN** a user without the permission that gates the export
- **WHEN** they open a document's detail screen
- **THEN** the print action is not offered

### Requirement: The Attachment Picker Accepts Only Printable Evidence

The attachment picker on the document screens SHALL offer only PDF, JPEG and PNG files, mirroring
the server's allow-list so the client and the server do not drift, and SHALL explain a rejected
file by naming the accepted types rather than reporting a bare failure. The client check is a
convenience: the server remains the enforcement point. Attachments already stored outside the
accepted types SHALL still be listed and downloadable from the detail screen.

#### Scenario: The picker offers the accepted types

- **WHEN** a user opens the attachment picker
- **THEN** it offers PDF, JPEG and PNG files

#### Scenario: A rejected file says what is accepted

- **WHEN** a user selects a file of an unaccepted type
- **THEN** a message names PDF, JPEG and PNG as the accepted types and no upload is attempted

#### Scenario: An older attachment remains readable

- **GIVEN** a document carrying an attachment of a type no longer accepted
- **WHEN** the user opens the detail screen
- **THEN** the attachment is listed and can still be downloaded
