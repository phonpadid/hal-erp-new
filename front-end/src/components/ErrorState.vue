<script setup lang="ts">
/**
 * Error state for a content region whose data failed to load: an alert icon, an
 * optional title, the failure message, and a retry button that emits `retry`.
 * Colors are PrimeUI theme tokens (plus fixed semantic red, as used elsewhere) so
 * light/dark both work.
 */
import Button from 'primevue/button';
import { useI18n } from 'vue-i18n';

defineProps<{
  message: string;
  title?: string;
}>();

const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center gap-3 py-12 px-4">
    <span class="inline-flex items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20 w-16 h-16">
      <i class="pi pi-exclamation-triangle text-2xl text-red-500" />
    </span>
    <div>
      <div class="text-color font-semibold">{{ title ?? t('components.state.errorTitle') }}</div>
      <p class="text-muted-color text-sm mt-1 mb-0">{{ message }}</p>
    </div>
    <Button :label="t('common.retry')" icon="pi pi-refresh" size="small" outlined @click="emit('retry')" />
  </div>
</template>
