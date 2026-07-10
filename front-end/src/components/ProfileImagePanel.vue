<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Image from 'primevue/image';
import Message from 'primevue/message';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ImageCropper from './ImageCropper.vue';

const props = withDefaults(
  defineProps<{
    /** Current image URL (or null). */
    url: string | null;
    /** Uploads the cropped file and resolves to the new image URL. */
    upload: (file: File) => Promise<string>;
    /** UX-only gate — hides the upload button when false. Server still enforces. */
    canEdit?: boolean;
    /** Round the preview (avatars) instead of a rounded square (logos). */
    circle?: boolean;
    /** Preview edge in px. */
    size?: number;
  }>(),
  { canEdit: true, circle: false, size: 220 },
);
const emit = defineEmits<{ uploaded: [url: string] }>();

const { t } = useI18n();

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_KB = 5 * 1024;

const busy = ref(false);
const current = ref<string | null>(props.url);
const validationError = ref('');
const serverError = ref(false);
const success = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const cropFile = ref<File | null>(null);
const cropOpen = ref(false);

function pickFile() {
  validationError.value = '';
  serverError.value = false;
  success.value = false;
  fileInput.value?.click();
}

function validate(file: File): string {
  if (!ACCEPT.includes(file.type)) return t('common.imageUpload.invalidType');
  if (file.size > MAX_KB * 1024) return t('common.imageUpload.tooLarge');
  return '';
}

function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const err = validate(file);
  if (err) {
    validationError.value = err;
    return;
  }
  cropFile.value = file;
  cropOpen.value = true;
}

/** Upload the cropped 1:1 image (no background removal) and reflect it immediately. */
async function onCropped(blob: Blob) {
  cropOpen.value = false;
  cropFile.value = null;
  busy.value = true;
  try {
    const file = new File([blob], 'image.png', { type: 'image/png' });
    const newUrl = await props.upload(file);
    current.value = newUrl;
    success.value = true;
    emit('uploaded', newUrl);
  } catch {
    serverError.value = true;
  } finally {
    busy.value = false;
  }
}

function onCropCancel() {
  cropOpen.value = false;
  cropFile.value = null;
}
</script>

<template>
  <div class="flex flex-col items-center gap-3">
    <!-- 1:1 preview -->
    <div
      class="flex items-center justify-center border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 overflow-hidden aspect-square"
      :class="circle ? 'rounded-full' : 'rounded-lg'"
      :style="{ width: size + 'px', maxWidth: '100%' }"
    >
      <Image
        v-if="current"
        :src="current"
        alt=""
        width="full"
        preview
        data-testid="profile-image"
        imageClass="w-full h-full object-cover"
      />
      <span v-else class="text-muted-color text-sm px-3 text-center">{{ t('common.imageUpload.none') }}</span>
    </div>

    <div v-if="canEdit" class="flex flex-col items-center gap-2" :style="{ width: size + 'px', maxWidth: '100%' }">
      <input
        ref="fileInput"
        type="file"
        :accept="ACCEPT.join(',')"
        class="hidden"
        data-testid="profile-image-input"
        @change="onFileChosen"
      />
      <Button
        :label="current ? t('common.imageUpload.replace') : t('common.imageUpload.upload')"
        icon="pi pi-upload"
        :loading="busy"
        size="small"
        data-testid="profile-image-upload-btn"
        @click="pickFile"
      />
      <span class="text-muted-color text-xs text-center">{{ t('common.imageUpload.hint') }}</span>
      <Message v-if="validationError" severity="error" size="small" variant="simple">{{ validationError }}</Message>
      <Message v-if="serverError" severity="error" size="small" variant="simple">{{ t('common.imageUpload.error') }}</Message>
      <Message v-if="success" severity="success" size="small" variant="simple">{{ t('common.imageUpload.success') }}</Message>
    </div>

    <Dialog v-model:visible="cropOpen" modal :header="t('common.imageUpload.cropTitle')" :dismissableMask="true" :style="{ width: 'auto' }">
      <p class="text-muted-color text-sm mt-0 mb-4">{{ t('common.imageUpload.cropHint') }}</p>
      <ImageCropper v-if="cropFile" :file="cropFile" @cropped="onCropped" @cancel="onCropCancel" />
    </Dialog>
  </div>
</template>
