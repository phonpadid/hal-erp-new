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
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Bound with v-model:search. When undefined the search field is not rendered. */
  search?: string;
  searchPlaceholder?: string;
  /**
   * Emit `update:search` only when the user presses Enter (or empties the box), instead of on
   * every keystroke. For lists whose search is answered by the server over a heavy read — the
   * approval inbox scans every pending document per request — typing "0005" otherwise fires four
   * full scans ("0", "00", "000", "0005") that all queue behind each other.
   */
  submitOnEnter?: boolean;
  /** Number of selected rows; the #bulk slot shows only when this is > 0. */
  selectionCount?: number;
}>();

const emit = defineEmits<{ 'update:search': [value: string] }>();
const { t } = useI18n();

// What the box shows. In submit-on-Enter mode it runs ahead of `search` until Enter commits it;
// a parent reset (clear filters) still lands here through the watch.
const draft = ref(props.search ?? '');
watch(() => props.search, (v) => { draft.value = v ?? ''; });

function onInput(value: unknown) {
  const next = String(value ?? '');
  draft.value = next;
  // Emptying the box is itself the request to see everything again — no Enter needed for that.
  if (!props.submitOnEnter || next === '') emit('update:search', next);
}

function onEnter() {
  if (props.submitOnEnter) emit('update:search', draft.value);
}
</script>

<template>
  <Toolbar class="mb-4 border-surface">
    <template #start>
      <div class="flex flex-wrap items-center gap-2">
        <IconField v-if="props.search !== undefined">
          <InputIcon class="pi pi-search" />
          <InputText
            :modelValue="draft"
            @update:modelValue="onInput"
            @keydown.enter.prevent="onEnter"
            :placeholder="searchPlaceholder ?? t(props.submitOnEnter ? 'components.toolbar.searchEnterPlaceholder' : 'components.toolbar.searchPlaceholder')"
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
