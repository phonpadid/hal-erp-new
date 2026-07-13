<script setup lang="ts">
/**
 * Configuration preview of a form template: renders each field as the control an
 * end user would see, so the doc-config builder gives immediate feedback on the
 * form being built. This is a representative preview, NOT the production document
 * renderer — inputs are inert (disabled) and conditional (condition_json) fields are
 * flagged rather than shown/hidden live. Theme tokens only, so light/dark both work.
 */
import Badge from 'primevue/badge';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import FileUpload from 'primevue/fileupload';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressBar from 'primevue/progressbar';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import Tag from 'primevue/tag';
import { usePrimeVue } from 'primevue/config';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FormFieldRow } from '../../api/docConfig';

defineProps<{ fields: FormFieldRow[] }>();
const { t } = useI18n();

// --- File field (advanced FileUpload template) ---------------------------
// The preview mirrors the PrimeVue advanced uploader so the builder shows the
// exact affordance an end user gets. It is inert in the config preview: bytes
// are tracked for the progress bar but nothing is persisted.
const $primevue = usePrimeVue();
const totalSize = ref(0);
const totalSizePercent = ref(0);
const files = ref<File[]>([]);

function formatSize(bytes: number): string {
  const k = 1024;
  const dm = 3;
  const sizes = $primevue.config.locale?.fileSizeTypes ?? ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return `0 ${sizes[0]}`;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const formattedSize = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${formattedSize} ${sizes[i]}`;
}

// PrimeVue's FileUpload stamps a preview `objectURL` onto each File at runtime.
function objectUrl(file: File): string {
  return (file as File & { objectURL?: string }).objectURL ?? '';
}

function onSelectedFiles(event: { files: File[] }): void {
  files.value = event.files;
  totalSize.value = files.value.reduce((sum, file) => sum + file.size, 0);
  totalSizePercent.value = totalSize.value / 10000;
}

function onTemplatedUpload(): void {
  totalSizePercent.value = 0;
}

function uploadEvent(callback: () => void): void {
  totalSizePercent.value = totalSize.value / 10000;
  callback();
}

function onRemoveTemplatingFile(file: File, removeFileCallback: (i: number) => void, index: number): void {
  removeFileCallback(index);
  totalSize.value -= file.size;
  totalSizePercent.value = totalSize.value / 10000;
}

// A dropdown's options_json is a JSON array of strings; parse defensively so a
// malformed value degrades to an empty option list instead of throwing.
function options(json?: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((o) => String(o)) : [];
  } catch {
    return [];
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-for="f in fields" :key="f.id" class="flex flex-col gap-1">
      <label class="text-sm font-medium text-color flex items-center gap-2 flex-wrap">
        <span>{{ f.fieldLabel || f.fieldName }}</span>
        <span v-if="f.isRequired" class="text-red-500"><!-- i18n-ignore: required marker -->*</span>
        <Tag v-if="f.conditionJson" :value="t('admin.docConfig.conditional')" severity="secondary" icon="pi pi-filter" class="text-xs" />
      </label>

      <!-- Inert controls: representative of the runtime form, not interactive. -->
      <InputText v-if="f.fieldType === 'string'" disabled fluid />
      <!-- `text` is the rich editor at runtime; a multi-line box represents its larger body. -->
      <Textarea v-else-if="f.fieldType === 'text'" disabled rows="3" fluid />
      <InputNumber v-else-if="f.fieldType === 'number'" disabled fluid />
      <DatePicker v-else-if="f.fieldType === 'date'" disabled showIcon iconDisplay="input" fluid />
      <Select v-else-if="f.fieldType === 'dropdown'" :options="options(f.optionsJson)" disabled fluid :placeholder="t('common.select')" />

      <!-- File field → advanced FileUpload template (inert preview). -->
      <FileUpload
        v-else-if="f.fieldType === 'file'"
        name="demo[]"
        url="/api/upload"
        :multiple="true"
        accept="image/*"
        :maxFileSize="1000000"
        @upload="onTemplatedUpload"
        @select="onSelectedFiles"
      >
        <template #header="{ chooseCallback, uploadCallback, clearCallback, files: headerFiles }">
          <div class="flex flex-wrap justify-between items-center flex-1 gap-4">
            <div class="flex gap-2">
              <Button @click="chooseCallback()" icon="pi pi-images" rounded variant="outlined" severity="secondary" />
              <Button @click="uploadEvent(uploadCallback)" icon="pi pi-cloud-upload" rounded variant="outlined" severity="success" :disabled="!headerFiles || headerFiles.length === 0" />
              <Button @click="clearCallback()" icon="pi pi-times" rounded variant="outlined" severity="danger" :disabled="!headerFiles || headerFiles.length === 0" />
            </div>
            <ProgressBar :value="totalSizePercent" :showValue="false" class="md:w-20rem h-1 w-full md:ml-auto">
              <span class="whitespace-nowrap">{{ totalSize }}B / 1Mb</span>
            </ProgressBar>
          </div>
        </template>
        <template #content="{ files: pendingFiles, uploadedFiles, removeUploadedFileCallback, removeFileCallback, messages }">
          <div class="flex flex-col gap-8 pt-4">
            <Message v-for="message of messages" :key="message" :class="{ 'mb-8': !pendingFiles.length && !uploadedFiles.length }" severity="error">
              {{ message }}
            </Message>

            <div v-if="pendingFiles.length > 0">
              <h5>{{ t('admin.docConfig.uploadPending') }}</h5>
              <div class="flex flex-wrap gap-4">
                <div v-for="(file, index) of pendingFiles" :key="file.name + file.type + file.size" class="p-8 rounded-border flex flex-col border border-surface items-center gap-4">
                  <div>
                    <img role="presentation" :alt="file.name" :src="objectUrl(file)" width="100" height="50" />
                  </div>
                  <span class="font-semibold text-ellipsis max-w-60 whitespace-nowrap overflow-hidden">{{ file.name }}</span>
                  <div>{{ formatSize(file.size) }}</div>
                  <Badge :value="t('admin.docConfig.uploadPending')" severity="warn" />
                  <Button icon="pi pi-times" @click="onRemoveTemplatingFile(file, removeFileCallback, index)" variant="outlined" rounded severity="danger" />
                </div>
              </div>
            </div>

            <div v-if="uploadedFiles.length > 0">
              <h5>{{ t('admin.docConfig.uploadCompleted') }}</h5>
              <div class="flex flex-wrap gap-4">
                <div v-for="(file, index) of uploadedFiles" :key="file.name + file.type + file.size" class="p-8 rounded-border flex flex-col border border-surface items-center gap-4">
                  <div>
                    <img role="presentation" :alt="file.name" :src="objectUrl(file)" width="100" height="50" />
                  </div>
                  <span class="font-semibold text-ellipsis max-w-60 whitespace-nowrap overflow-hidden">{{ file.name }}</span>
                  <div>{{ formatSize(file.size) }}</div>
                  <Badge :value="t('admin.docConfig.uploadCompleted')" class="mt-4" severity="success" />
                  <Button icon="pi pi-times" @click="removeUploadedFileCallback(index)" variant="outlined" rounded severity="danger" />
                </div>
              </div>
            </div>
          </div>
        </template>
        <template #empty>
          <div class="flex items-center justify-center flex-col">
            <i class="pi pi-cloud-upload border-2! rounded-full! p-8! text-4xl! text-muted-color!" />
            <p class="mt-6 mb-0">{{ t('admin.docConfig.uploadDragDrop') }}</p>
          </div>
        </template>
      </FileUpload>

      <!-- Line-items field → a small table placeholder. -->
      <div v-else-if="f.fieldType === 'line_items'" class="rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div class="grid grid-cols-3 gap-2 bg-surface-100 dark:bg-surface-800 px-3 py-2 text-xs font-medium text-muted-color">
          <span>{{ t('common.name') }}</span><span>{{ t('admin.docConfig.previewQty') }}</span><span>{{ t('common.amount') }}</span>
        </div>
        <div class="grid grid-cols-3 gap-2 px-3 py-2">
          <span class="h-4 rounded bg-surface-100 dark:bg-surface-800" /><span class="h-4 rounded bg-surface-100 dark:bg-surface-800" /><span class="h-4 rounded bg-surface-100 dark:bg-surface-800" />
        </div>
      </div>
    </div>
  </div>
</template>
