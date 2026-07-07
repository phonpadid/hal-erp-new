<script setup lang="ts">
/**
 * Sequential event history (e.g. a document's approval history) as a vertical
 * Timeline. Each event carries an optional icon + severity (which colour the marker),
 * a title, optional subtitle (actor), a timestamp, and an optional body (remark).
 * Renders an EmptyState when there are no events. Marker colours are fixed semantic
 * tints; all surrounding surfaces/text use PrimeUI theme tokens so light/dark work.
 */
import Timeline from 'primevue/timeline';
import EmptyState from './EmptyState.vue';
import { useI18n } from 'vue-i18n';

export interface TimelineEntry {
  icon?: string;
  severity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary';
  title: string;
  subtitle?: string;
  at?: string;
  body?: string;
}

defineProps<{
  events: TimelineEntry[];
  emptyMessage?: string;
}>();

const { t } = useI18n();

function markerClass(severity?: string): string {
  switch (severity) {
    case 'success':
      return 'bg-green-500 text-white';
    case 'danger':
      return 'bg-red-500 text-white';
    case 'warn':
      return 'bg-yellow-500 text-white';
    case 'info':
      return 'bg-blue-500 text-white';
    default:
      return 'bg-surface-300 dark:bg-surface-600 text-color';
  }
}
</script>

<template>
  <EmptyState
    v-if="!events.length"
    icon="pi pi-clock"
    :title="t('components.timeline.empty')"
    :message="emptyMessage"
  />
  <Timeline v-else :value="events" class="w-full">
    <template #marker="{ item }">
      <span class="inline-flex items-center justify-center rounded-full w-8 h-8 shrink-0" :class="markerClass(item.severity)">
        <i :class="['pi', item.icon ?? 'pi pi-circle-fill', 'text-sm']" />
      </span>
    </template>
    <template #content="{ item }">
      <div class="flex flex-col gap-1 pb-6">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-color font-medium">{{ item.title }}</span>
          <span v-if="item.subtitle" class="text-muted-color text-sm">{{ item.subtitle }}</span>
        </div>
        <small v-if="item.at" class="text-muted-color">{{ item.at }}</small>
        <p v-if="item.body" class="text-color text-sm mt-1 mb-0">{{ item.body }}</p>
      </div>
    </template>
  </Timeline>
</template>
