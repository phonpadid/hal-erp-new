## Context

`document-pdf.service.ts` holds the letter's fixed Lao phrasing as module constants:

```
const RECIPIENT_LINE = (company: string) => `ຮຽນ: ຜູ້ອຳນວຍການ${company}.`;
const CLOSING_PARAGRAPH = (company: string) =>
  `ດັ່ງນັ້ນ, ຈຶ່ງສະເໜີມາຍັງ ຜູ້ອຳນວຍການ${company} ແລະ ຜະແນກການທີ່ກ່ຽວຂ້ອງ ພິຈາລະນາຕາມຄວາມ ເໝາະສົມດ້ວຍ.`;
```

Both are called with `model.companyName`, which is `document.company.name_th` (line 547). That same
`companyName` also draws the letterhead block at line 806. One value, three uses, two of which are
about the ADDRESSEE and one about the ISSUER — which is precisely why "change the company name in
the letter" is the wrong fix and would silently rewrite the letterhead.

`document_type` already carries per-type print and read configuration of exactly this shape:
`print_templates` (which sheets print) and `view_permission_code` (who may read the type's
documents). Both are nullable-or-defaulted strings set by an administrator in the type form, both
are documented in the DBML as configuration rather than code, and `view_permission_code` already
establishes the convention that an empty string is stored as NULL.

## Goals / Non-Goals

**Goals:**

- A type can name the party its letters address, set by an administrator with no deployment.
- Every type that exists today prints byte-identical letters until somebody sets the field.
- The salutation and the closing can never name different parties.
- The letterhead is provably unaffected.

**Non-Goals:**

- Not making the rest of the letter configurable. `ຮຽນ:`, the closing frame and
  `ຂອບໃຈມາດ້ວຍຄວາມເຄົາລົບນັບຖືຢ່າງສູງ` are Lao official phrasing; a company that could edit them could
  produce a letter that is no longer a Lao official letter.
- Not per-document, and not per-company. See the spec's reasoning.
- Not translating or validating the addressee text. It is printed as written, like `step_name`.
- Not touching `PLACE_OF_ISSUE`, which the spec already fixes as letter text.

## Decisions

**A whole-phrase replacement, not a company-name substitution.**
The alternative — keep `ຜູ້ອຳນວຍການ` fixed and let the type override only what follows it — would print
`ຮຽນ: ຜູ້ອຳນວຍການພະແນກພັດທະນາເທັກໂນໂລຊີ`, "the director of the IT department", which is a different
party from the department and is not who the letter is for. The whole phrase is one noun: the
addressee. So `RECIPIENT_LINE` and `CLOSING_PARAGRAPH` take an `addressee` string, and the caller
decides whether that string is the configured value or the composed default.

**One resolver, called once.**
The default (`ຜູ້ອຳນວຍການ` + `company.name_th`) is composed in a single place that both lines read,
rather than each line falling back on its own. Two independent fallbacks are how a salutation and a
closing come to disagree — the failure the spec forbids — and the "both lines name the same party"
scenario is there to fail if that ever stops being true.

**On `document_type`, carried through the render model.**
The model already carries `printTemplates` from the type (line 519), so the type is in hand where
the model is built; the addressee joins it as a resolved string rather than as the raw column, so
the renderer never has to know the default rule. A nullable `varchar`, empty-string-to-NULL on
write, mirroring `view_permission_code` exactly — including its DBML note explaining why it is
configuration and not a branch on the type's code.

**No enumeration, no FK to `department`.**
Tempting, since the first use names a department. But the addressee is a form of words on a printed
letter, not a reference to an org-chart row: HAL may want `ພະແນກພັດທະນາເທັກໂນໂລຊີ` on the PRFI letter
whether or not a department row spells it that way, and a FK would make renaming a department
rewrite historical-looking letters. Free text, like `step_name`.

## Risks / Trade-offs

- **An administrator sets the field and every letter of that type changes at once, including for
  documents already approved.** → True and intended: the PDF is rendered on demand from current
  configuration, as it already is for `print_templates` and the signature blocks. A letter is not an
  archived artefact in this system. Worth saying plainly to whoever sets it; the form's help text
  does.
- **Free text can be set to something wrong, or to the empty-looking whitespace.** → Trimmed on
  write and stored as NULL when empty, so whitespace cannot become a blank addressee that prints
  `ຮຽນ: .`.
- **A long addressee could overflow the salutation line.** → The line already goes through
  `laoLineBreaks` and a width-constrained `text()` call, so it wraps the way a long company name
  already does. No new layout path.
- **Someone later wants this per company as well.** → Not closed off: a company-level default could
  compose the fallback this change centralises, without touching the renderer or the type column.

## Migration Plan

One additive migration adding a nullable column. No backfill: NULL is the default and NULL means
today's wording, so every existing row is already correct. Deploy order does not matter — the
renderer treats a missing value and a NULL value identically. Rollback is dropping the column, after
which every type prints the director wording again.

## Open Questions

None. The first consumer (`PRFI` → `ພະແນກພັດທະນາເທັກໂນໂລຊີ`) is configuration an administrator enters
after this ships, not part of the change.
