<script setup lang="ts">
import Button from 'primevue/button';
import { useI18n } from 'vue-i18n';
import { useLayout } from '../../layouts/composables/layout';

// Shared visual shell for the public auth screens (login, forgot/reset password):
// gradient backdrop, centered glass card, brand mark, and a dark-mode toggle.
// Uses theme tokens only so light/dark both work.
defineProps<{ title: string; subtitle?: string; icon?: string }>();

const { toggleDarkMode, isDarkTheme } = useLayout();
const { t } = useI18n();
</script>

<template>
  <div
    class="relative min-h-screen flex items-center justify-center overflow-hidden bg-surface-50 dark:bg-surface-950 px-4"
  >
    <div
      class="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
    />
    <div
      class="pointer-events-none absolute -bottom-40 -right-24 h-112 w-md rounded-full bg-primary/10 blur-3xl"
    />

    <Button
      type="button"
      text
      rounded
      class="absolute! top-4 right-4"
      :aria-label="t('topbar.toggleDarkMode')"
      @click="toggleDarkMode"
    >
      <i :class="isDarkTheme ? 'pi pi-sun' : 'pi pi-moon'" />
    </Button>

    <div class="relative z-10 w-full max-w-md flex flex-col items-center">
      <div class="flex flex-col items-center text-center mb-6">
        <div
          class="flex items-center justify-center h-24 w-24 rounded-full bg-white shadow-lg shadow-primary/10 p-3 mb-4"
        >
          <img src="/logo_hal.png" alt="HAL Logistics" class="h-full w-full object-contain" />
        </div>
        <h1 class="text-3xl font-bold text-color">HAL ERP</h1><!-- i18n-ignore: product brand name -->
      </div>

      <div
        class="w-full rounded-2xl border border-surface bg-surface-0/80 dark:bg-surface-900/80 backdrop-blur-xl shadow-xl p-8 sm:p-10"
      >
        <div class="mb-6">
          <h2 class="text-2xl font-bold text-color">{{ title }}</h2>
          <p v-if="subtitle" class="text-sm text-muted-color mt-1">{{ subtitle }}</p>
        </div>

        <slot />

        <div v-if="$slots.footer" class="mt-8 text-center text-sm">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </div>
</template>
