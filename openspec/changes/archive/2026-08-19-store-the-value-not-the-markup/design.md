# Design — Store the value, not the markup

## Context

`form_field.field_type` is read in two places that disagree about what it means. The renderer
(`front-end/src/utils/formFields.ts`) treats it as *which control to draw*; a post-action reading
`doc_field_value` treats it as *what shape the value has*. For `text` those two readings are
incompatible: the control is a rich editor, so the value is HTML, and a consumer parsing it as a
number cannot succeed.

Found by filling in a promotion through the wizard and reading the rows back:
`new_salary` = `<p>7500000</p>`, against a guard of `/^\d+(\.\d+)?$/`.

## Decisions

### D1. Fix the configuration, not the parser

Two ways to reconcile them:

| | what changes | cost |
| --- | --- | --- |
| strip markup before storing | every `text` value loses formatting | destroys the field type that legitimately wants HTML — a reason, a justification |
| strip markup before parsing | `applyPromotion` unwraps `<p>…</p>` | the guard now has to know about the renderer; every future consumer needs the same unwrapping; a value that *looks* numeric in the UI is still stored as markup, so reports and PDFs keep the tags |
| **declare the right type (chosen)** | seeded promotion fields move off `text` | the registry already offers `number`, `string` and `dropdown`, all of which store plain values |

The third is the only one where the stored value becomes correct rather than repaired at each
reader. `formFields.ts` already returns `InputText` for `number` and `string` — the plumbing exists;
the seed simply names the wrong type.

### D2. `text` keeps its rich editor, and that is not the bug

It is tempting to read "`text` renders a rich editor" as the defect and split it into
`text` = plain / `richtext` = HTML. The registry already accepts `richtext`, `rich_text` and `html`
as synonyms of `text`, so the vocabulary is there — but changing what `text` renders would silently
convert every existing rich field into a single-line input, including the reason fields that are the
majority of configured forms and the ones the review dialog renders with `v-html`.

So `text` stays as it is, `html: true` and all. What changes is which fields are declared `text`.

### D3. The value's shape is declared by the type, and enforced where it is stored

Getting the seed right fixes today's fields; it does not stop the next form from declaring a salary
as `text`. The rule needs somewhere to live, so: a field whose type is not one of the HTML-valued
types SHALL NOT store markup, checked when the value is written.

This is cheap — the HTML-valued set is already known to the renderer, and `fieldComponent(...).html`
is the exact predicate — and it turns "somebody configured it wrong" into an error at submit rather
than a rollback at approval, which is the same move `finish-every-document-the-wizard-offers` makes
for missing content.

### D4. The date field commits what was typed, or says it did not

`FormDatePicker` wraps PrimeVue's DatePicker to keep the value an ISO `yyyy-mm-dd` string. Typing
into it shows the keystrokes and then discards them: the promotion lost `effective_date` this way,
and the review step showed `—` without comment.

Two options: make the input read-only so the picker is visibly the only way in, or parse what was
typed. Parsing is chosen — a date field that cannot be typed into is a worse form, especially for a
date far from today — with the rule that an unparseable entry is *shown* as rejected rather than
blanked. The failure to remove is the silence, not the typing.

### D5. Job level becomes a dropdown, and that is a real constraint, not a nicety

`new_job_level` currently accepts any string; the seed's own values are `STAFF`, `SENIOR` and so on,
and `job_level` is a master-data table. A free-text job level that does not match a real level
produces an employee whose level means nothing to the resolver that routes approvals by rank.

Making it a `dropdown` sourced from the company's job levels is therefore not just tidier: it is what
keeps `employee.job_level` a value the approval router can use.

## Risks

- **Existing configured forms may declare a numeric field as `text`.** On a seeded database only the
  promotion fields do. The submit-time check (D3) surfaces any others as an error naming the field,
  which is the intended way to find them.
- **Parsing typed dates introduces locale ambiguity** — `01/09/2026` is two different days depending
  on the reader. The wrapper already standardises on ISO `yyyy-mm-dd` for storage; the typed format
  should be the same one the field displays, so what the user sees and what they may type agree.
- **A dropdown of job levels needs the levels to exist.** They are seeded master data; a company with
  none gets an empty picker, which is a configuration gap the picker makes visible rather than one it
  causes.
