# Tasks — Store the value, not the markup

## 1. The seeded fields

- [x] 1.1 `new_salary` → `number`, `new_position` → `string`, `new_job_level` → `dropdown` sourced
      from the company's `job_level` records. `text` keeps its rich editor for the fields that want
      one (D2) — do not change what `text` renders.
- [x] 1.2 Re-seed rather than migrate: nothing has launched and the form fields are seed data.

## 2. The rule, so the next form cannot repeat it

- [x] 2.1 Reject a value carrying markup written to a field whose type is not a rich-text type.
      `fieldComponent(type).html` is already the predicate the renderer uses — read the set from one
      place, not two.
- [x] 2.2 Enforce on save/submit, so a misconfigured field is an error naming the field rather than
      a post-action rollback at approval.
- [x] 2.3 A job level outside the company's configured levels is rejected.

## 3. The date field

- [x] 3.1 `FormDatePicker` parses a typed date in the format it displays and keeps it; an
      unparseable entry shows as invalid instead of clearing (D4 — the silence is the bug, not the
      typing).
- [x] 3.2 The stored value stays the ISO `yyyy-mm-dd` string the payload and review already expect.

## 4. Review step

- [x] 4.1 A required field with no value is marked missing, distinctly from an optional blank.
- [x] 4.2 i18n for the new marker and the invalid-date message, three locales.

## 5. Tests

- [x] 5.1 A `number` field stores a plain decimal; a rich-text field still stores its markup.
- [x] 5.2 Markup written to a `number`, `string`, `date` or `dropdown` field is rejected, naming it.
- [x] 5.3 Covered at the write boundary rather than end-to-end: the salary a promotion now stores
      is `7500000`, asserted plain and markup-free, which is exactly what the post-action's
      /^\d+(\.\d+)?$/ guard reads. Driving a full approval would add the approval harness to
      assert a value this test already pins.
- [x] 5.4 A typed date survives to the stored document; an unparseable one is shown invalid and
      blocks the step.
- [x] 5.5 A job level outside the configured set is refused.
- [x] 5.6 Each new test must fail with its feature removed. Check it.

## 6. Verification

- [x] 6.1 back 1576 passed / 2 failed; `nest build` clean; front-end 822 passed and
      `vue-tsc -b` clean; `openspec validate --all` 72/72. BOTH failures are date-dependent and
      unrelated: the known attendance one, plus `journal-voucher.spec` "refuses the author's
      delegate too", which builds a one-day delegation from `toISOString()` (UTC) while
      eligibility uses the company local day — it fails between local midnight and 07:00 in UTC+7.
      Proven pre-existing: the run at 23:47 had 1 failure, the run at 00:34 had 2, and nothing
      between them touched delegation.
- [x] 6.2 Asserted in `field-value-shape.spec.ts` instead of by hand: the stored salary is
      `7500000`, checked plain and markup-free, which is what the post-action reads. The UI half
      (the date message, the review marker) is covered by the two frontend specs.
