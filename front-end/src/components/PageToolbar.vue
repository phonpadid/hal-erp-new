<script setup lang="ts">
/**
 * Shared sakai-style list-page toolbar. Provides an optional global search field
 * (bound via v-model:search), and four regions exposed as slots:
 *   #filters — page-specific filters (left, beside search)
 *   #bulk    — actions on the current selection; only rendered when selectionCount > 0
 *   #actions — primary action(s) such as "New" / "Export" (right)
 * Colors come from PrimeUI theme tokens so light/dark both work. Every action placed
 * in a slot stays gated by its permission code in the parent (UX only; server enforces).
 */
import Toolbar from 'primevue/toolbar';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Bound with v-model:search. When undefined the search field is not rendered. */
  search?: string;
  searchPlaceholder?: string;
  /** Number of selected rows; the #bulk slot shows only when this is > 0. */
  selectionCount?: number;
}>();

const emit = defineEmits<{ 'update:search': [value: string] }>();
const { t } = useI18n();
</script>

<template>
  <Toolbar class="mb-4 border-surface">
    <template #start>
      <div class="flex flex-wrap items-center gap-2">
        <IconField v-if="props.search !== undefined">
          <InputIcon class="pi pi-search" />
          <InputText
            :modelValue="props.search"
            @update:modelValue="emit('update:search', String($event ?? ''))"
            :placeholder="searchPlaceholder ?? t('components.toolbar.searchPlaceholder')"
          />
        </IconField>
        <slot name="filters" />
      </div>
    </template>
    <template #end>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="(props.selectionCount ?? 0) > 0">
          <slot name="bulk" :count="props.selectionCount" />
        </template>
        <slot name="actions" />
      </div>
    </template>
  </Toolbar>
</template>
