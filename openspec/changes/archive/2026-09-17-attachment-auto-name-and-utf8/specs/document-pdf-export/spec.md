## ADDED Requirements

### Requirement: An Evidence Page Is Captioned By The Stored File Name

The caption an evidence page prints for an attachment SHALL be the attachment's stored `file_name`
— for attachments filed since names are generated, `<doc_no>-<nn><ext>`; for older ones, the name
they were filed under, repaired to readable text where the migration could. The caption SHALL NOT
be the uploader's `original_file_name`: the printed set is cross-referenced by document number, and
a caption that carries the number lets a reader tie a loose page back to its document.

#### Scenario: A new attachment's page is captioned by its generated name

- **GIVEN** an attachment stored as `RECBL-HAL-2026-0029-01.pdf` with original name `ໃບສະເໜີ.pdf`
- **WHEN** the document is exported
- **THEN** the evidence page for it is captioned `RECBL-HAL-2026-0029-01.pdf`

#### Scenario: An older attachment's page reads its Lao name correctly

- **GIVEN** an attachment whose garbled `file_name` was repaired to `ໃບສະເໜີ ລົດຮ່ວມ.pdf`
- **WHEN** the document is exported
- **THEN** its evidence page is captioned `ໃບສະເໜີ ລົດຮ່ວມ.pdf`
