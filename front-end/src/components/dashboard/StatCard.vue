<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import Message from 'primevue/message';
import { RouterLink } from 'vue-router';

/**
 * Presentational dashboard stat card: icon + label + a big value, with its own
 * loading / error states so each widget renders independently. Colors are theme
 * tokens so light/dark both work.
 */
defineProps<{
  icon: string;
  label: string;
  hint?: string;
  value: string | number | null;
  loading?: boolean;
  error?: string;
  to?: string;
}>();
</script>

<template>
  <div class="card h-full flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-muted-color text-sm font-medium">{{ label }}</div>
        <Message v-if="error" severity="error" :closable="false" class="mt-2">{{ error }}</Message>
        <Skeleton v-else-if="loading" width="4rem" height="2rem" class="mt-2" />
        <div v-else class="text-color text-3xl font-semibold mt-1">{{ value ?? '—' }}</div>
      </div>
      <span class="inline-flex items-center justify-center rounded-border bg-primary text-primary-contrast w-12 h-12 shrink-0">
        <i :class="['pi', icon, 'text-xl']" />
      </span>
    </div>
    <div class="flex items-center justify-between gap-2 mt-auto">
      <small v-if="hint" class="text-muted-color">{{ hint }}</small>
      <RouterLink v-if="to" :to="to" class="text-primary text-sm font-medium ml-auto">
        {{ $t('dashboard.viewAll') }} <i class="pi pi-arrow-right text-xs" />
      </RouterLink>
    </div>
  </div>
</template>
