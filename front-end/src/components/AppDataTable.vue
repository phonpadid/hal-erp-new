<script setup lang="ts">
/**
 * Shared list table (web-app-layout: Scrollable Paginated Data Table). Wraps PrimeVue
 * DataTable in lazy mode: it shows the server's current page, binds `total` to the
 * paginator, and emits `{ page, limit }` when the user pages so the caller refetches.
 * Scrollable at a fixed height (default 500px), a ProgressSpinner while loading, a refresh
 * control in the paginator, and a leading `#` row-number column. Caller passes its own
 * <Column>s via the default slot; extra DataTable props (filters, rowHover, …) pass through.
 */
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import { ref } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    value: any[];
    total: number;
    loading?: boolean;
    page?: number;
    rows?: number;
    scrollHeight?: string;
    dataKey?: string;
    rowsPerPageOptions?: number[];
    /**
     * Optional override for the leading `#` value. Given a row and its index on the page, return
     * what the number column should show. Used by grouped tables, where the flat page-offset count
     * runs straight through a group heading it is not part of; every other caller is a flat list
     * and wants the default.
     */
    numberOf?: (row: any, index: number) => number | string;
  }>(),
  {
    loading: false,
    page: 1,
    rows: 20,
    scrollHeight: "500px",
    dataKey: "id",
    rowsPerPageOptions: () => [10, 20, 50, 100],
  },
);

const emit = defineEmits<{
  (e: "page", payload: { page: number; limit: number }): void;
  (e: "refresh"): void;
}>();

// PrimeVue @page gives a 0-based `page` and `rows`; re-emit 1-based for the server.
function onPage(e: { page: number; rows: number }) {
  emit("page", { page: e.page + 1, limit: e.rows });
}

const dt = ref<InstanceType<typeof DataTable> | null>(null);
// NOTE: lazy/server pagination means `value` is only the current page, so this exports
// the rows currently loaded (the visible page), not the entire dataset.
function exportCSV() {
  dt.value?.exportCSV();
}
</script>

<template>
  <DataTable
    ref="dt"
    :value="value"
    :dataKey="dataKey"
    lazy
    paginator
    scrollable
    :scrollHeight="scrollHeight"
    :rows="rows"
    :first="(page - 1) * rows"
    :totalRecords="total"
    :loading="loading"
    :rowsPerPageOptions="rowsPerPageOptions"
    v-bind="$attrs"
    @page="onPage"
  >
    <template #loading>
      <ProgressSpinner
        style="width: 50px; height: 50px"
        strokeWidth="8"
        fill="transparent"
        animationDuration=".5s"
        :aria-label="$t('common.loading')"
      />
    </template>

    <template #paginatorstart>
      <Button
        type="button"
        :icon="loading ? 'pi pi-spin pi-refresh' : 'pi pi-refresh'"
        text
        :aria-label="$t('common.refresh')"
        @click="emit('refresh')"
      />
    </template>
    <template #paginatorend>
      <Button type="button" icon="pi pi-download" text :aria-label="$t('common.export')" @click="exportCSV" />
    </template>

    <Column :header="'#'" headerStyle="width:3rem">
      <template #body="slotProps">
        {{ numberOf ? numberOf(slotProps.data, slotProps.index) : (page - 1) * rows + slotProps.index + 1 }}
      </template>
    </Column>

    <slot />

    <!-- Forwarded so a caller can use DataTable's row grouping (rowGroupMode="subheader")
         through this wrapper; without it the group header renders empty. -->
    <template v-if="$slots.groupheader" #groupheader="slotProps">
      <slot name="groupheader" v-bind="slotProps" />
    </template>

    <template v-if="$slots.empty" #empty>
      <slot name="empty" />
    </template>
  </DataTable>
</template>

<style scoped>
/* Keep cells on one line so wide datasets push the table past the container width and
 * trigger the DataTable's built-in horizontal scroll, instead of wrapping (ตกแถว). */
:deep(.p-datatable-thead > tr > th),
:deep(.p-datatable-tbody > tr > td) {
  white-space: nowrap;
}
</style>
