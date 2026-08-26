import { createTestingPinia } from '@pinia/testing';
import { describe, expect, it } from 'vitest';
import { hasFieldValue, missingRequiredFields } from '@erp/shared';

/**
 * The draft-completeness prompt on the document detail asks the SHARED presence rule, which reads
 * each field where its type stores its value.
 *
 * It used to build its value map from `docs.fieldValues` alone. A `file` field never has a
 * `doc_field_value` row — its value is a `document_attachment` — so a required file field was
 * named as missing on every editable draft, attachment or not.
 *
 * That was not merely a stray warning. When a submit is refused for a real reason the reason is a
 * toast that expires; this banner does not. A requester who looked away was left with one
 * instruction on screen — attach the file you already attached — while the actual refusal
 * ("2,000,000 requested, 1,000,000 available") had gone.
 *
 * The prompt's own computation is exercised here through the rule it now delegates to, with the
 * exact inputs the view passes: `fieldValues` by name, `attachments.length`, `lines.length`.
 */
createTestingPinia();

/** What `DocumentDetailView.missingRequiredLabels` feeds the shared rule. */
const promptInput = (docs: {
  fieldValues: Array<{ fieldName: string; value?: string }>;
  attachments: unknown[];
  lines: unknown[];
}) => {
  const values: Record<string, string | undefined> = {};
  for (const fv of docs.fieldValues) values[fv.fieldName] = fv.value || undefined;
  return { values, attachmentCount: docs.attachments.length, lineCount: docs.lines.length };
};

const TEMPLATE = [
  { fieldName: 'file', fieldType: 'file', isRequired: true, fieldLabel: 'ເອກະສານຕິດຂັດ' },
  { fieldName: 'Reson', fieldType: 'text', isRequired: true, fieldLabel: 'ເຫດຜົນ' },
  { fieldName: 'date', fieldType: 'date', isRequired: true, fieldLabel: 'ວັນທີສະເໜີ' },
];

const labels = (input: ReturnType<typeof promptInput>) =>
  missingRequiredFields(TEMPLATE, input).map((f) => f.fieldLabel);

describe('the draft completeness prompt', () => {
  it('says nothing about an attached file', () => {
    // The exact shape of every REC draft raised in the UI run: three required fields, all filled,
    // the file present as an attachment rather than as a field value.
    const input = promptInput({
      fieldValues: [{ fieldName: 'Reson', value: 'UI test' }, { fieldName: 'date', value: '2026-08-26' }],
      attachments: [{ id: 'a1' }],
      lines: [{ id: 'l1' }],
    });
    expect(labels(input)).toEqual([]);
  });

  it('still names a file that is genuinely missing', () => {
    const input = promptInput({
      fieldValues: [{ fieldName: 'Reson', value: 'UI test' }, { fieldName: 'date', value: '2026-08-26' }],
      attachments: [],
      lines: [{ id: 'l1' }],
    });
    expect(labels(input)).toEqual(['ເອກະສານຕິດຂັດ']);
  });

  it('names an empty text field, and does not confuse it with the attachment', () => {
    const input = promptInput({
      fieldValues: [{ fieldName: 'Reson', value: '' }, { fieldName: 'date', value: '2026-08-26' }],
      attachments: [{ id: 'a1' }],
      lines: [],
    });
    expect(labels(input)).toEqual(['ເຫດຜົນ']);
  });

  it('says nothing about entered lines on a line_items template', () => {
    const withLines = [{ fieldName: 'items', fieldType: 'line_items', isRequired: true, fieldLabel: 'Items' }];
    const filled = promptInput({ fieldValues: [], attachments: [], lines: [{ id: 'l1' }] });
    const empty = promptInput({ fieldValues: [], attachments: [], lines: [] });
    expect(missingRequiredFields(withLines, filled)).toHaveLength(0);
    expect(missingRequiredFields(withLines, empty).map((f) => f.fieldLabel)).toEqual(['Items']);
  });

  it('agrees with the rule the server gate uses', () => {
    // Same function, same inputs — the point of sharing it. A field type added later cannot be
    // handled in one and forgotten in the other.
    const input = promptInput({ fieldValues: [], attachments: [{ id: 'a1' }], lines: [] });
    for (const f of TEMPLATE) {
      const promptSaysMissing = missingRequiredFields([f], input).length > 0;
      const gateSaysMissing = !hasFieldValue(f, input);
      expect(promptSaysMissing).toBe(gateSaysMissing);
    }
  });
});
