## Why

The printed proposal letter should look like the paper form the company already uses, and it
differs in three places:

- **Logo and company name.** The form puts the logo and the company name together at the left,
  with the logo centred over the name, and the name level with ເລກທີ on the right. The letter instead puts
  the logo in the top-left corner with the name beside it.
- **Place of issue.** The form's date line reads `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ …`. The letter prints
  `ວັນທີ …` alone.
- **A fixed purpose phrase.** The letter prints `ມີຈຸດປະສົງ: ຂໍສະເໜີມາຍັງທ່ານ ເພື່ອຂໍ` after
  the proposer's department on every letter. The user states the reason themselves in the form's
  ເຫດຜົນ field, so this canned half-sentence either duplicates what follows or contradicts it,
  and it confuses readers.

## What Changes

- **Header band.**
  - The logo and the company name form one block at the left: the logo sits centred directly
    above the name.
  - The name row carries `ເລກທີ {doc_no}` on the right.
  - The next row, on the right, is `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ {created_at}`.
- **Place of issue is fixed text.** `ນະຄອນຫຼວງວຽງຈັນ` is printed as constant letter boilerplate,
  like the salutation and the closing. This follows the user's decision, and there is no company
  setting.
- **The purpose phrase is removed.**
  - The proposer's second line ends at the department.
  - The reason reaches the letter only through the form's own field, as ເຫດຜົນ in the body.

Out of scope, left unchanged: the national header text and separator, the title, the salutation,
the "via" line, the body, the closing, the signatures (centred in the previous change), and the
configured sheets.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `document-pdf-export`:
  - **Company Logo and Name Header:** the layout changes, with the logo centred and the name on
    the number row.
  - **Document Number and Date Fields:** the date line gains the place of issue.
  - **Proposer Identity Line:** it no longer carries a fixed purpose phrase.

Invariants: none is touched. The change is rendering only, with no data and no schema.

## Impact

- `back/src/modules/document/document-pdf.service.ts`:
  - the header band drawing in `toPdf`;
  - add a `PLACE_OF_ISSUE` constant;
  - remove `PURPOSE_LEAD` and its use.
- `back/src/modules/document/document-pdf.spec.ts`: drawing assertions for the three changes.
- There is no migration, no permission, and no frontend change.
