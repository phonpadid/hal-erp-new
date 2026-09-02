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
import { cloneVNode, ref, type VNode, useAttrs, useSlots } from 'vue';

defineOptions({ inheritAttrs: false });
// Read explicitly: the guard below inspects what a caller passed through rather than declared.
const attrs = useAttrs();

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
    /**
     * Page on the CLIENT rather than the server, for a caller that already holds every row —
     * a table whose `total` is the length of its own array.
     *
     * `lazy` is what makes PrimeVue delegate filtering and paging to the server, and it is wrong
     * for such a caller: the filter bindings it passes are ignored, so its search box does
     * nothing. With this set the component keeps `lazy` off and PrimeVue filters and pages the
     * rows it was given — which, because that IS the whole set, searches the whole set.
     */
    clientPaged?: boolean;
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

/**
 * Column priority. A caller marks a column `data-priority="secondary"` when it is not what a
 * reader triages a row on; below `md` those columns are hidden and reachable through a per-row
 * expander instead. Declared once, on the column: this wrapper derives both the hiding and the
 * expander content from the same attribute, so the two can never disagree.
 *
 * Horizontal scroll alone was the whole responsive story before this. At 375px the documents
 * list showed two of its eight columns with nothing to say the other six existed.
 */
const slots = useSlots();

function flattenSlot(nodes: VNode[]): VNode[] {
  return nodes.flatMap((n) => (Array.isArray(n.children) ? flattenSlot(n.children as VNode[]) : [n]));
}

// Plain functions, deliberately not computeds. A slot function returns fresh vnodes on every
// call, so a computed over one never settles: reading it during render re-invokes the slot,
// which invalidates the computed, which re-renders. That loop is what "Maximum recursive
// updates exceeded" looks like from the outside.
const priorityOf = (n: VNode) =>
  n.type === Column ? (n.props?.["data-priority"] as string | undefined) : undefined;
const isSecondary = (n: VNode) => priorityOf(n) === "secondary";

function secondaryColumns(): VNode[] {
  return flattenSlot(slots.default?.() ?? []).filter(isSecondary);
}
function hasSecondary(): boolean {
  return secondaryColumns().length > 0;
}

/**
 * The caller's columns, with a secondary one hidden below `md`. Derived here rather than asked
 * of the caller, so `data-priority` stays the single declaration: PrimeVue does not forward an
 * unknown attribute to the th/td, but it does forward `class`.
 */
function renderedColumns(): VNode[] {
  return flattenSlot(slots.default?.() ?? []).map((n) => {
    const priority = priorityOf(n);
    if (priority === "secondary") return cloneVNode(n, { class: "hidden md:table-cell" });
    // The column that identifies the row — a document number, a code. Under the fixed layout
    // used below `md` every column would otherwise take an equal share, which is too little
    // for an identifier and leaves it stacking a character per line.
    if (priority === "identity") return cloneVNode(n, { class: "w-[45%] md:w-auto" });
    return n;
  });
}

/** Header text of a secondary column, for its label in the expanded row. */
function headerOf(n: VNode): string {
  const h = n.props?.header;
  return typeof h === "string" ? h : "";
}
/** Render a secondary column's cell for one row: its #body slot, or the raw field value. */
function cellOf(n: VNode, data: any, index: number) {
  const body = (n.children as any)?.body;
  if (typeof body === "function") return body({ data, index, field: n.props?.field });
  const field = n.props?.field;
  return field ? String(data?.[field] ?? "") : "";
}

/**
 * This table is `lazy` unless the caller sets `clientPaged`, and PrimeVue ignores
 * `filters` / `globalFilterFields` in that mode
 * — it delegates filtering to the server and expects a `@filter` handler. Passing them here is
 * therefore silent decoration: the approval inbox shipped a search box that filtered nothing
 * because of exactly this, and the mistake is invisible from the call site.
 *
 * Say so at the boundary. A caller that wants filtering either sends the term to its own store and
 * refetches — the way the documents list and the inbox do — or, if it already holds every row it
 * will ever show, sets `clientPaged` and lets PrimeVue do it.
 */
if (import.meta.env.DEV && !props.clientPaged) {
  const stray = ['filters', 'globalFilterFields'].filter((k) => (attrs as Record<string, unknown>)[k] !== undefined);
  if (stray.length) {
    console.error(
      `[AppDataTable] ${stray.join(' and ')} passed to a lazy table — PrimeVue ignores ` +
        'client-side filtering when `lazy` is set, so this control would filter nothing. ' +
        'Send the term to the server and refetch instead.',
    );
  }
}

const expandedRows = ref<any[]>([]);

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
    :lazy="!clientPaged"
    paginator
    scrollable
    :scrollHeight="scrollHeight"
    :rows="rows"
    :first="(page - 1) * rows"
    :totalRecords="total"
    :loading="loading"
    :rowsPerPageOptions="rowsPerPageOptions"
    v-model:expandedRows="expandedRows"
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

    <!-- Below `md` only: the handle onto the columns this width cannot carry. -->
    <Column v-if="hasSecondary()" expander class="md:hidden" headerStyle="width:3rem" />

    <component v-for="(col, i) in renderedColumns()" :key="i" :is="col" />

    <template v-if="hasSecondary()" #expansion="{ data, index }">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 py-2 text-sm md:hidden">
        <template v-for="(col, i) in secondaryColumns()" :key="i">
          <dt class="text-muted-color">{{ headerOf(col) }}</dt>
          <dd class="m-0"><component :is="() => cellOf(col, data, index)" /></dd>
        </template>
      </dl>
    </template>

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

/* Below `md` the nowrap above works against the point of hiding columns: one long document
 * number then eats the whole viewport and pushes the primary columns off-screen anyway. At
 * this width the columns that remain are the few a reader triages on, so let them wrap and
 * fit rather than scroll. `md` is Tailwind's 768px. */
@media (max-width: 767.98px) {
  :deep(.p-datatable-thead > tr > th),
  :deep(.p-datatable-tbody > tr > td) {
    /* `normal` only. `word-break: break-word` breaks between any two characters, which stacks a
     * document number one letter per line and does the same to a Lao header — Lao is written
     * without spaces, so it has no other break opportunity to fall back on. Left at `normal`, a
     * hyphenated document number breaks at its hyphens and Lao keeps its line.
     *
     * `overflow-wrap: anywhere` is the backstop for the one case that leaves: a token with no
     * break opportunity that is still wider than its column, which under fixed layout would
     * otherwise bleed across the cell beside it. It breaks only where nothing else will,
     * unlike `word-break`, which breaks between any two characters and stacks Lao one letter
     * per line. */
    white-space: normal;
  }

  /* The backstop applies to body cells only. A Lao header is a single token with no break
   * opportunity, so `anywhere` sets it one character per line; a header is short enough to
   * ride slightly wide instead. */
  :deep(.p-datatable-tbody > tr > td) {
    overflow-wrap: anywhere;
  }

  /* Auto layout gives a long document number whatever width it asks for, which pushes the other
   * primary columns off-screen — hiding four columns then buys nothing. Fixed layout makes the
   * remaining columns share the viewport instead; `#` and the expander keep their declared 3rem
   * and the rest split what is left. */
  :deep(.p-datatable-table) {
    table-layout: fixed;
    width: 100%;
    min-width: 0;
  }
}

/* An expanded row is the one place cells must wrap: it exists to carry the columns this
 * width cannot, so nowrap would push it straight back off-screen. */
:deep(.p-datatable-row-expansion > td) {
  white-space: normal;
}

</style>
