<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Image from 'primevue/image';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth';
import ImageCropper from './ImageCropper.vue';
import {
  SIGNATURE_ACCEPT,
  SIGNATURE_MAX_KB,
  removeSignatureBackground,
  signatureApi,
  uploadSignature,
  type OwnSignature,
} from '../api/profile';

const { t } = useI18n();
const auth = useAuthStore();

const loading = ref(true);
const busy = ref(false);
const current = ref<OwnSignature['signature']>(null);
const validationError = ref('');
const serverError = ref(false);
const success = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
// The picked file waits in the 1:1 crop dialog until the user confirms the crop.
const cropFile = ref<File | null>(null);
const cropOpen = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await signatureApi.get();
    current.value = res.hasSignature ? res.signature : null;
    auth.setHasSignature(res.hasSignature); // the panel is the freshest reading the session has
  } catch {
    current.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function pickFile() {
  validationError.value = '';
  serverError.value = false;
  success.value = false;
  fileInput.value?.click();
}

/** Client-side guard mirroring the server DTO (png/jpeg, <= 1 MB) — UX only; server re-checks. */
function validate(file: File): string {
  if (!(SIGNATURE_ACCEPT as readonly string[]).includes(file.type)) return t('profile.signature.invalidType');
  if (file.size > SIGNATURE_MAX_KB * 1024) return t('profile.signature.tooLarge');
  return '';
}

function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // allow re-choosing the same file
  if (!file) return;

  const err = validate(file);
  if (err) {
    validationError.value = err;
    return;
  }
  // Open the 1:1 cropper; upload only happens once the user confirms the crop.
  cropFile.value = file;
  cropOpen.value = true;
}

/**
 * After cropping 1:1, strip the background via the server (remove.bg) and upload the result.
 * Background removal is best-effort: if it fails, the cropped image is uploaded as-is so the
 * user is never blocked from saving a signature.
 */
async function onCropped(blob: Blob) {
  cropOpen.value = false;
  cropFile.value = null;
  busy.value = true;
  try {
    let toUpload = blob;
    try {
      toUpload = await removeSignatureBackground(blob);
    } catch {
      toUpload = blob; // remove.bg unavailable → fall back to the plain cropped image
    }
    const file = new File([toUpload], 'signature.png', { type: 'image/png' });
    const res = await uploadSignature(file);
    current.value = res.signature; // reflect the new signature without a page reload
    // Submit / Approve elsewhere were disabled for want of this; let them open now, not on the
    // next /auth/me.
    auth.setHasSignature(res.hasSignature);
    success.value = true;
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
  <div class="card">
    <h2 class="flex items-center gap-2 text-lg font-semibold text-color mt-0 mb-2">
      <i class="pi pi-pencil text-primary" />{{ t('profile.signature.heading') }}
    </h2>
    <p class="text-muted-color text-sm mt-0 mb-4">{{ t('profile.signature.description') }}</p>
    <!-- Why someone was sent here: submitting and approving are closed until a signature exists. -->
    <Message v-if="!loading && !current" severity="info" size="small" class="mb-4" data-testid="signature-required-for">
      {{ t('profile.signature.requiredFor') }}
    </Message>

    <div v-if="loading" class="flex justify-center py-6">
      <ProgressSpinner style="width: 2rem; height: 2rem" strokeWidth="4" />
    </div>

    <div v-else class="flex flex-col items-center gap-4">
      <!-- 1:1 preview on a white surface (a transparent signature reads like ink on paper). -->
      <div
        class="flex items-center justify-center border border-surface-200 dark:border-surface-700 rounded-lg bg-white w-full max-w-55 aspect-square"
      >
        <Image
          v-if="current"
          :src="current.url"
          :alt="t('profile.signature.current')"
          width="full"
          preview
          data-testid="signature-image"
          imageClass="max-w-full max-h-full object-contain"
        />
        <span v-else class="text-muted-color text-sm px-3 text-center">{{ t('profile.signature.none') }}</span>
      </div>

      <!-- Upload/replace action sits below the preview. -->
      <div class="flex flex-col gap-2 w-full max-w-55">
        <input
          ref="fileInput"
          type="file"
          :accept="SIGNATURE_ACCEPT.join(',')"
          class="hidden"
          data-testid="signature-file-input"
          @change="onFileChosen"
        />
        <Button
          :label="current ? t('profile.signature.replace') : t('profile.signature.upload')"
          icon="pi pi-upload"
          :loading="busy"
          data-testid="signature-upload-btn"
          @click="pickFile"
        />
        <span class="text-muted-color text-xs">{{ t('profile.signature.hint') }}</span>

        <Message v-if="validationError" severity="error" size="small" variant="simple">{{ validationError }}</Message>
        <Message v-if="serverError" severity="error" size="small" variant="simple">{{ t('profile.signature.error') }}</Message>
        <Message v-if="success" severity="success" size="small" variant="simple">{{ t('profile.signature.success') }}</Message>
      </div>
    </div>

    <Dialog
      v-model:visible="cropOpen"
      modal
      :header="t('profile.signature.cropTitle')"
      :dismissableMask="true"
      :style="{ width: 'auto' }"
    >
      <p class="text-muted-color text-sm mt-0 mb-4">{{ t('profile.signature.cropHint') }}</p>
      <ImageCropper v-if="cropFile" :file="cropFile" @cropped="onCropped" @cancel="onCropCancel" />
    </Dialog>
  </div>
</template>
