<script setup lang="ts">
/**
 * A titled content section for detail pages, backed by a PrimeVue `Panel` so every
 * section shares the same theme-aware chrome (header, surface, border) in light and
 * dark mode. Keeps the original API: `title`/`subtitle` props, an `#actions` slot
 * (rendered in the panel header), and the section body in the default slot. Use
 * instead of stacking unlabeled bare cards. Theme tokens only.
 */
import Panel from 'primevue/panel';

defineProps<{
  title?: string;
  subtitle?: string;
  icon?: string;
}>();
</script>

<template>
  <!-- min-w-0 down the Panel's content chain so a wide scrollable table scrolls
       inside the card instead of stretching it (PrimeVue's content wrappers default
       to min-width:auto, which otherwise lets the table push the card wider). -->
  <Panel
    class="mb-4 min-w-0"
    :pt="{
      contentWrapper: { class: 'min-w-0' },
      contentContainer: { class: 'min-w-0' },
      content: { class: 'min-w-0' },
    }"
  >
    <template #header>
      <!-- Single items-center row: icon + title on the left, actions pushed right,
           so the icon, title text, and any header actions share one baseline. -->
      <div class="flex items-center gap-2.5 min-w-0 w-full">
        <span v-if="icon" class="inline-flex items-center justify-center rounded-lg bg-primary/10 text-primary w-8 h-8 shrink-0">
          <i :class="['pi', icon, 'text-sm', 'leading-none']" />
        </span>
        <div class="min-w-0">
          <h2 v-if="title" class="font-semibold text-color m-0! leading-tight">{{ title }}</h2>
          <p v-if="subtitle" class="text-muted-color text-sm mt-1 mb-0">{{ subtitle }}</p>
        </div>
        <div v-if="$slots.actions" class="ml-auto shrink-0">
          <slot name="actions" />
        </div>
      </div>
    </template>
    <slot />
  </Panel>
</template>
