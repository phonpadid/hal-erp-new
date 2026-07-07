<script setup lang="ts">
/**
 * Sakai-style loading placeholder for a table region: `rows` × `columns` skeleton
 * cells. Use while the first page of data is loading and nothing is shown yet, in
 * place of a bare spinner. Set `columns` to match the real table's column count.
 */
import Skeleton from 'primevue/skeleton';

withDefaults(
  defineProps<{
    columns?: number;
    rows?: number;
  }>(),
  { columns: 4, rows: 5 },
);
</script>

<template>
  <div class="flex flex-col gap-3 py-2">
    <div v-for="r in rows" :key="r" class="flex gap-3">
      <Skeleton v-for="c in columns" :key="c" height="1.5rem" class="flex-1" />
    </div>
  </div>
</template>
