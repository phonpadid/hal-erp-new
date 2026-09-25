import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import type { AttachmentRow } from '../api/documents';

const removeAttachment = vi.fn().mockResolvedValue(undefined);
vi.mock('../api/documents', () => ({
  documentsApi: {
    downloadUrl: vi.fn(),
    listAttachments: vi.fn().mockResolvedValue([]),
    removeAttachment: (...a: unknown[]) => removeAttachment(...a),
  },
  uploadAttachment: vi.fn(),
}));
// Accept every confirmation: the ConfirmDialog lives in the app shell, not this harness.
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: (o: { accept?: () => unknown }) => o.accept?.() }),
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
    global: { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] },
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

describe('attachment list — removing a draft attachment', () => {
  const row: AttachmentRow = { id: 'a9', fileName: 'MEMO-HAL-2026-0001-01.pdf', originalFileName: 'wrong.pdf', mimeType: 'application/pdf' };
  const mountWith = async (props: Record<string, unknown>) => {
    const w = mount(AttachmentUploader, {
      props: { documentId: 'doc-1', attachments: [row], ...props },
      global: { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] },
    });
    await flushPromises();
    return w;
  };

  it('offers no delete button unless the parent says the attachments are removable', async () => {
    const w = await mountWith({});
    expect(w.find('[data-testid="attachment-remove"]').exists()).toBe(false);
  });

  it('offers none on a read-only list even when removable', async () => {
    const w = await mountWith({ removable: true, readonly: true });
    expect(w.find('[data-testid="attachment-remove"]').exists()).toBe(false);
  });

  it('removes the file through the API once confirmed, and tells the parent to reload', async () => {
    removeAttachment.mockClear();
    const w = await mountWith({ removable: true });
    await w.find('[data-testid="attachment-remove"]').trigger('click');
    await flushPromises();
    expect(removeAttachment).toHaveBeenCalledWith('doc-1', 'a9');
    expect(w.emitted('removed')).toHaveLength(1);
  });
});
