<script setup lang="ts">
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import FileUpload from 'primevue/fileupload';
import type { FileUploadSelectEvent, FileUploadUploaderEvent } from 'primevue/fileupload';
import Image from 'primevue/image';
import Message from 'primevue/message';
import ProgressBar from 'primevue/progressbar';
import { usePrimeVue } from 'primevue/config';
import { computed, ref, watch } from 'vue';
import { documentsApi, uploadAttachment } from '../api/documents';
import type { AttachmentRow } from '../api/documents';
import { useFeedback } from '../composables/useFeedback';

/**
 * Document attachments, rendered with the advanced PrimeVue FileUpload template.
 * Two modes:
 * - Persisted (a `documentId` is given): the "Upload" button runs our presign → PUT →
 *   register-metadata flow per file, then refreshes the saved-attachments list above.
 * - Staged (no `documentId` yet, e.g. a brand-new draft): the picker just holds the chosen
 *   files and mirrors them to `v-model:staged` so the parent can upload them once the draft
 *   has an id. The Upload button is hidden — nothing is sent until save.
 */
const props = defineProps<{ documentId?: string; attachments?: AttachmentRow[]; readonly?: boolean; staged?: File[] }>();
const emit = defineEmits<{ (e: 'uploaded'): void; (e: 'update:staged', files: File[]): void }>();
const fb = useFeedback();
const $primevue = usePrimeVue();

const MAX_FILE_SIZE = 10_000_000; // 10 MB per file

/**
 * What may be attached, mirroring the server's evidence allow-list so the two cannot drift.
 *
 * Narrow because an attachment is printed into the document set, not only downloaded: these are
 * the types that can be put on a page. The server still enforces — this only spares someone the
 * round trip and tells them what to attach instead.
 */
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ACCEPT = ACCEPTED_TYPES.join(',');

const persisted = computed(() => !!props.documentId);
const busy = ref(false);
const totalSize = ref(0);
const totalSizePercent = ref(0);
const fu = ref<{ clear?: () => void } | null>(null);

function isImage(file: { type?: string }): boolean {
  return !!file.type && file.type.startsWith('image/');
}

// PrimeVue's FileUpload stamps a preview `objectURL` onto each File at runtime.
function objectUrl(file: File): string {
  return (file as File & { objectURL?: string }).objectURL ?? '';
}

function formatSize(bytes: number): string {
  const k = 1024;
  const sizes = $primevue.config.locale?.fileSizeTypes ?? ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return `0 ${sizes[0]}`;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function setProgress(bytes: number): void {
  totalSize.value = Math.max(0, bytes);
  totalSizePercent.value = Math.min(100, (totalSize.value / MAX_FILE_SIZE) * 100);
}

// Advanced-template `select` gives the full accumulated file list; mirror it to progress
// and (in staged mode) to the parent's v-model.
function onSelectedFiles(event: FileUploadSelectEvent): void {
  const files = (event.files as File[]) ?? [];
  setProgress(files.reduce((sum, f) => sum + f.size, 0));
  if (!persisted.value) emit('update:staged', files.slice());
}


function uploadEvent(callback: () => void): void {
  setProgress(totalSize.value);
  callback();
}

function onTemplatedUpload(): void {
  setProgress(0);
}

function onClear(): void {
  setProgress(0);
  if (!persisted.value) emit('update:staged', []);
}

function onRemoveTemplatingFile(file: File, removeFileCallback: (i: number) => void, index: number): void {
  removeFileCallback(index);
  setProgress(totalSize.value - file.size);
  if (!persisted.value) {
    emit('update:staged', (props.staged ?? []).filter((f) => !(f.name === file.name && f.size === file.size)));
  }
}

// Persisted mode: our presign flow per file, then clear the picker and refresh the list.
async function onUpload(event: FileUploadUploaderEvent): Promise<void> {
  if (!props.documentId) return;
  const files = Array.isArray(event.files) ? event.files : [event.files];
  busy.value = true;
  try {
    for (const file of files) await uploadAttachment(props.documentId, file);
    fu.value?.clear?.();
    setProgress(0);
    emit('uploaded');
  } catch (e) {
    fb.error(e);
  } finally {
    busy.value = false;
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}
function attKind(att: AttachmentRow): 'image' | 'pdf' | 'other' {
  const mime = (att.mimeType ?? '').toLowerCase();
  const ext = extOf(att.fileName);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'other';
}
function attIcon(att: AttachmentRow): string {
  const kind = attKind(att);
  return kind === 'image' ? 'pi pi-image' : kind === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file';
}

async function signedUrl(att: AttachmentRow): Promise<string | null> {
  if (!props.documentId) return null;
  try {
    const { url } = await documentsApi.downloadUrl(props.documentId, att.id);
    return url;
  } catch (e) {
    fb.error(e);
    return null;
  }
}

// Fetch a presigned URL for every previewable attachment up front so images/PDFs render
// inline right away. URLs are short-lived (see S3_URL_TTL_SECONDS, ~5 min); we refetch
// whenever the attachment list changes. `download()` always fetches a fresh one on click.
const urlMap = ref<Record<string, string>>({});
async function loadPreviews(): Promise<void> {
  if (!props.documentId || !props.attachments?.length) {
    urlMap.value = {};
    return;
  }
  const entries = await Promise.all(
    props.attachments.map(async (a) => {
      if (attKind(a) === 'other') return null;
      const url = await signedUrl(a);
      return url ? ([a.id, url] as const) : null;
    }),
  );
  urlMap.value = Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null));
}
watch(() => props.attachments, loadPreviews, { immediate: true, deep: true });

