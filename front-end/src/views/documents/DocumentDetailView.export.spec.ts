import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';

// Keep the real module but stub the network call + the DOM download side-effect.
vi.mock('../../api/documents', async (orig) => {
  const actual = (await orig()) as typeof import('../../api/documents');
  return {
    ...actual,
    documentsApi: {
      ...actual.documentsApi,
      exportPdf: vi.fn(),
      creatableTypes: vi.fn().mockResolvedValue([]),
      formForType: vi.fn().mockResolvedValue(null),
    },
    downloadBlob: vi.fn(),
  };
});
import { documentsApi, downloadBlob } from '../../api/documents';
import DocumentDetailView from './DocumentDetailView.vue';

const exportMock = documentsApi.exportPdf as unknown as ReturnType<typeof vi.fn>;
const downloadMock = downloadBlob as unknown as ReturnType<typeof vi.fn>;

const DOC = { id: 'd1', docNo: 'PR-A-2026-0001', status: 'COMPLETED', companyId: 'c1' };

function mountDetail(permissions?: string[]) {
  return mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'd1' },
    permissions,
    initialState: { documents: { current: DOC, lines: [], attachments: [] } },
  });
}

// PrimeVue's Dialog teleports to <body>, so its contents are queried there rather than through
// the mounted wrapper.
function inDialog(testId: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`no [data-testid="${testId}"] in the dialog`);
  return el;
}

async function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
}

/** Open the print dialog and confirm, optionally choosing the whole-set option first. */
async function print(w: Awaited<ReturnType<typeof mountDetail>>, choice?: 'CHAIN') {
  await w.find('[data-testid="export-pdf-btn"]').trigger('click');
  await flushPromises();
  if (choice === 'CHAIN') {
    // PrimeVue's RadioButton puts the real control inside the component root the testid is on.
    const radio = inDialog('print-chain').querySelector('input') as HTMLInputElement;
    radio.click();
    await flushPromises();
  }
  await click(inDialog('print-confirm'));
}

describe('DocumentDetailView — print', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prints this document alone by default', async () => {
    exportMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const w = await mountDetail();
    await flushPromises();

    const btn = w.find('[data-testid="export-pdf-btn"]');
    expect(btn.exists()).toBe(true);
    await print(w);

    expect(exportMock).toHaveBeenCalledWith('d1', 'SELF');
    expect(downloadMock).toHaveBeenCalledOnce();
    expect(downloadMock.mock.calls[0][1]).toBe('PR-A-2026-0001.pdf');
  });

  it('prints the whole set when that is chosen', async () => {
    exportMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const w = await mountDetail();
    await flushPromises();
    await print(w, 'CHAIN');

    expect(exportMock).toHaveBeenCalledWith('d1', 'CHAIN');
    // Named apart from the single-document export, so both can sit in one downloads folder.
    expect(downloadMock.mock.calls[0][1]).toBe('PR-A-2026-0001-set.pdf');
  });

  it('asks for nothing when the dialog is cancelled', async () => {
    const w = await mountDetail();
    await flushPromises();
    await w.find('[data-testid="export-pdf-btn"]').trigger('click');
    await flushPromises();
    await click(inDialog('print-cancel'));

    expect(exportMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('does not download when the export fails', async () => {
    exportMock.mockRejectedValue(new Error('boom'));
    const w = await mountDetail();
    await flushPromises();
    await print(w);

    expect(exportMock).toHaveBeenCalledWith('d1', 'SELF');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('hides the print action without DOC_VIEW permission', async () => {
    const w = await mountDetail([]); // no permissions granted
    await flushPromises();
    expect(w.find('[data-testid="export-pdf-btn"]').exists()).toBe(false);
  });
});
