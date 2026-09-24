## Context

`DocumentPdfService.toPdf` draws the letter with pdfkit, band by band:
1. the national header;
2. the logo and name band (logo at `left`, 72×72, with the name beside it; ເລກທີ/ວັນທີ right-aligned
   in a 170pt column);
3. the title;
4. the salutation and subject;
5. the proposer lines, where the second line appends `PURPOSE_LEAD`.

The reference is the company's paper form (ໜັງສືສະເໜີ).

## Goals / Non-Goals

**Goals:**
- Lay out the logo, the name, the number and the dated place of issue as on the paper form.
- Remove the canned purpose phrase.

**Non-Goals:**
- A company setting for the city. The user chose fixed text.
- Any other part of the letter, and the configured sheets.

## Decisions

### 1. The header becomes two stacked bands

1. **Logo over the name.** The name's printed width is measured first (`widthOfString` at 12pt,
   capped at the width left of the number column). If there is a logo, it is drawn at
   `left + nameWidth / 2 - 36`, never left of `left`, with `{ fit: [72, 72], align: 'center',
   valign: 'center' }`, so it is centred over the name. Then the band advances 72pt plus a small
   gap. With no logo, or an unreadable one, nothing is drawn and nothing is advanced. That keeps
   the existing "letter still renders" catch.
   - A first reading of the form centred the logo on the page. The user corrected this with a
     close-up of the paper: the logo belongs to the name's block.
2. **Number row.**
   - The name is drawn at `left`, in a width that stops short of the right column so a long name
     wraps instead of running under the number.
   - `ເລກທີ {doc_no}` is right-aligned at the same `y`.
   - The date line is right-aligned directly below the number.
   - The band's bottom is the lower of the name's end and the date's end, exactly as today.

- **Why this layout?** The paper form keeps the logo and the name as one block at the left, level
  with the number. Matching the paper is the requirement.
- The right column widens from 170pt to about 220pt, because `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ 24/09/2026`
  does not fit in 170pt at 10pt.

### 2. The place of issue is a constant

`const PLACE_OF_ISSUE = 'ນະຄອນຫຼວງວຽງຈັນ'` goes beside `RECIPIENT_LINE` and `CLOSING_SALUTE`, the
other fixed Lao boilerplate. The date line becomes `` `${PLACE_OF_ISSUE}, ວັນທີ ${date}` ``.

### 3. The purpose phrase goes, and the line ends at the department

`PURPOSE_LEAD` is deleted. The second proposer line becomes
`ສັງກັດຢູ່ ພະແນກ {department}`. The trailing `;  ` separator is dropped too, because it only
existed to join the phrase.

### Testing

The test wraps pdfkit's `text` and `image`, the technique the signature-centring test already
uses, and asserts:
- the logo's x centres it on the page;
- the name is drawn at `left`, at the same y as the number;
- the date line text is `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ DD/MM/YYYY`;
- no drawn text contains `ມີຈຸດປະສົງ`.

## Risks / Trade-offs

- **[Trade-off] A company outside Vientiane prints ນະຄອນຫຼວງວຽງຈັນ.**
  → This is the user's explicit choice. If it is ever needed, one constant becomes a company field,
  as a separate change with a migration.
- **[Risk] A very long company name wraps onto two lines.**
  → The band's bottom already follows whichever column ends lower, so the title never overlaps
  it.

There are no data writes, no transactions and no locks.

## Migration Plan

None. Deploy the code. Rollback is a revert.

## Open Questions

_None._
