/**
 * The form-field conventions the printed letter and the payables sheet read from.
 *
 * A form is configuration, so these are conventions rather than a schema: a form that uses one of
 * these names fills the matching place, and a form that uses none leaves it blank. Kept in one
 * module so the letter and the sheet cannot come to disagree about which field is which.
 *
 * Matched on `field_name`, case-insensitively — never on `field_type`, which several fields share
 * (`Reson` and `subject` are both `text`).
 */

// `reson` is a misspelling, and it is the name every form template in production actually
// carries (label ເຫດຜົນ) — the cell printed blank until it was listed here. Kept as an alias
// rather than renamed in the database: values key on `form_field.id`, so a rename would be
// safe, but this list exists precisely so a form's naming is not the renderer's business.
export const PURPOSE_FIELD_NAMES = ['purpose', 'purposes', 'reason', 'reson', 'objective'];

/** The letter's ເລື່ອງ line. `subject` first: when a form carries both, it wins. */
export const SUBJECT_FIELD_NAMES = ['subject', 'topic'];

/**
 * The caption that marks a subject field when no field bears a subject NAME. A fallback only: a
 * label is translated per company and editable, so it never displaces a correctly named field.
 */
export const SUBJECT_FIELD_LABELS = ['ເລື່ອງ'];

/** The part of `form_field` these lookups read. */
export interface NamedField {
  id: string;
  fieldName: string;
  fieldLabel?: string | null;
}

/** A label compared as a caption: surrounding whitespace and a trailing colon are not part of it. */
const caption = (label: string | null | undefined): string =>
  (label ?? '').trim().replace(/[:：]\s*$/, '').trim();

/**
 * The form's subject field: by name first (`subject`, then `topic`), else by the caption ເລື່ອງ,
 * else none. The one lookup both the letter and the payables sheet use.
 */
export function findSubjectField<F extends NamedField>(fields: F[]): F | undefined {
  for (const name of SUBJECT_FIELD_NAMES) {
    const byName = fields.find((f) => f.fieldName.toLowerCase() === name);
    if (byName) return byName;
  }
  return fields.find((f) => SUBJECT_FIELD_LABELS.includes(caption(f.fieldLabel)));
}
