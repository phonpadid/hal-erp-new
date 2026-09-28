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

/**
 * The letter's ອີງຕາມ block — the decisions and earlier documents the letter rests on, printed under
 * ເລື່ອງ as one dashed line each. `ref` is the name the forms carry.
 */
export const REFERENCE_FIELD_NAMES = ['ref', 'refs', 'reference', 'references'];

/** The caption that marks the references field when no field bears one of those names. */
export const REFERENCE_FIELD_LABELS = ['ອີງຕາມ'];

/**
 * The letter's own date field — the day the proposal is dated. The letter already prints the date
 * in its header (ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ …), so this field is left out of the body rather than printed
 * a second time. Only a `date` field qualifies: a text field that happens to be named `date` is
 * something the requester wrote, and still prints.
 */
export const PROPOSAL_DATE_FIELD_NAMES = ['date', 'proposal_date', 'request_date'];
export const PROPOSAL_DATE_FIELD_LABELS = ['ວັນທີສະເໜີ'];

/** The part of `form_field` these lookups read. */
export interface NamedField {
  id: string;
  fieldName: string;
  fieldLabel?: string | null;
}

/** A label compared as a caption: surrounding whitespace and a trailing colon are not part of it. */
const caption = (label: string | null | undefined): string =>
  (label ?? '').trim().replace(/[:：]\s*$/, '').trim();

/** The form's proposal-date field (see {@link PROPOSAL_DATE_FIELD_NAMES}), by name, else by caption. */
export function findProposalDateField<F extends NamedField & { fieldType?: string | null }>(
  fields: F[],
): F | undefined {
  const dates = fields.filter((f) => f.fieldType === 'date');
  for (const name of PROPOSAL_DATE_FIELD_NAMES) {
    const byName = dates.find((f) => f.fieldName.toLowerCase() === name);
    if (byName) return byName;
  }
  return dates.find((f) => PROPOSAL_DATE_FIELD_LABELS.includes(caption(f.fieldLabel)));
}

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

/**
 * The form's references field: by name first (`ref`, then its aliases), else by the caption ອີງຕາມ,
 * else none. The one lookup both the letter and the payables sheet use.
 */
export function findReferenceField<F extends NamedField>(fields: F[]): F | undefined {
  for (const name of REFERENCE_FIELD_NAMES) {
    const byName = fields.find((f) => f.fieldName.toLowerCase() === name);
    if (byName) return byName;
  }
  return fields.find((f) => REFERENCE_FIELD_LABELS.includes(caption(f.fieldLabel)));
}

/** One ອີງຕາມ entry: the marker drawn in front of it (a dash, or the number it was written with) and its text. */
export interface ReferenceLine {
  marker: string;
  text: string;
}

/** The dash an entry is drawn behind when it was not numbered. */
export const REFERENCE_DASH = '–';

/**
 * A references value as the letter's list: one entry per line the requester wrote (or per list
 * item, in the rich editor). A numbered entry (`1.`, `2)`) keeps its number; any other is drawn
 * behind a dash, and a dash or bullet it was typed with is dropped so it is not doubled. Blank lines
 * are dropped. Takes the value already reduced to plain text, where a numbered list is `1. …`.
 */
export function referenceLines(text: string | null | undefined): ReferenceLine[] {
  return (text ?? '')
    .split('\n')
    .map((l) => {
      const numbered = l.match(/^\s*(\d{1,3}[.)])\s+(.*)$/);
      if (numbered) return { marker: numbered[1], text: numbered[2].trim() };
      return { marker: REFERENCE_DASH, text: l.replace(/^\s*[-–—•*·]+\s*/, '').trim() };
    })
    .filter((l) => l.text !== '');
}
