import { describe, expect, it } from 'vitest';
import { findSubjectField, type NamedField } from './form-field-names';

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
