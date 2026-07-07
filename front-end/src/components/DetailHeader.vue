<script setup lang="ts">
/**
 * Detail-page header: the record's title/identifier with its status rendered as a
 * Tag, an optional meta line, an optional emphasized #headline (e.g. a document total),
 * and an #actions slot. Mirrors PageHeader's layout so list and detail pages read
 * consistently. Colors are PrimeUI theme tokens.
 *
 * Slots (all optional, backward compatible):
 * - #meta      — richer meta line under the title; falls back to the `subtitle` prop.
 * - #headline  — emphasized content on the right, above the actions (e.g. the total).
 * - #actions   — action buttons on the right.
 */
import Tag from 'primevue/tag';

defineProps<{
  title: string;
  subtitle?: string;
  status?: string;
  statusSeverity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
}>();
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-4">
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h1 class="text-xl font-semibold text-color m-0 truncate">{{ title }}</h1>
        <Tag v-if="status" :value="status" :severity="statusSeverity" />
      </div>
      <slot name="meta">
        <p v-if="subtitle" class="text-muted-color text-sm mt-1 mb-0">{{ subtitle }}</p>
      </slot>
    </div>
    <div v-if="$slots.headline || $slots.actions" class="flex flex-col items-start sm:items-end gap-3 shrink-0">
      <slot name="headline" />
      <div v-if="$slots.actions" class="flex items-center gap-2 flex-wrap sm:justify-end">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
