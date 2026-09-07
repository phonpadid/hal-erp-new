<script setup lang="ts">
/**
 * One bank in a picker: its logo beside its name.
 *
 * Presentational only — no store, no emits, so it is safe inside a `<Select>` slot and inside a
 * `@primevue/forms` `<FormField>`. A value the catalog does not know arrives with no `logo` and
 * renders as plain text, which is the point: an odd bank should look odd.
 *
 * The default slot replaces the visible text where a row says more than the bank's name (a list
 * showing `BCEL · 000123`); `label` stays the image's alt either way.
 */
defineProps<{ label: string; sublabel?: string; logo?: string }>();
</script>

<template>
  <span class="flex min-w-0 items-center gap-2">
    <!-- alt is the bank's name, so a missing file degrades to the name rather than a gap. -->
    <img v-if="logo" :src="logo" :alt="label" class="h-5 w-8 shrink-0 object-contain" />
    <span class="min-w-0">
      <span class="block truncate"><slot>{{ label }}</slot></span>
      <span v-if="sublabel" class="block truncate text-xs text-muted-color">{{ sublabel }}</span>
    </span>
  </span>
</template>
