import { flushPromises, mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';

// The panel talks to the profile API directly — mock it.
vi.mock('../api/profile', () => ({
  signatureApi: { get: vi.fn() },
  uploadSignature: vi.fn(),
  removeSignatureBackground: vi.fn(),
  SIGNATURE_ACCEPT: ['image/png', 'image/jpeg'],
  SIGNATURE_MAX_KB: 1024,
}));
import { removeSignatureBackground, signatureApi, uploadSignature } from '../api/profile';
import SignaturePanel from './SignaturePanel.vue';
import { useAuthStore } from '../stores/auth';

const getMock = signatureApi.get as unknown as ReturnType<typeof vi.fn>;
const uploadMock = uploadSignature as unknown as ReturnType<typeof vi.fn>;
const removeBgMock = removeSignatureBackground as unknown as ReturnType<typeof vi.fn>;

// Stub the Dialog (renders its slot inline when visible) and the canvas-based cropper
// (jsdom has no canvas) so we can drive the crop-confirm emit deterministically.
const stubs = {
  Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' },
  ImageCropper: { name: 'ImageCropper', props: ['file'], emits: ['cropped', 'cancel'], template: '<div data-testid="cropper-stub" />' },
};
// The panel reports `hasSignature` to the auth store, so the gates elsewhere clear on upload.
const global = { plugins: [i18n, PrimeVue, createTestingPinia({ stubActions: false })], stubs };

async function mountLoaded(signature: { id: string; mimeType: string | null; uploadedAt: string | null; url: string } | null) {
  getMock.mockResolvedValue({ hasSignature: !!signature, signature });
  const w = mount(SignaturePanel, { global });
  await flushPromises();
  return w;
}

/** Simulate choosing a file in the hidden input. */
async function chooseFile(w: ReturnType<typeof mount>, file: File) {
  const input = w.find('[data-testid="signature-file-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

/** Emit a cropped PNG blob from the stubbed cropper, as if the user confirmed the crop. */
async function confirmCrop(w: ReturnType<typeof mount>) {
  await w.findComponent({ name: 'ImageCropper' }).vm.$emit('cropped', new Blob(['x'], { type: 'image/png' }));
  await flushPromises();
}

describe('SignaturePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (i18n.global.locale as unknown as { value: string }).value = 'en';
    // Default: background removal succeeds, returning a transparent PNG.
    removeBgMock.mockResolvedValue(new Blob(['nobg'], { type: 'image/png' }));
  });

  it('tells the session whether a signature is on file, and flips it the moment an upload lands', async () => {
    const w = await mountLoaded(null);
    // With none on file the panel says what it is for — the reason a person was sent here.
    expect(w.find('[data-testid="signature-required-for"]').exists()).toBe(true);
    expect(useAuthStore().hasSignature).toBe(false);

    uploadMock.mockResolvedValue({ hasSignature: true, signature: { id: 's1', mimeType: 'image/png', uploadedAt: null, url: 'blob:new' } });
    await chooseFile(w, new File(['x'], 'sig.png', { type: 'image/png' }));
    await confirmCrop(w);

    // Submit / Approve elsewhere read this; they must open without a reload.
    expect(useAuthStore().hasSignature).toBe(true);
    expect(w.find('[data-testid="signature-required-for"]').exists()).toBe(false);
  });

  it('opens the 1:1 cropper for a valid image and uploads only after confirming the crop', async () => {
    const w = await mountLoaded(null);
    expect(w.text()).toContain('No signature on file');
    uploadMock.mockResolvedValue({ hasSignature: true, signature: { id: 's1', mimeType: 'image/png', uploadedAt: null, url: 'blob:new' } });

    await chooseFile(w, new File(['x'], 'sig.png', { type: 'image/png' }));
    // Cropper shown; nothing uploaded yet.
    expect(w.find('[data-testid="cropper-stub"]').exists()).toBe(true);
    expect(uploadMock).not.toHaveBeenCalled();

    await confirmCrop(w);
    // Background is removed first, then the transparent PNG is uploaded and shown.
    expect(removeBgMock).toHaveBeenCalledOnce();
    expect(uploadMock).toHaveBeenCalledOnce();
    expect((uploadMock.mock.calls[0][0] as File).type).toBe('image/png');
    const img = w.find('[data-testid="signature-image"] img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('blob:new');
  });

  it('falls back to the cropped image when background removal fails', async () => {
    const w = await mountLoaded(null);
    removeBgMock.mockRejectedValue(new Error('remove.bg down'));
    uploadMock.mockResolvedValue({ hasSignature: true, signature: { id: 's1', mimeType: 'image/png', uploadedAt: null, url: 'blob:new' } });

    await chooseFile(w, new File(['x'], 'sig.png', { type: 'image/png' }));
    await confirmCrop(w);

    // Removal was attempted, and the signature was still uploaded (best-effort).
    expect(removeBgMock).toHaveBeenCalledOnce();
    expect(uploadMock).toHaveBeenCalledOnce();
    expect(w.find('[data-testid="signature-image"] img').attributes('src')).toBe('blob:new');
  });

  it('rejects a non-image file before opening the cropper', async () => {
    const w = await mountLoaded(null);
    await chooseFile(w, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));

    expect(w.find('[data-testid="cropper-stub"]').exists()).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('PNG or JPEG');
  });

  it('rejects an oversized image before opening the cropper', async () => {
    const w = await mountLoaded(null);
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await chooseFile(w, big);

    expect(w.find('[data-testid="cropper-stub"]').exists()).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('1 MB');
  });

  it('replaces an existing signature via the cropper and updates the displayed image', async () => {
    const w = await mountLoaded({ id: 's0', mimeType: 'image/png', uploadedAt: null, url: 'blob:old' });
    expect(w.find('[data-testid="signature-image"] img').attributes('src')).toBe('blob:old');
    uploadMock.mockResolvedValue({ hasSignature: true, signature: { id: 's1', mimeType: 'image/png', uploadedAt: null, url: 'blob:new' } });

    await chooseFile(w, new File(['x'], 'sig.png', { type: 'image/png' }));
    await confirmCrop(w);

    expect(w.find('[data-testid="signature-image"] img').attributes('src')).toBe('blob:new');
  });
});
