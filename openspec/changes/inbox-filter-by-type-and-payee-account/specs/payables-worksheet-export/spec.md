## MODIFIED Requirements

### Requirement: The Sheet Has Finance's Columns In Finance's Order

The workbook SHALL have one sheet with a title row, a header row, and one data row per document, in
this column order: arrival date (`ວັນທີ່ເອກະສານມາ`), running index (`ລ/ດ`), finance number
(`ເລກທີ ການເງິນ`), department number (`ເລກທີພະແນກ`), description (`ລາຍການ`), section (`ພາກສ່ວນ`),
one amount column per currency (see below), bank (`ບັນຊີ`), the payee's account number
(`ເລກບັນຊີ`), the payee's account name (`ຊື່ບັນຊີ`), main account (`ຫຼັກ`), reserve account
(`ສຳຮອງ`), remark (`ໝາຍເຫດ`). Headers SHALL be written in Lao as listed, since the sheet is the
Lao-language document finance already keeps and hands to the head.

The bank column (`ບັນຊີ`) SHALL carry the `vendor_bank_account.bank_code` of the payee account the
document names (`BCEL`, `LDB`), and SHALL be empty when the document names none — the requester
already chose the destination, so the system can answer this one.

The two columns beside it SHALL carry the rest of that same destination: `vendor_bank_account.account_no`
and `vendor_bank_account.account_name`, each empty when the document names no payee. A bank code
alone is not a transfer — finance reads this sheet to move the money and had to open every document
to copy the two fields the bank actually asks for. The account number SHALL be written as TEXT, never
as a number: it identifies, it does not measure, and a spreadsheet that reads it as a quantity drops
its leading zeros. The columns finance decides —
finance number, main account, reserve account, remark — SHALL be written **empty**. The system
holds no decision for them and SHALL NOT guess one.

Per row:
- arrival date SHALL be `document.submitted_at` as a date cell (no time), the moment the document
  reached finance's queue;
- section SHALL be the document's `department.name`;
- the running index SHALL count from 1 within the sheet in the order written.

Rows SHALL be ordered by `submitted_at` descending within each group (newest first, as finance's
sheet is kept), with `doc_no` as the tie-break.

#### Scenario: Decision columns are blank

- **WHEN** the export is produced
- **THEN** every data row's finance-number, main, reserve and remark cells are empty

#### Scenario: The payee's bank is written

- **GIVEN** a document whose payee account is at `BCEL` and one that names no payee
- **WHEN** the export is produced
- **THEN** the first row's bank cell is `BCEL` and the second row's bank cell is empty

#### Scenario: Arrival date is the submit date

- **GIVEN** a document created on the 1st and submitted on the 3rd
- **WHEN** the export is produced
- **THEN** its arrival-date cell is the 3rd


#### Scenario: The payee's account number and name are written

- **GIVEN** a document whose payee account is `0209876543` in the name of `ບໍລິສັດ ກ ຈຳກັດ` at
  `BCEL`
- **WHEN** the export is produced
- **THEN** that row's bank cell is `BCEL`, its account-number cell is `0209876543` and its
  account-name cell is `ບໍລິສັດ ກ ຈຳກັດ`

#### Scenario: A document with no payee leaves all three empty

- **GIVEN** a document that names no payee account
- **WHEN** the export is produced
- **THEN** its bank, account-number and account-name cells are all empty

#### Scenario: An account number keeps its leading zeros

- **GIVEN** a payee account numbered `0209876543`
- **WHEN** the export is produced
- **THEN** the cell is text and reads `0209876543`, not `209876543`
