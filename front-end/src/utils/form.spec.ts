import { describe, expect, it } from 'vitest';
import { lineAmount, validateRequired } from './form';
import type { FormFieldDef } from '../api/documents';

const field = (id: string, isRequired: boolean): FormFieldDef => ({
  id, fieldName: id, fieldLabel: id, fieldType: 'text', isRequired, sortOrder: 0,
});

describe('validateRequired', () => {
  it('reports required fields with no value', () => {
    const fields = [field('a', true), field('b', false), field('c', true)];
    expect(validateRequired(fields, { a: 'x' })).toEqual(['c']);
  });

  it('returns empty when all required are present', () => {
    expect(validateRequired([field('a', true)], { a: 'ok' })).toEqual([]);
  });
});

describe('lineAmount', () => {
  it('multiplies qty × unit price exactly (no float drift)', () => {
    expect(lineAmount('3', '19.99')).toBe('59.97');
    expect(lineAmount('0.1', '0.2')).toBe('0.02');
  });
});
