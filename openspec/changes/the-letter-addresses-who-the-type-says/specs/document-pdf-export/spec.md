## ADDED Requirements

### Requirement: The Letter Addresses Whoever Its Type Names

The letter's salutation and its closing paragraph SHALL address the party named by the document's
type in `document_type.letter_addressee`. When that value is NULL — the default, and what every type
carries until an administrator sets one — the letter SHALL address `ຜູ້ອຳນວຍການ` followed by the
issuing company's `name_th`, which is the wording printed before this setting existed. When a value
is present, it SHALL replace that whole phrase, `ຜູ້ອຳນວຍການ` included, in BOTH lines: a letter that
greeted one party and closed by proposing to another would state two different recipients for one
request.

The surrounding letter text SHALL stay fixed: the `ຮຽນ:` label, the trailing full stop, and the
closing's `ດັ່ງນັ້ນ, ຈຶ່ງສະເໜີມາຍັງ ... ແລະ ຜະແນກການທີ່ກ່ຽວຂ້ອງ ພິຈາລະນາຕາມຄວາມ ເໝາະສົມດ້ວຍ.` frame are
Lao official phrasing and are not configuration. The addressee is the only part a type may decide.

The setting SHALL live on the document TYPE, not on the document and not on the company: who a kind
of request is addressed to is configuration (invariant 7), while a per-document choice would let a
requester redirect their own request, and a per-company one could not tell a purchase request from a
data request. An empty string SHALL be stored as NULL, so "cleared" and "never set" are one state
rather than two that print differently.

#### Scenario: A type that names no addressee prints the director wording

- **GIVEN** a document whose type has `letter_addressee` NULL, in a company whose `name_th` is `ບໍລິສັດ ຮຸ່ງອາລຸນ ຂົນສົ່ງດ່ວນ ຈຳກັດ`
- **WHEN** the letter is exported
- **THEN** the salutation reads `ຮຽນ: ຜູ້ອຳນວຍການບໍລິສັດ ຮຸ່ງອາລຸນ ຂົນສົ່ງດ່ວນ ຈຳກັດ.`
- **AND** the closing proposes to `ຜູ້ອຳນວຍການບໍລິສັດ ຮຸ່ງອາລຸນ ຂົນສົ່ງດ່ວນ ຈຳກັດ`

#### Scenario: A type that names an addressee replaces the whole phrase

- **GIVEN** a document whose type has `letter_addressee` `ພະແນກພັດທະນາເທັກໂນໂລຊີ`
- **WHEN** the letter is exported
- **THEN** the salutation reads `ຮຽນ: ພະແນກພັດທະນາເທັກໂນໂລຊີ.`
- **AND** the word `ຜູ້ອຳນວຍການ` appears in neither the salutation nor the closing paragraph

#### Scenario: Both lines name the same party

- **GIVEN** a document whose type names an addressee
- **WHEN** the letter is exported
- **THEN** the party named in the salutation and the party named in the closing paragraph are the same text

#### Scenario: Only the addressee is configurable

- **GIVEN** a document whose type has `letter_addressee` `ພະແນກພັດທະນາເທັກໂນໂລຊີ`
- **WHEN** the letter is exported
- **THEN** the salutation still carries the `ຮຽນ:` label and its trailing full stop
- **AND** the closing still reads `ດັ່ງນັ້ນ, ຈຶ່ງສະເໜີມາຍັງ ... ແລະ ຜະແນກການທີ່ກ່ຽວຂ້ອງ ພິຈາລະນາຕາມຄວາມ ເໝາະສົມດ້ວຍ.` around it

#### Scenario: A cleared addressee returns to the default wording

- **GIVEN** a type whose `letter_addressee` is set
- **WHEN** an administrator clears the field
- **THEN** the value is stored as NULL and the letter prints the director wording again

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

This header names the company ISSUING the letter and is independent of who the letter is addressed
to. It SHALL NOT be affected by `document_type.letter_addressee`: the two answer different
questions, and a type that addresses a department still issues its letter on the company's paper.

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

#### Scenario: A configured addressee does not change the letterhead

- **GIVEN** a document whose type has `letter_addressee` `ພະແນກພັດທະນາເທັກໂນໂລຊີ`
- **WHEN** the letter is exported
- **THEN** the header block still shows the company's `name_th`, unchanged
