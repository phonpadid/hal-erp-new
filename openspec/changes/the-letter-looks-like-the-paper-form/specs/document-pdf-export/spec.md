## MODIFIED Requirements

### Requirement: Company Logo and Name Header

The exported PDF SHALL render the issuing company's logo and name below the national header,
laid out as the company's paper form lays them out:
- the logo and the company name SHALL form one block at the left margin, with the logo directly
  above the name and centred over it;
- the company name SHALL start at the left margin, on the same row as the ເລກທີ field, which is
  right-aligned.

The logo SHALL be the image at the document's `company.profile_image_path`, fetched server-side
from object storage. When the company has no `profile_image_path`, or the object cannot be fetched,
the logo SHALL be omitted, the name row SHALL follow the national header directly, and the export
SHALL still succeed. The company name SHALL be `company.name_th`.

#### Scenario: Company with a logo shows its logo and name

- **GIVEN** a document whose company has a `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the PDF shows that company's logo image and its `name_th`

#### Scenario: The logo sits centred over the name, and the name is on the number row

- **GIVEN** a document whose company has a logo
- **WHEN** the letter is exported
- **THEN** the logo is directly above the company name, and its horizontal centre is the centre of
  the printed name
- **AND** the company name starts at the left margin, at the same height as ເລກທີ

#### Scenario: Company without a logo still exports

- **GIVEN** a document whose company has no `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the company name is shown, no logo image is rendered, and the export succeeds

### Requirement: Document Number and Date Fields

The exported PDF SHALL show, in the header area, a ເລກທີ field bound to the document's `doc_no`,
right-aligned on the company-name row. Below it, also right-aligned, it SHALL show the date line
`ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ {date}`, where the date is the document's `created_at` rendered as a
date.

The place of issue (`ນະຄອນຫຼວງວຽງຈັນ`) SHALL be fixed letter text, like the salutation and the
closing, and SHALL NOT be read from company data.

#### Scenario: Number and date reflect the document

- **GIVEN** a document with a `doc_no` and a `created_at`
- **WHEN** the PDF is exported
- **THEN** ເລກທີ shows the `doc_no` and ວັນທີ shows the `created_at` formatted as a date

#### Scenario: The date names the place of issue

- **GIVEN** a document created on 24 September 2026
- **WHEN** the letter is exported
- **THEN** the date line reads `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ 24/09/2026`

### Requirement: Proposer Identity Line

The exported PDF SHALL render a proposer line identifying the person the document is for,
resolved from the document's employee: the `document.related_employee` when present, otherwise the
employee record of `document.created_by` in the document's company. The line SHALL present:
- the employee `full_name`, labelled ຂ້າພະເຈົ້າ ທ້າວ/ນາງ;
- the employee `position`, labelled ຕຳແໜ່ງ;
- the employee `department` name, labelled ສັງກັດ ພະແນກ.

A missing `position` or an unresolved employee SHALL leave the corresponding value blank, and the
export SHALL still succeed.

The proposer line SHALL NOT carry any fixed statement of purpose (such as
`ມີຈຸດປະສົງ: ຂໍສະເໜີມາຍັງທ່ານ ເພື່ອຂໍ`). The purpose of a document is what the requester wrote in
the form, and a canned phrase ahead of it either repeats that or contradicts it.

#### Scenario: Proposer line reflects the document's employee

- **GIVEN** a document whose related/creating employee has a full name, position, and department
- **WHEN** the PDF is exported
- **THEN** the proposer line shows that full name, position, and department name

#### Scenario: Employee without a position still renders

- **GIVEN** a document whose employee has no `position`
- **WHEN** the PDF is exported
- **THEN** the proposer line shows the full name and department with an empty position and
  the export still succeeds

#### Scenario: No canned purpose follows the department

- **WHEN** any letter is exported
- **THEN** no text reading `ມີຈຸດປະສົງ` is printed on the proposer lines, and the requester's own
  reason appears only where the form puts it
