## Why

Every letter this system prints is addressed to the managing director. `document-pdf.service.ts`
builds the salutation as `ຮຽນ: ຜູ້ອຳນວຍການ${company}.` and the closing as
`ດັ່ງນັ້ນ, ຈຶ່ງສະເໜີມາຍັງ ຜູ້ອຳນວຍການ${company} ແລະ ຜະແນກການທີ່ກ່ຽວຂ້ອງ ...`, with the company name
interpolated and the rest of the phrase fixed in code.

That is wrong for a whole class of document. HAL's `PRFI` (ໃບສະເໜີຂໍ້ມູນ) asks the IT department for
data; it is not a request to the director and should not be addressed to one. The letter currently
goes out saying it is, which is a statement about who is being asked — not a formatting detail.

Per-type letter wording cannot be a branch on the type's code (invariant 7): the next type that
addresses someone else would need another branch, another deployment, and a developer. An
administrator who can already decide a type's form, its route, its category and who may read it
should be able to decide who its letter is addressed to.

## What Changes

- `document_type` gains a nullable **letter addressee** setting: free text that replaces the entire
  `ຜູ້ອຳນວຍການ<company>` phrase in both the salutation and the closing paragraph.
- NULL — the default and the value every existing type keeps — prints exactly today's wording, so no
  document that prints correctly today changes.
- The setting is editable in the document-type admin form beside the other per-type print
  configuration (`print_templates`), so turning it on needs no deployment.
- The company-name letterhead block is explicitly NOT affected. It names the company issuing the
  letter, which is a different fact from who the letter is addressed to, and it stays
  `document.company.name_th` whatever the addressee is.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-pdf-export`: gains a requirement that the salutation and closing address whoever the
  document's type names, defaulting to today's director wording. The existing Company Logo and Name
  Header requirement gains a scenario pinning the letterhead as unaffected, because "replace the
  company name in the letter" is exactly the misreading this change must not invite.
- `web-doc-config`: the document-type form gains the field, so the setting is reachable without a
  developer.

## Impact

- `erp_approval_system.dbml` — `document_type` gains `letter_addressee`, documented beside
  `print_templates` and `view_permission_code`, which it resembles: per-type print/read
  configuration, nullable, empty string stored as NULL.
- One additive migration: a nullable column, no backfill, no default beyond NULL. Nothing to
  recompute and nothing that can fail on existing rows.
- `back/src/modules/document/document.entities.ts`, `dto/config.dto.ts`,
  `document-type.service.ts` — the column, its validation and its create/update path.
- `back/src/modules/document/document-pdf.service.ts` — `RECIPIENT_LINE` and `CLOSING_PARAGRAPH`
  take the addressee instead of the company name; the model carries it from the document's type.
- `front-end/src/views/admin/doc-config/DocTypeFormView.vue` and its i18n — the admin field.
- No change to approval, budget, numbering or any ledger. A letter's wording decides nothing about
  what a document does.
