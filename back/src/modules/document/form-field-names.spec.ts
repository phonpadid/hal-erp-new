import { describe, expect, it } from 'vitest';
import { findProposalDateField, findReferenceField, findSubjectField, referenceLines, type NamedField } from './form-field-names';

const field = (id: string, fieldName: string, fieldLabel = ''): NamedField => ({ id, fieldName, fieldLabel });

/**
 * Which field is the letter's ເລື່ອງ. By name first, by caption only as a fallback, never by type —
 * so a form that carries `Reson` beside the subject can never have the two swapped.
 */
describe('findSubjectField', () => {
  it('finds the field named subject', () => {
    expect(findSubjectField([field('a', 'Reson', 'ເຫດຜົນ'), field('b', 'subject', 'ເລື່ອງ')])?.id).toBe('b');
  });

  it('matches the name in any case', () => {
    expect(findSubjectField([field('a', 'Subject')])?.id).toBe('a');
    expect(findSubjectField([field('a', 'SUBJECT')])?.id).toBe('a');
  });

  it('accepts topic as an alias, and prefers subject when both exist', () => {
    expect(findSubjectField([field('a', 'topic')])?.id).toBe('a');
    expect(findSubjectField([field('a', 'topic'), field('b', 'subject')])?.id).toBe('b');
  });

  it('falls back to the caption ເລື່ອງ, with or without its colon', () => {
    expect(findSubjectField([field('a', 'Reson', 'ເຫດຜົນ'), field('b', 'title', 'ເລື່ອງ:')])?.id).toBe('b');
    expect(findSubjectField([field('b', 'title', '  ເລື່ອງ  ')])?.id).toBe('b');
  });

  it('lets the name win over the caption', () => {
    expect(findSubjectField([field('a', 'heading', 'ເລື່ອງ'), field('b', 'subject', 'Topic')])?.id).toBe('b');
  });

  it('finds nothing when neither the name nor the caption matches', () => {
    expect(findSubjectField([field('a', 'Reson', 'ເຫດຜົນ'), field('b', 'date', 'ວັນທີສະເໜີ')])).toBeUndefined();
    expect(findSubjectField([])).toBeUndefined();
  });

  it('never picks a field by its type', () => {
    // A lone text field that is neither named nor captioned as the subject is not the subject.
    expect(findSubjectField([field('a', 'note', 'ໝາຍເຫດ')])).toBeUndefined();
  });
});

describe('findProposalDateField', () => {
  const f = (id: string, fieldName: string, fieldType: string, fieldLabel?: string) => ({ id, fieldName, fieldType, fieldLabel });

  it('finds the date field named `date` — the name every production form carries', () => {
    expect(findProposalDateField([f('r', 'Reson', 'text'), f('d', 'date', 'date', 'ວັນທີສະເໜີ')])?.id).toBe('d');
  });

  it('falls back to the caption ວັນທີສະເໜີ on a date field named otherwise', () => {
    expect(findProposalDateField([f('d', 'submitted_on', 'date', 'ວັນທີສະເໜີ:')])?.id).toBe('d');
  });

  it('leaves a text field named `date` alone — that is something the requester wrote', () => {
    expect(findProposalDateField([f('t', 'date', 'text', 'ວັນທີ')])).toBeUndefined();
  });

  it('leaves any other date alone — a needed-by date is not the date of the letter', () => {
    expect(findProposalDateField([f('e', 'expected_date', 'date', 'ວັນທີຕ້ອງການ')])).toBeUndefined();
  });
});

/** Which field is the letter's ອີງຕາມ block — the same rules as the subject: name, then caption, never type. */
describe('findReferenceField', () => {
  it('finds the field named ref, in any case', () => {
    expect(findReferenceField([field('a', 'subject', 'ເລື່ອງ'), field('b', 'ref', 'ອ້າງອີງ')])?.id).toBe('b');
    expect(findReferenceField([field('a', 'REF')])?.id).toBe('a');
  });

  it('accepts reference as an alias, and prefers ref when both exist', () => {
    expect(findReferenceField([field('a', 'reference')])?.id).toBe('a');
    expect(findReferenceField([field('a', 'reference'), field('b', 'ref')])?.id).toBe('b');
  });

  it('falls back to the caption ອີງຕາມ, and the name wins over it', () => {
    expect(findReferenceField([field('a', 'basis', 'ອີງຕາມ:')])?.id).toBe('a');
    expect(findReferenceField([field('a', 'basis', 'ອີງຕາມ'), field('b', 'ref', 'Refs')])?.id).toBe('b');
  });

  it('finds nothing on a form without one', () => {
    expect(findReferenceField([field('a', 'subject', 'ເລື່ອງ'), field('b', 'Reson', 'ເຫດຜົນ')])).toBeUndefined();
  });
});

describe('referenceLines', () => {
  const dash = (text: string) => ({ marker: '–', text });

  it('gives one dashed entry per line, without the dash or bullet it was typed with', () => {
    expect(referenceLines('- ອີງຕາມ ກ;\n– ອີງຕາມ ຂ;\n• ອີງຕາມ ຄ.')).toEqual([dash('ອີງຕາມ ກ;'), dash('ອີງຕາມ ຂ;'), dash('ອີງຕາມ ຄ.')]);
  });

  it('keeps the number of a numbered entry', () => {
    expect(referenceLines('1. ອີງຕາມ ກ;\n2) ອີງຕາມ ຂ.')).toEqual([
      { marker: '1.', text: 'ອີງຕາມ ກ;' },
      { marker: '2)', text: 'ອີງຕາມ ຂ.' },
    ]);
  });

  it('does not take a date or an amount for a number', () => {
    expect(referenceLines('01 ສິງຫາ 2026\n2026.')).toEqual([dash('01 ສິງຫາ 2026'), dash('2026.')]);
  });

  it('keeps a line that has no marker, and drops blank ones', () => {
    expect(referenceLines('ອີງຕາມ ກ\n\n  \nອີງຕາມ ຂ')).toEqual([dash('ອີງຕາມ ກ'), dash('ອີງຕາມ ຂ')]);
  });

  it('keeps a dash inside the text — a document code like PM-QA-01:00', () => {
    expect(referenceLines('- ເລກລະຫັດ PM-QA-01:00')).toEqual([dash('ເລກລະຫັດ PM-QA-01:00')]);
  });

  it('is empty for no value', () => {
    expect(referenceLines('')).toEqual([]);
    expect(referenceLines(null)).toEqual([]);
  });
});
