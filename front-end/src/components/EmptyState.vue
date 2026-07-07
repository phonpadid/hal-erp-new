<script setup lang="ts">
/**
 * Empty state for a content region that loaded successfully but has no records:
 * a muted icon (or a decorative illustration), a title, an optional message, and an
 * optional call-to-action via the #action slot. Colors are PrimeUI theme tokens so
 * light/dark both work.
 *
 * Pass `illustration` (a raw SVG string imported with `...svg?raw`) plus its `accent`
 * hex to show a themed illustration instead of the icon circle; the illustration is
 * decorative (ThemedIllustration marks it aria-hidden), so the title always carries
 * the meaning.
 */
import ThemedIllustration from './ThemedIllustration.vue';

defineProps<{
  title: string;
  message?: string;
  icon?: string;
  illustration?: string;
  accent?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center gap-3 py-12 px-4">
    <ThemedIllustration
      v-if="illustration"
      :svg="illustration"
      :accent="accent ?? ''"
      class="w-40 opacity-90"
    />
    <span
      v-else
      class="inline-flex items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800 text-muted-color w-16 h-16"
    >
      <i :class="['pi', icon ?? 'pi pi-inbox', 'text-2xl']" />
    </span>
    <div>
      <div class="text-color font-semibold">{{ title }}</div>
      <p v-if="message" class="text-muted-color text-sm mt-1 mb-0">{{ message }}</p>
    </div>
    <div v-if="$slots.action" class="mt-1">
      <slot name="action" />
    </div>
  </div>
</template>
