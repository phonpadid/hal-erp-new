import { flushPromises } from '@vue/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import ReviewApprovalDialog from './ReviewApprovalDialog.vue';
import { documentsApi } from '../../api/documents';

/**
 * Finance approves from the inbox modal, and what they check there is where the money is booked —
 * the GL account each line posts to. The detail page carried it; the modal did not, so approving
 * meant opening the document in another tab. The modal reads the same rule as the detail page's GL
 * column: the display `glAccount`, else the stamped account's code.
 */
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const PERMS = ['DOC_VIEW'];

async function openDialog(lines: unknown[]) {
  vi.spyOn(documentsApi, 'detail').mockResolvedValue({
    document: { id: 'doc-1', docNo: 'REC-HAL-2026-0029', status: 'IN_APPROVAL', totalAmount: '123000.00', currency: { code: 'LAK' } },
    fieldValues: [], lines, budgetMovements: [], attachments: [], refDocument: null, hasPayment: false,
  } as never);
  vi.spyOn(documentsApi, 'canAct').mockResolvedValue({ canAct: false } as never);

  const w = await mountView(ReviewApprovalDialog, {
    permissions: PERMS,
    props: { docId: 'doc-1', docNo: 'REC-HAL-2026-0029', visible: false },
    initialState: { auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
  });
  await w.setProps({ visible: true });
  await flushPromises();
  await flushPromises();
  wrapper = w;
  return w;
}

const gl = () => document.body.querySelector('[data-testid="document-gl-lines"]');

describe('the approve modal names the GL account each line is booked to', () => {
  it('shows the code, the account name and the line it belongs to', async () => {
    await openDialog([
      {
        lineNo: 1, description: '12345678', qty: '1', unitPrice: '123000', lineAmount: '123000.00',
        glAccount: '612.06', account: { id: 'a-1', code: '612.06', name: 'Rent' },
        item: { name: 'HAL Express rent' },
      },
    ]);
    const text = gl()?.textContent ?? '';
    expect(text).toContain('612.06');
    expect(text).toContain('Rent');
    expect(text).toContain('HAL Express rent');
    expect(text).toContain('123,000');
  });

  it('falls back to the stamped account when the line kept no display code', async () => {
    await openDialog([
      { lineNo: 1, description: 'Paper', qty: '1', unitPrice: '100', lineAmount: '100', glAccount: '', account: { id: 'a-2', code: '530.01' } },
    ]);
    expect(gl()?.textContent).toContain('530.01');
  });

  it('is absent when no line is booked to an account', async () => {
    await openDialog([{ lineNo: 1, description: 'Paper', qty: '1', unitPrice: '100', lineAmount: '100' }]);
    expect(gl()).toBeNull();
  });
});
