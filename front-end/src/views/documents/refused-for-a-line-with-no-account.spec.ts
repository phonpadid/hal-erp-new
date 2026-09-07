import { describe, expect, it } from 'vitest';
import { missingRequiredFields } from '@erp/shared';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';

/**
 * A submit refused because a line resolves no expense account.
 *
 * The refusal names the LINE and all three places an account can be set — the item, the document
 * type, the budget — rather than naming the budget alone. Which of them to fill in depends on what
 * the line is: a line with an item takes its account from the item and never reads the budget at
 * all, so a message that named only the budget sent the reader to the wrong one of three.
 */
const REFUSAL =
  'Line 1 resolves no GL account, so its spending cannot be posted to the ledger; set one on the ' +
  'item, on the document type, or on the budget it charges';

describe('a submit refused for a line that resolves no GL account', () => {
  it('keeps the reason on screen, naming the line and all three sources', async () => {
    const wrapper = await mountView(DocumentDetailView, {
      path: '/documents/:id',
      routeParams: { id: 'doc-1' },
      query: { refused: REFUSAL },
      initialState: {
        documents: {
          current: { id: 'doc-1', docNo: 'RECADMIN-HAL-2026-0001', status: 'DRAFT', documentType: { name: 'Disbursement' } },
          fieldValues: [],
          lines: [],
          attachments: [],
          approvalLog: [],
        },
      },
    });

    const banner = wrapper.find('[data-testid="submit-refusal"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Line 1');
    // All three, because which one to fill in depends on what the line is.
    expect(banner.text()).toMatch(/item/i);
    expect(banner.text()).toMatch(/document type/i);
    expect(banner.text()).toMatch(/budget/i);
    wrapper.unmount();
  });

  it('raises no missing-field prompt, because no field carries this value', () => {
    // The prompt is driven by the shared presence rule over the document's own form. A document
    // refused for an unresolvable account has every required field filled — the account is not one
    // of them — so the rule must find nothing to complain about.
    const template = [
      { fieldName: 'file', fieldType: 'file', isRequired: true, fieldLabel: 'Attachment' },
      { fieldName: 'reason', fieldType: 'text', isRequired: true, fieldLabel: 'Reason' },
    ];
    const missing = missingRequiredFields(template as never, {
      values: { reason: 'office supplies' },
      attachmentCount: 1,
      lineCount: 1,
    });
    expect(missing).toEqual([]);
  });
});
