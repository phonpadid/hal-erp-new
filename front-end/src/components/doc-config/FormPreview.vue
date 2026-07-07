<script setup lang="ts">
/**
 * Configuration preview of a form template: renders each field as the control an
 * end user would see, so the doc-config builder gives immediate feedback on the
 * form being built. This is a representative preview, NOT the production document
 * renderer — inputs are inert (disabled) and conditional (condition_json) fields are
 * flagged rather than shown/hidden live. Theme tokens only, so light/dark both work.
 */
import DatePicker from 'primevue/datepicker';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { useI18n } from 'vue-i18n';
import type { FormFieldRow } from '../../api/docConfig';

defineProps<{ fields: FormFieldRow[] }>();
const { t } = useI18n();

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
      <InputText v-if="f.fieldType === 'text'" disabled fluid />
      <InputNumber v-else-if="f.fieldType === 'number'" disabled fluid />
      <DatePicker v-else-if="f.fieldType === 'date'" disabled showIcon iconDisplay="input" fluid />
      <Select v-else-if="f.fieldType === 'dropdown'" :options="options(f.optionsJson)" disabled fluid :placeholder="t('common.select')" />

      <!-- File field → an upload affordance placeholder. -->
      <div v-else-if="f.fieldType === 'file'" class="flex items-center gap-2 rounded-md border border-dashed border-surface-300 dark:border-surface-600 text-muted-color px-3 py-4 text-sm">
        <i class="pi pi-upload" />
        <span>{{ t('admin.docConfig.previewFile') }}</span>
      </div>

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
