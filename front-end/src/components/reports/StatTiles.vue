<script setup lang="ts">
import Skeleton from 'primevue/skeleton';
import { computed } from 'vue';

/**
 * A responsive row of compact KPI tiles for the top of a report. Each tile is a label, a
 * big value, and a tinted icon chip. Tone maps to a PrimeUI color token (no hardcoded hex),
 * so light and dark both render. Purely presentational.
 */
export interface StatTile {
  label: string;
  value: string | number | null;
  icon?: string;
  tone?: 'primary' | 'success' | 'warn' | 'danger' | 'info';
  hint?: string;
}

const props = withDefaults(
  defineProps<{
    tiles: StatTile[];
    loading?: boolean;
    /** Tiles per row on wide screens (each spans 12/cols columns). Defaults to 4. */
    cols?: 2 | 3 | 4;
  }>(),
  { loading: false, cols: 4 },
);

// Full class strings so Tailwind keeps them (no dynamic concatenation).
const COLS: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};
const colsClass = computed(() => COLS[props.cols] ?? COLS[4]);

// Tinted chip: soft background + matching foreground, from theme color tokens.
const CHIP: Record<NonNullable<StatTile['tone']>, string> = {
  primary: 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  warn: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  info: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
};
const chipClass = (tone?: StatTile['tone']) => CHIP[tone ?? 'primary'];
</script>

<template>
  <div class="grid gap-3" :class="colsClass">
    <div v-for="(t, i) in tiles" :key="i" class="card mb-0! flex items-center gap-3">
      <span v-if="t.icon" :class="['inline-flex items-center justify-center rounded-border w-10 h-10 shrink-0', chipClass(t.tone)]">
        <i :class="['pi', t.icon]" />
      </span>
      <div class="min-w-0">
        <div class="text-muted-color text-xs font-medium truncate">{{ t.label }}</div>
        <Skeleton v-if="loading" width="3.5rem" height="1.5rem" class="mt-1" />
        <div v-else class="text-color text-xl font-semibold leading-tight truncate">{{ t.value ?? '—' }}</div>
        <small v-if="t.hint && !loading" class="text-muted-color">{{ t.hint }}</small>
      </div>
    </div>
  </div>
</template>
