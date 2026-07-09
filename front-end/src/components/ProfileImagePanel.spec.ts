import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n';
import ProfileImagePanel from './ProfileImagePanel.vue';

const stubs = {
  Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' },
  ImageCropper: { name: 'ImageCropper', props: ['file'], emits: ['cropped', 'cancel'], template: '<div data-testid="cropper-stub" />' },
};
const global = { plugins: [i18n, PrimeVue], stubs };

function mountPanel(props: Record<string, unknown>) {
  return mount(ProfileImagePanel, { props: props as never, global });
}

async function chooseFile(w: ReturnType<typeof mount>, file: File) {
  const input = w.find('[data-testid="profile-image-input"]');
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

async function confirmCrop(w: ReturnType<typeof mount>) {
  await w.findComponent({ name: 'ImageCropper' }).vm.$emit('cropped', new Blob(['x'], { type: 'image/png' }));
  await flushPromises();
}

describe('ProfileImagePanel', () => {
  beforeEach(() => (i18n.global.locale as unknown as { value: string }).value = 'en');

  it('crops to 1:1 then uploads (no background removal) and shows the new image', async () => {
    const upload = vi.fn().mockResolvedValue('blob:new');
    const w = mountPanel({ url: null, upload });

    await chooseFile(w, new File(['x'], 'pic.png', { type: 'image/png' }));
    expect(w.find('[data-testid="cropper-stub"]').exists()).toBe(true);
    expect(upload).not.toHaveBeenCalled();

    await confirmCrop(w);
    expect(upload).toHaveBeenCalledOnce();
    expect((upload.mock.calls[0][0] as File).type).toBe('image/png');
    expect(w.find('[data-testid="profile-image"] img').attributes('src')).toBe('blob:new');
    expect(w.emitted('uploaded')?.[0]).toEqual(['blob:new']);
  });

  it('rejects a non-image before opening the cropper', async () => {
    const upload = vi.fn();
    const w = mountPanel({ url: null, upload });
    await chooseFile(w, new File(['x'], 'doc.pdf', { type: 'application/pdf' }));

    expect(w.find('[data-testid="cropper-stub"]').exists()).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(w.text()).toContain('PNG, JPEG or WebP');
  });

  it('hides the upload control when canEdit is false', async () => {
    const w = mountPanel({ url: 'blob:existing', upload: vi.fn(), canEdit: false });
    expect(w.find('[data-testid="profile-image-upload-btn"]').exists()).toBe(false);
    // The image itself still renders.
    expect(w.find('[data-testid="profile-image"] img').attributes('src')).toBe('blob:existing');
  });
});
