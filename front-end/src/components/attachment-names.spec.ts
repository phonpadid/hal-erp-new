import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import type { AttachmentRow } from '../api/documents';

vi.mock('../api/documents', () => ({
  documentsApi: { downloadUrl: vi.fn(), listAttachments: vi.fn().mockResolvedValue([]) },
  uploadAttachment: vi.fn(),
}));
vi.mock('../composables/useFeedback', () => ({ useFeedback: () => ({ error: vi.fn(), success: vi.fn() }) }));
import AttachmentUploader from './AttachmentUploader.vue';

/**
 * The server names an attachment after its document — `RECBL-HAL-2026-0029-01.pdf` — and keeps
 * what the uploader called it. The list shows the system's name first, because that is how the
 * printed set is cross-referenced, and the uploader's name under it, because that is how they
 * recognise the file. A row filed before names were generated has only the one name and must not
 * grow an empty second line.
 */
async function mountList(attachments: AttachmentRow[]) {
  const w = mount(AttachmentUploader, {
    props: { documentId: 'doc-1', attachments, readonly: true },
    global: { plugins: [i18n, PrimeVue, ToastService] },
  });
  await flushPromises();
  return w;
}

describe('attachment list — generated name over the original', () => {
  it('shows the generated name with the Lao original beneath it', async () => {
    const w = await mountList([
      { id: 'a1', fileName: 'RECBL-HAL-2026-0029-01.pdf', originalFileName: 'ໃບສະເໜີ ລົດຮ່ວມ (ສັນຍາ).pdf', mimeType: 'application/pdf', fileSizeKb: 120 },
    ]);
    expect(w.find('[data-testid="attachment-name"]').text()).toBe('RECBL-HAL-2026-0029-01.pdf');
    expect(w.find('[data-testid="attachment-original-name"]').text()).toBe('ໃບສະເໜີ ລົດຮ່ວມ (ສັນຍາ).pdf');
  });

  it('shows one line for an older attachment that has no original name', async () => {
    const w = await mountList([{ id: 'a2', fileName: 'ໃບເບີກຈ່າຍ.pdf', originalFileName: null, mimeType: 'application/pdf' }]);
    expect(w.find('[data-testid="attachment-name"]').text()).toBe('ໃບເບີກຈ່າຍ.pdf');
    expect(w.find('[data-testid="attachment-original-name"]').exists()).toBe(false);
  });

  it('does not repeat a name that is already the same', async () => {
    const w = await mountList([{ id: 'a3', fileName: 'r.pdf', originalFileName: 'r.pdf', mimeType: 'application/pdf' }]);
    expect(w.find('[data-testid="attachment-original-name"]').exists()).toBe(false);
  });
});
