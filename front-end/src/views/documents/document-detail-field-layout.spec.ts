import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW'];

const REASON =
  'ຂໍເບີກຈ່າຍຄ່າບໍລິການອິນເຕີເນັດປະຈຳເດືອນກັນຍາ 2026 ສຳລັບຫ້ອງການໃຫຍ່ ແລະ ສາຂາທັງໝົດ ' +
  'ພ້ອມທັງຄ່າບຳລຸງຮັກສາອຸປະກອນເຄືອຂ່າຍ';

async function mount(fieldValues: Array<Record<string, unknown>>) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'COMPLETED', currency: { code: 'LAK', decimalPlaces: 0 } },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues, lines: [], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        budgetMovements: [], loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const cellFor = (w: VueWrapper, label: string) =>
  w.findAll('dl dt').find((dt) => dt.text() === label)?.element.parentElement;

/**
 * The field card was a fixed three-column grid, which gives a date the same width as a paragraph:
 * the date leaves two thirds of its cell empty while the reason beside it is broken into a narrow
 * ribbon down the page. Width follows the content now.
 */
describe('document detail: field values get the width their content needs', () => {
  it('gives a long reason the whole row', async () => {
    const w = await mount([
      { formFieldId: 'f1', fieldLabel: 'ເຫດຜົນ', fieldType: 'string', value: REASON },
      { formFieldId: 'f2', fieldLabel: 'ວັນທີສະເໜີ', fieldType: 'date', value: '2026-09-11' },
    ]);
    expect(cellFor(w, 'ເຫດຜົນ')?.className).toContain('col-span-full');
    // …and the date beside it does not take one, or every field would stack.
    expect(cellFor(w, 'ວັນທີສະເໜີ')?.className ?? '').not.toContain('col-span-full');
  });

  it('gives a multi-line field the row whatever its length', async () => {
    const w = await mount([
      { formFieldId: 'f1', fieldLabel: 'ໝາຍເຫດ', fieldType: 'string', value: 'ແຖວໜຶ່ງ\nແຖວສອງ' },
    ]);
    expect(cellFor(w, 'ໝາຍເຫດ')?.className).toContain('col-span-full');
  });

  it('gives a long-text field the row even when what was typed is short', async () => {
    const w = await mount([
      { formFieldId: 'f1', fieldLabel: 'ລາຍລະອຽດ', fieldType: 'textarea', value: 'ສັ້ນ' },
    ]);
    expect(cellFor(w, 'ລາຍລະອຽດ')?.className).toContain('col-span-full');
  });

  it('keeps short values in a single column', async () => {
    const w = await mount([
      { formFieldId: 'f1', fieldLabel: 'ເລກທີສັນຍາ', fieldType: 'string', value: 'CT-2026-0091' },
      { formFieldId: 'f2', fieldLabel: 'ວັນທີສະເໜີ', fieldType: 'date', value: '2026-09-11' },
    ]);
    expect(cellFor(w, 'ເລກທີສັນຍາ')?.className ?? '').not.toContain('col-span-full');
    expect(cellFor(w, 'ວັນທີສະເໜີ')?.className ?? '').not.toContain('col-span-full');
  });

  it("keeps the author's line breaks, instead of running the paragraphs together", async () => {
    const w = await mount([
      { formFieldId: 'f1', fieldLabel: 'ໝາຍເຫດ', fieldType: 'string', value: 'ແຖວໜຶ່ງ\nແຖວສອງ' },
    ]);
    const dd = w.findAll('dl dd').at(0);
    expect(dd?.classes()).toContain('whitespace-pre-line');
  });
});
