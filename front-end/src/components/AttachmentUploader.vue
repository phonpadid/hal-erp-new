<script setup lang="ts">
import FileUpload from 'primevue/fileupload';
import type { FileUploadUploaderEvent } from 'primevue/fileupload';
import { ref } from 'vue';
import { documentsApi, uploadToPresignedUrl } from '../api/documents';
import type { AttachmentRow } from '../api/documents';
import { useFeedback } from '../composables/useFeedback';

/**
 * Document attachments: lists current files with presigned download links, and (unless
 * readonly) uploads new files straight to object storage via a presigned PUT URL — the
 * bytes never pass through the API; only metadata is registered afterwards.
 */
const props = defineProps<{ documentId: string; attachments: AttachmentRow[]; readonly?: boolean }>();
const emit = defineEmits<{ (e: 'uploaded'): void }>();
const fb = useFeedback();
const busy = ref(false);

async function onUpload(event: FileUploadUploaderEvent) {
  const files = Array.isArray(event.files) ? event.files : [event.files];
  busy.value = true;
  try {
    for (const file of files) {
      const { uploadUrl, key } = await documentsApi.presignUpload(props.documentId, {
        fileName: file.name,
        contentType: file.type,
      });
      await uploadToPresignedUrl(uploadUrl, file);
      await documentsApi.attach(props.documentId, {
        fileName: file.name,
        filePath: key,
        fileSizeKb: Math.round(file.size / 1024),
        mimeType: file.type || undefined,
      });
    }
    emit('uploaded');
  } catch (e) {
    fb.error(e);
  } finally {
    busy.value = false;
  }
}

async function download(att: AttachmentRow) {
  try {
    const { url } = await documentsApi.downloadUrl(props.documentId, att.id);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    fb.error(e);
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul v-if="attachments.length" class="flex flex-col gap-1">
      <li v-for="a in attachments" :key="a.id" class="flex items-center gap-2 text-sm">
        <i class="pi pi-paperclip text-muted-color" />
        <button type="button" class="text-primary hover:underline" @click="download(a)">{{ a.fileName }}</button>
        <span v-if="a.fileSizeKb" class="text-muted-color text-xs">{{ a.fileSizeKb }} KB</span>
      </li>
    </ul>
    <p v-else class="text-muted-color text-sm">{{ $t('documents.detail.noAttachments') }}</p>

    <FileUpload
      v-if="!readonly"
      mode="basic"
      customUpload
      auto
      :multiple="true"
      :disabled="busy"
      :chooseLabel="$t('documents.detail.uploadFile')"
      @uploader="onUpload"
    />
  </div>
</template>
