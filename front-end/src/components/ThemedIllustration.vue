<script setup lang="ts">
/**
 * Renders an inlined SVG illustration whose accent color follows the active theme's primary
 * palette (shade 400). An SVG loaded via <img> can't inherit CSS color, so callers pass the
 * raw SVG string (import with `...svg?raw`) plus the fixed accent hex to remap; that accent
 * becomes `currentColor`, and this component sets the color from the PrimeVue token via
 * `text-primary-400`, so it re-tints live when the user changes the primary color.
 * The svg's fixed width/height are stripped so it scales to the container.
 */
import { computed } from 'vue';

const props = withDefaults(defineProps<{ svg: string; accent?: string }>(), { accent: '' });

const themed = computed(() => {
  let out = props.svg;
  if (props.accent) {
    const escaped = props.accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), 'currentColor');
  }
  return out.replace(/(<svg\b[^>]*?)\swidth="[\d.]+"\sheight="[\d.]+"/i, '$1');
});
</script>

<template>
  <!-- v-html is safe here: `themed` derives from a build-time static asset, never user input. -->
  <div class="themed-illustration text-primary-400" role="img" aria-hidden="true" v-html="themed" />
</template>

<style scoped>
.themed-illustration :deep(svg) {
  width: 100%;
  height: auto;
}
</style>
