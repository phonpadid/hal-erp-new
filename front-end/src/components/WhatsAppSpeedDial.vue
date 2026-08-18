<script setup lang="ts">
/**
 * Floating WhatsApp contact button built on PrimeVue SpeedDial. Opens wa.me with a
 * pre-filled message in a new tab. Positioned in a page corner; defaults to fixed so
 * it stays pinned to the viewport while scrolling — pass position="absolute" to anchor
 * it to the nearest positioned ancestor instead. Icon is a PrimeIcon; no hardcoded
 * colors so it follows the active theme.
 */
import SpeedDial from "primevue/speeddial";
import type { MenuItem } from "primevue/menuitem";

const props = withDefaults(
  defineProps<{
    /** Phone in international format, digits only (country code, no +). */
    phone: string;
    /** Pre-filled message text. */
    message?: string;
    /** CSS position: fixed (pinned to viewport) or absolute (anchored to ancestor). */
    position?: "fixed" | "absolute";
    /** Inset from the corner. */
    inset?: string;
  }>(),
  {
    message: "ສະບາຍດີ",
    position: "fixed",
    inset: "1rem",
  },
);

const items: MenuItem[] = [
  {
    label: "WhatsApp",
    icon: "pi pi-whatsapp",
    command: () => {
      const url = `https://wa.me/${props.phone}?text=${encodeURIComponent(props.message)}`;
      window.open(url, "_blank", "noopener");
    },
  },
];
</script>

<template>
  <SpeedDial
    :model="items"
    direction="up"
    :aria-label="'WhatsApp'"
    :style="{
      position: props.position,
      right: props.inset,
      bottom: props.inset,
      zIndex: 'var(--z-floating-affordance)',
    }"
  />
</template>
