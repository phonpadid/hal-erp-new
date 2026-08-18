# Store the value, not the markup

## Why

`form_field.field_type` decides both how a field is rendered and what its stored value means. The
renderer at `front-end/src/utils/formFields.ts:93` folds `text` in with `richtext`, `rich_text` and
`html`, returning a Quill `Editor` marked `html: true` — *"Plain text fields use the rich Editor so
the field body can be formatted"*. So every `text` field stores HTML, including the ones whose value
is a number a post-action later parses. The neighbouring cases are what the same registry offers
instead: `number` and `string` both return an `InputText` whose value is stored plain.

Filling in a promotion through the wizard and reading the rows back:

```
 field_name       field_type   stored value
 ─────────────    ──────────   ─────────────────────────────
 new_position     text         <p>Senior&nbsp;Officer</p>
 new_salary       text         <p>7500000</p>
 new_job_level    text         <p>SENIOR</p>
 effective_date   date         (empty)
```

**A salary that can never parse.** `applyPromotion` guards the value before it touches the employee:

```ts
if (salary != null && salary !== '' && !/^\d+(\.\d+)?$/.test(salary)) {
  throw new BadRequestException(`UPDATE_EMPLOYEE: invalid salary '${salary}'`);
}
```

`<p>7500000</p>` cannot match that pattern. The guard is right — its docblock says so plainly, *"A
non-decimal salary fails (the approval rolls back)"* — but the only form that produces the value
guarantees it will fail. The two were written against different assumptions about what a `text`
field holds, and nothing brought them together until a document was filled in and approved.

**A position stored as markup.** Even where no guard exists, the value is wrong.
`position: f['new_position']` writes `<p>Senior&nbsp;Officer</p>` straight into `employee.position`,
which then appears wherever a position is displayed — an org chart, a PDF, an approval step that
routes by position. Nothing rejects it because nothing is looking for markup.

**The date field discards typed input.** `effective_date` is `date` and renders a proper picker, but
typing `01/09/2026` into it and moving on leaves the value empty: the review step showed `—` and the
stored value is blank. Only choosing from the calendar commits. A field that accepts keystrokes,
shows them, and then throws them away is worse than one that is read-only, because the user has no
reason to look again. The promotion above lost its effective date exactly this way, and nothing in
the wizard or the review step said so.

**Why `text` is the wrong default for these.** The field type is doing two jobs at once — picking an
editor and declaring a value's shape — and they disagree. A salary is a decimal, a job level is one
of a known set, a position is a single line. None of the three wants a heading, a bullet list, or an
embedded image, all of which that editor offers.

## What Changes

**A field's type SHALL describe the value, and the renderer SHALL follow from it.** Where a
post-action or any other consumer parses a field, the field's type SHALL be one whose stored value
can be parsed: a decimal for money, a member of a known set where the set is known, a single line of
text where the value is a name.

Concretely, `FIELD_TYPES` already carries `number`, `dropdown` and `string` beside `text`. The
seeded promotion fields move to them — `new_salary` to `number`, `new_job_level` to a `dropdown` of
the company's job levels, `new_position` to `string` — and `text` keeps its rich editor for the
fields that genuinely want one, such as a reason or a justification.

**A stored value SHALL NOT carry the editor's markup.** Whatever the renderer, the value written to
`doc_field_value` is the value the field means. A rich-text field may legitimately store HTML; a
number, a date, a dropdown choice and a single-line string may not.

**A date field SHALL commit what the user typed, or refuse it visibly.** Accepting keystrokes and
silently discarding them is the failure to remove; either the typed date parses and is kept, or the
field says it did not.

**The mismatch SHALL be caught before it reaches a post-action.** A field whose value a post-action
parses is a contract between two places that currently cannot see each other. Submit is where that
contract can be checked cheaply, and it is far earlier than the approval where it currently breaks.

## Who this answers

| party | what happened | after |
| --- | --- | --- |
| whoever raises a promotion | typed a salary the approval could never accept | the field takes a number, and the number is what is stored |
| the approver of that promotion | the approval rolls back with `invalid salary '<p>7500000</p>'` | there is nothing to roll back |
| whoever reads an employee record | a position rendered as `<p>Senior&nbsp;Officer</p>` | the position is the position |
| whoever sets an effective date | typed it, saw it, lost it | the date is kept, or the field says it was not |
| whoever configures a form | one field type meaning both "rich editor" and "any string" | the type says what the value is |

## What This Change Does NOT Do

- **Does not change any post-action's parsing.** The salary guard, the effective-date handling and
  the employee update are all correct and stay as they are. What changes is what reaches them.
- **Does not remove the rich-text field type.** A reason or a justification is genuinely rich text
  and keeps its editor; the change is which fields are declared as such.
- **Does not migrate historical values.** Nothing has launched, and the seeded fields are re-seeded.
  A production backfill would be a separate question with its own risks.
- **Does not address who a promotion is about.** That `related_employee` is never set by the wizard
  is a different defect, covered by `finish-every-document-the-wizard-offers`. These two compound —
  a promotion today names nobody *and* carries an unparseable salary — but they are fixed in
  different places.
