<script setup lang="ts">
/**
 * A titled section card for report content (a chart or a table). Provides consistent
 * framing — surface background, rounded border, header with title + optional subtitle and
 * an actions slot. Colors come from PrimeUI theme tokens so light/dark both render.
 */
defineProps<{
  title?: string;
  subtitle?: string;
  icon?: string;
}>();
</script>

<template>
  <section class="card h-full flex flex-col gap-3 mb-0!">
    <header v-if="title || $slots.actions" class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 v-if="title" class="text-color text-sm font-semibold m-0 flex items-center gap-2">
          <i v-if="icon" :class="['pi', icon, 'text-muted-color']" />
          <span class="truncate">{{ title }}</span>
        </h3>
        <p v-if="subtitle" class="text-muted-color text-xs mt-1 mb-0">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
        <slot name="actions" />
      </div>
    </header>
    <div class="flex-1 min-w-0">
      <slot />
    </div>
  </section>
</template>
