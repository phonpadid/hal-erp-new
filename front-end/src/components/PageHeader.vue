<script setup lang="ts">
/**
 * Shared sakai-style page header used at the top of every in-app view: a title
 * (with optional subtitle) on the left and an optional actions slot on the right.
 * Pair with `.card` containers for page body sections. Colors come from PrimeUI
 * theme tokens (text-color / text-muted-color) so light and dark mode both work.
 */
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
    <div class="min-w-0">
      <h1 class="text-xl font-semibold text-color m-0 truncate">{{ title }}</h1>
      <p v-if="subtitle" class="text-muted-color text-sm mt-1 mb-0">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
