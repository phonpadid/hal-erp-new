import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('DocumentDetailView — Export PDF', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downloads the PDF when the export action is triggered', async () => {
    exportMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const w = await mountDetail();
    await flushPromises();

    const btn = w.find('[data-testid="export-pdf-btn"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();

    expect(exportMock).toHaveBeenCalledWith('d1');
    expect(downloadMock).toHaveBeenCalledOnce();
    expect(downloadMock.mock.calls[0][1]).toBe('PR-A-2026-0001.pdf');
  });

  it('does not download when the export fails', async () => {
    exportMock.mockRejectedValue(new Error('boom'));
    const w = await mountDetail();
    await flushPromises();

    await w.find('[data-testid="export-pdf-btn"]').trigger('click');
    await flushPromises();

    expect(exportMock).toHaveBeenCalledWith('d1');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('hides the export action without DOC_VIEW permission', async () => {
    const w = await mountDetail([]); // no permissions granted
    await flushPromises();
    expect(w.find('[data-testid="export-pdf-btn"]').exists()).toBe(false);
  });
});