function openInNewTab(url: string): void {
  if (url) window.open(url, '_blank', 'noopener');
}

async function download(att: AttachmentRow): Promise<void> {
  const url = await signedUrl(att);
  openInNewTab(url ?? '');
}

// PDF: click to open a large dialog viewer (the inline iframe swallows clicks, so this is
// triggered by an explicit expand button). Reuse the prefetched URL, refetch if expired.
const pdfOpen = ref(false);
const pdfUrl = ref('');
const pdfName = ref('');
async function openPdf(att: AttachmentRow): Promise<void> {
  const url = urlMap.value[att.id] ?? (await signedUrl(att));
  if (!url) return;
  pdfUrl.value = url;
  pdfName.value = att.fileName;
  pdfOpen.value = true;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Saved attachments (persisted mode only), with presigned download links. -->
    <template v-if="persisted">
      <ul v-if="attachments?.length" class="flex flex-col gap-4">
        <li v-for="a in attachments" :key="a.id" class="flex flex-col gap-1">
          <div class="flex items-center gap-2 text-sm">
            <i :class="attIcon(a)" class="text-muted-color" />
            <span class="font-medium">{{ a.fileName }}</span>
            <span v-if="a.fileSizeKb" class="text-muted-color text-xs">{{ a.fileSizeKb }} KB</span>
            <Button v-if="attKind(a) === 'pdf'" icon="pi pi-window-maximize" text rounded size="small" severity="secondary" :aria-label="$t('common.open')" @click="openPdf(a)" />
            <Button icon="pi pi-download" text rounded size="small" severity="secondary" :aria-label="$t('common.download')" @click="download(a)" />
          </div>
          <!-- Inline preview: image (click to zoom via PrimeVue Image) or embedded PDF (click ⤢ to enlarge). -->
          <Image v-if="attKind(a) === 'image' && urlMap[a.id]" :src="urlMap[a.id]" :alt="a.fileName" preview :imageStyle="{ maxHeight: '16rem', maxWidth: '100%', objectFit: 'contain', borderRadius: '0.375rem' }" />
          <div v-else-if="attKind(a) === 'pdf' && urlMap[a.id]" class="relative cursor-pointer group" @click="openPdf(a)">
            <iframe :src="urlMap[a.id]" class="w-full h-96 rounded border border-surface pointer-events-none" :title="a.fileName" />
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 rounded">
              <span class="inline-flex items-center gap-2 rounded-md bg-surface-0 dark:bg-surface-900 px-3 py-2 text-sm shadow"><i class="pi pi-window-maximize" />{{ $t('common.open') }}</span>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="text-muted-color text-sm">{{ $t('documents.detail.noAttachments') }}</p>
    </template>

    <FileUpload
      v-if="!readonly"
      ref="fu"
      name="attachments[]"
      customUpload
      :multiple="true"
      :maxFileSize="MAX_FILE_SIZE"
      :accept="ACCEPT"
      :invalidFileTypeMessage="$t('documents.detail.acceptedTypes')"
      :disabled="busy"
      @uploader="onUpload"
      @upload="onTemplatedUpload"
      @select="onSelectedFiles"
      @clear="onClear"
    >
      <template #header="{ chooseCallback, uploadCallback, clearCallback, files }">
        <div class="flex flex-wrap justify-between items-center flex-1 gap-4">
          <div class="flex gap-2">
            <Button @click="chooseCallback()" icon="pi pi-images" rounded variant="outlined" severity="secondary" />
            <Button v-if="persisted" @click="uploadEvent(uploadCallback)" icon="pi pi-cloud-upload" rounded variant="outlined" severity="success" :disabled="busy || !files || files.length === 0" />
            <Button @click="clearCallback()" icon="pi pi-times" rounded variant="outlined" severity="danger" :disabled="!files || files.length === 0" />
          </div>
          <ProgressBar :value="totalSizePercent" :showValue="false" class="md:w-20rem h-1 w-full md:ml-auto">
            <span class="whitespace-nowrap">{{ formatSize(totalSize) }} / {{ formatSize(MAX_FILE_SIZE) }}</span>
          </ProgressBar>
        </div>
      </template>
      <template #content="{ files, uploadedFiles, removeUploadedFileCallback, removeFileCallback, messages }">
        <div class="flex flex-col gap-8 pt-4">
          <Message v-for="message of messages" :key="message" :class="{ 'mb-8': !files.length && !uploadedFiles.length }" severity="error">
            {{ message }}
          </Message>

          <div v-if="files.length > 0">
            <h5>{{ $t('documents.detail.uploadPending') }}</h5>
            <div class="flex flex-wrap gap-4">
              <div v-for="(file, index) of files" :key="file.name + file.type + file.size" class="p-8 rounded-border flex flex-col border border-surface items-center gap-4">
                <div class="flex items-center justify-center" style="width: 100px; height: 50px">
                  <img v-if="isImage(file)" role="presentation" :alt="file.name" :src="objectUrl(file)" class="max-w-full max-h-full object-contain" />
                  <i v-else class="pi pi-file text-4xl text-muted-color" />
                </div>
                <span class="font-semibold text-ellipsis max-w-60 whitespace-nowrap overflow-hidden">{{ file.name }}</span>
                <div>{{ formatSize(file.size) }}</div>
                <Badge :value="$t('documents.detail.uploadPending')" severity="warn" />
                <Button icon="pi pi-times" @click="onRemoveTemplatingFile(file, removeFileCallback, index)" variant="outlined" rounded severity="danger" />
              </div>
            </div>
          </div>

          <div v-if="uploadedFiles.length > 0">
            <h5>{{ $t('documents.detail.uploadCompleted') }}</h5>
            <div class="flex flex-wrap gap-4">
              <div v-for="(file, index) of uploadedFiles" :key="file.name + file.type + file.size" class="p-8 rounded-border flex flex-col border border-surface items-center gap-4">
                <div class="flex items-center justify-center" style="width: 100px; height: 50px">
                  <img v-if="isImage(file)" role="presentation" :alt="file.name" :src="objectUrl(file)" class="max-w-full max-h-full object-contain" />
                  <i v-else class="pi pi-file text-4xl text-muted-color" />
                </div>
                <span class="font-semibold text-ellipsis max-w-60 whitespace-nowrap overflow-hidden">{{ file.name }}</span>
                <div>{{ formatSize(file.size) }}</div>
                <Badge :value="$t('documents.detail.uploadCompleted')" class="mt-4" severity="success" />
                <Button icon="pi pi-times" @click="removeUploadedFileCallback(index)" variant="outlined" rounded severity="danger" />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #empty>
        <div class="flex items-center justify-center flex-col">
          <i class="pi pi-cloud-upload border-2! rounded-full! p-8! text-4xl! text-muted-color!" />
          <p class="mt-6 mb-0">{{ $t('documents.detail.uploadDragDrop') }}</p>
        </div>
      </template>
    </FileUpload>

    <!-- Enlarged PDF viewer. -->
    <Dialog v-model:visible="pdfOpen" modal dismissableMask :header="pdfName" :style="{ width: '90vw', maxWidth: '1100px' }" :contentStyle="{ height: '85vh', padding: '0' }">
      <iframe :src="pdfUrl" class="w-full h-full border-0" :title="pdfName" />
      <template #footer>
        <Button :label="$t('common.download')" icon="pi pi-download" text @click="openInNewTab(pdfUrl)" />
      </template>
    </Dialog>
  </div>
</template>
