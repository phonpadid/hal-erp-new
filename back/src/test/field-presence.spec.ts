import { describe, expect, it } from 'vitest';
import { FIELD_TYPES, hasFieldValue, missingRequiredFields } from '@erp/shared';

/**
 * Presence is asked where each field's TYPE stores its value.
 *
 * This rule had two hand-kept copies — the server's submit gate and the client's completeness
 * prompt — and they drifted. The client consulted `doc_field_value` alone, where a `file` field's
 * value never lives, so a required file was reported missing on every draft whether or not it was
 * attached. These tests are the reason there is now one rule.
 */

const ctx = (over: Partial<Parameters<typeof hasFieldValue>[1]> = {}) => ({
  values: {},
  attachmentCount: 0,
  lineCount: 0,
  ...over,
});

describe('hasFieldValue', () => {
  it('reads a file field from the attachments, not from the field values', () => {
    const file = { fieldName: 'evidence', fieldType: 'file' };
    expect(hasFieldValue(file, ctx({ attachmentCount: 1 }))).toBe(true);
    expect(hasFieldValue(file, ctx({ attachmentCount: 0 }))).toBe(false);
    // A file never produces a doc_field_value row, so a value there must not fake presence…
    expect(hasFieldValue(file, ctx({ values: { evidence: 'anything' } }))).toBe(
      false,
    );
  });

  it('reads a line_items field from the lines', () => {
    const lines = { fieldName: 'items', fieldType: 'line_items' };
    expect(hasFieldValue(lines, ctx({ lineCount: 2 }))).toBe(true);
    expect(hasFieldValue(lines, ctx({ lineCount: 0 }))).toBe(false);
  });

  it('reads every other type from its stored value, treating empty as absent', () => {
    const text = { fieldName: 'reason', fieldType: 'text' };
    expect(hasFieldValue(text, ctx({ values: { reason: 'because' } }))).toBe(
      true,
    );
    expect(hasFieldValue(text, ctx({ values: { reason: '' } }))).toBe(false);
    expect(hasFieldValue(text, ctx())).toBe(false);
    // An attachment on the document says nothing about a text field.
    expect(hasFieldValue(text, ctx({ attachmentCount: 3 }))).toBe(false);
  });

  it('handles every declared field type without falling through to a wrong answer', () => {
    for (const fieldType of FIELD_TYPES) {
      const f = { fieldName: 'f', fieldType };
      const filled =
        fieldType === 'file'
          ? ctx({ attachmentCount: 1 })
          : fieldType === 'line_items'
            ? ctx({ lineCount: 1 })
            : ctx({ values: { f: 'v' } });
      expect(
        hasFieldValue(f, filled),
        `${fieldType} should read as present`,
      ).toBe(true);
      expect(
        hasFieldValue(f, ctx()),
        `${fieldType} should read as absent`,
      ).toBe(false);
    }
  });
});

describe('missingRequiredFields', () => {
  const FIELDS = [
    {
      fieldName: 'evidence',
      fieldType: 'file',
      isRequired: true,
      fieldLabel: 'Evidence',
    },
    {
      fieldName: 'reason',
      fieldType: 'text',
      isRequired: true,
      fieldLabel: 'Reason',
    },
    {
      fieldName: 'note',
      fieldType: 'text',
      isRequired: false,
      fieldLabel: 'Note',
    },
  ];

  it('does not name a required file that is attached', () => {
    const missing = missingRequiredFields(
      FIELDS,
      ctx({ attachmentCount: 1, values: { reason: 'x' } }),
    );
    expect(missing).toHaveLength(0);
  });

  it('names a required file that is not attached', () => {
    const missing = missingRequiredFields(
      FIELDS,
      ctx({ values: { reason: 'x' } }),
    );
    expect(missing.map((f) => f.fieldName)).toEqual(['evidence']);
  });

  it('ignores optional fields', () => {
    const missing = missingRequiredFields(
      FIELDS,
      ctx({ attachmentCount: 1, values: { reason: 'x' } }),
    );
    expect(missing.map((f) => f.fieldName)).not.toContain('note');
  });

  it('never names a field its condition hides', () => {
    // A hidden field is neither required nor persisted; reporting it would ask the user to fill
    // in something the form does not show them.
    const conditional = [
      {
        fieldName: 'why',
        fieldType: 'text',
        isRequired: true,
        conditionJson: '{"field":"kind","op":"eq","value":"other"}',
      },
    ];
    expect(
      missingRequiredFields(conditional, ctx({ values: { kind: 'standard' } })),
    ).toHaveLength(0);
    expect(
      missingRequiredFields(
        conditional,
        ctx({ values: { kind: 'other' } }),
      ).map((f) => f.fieldName),
    ).toEqual(['why']);
  });
});
