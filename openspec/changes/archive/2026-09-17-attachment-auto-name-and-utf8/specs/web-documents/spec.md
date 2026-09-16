## MODIFIED Requirements

### Requirement: The Attachment Picker Accepts Only Printable Evidence

The attachment picker on the document screens SHALL offer only PDF, JPEG and PNG files, mirroring
the server's allow-list so the client and the server do not drift, and SHALL explain a rejected
file by naming the accepted types rather than reporting a bare failure. The client check is a
convenience: the server remains the enforcement point. Attachments already stored outside the
accepted types SHALL still be listed and downloadable from the detail screen.

The attachment list SHALL show each attachment by its stored `file_name` — for new uploads the
server-generated `<doc_no>-<nn><ext>` — and, when `original_file_name` is present and differs,
SHALL show the original name as secondary text beneath it, so the uploader can still recognise
the file they chose. The picker SHALL NOT ask the user to name the file.

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

#### Scenario: The list shows the generated name with the original beneath

- **GIVEN** an attachment named `RECBL-HAL-2026-0029-01.pdf` whose `original_file_name` is
  `ໃບສະເໜີ ລົດຮ່ວມ.pdf`
- **WHEN** the document screen lists it
- **THEN** `RECBL-HAL-2026-0029-01.pdf` is the primary text and `ໃບສະເໜີ ລົດຮ່ວມ.pdf` the secondary

#### Scenario: An older attachment shows only its name

- **GIVEN** an attachment recorded before generated names, with a null `original_file_name`
- **WHEN** the document screen lists it
- **THEN** only its `file_name` is shown, with no empty secondary line
