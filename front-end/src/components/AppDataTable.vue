<script setup lang="ts">
/**
 * Shared list table (web-app-layout: Scrollable Paginated Data Table). Wraps PrimeVue
 * DataTable in lazy mode: it shows the server's current page, binds `total` to the
 * paginator, and emits `{ page, limit }` when the user pages so the caller refetches.
 * Scrollable at a fixed height (default 500px), a ProgressSpinner while loading, a refresh
 * control in the paginator, and a leading `#` row-number column. Caller passes its own
 * <Column>s via the default slot; extra DataTable props (filters, rowHover, …) pass through.
 * Below `md` the fixed-height scroll box and the `#` column both give way to the page's own
 * scroll — see the column-priority note below and the stylesheet at the foot of this file.
 */
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import { cloneVNode, ref, type VNode, useAttrs, useSlots, watchEffect } from 'vue';

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
 * Column priority. A caller marks each column with what it is FOR, and this wrapper derives the
 * narrow-width layout from that one declaration, so hiding and expanding can never disagree:
 *
 *   (unmarked)  — primary: shown at every width.
 *   "identity"  — the column that names the row. Gets a fixed share below `md` so a document
 *                 number is not squeezed into the equal slice fixed layout would otherwise give.
 *   "secondary" — not what a reader triages on. Hidden below `md`, reached through a per-row
 *                 expander that lists header and value for each.
 *   "actions"   — what the row is acted on with. Kept at every width, but icon-only and narrow
 *                 below `md`.
 *
 * Horizontal scroll alone was the whole responsive story before this. At 375px the documents
 * list showed two of its eight columns with nothing to say the other six existed — and a table
 * that marks nothing at all (the approval inbox, until this was applied to it) gives all nine
 * columns an equal slice of the viewport, which stacks Lao headers one character per line.
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
 * Does this table declare priorities at all? Only a table whose columns say what they are FOR
 * can be re-laid-out below `md`; an unmarked one keeps the plain table it has always been, so
 * marking up a view is what opts it in and nothing changes underneath the 33 that have not.
 */
function hasPriorities(): boolean {
  return flattenSlot(slots.default?.() ?? []).some((n) => priorityOf(n) !== undefined);
}

/** A string, quoted and escaped for use as a CSS `content` value. */
function cssString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Add one declaration to whatever `bodyStyle` the caller already passed. PrimeVue accepts either
 * a string or an object there, and callers use both.
 */
function withBodyStyle(existing: unknown, prop: string, value: string): string | Record<string, string> {
  if (existing && typeof existing === "object") return { ...(existing as Record<string, string>), [prop]: value };
  const prefix = typeof existing === "string" && existing.trim() ? `${existing.replace(/;\s*$/, "")};` : "";
  return `${prefix}${prop}:${value}`;
}

/**
 * The caller's columns, tagged by what each is for. Derived here rather than asked of the caller,
 * so `data-priority` stays the single declaration: PrimeVue does not forward an unknown attribute
 * to the th/td, but it does forward `class` — and `bodyStyle`, which is how a detail cell carries
 * its own header text down to the stylesheet as a custom property.
 */
function renderedColumns(): VNode[] {
  const cols = flattenSlot(slots.default?.() ?? []);
  if (!cols.some((n) => priorityOf(n) !== undefined)) return cols;
  return cols.map((n) => {
    const priority = priorityOf(n);
    // Not what a reader triages on: gone below `md`, reachable through the row's expander.
    if (priority === "secondary") return cloneVNode(n, { class: "hidden md:table-cell app-col-secondary" });
    // The column that identifies the row — a document number, a code. It leads the card below `md`.
    if (priority === "identity") return cloneVNode(n, { class: "app-col-identity" });
    // The column that ACTS on the row. It has to survive every width, because a queue you can read
    // but not act on is not an inbox — so it is pinned to the card's trailing edge, icon-only.
    if (priority === "actions") return cloneVNode(n, { class: "app-col-actions" });
    // Everything else primary: shown under the identity line, labelled with its own header, because
    // the card layout hides the header row and a bare number with nothing to name it is a riddle.
    const label = headerOf(n);
    return cloneVNode(n, {
      class: "app-col-detail",
      ...(label ? { bodyStyle: withBodyStyle(n.props?.bodyStyle, "--app-col-label", cssString(label)) } : {}),
    });
  });
}

/**
 * What to call a column when its value is shown away from the header row — in the expanded row,
 * or as the label on a card's detail cell.
 *
 * `data-label` first, for a column that renders its header through a `#header` slot: PrimeVue
 * renders BOTH the `header` prop and the slot when given both, so a column cannot simply also
 * declare a plain `header` to be read here without printing its title twice.
 */
function headerOf(n: VNode): string {
  const label = n.props?.["data-label"] ?? n.props?.header;
  return typeof label === "string" ? label : "";
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

/**
 * `clientPaged` is only ever correct for a caller that HOLDS every row — and the tell is exact:
 * its `total` is its own array's length. When the two disagree, the caller is server-paged, `lazy`
 * has been turned off underneath it, and PrimeVue is now counting pages from the twenty rows it
 * was handed instead of the eighty-five the server reported. The pager collapses to one page and
 * every row past the first page becomes unreachable — silently, because the rows that ARE shown
 * look perfectly right.
 *
 * That shipped on the RBAC users table. Checked here rather than left to review, because the
 * mistake is one word long and invisible in the diff that makes it.
 */
if (import.meta.env.DEV && props.clientPaged) {
  watchEffect(() => {
    if (props.total !== props.value.length) {
      console.error(
        `[AppDataTable] clientPaged is set, but total (${props.total}) is not the number of rows ` +
          `given (${props.value.length}). That means this table is SERVER-paged and holds one ` +
          'page: off `lazy`, its pager will show a single page and hide every other row. Drop ' +
          '`clientPaged` and send the search term to the server instead.',
      );
    }
  });
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
    :class="{ 'app-mobile-cards': hasPriorities(), 'app-mobile-indent': hasSecondary() }"
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

    <!-- The row ordinal is desktop-only: below `md` it is not what anyone triages on, and the
         3rem it holds is 3rem the identifying column does not have. The expander takes its
         place as the narrow leading column at those widths. -->
    <Column :header="'#'" headerStyle="width:3rem" class="hidden md:table-cell">
      <template #body="slotProps">
        {{ numberOf ? numberOf(slotProps.data, slotProps.index) : (page - 1) * rows + slotProps.index + 1 }}
      </template>
    </Column>

    <!-- Below `md` only: the handle onto the columns this width cannot carry. -->
    <Column v-if="hasSecondary()" expander class="md:hidden app-col-expander" headerStyle="width:3rem" />

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

/* An expanded row is the one place cells must wrap: it exists to carry the columns this
 * width cannot, so nowrap would push it straight back off-screen. */
:deep(.p-datatable-row-expansion > td) {
  white-space: normal;
}

/* ---------------------------------------------------------------------------------------
 * Phone widths. `md` is Tailwind's 768px.
 *
 * A table is a grid of columns sharing one width, and below about 400px there is no share
 * that works: nine columns of a 375px viewport is 30px each, and Lao — written without
 * spaces — has no break opportunity inside a word, so a 30px column sets its header one
 * character per line. That is not a wrapping bug to tune; it is a table asking for width
 * the screen does not have.
 *
 * So below `md` a marked-up table stops being a grid of columns and becomes a list of
 * cards: each row is a flex box that lays out as
 *
 *     [▸] IDENTITY …………………………………………… [✓]
 *         label value · label value
 *
 * — the identifying column on its own line, the remaining primary columns wrapping beneath
 * it under their own header text, the action pinned to the trailing edge, and the expander
 * leading. No column has to fit a share of the width any more; each takes what it needs and
 * the row grows a line when it has to. That holds at 320px as well as at 430px.
 *
 * Only a table that declares `data-priority` gets this (`.app-mobile-cards`) — an unmarked
 * one has not said which column identifies the row, and a card with no heading and no column
 * headers above it would be worse than the cramped table it replaced. */
@media (max-width: 767.98px) {
  /* --- Tables that have NOT been marked up: the old behaviour, minus the wasted padding. --- */
  :deep(.p-datatable-thead > tr > th),
  :deep(.p-datatable-tbody > tr > td) {
    /* `normal` only. `word-break: break-word` breaks between any two characters, which stacks a
     * document number one letter per line and does the same to a Lao header. Left at `normal`, a
     * hyphenated document number breaks at its hyphens and Lao keeps its line. */
    white-space: normal;
    /* PrimeVue's desktop cell padding is 0.75rem 1rem. Five columns of it spend 160px of a 375px
     * viewport on empty space, and every pixel spent here is a pixel the text must break to fit. */
    padding: 0.5rem 0.375rem;
  }

  /* The backstop for the one case `normal` leaves: a token with no break opportunity that is
   * still wider than its column, which would otherwise bleed across the cell beside it. It
   * breaks only where nothing else will. Body cells only — a Lao header is a single token, so
   * `anywhere` would set it one character per line; a header rides slightly wide instead. */
  :deep(.p-datatable-tbody > tr > td) {
    overflow-wrap: anywhere;
  }

  /* Nested scroll is why a phone user could not reach the approve button: the table held its own
   * 500px scroll box inside a page that also scrolls, and a touch drag starting on a row moves
   * the inner box — which, once it hits its end, swallows the gesture rather than handing it to
   * the page. On a phone the page scroll is the only one worth having, so let the table grow to
   * its rows and scroll with the document. */
  :deep(.p-datatable-table-container) {
    max-height: none !important;
    overflow: visible;
  }

  /* PrimeVue makes the header sticky for a scrollable table. With the container's own scroll
   * gone (above), "sticky" now means sticky to the viewport, and the header rides up over the
   * page as it scrolls. Only an unmarked table still has a header row at this width. */
  :deep(.p-datatable-thead > tr > th) {
    position: static;
  }

  /* Refresh, first/prev/next/last, the page numbers, the rows-per-page select and export do not
   * fit one line at this width; unwrapped they overflow the card instead of stacking. */
  :deep(.p-paginator) {
    flex-wrap: wrap;
    row-gap: 0.25rem;
    padding: 0.5rem 0.25rem;
  }

  /* --- Marked-up tables: one card per row. --- */

  /* The header row names columns that no longer exist as columns; each value carries its own
   * label instead (see `--app-col-label` below). */
  .app-mobile-cards :deep(.p-datatable-thead) {
    display: none;
  }

  /* Blocks all the way down, so no anonymous table box is left to impose a column grid on the
   * flex rows. */
  .app-mobile-cards :deep(.p-datatable-table),
  .app-mobile-cards :deep(.p-datatable-tbody) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .app-mobile-cards :deep(.p-datatable-tbody > tr:not(.p-datatable-row-expansion, .p-datatable-empty-message, .p-rowgroup-header)) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 0.5rem;
    row-gap: 0.125rem;
    padding: 0.625rem 0.25rem;
    border-bottom: 1px solid var(--p-datatable-body-cell-border-color, var(--p-content-border-color));
  }

  /* The expansion row is a card of its own, full width, under the row it belongs to; so is the
   * empty message, which otherwise inherits the flex row's centring from PrimeVue's own rules. */
  .app-mobile-cards :deep(.p-datatable-row-expansion),
  .app-mobile-cards :deep(.p-datatable-empty-message) {
    display: block;
  }
  .app-mobile-cards :deep(.p-datatable-row-expansion > td),
  .app-mobile-cards :deep(.p-datatable-empty-message > td) {
    display: block;
    width: 100% !important;
  }

  /* `:not(.hidden)` is load-bearing: this selector is more specific than Tailwind's `.hidden`,
   * so without it `display: block` would win and every secondary column — and the row ordinal —
   * would come back at exactly the width they were hidden for. */
  .app-mobile-cards :deep(.p-datatable-tbody > tr > td:not(.hidden)) {
    display: block;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100%;
    padding: 0;
    border: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  /* Order, not DOM order: the action sits at the trailing edge of the first line whatever
   * position the caller declared it in, and the detail cells wrap beneath the identity. */
  .app-mobile-cards :deep(.app-col-expander) {
    order: 0;
    flex: 0 0 auto;
  }
  .app-mobile-cards :deep(.app-col-identity) {
    order: 1;
    flex: 1 1 8rem;
    font-weight: 600;
  }
  .app-mobile-cards :deep(.app-col-actions) {
    order: 2;
    flex: 0 0 auto;
    margin-inline-start: auto;
  }
  .app-mobile-cards :deep(.app-col-detail) {
    order: 3;
    flex: 0 1 auto;
    font-size: 0.8125rem;
    /* A right-aligned amount is right-aligned against a column edge that no longer exists; in a
     * card it reads as label-then-value like everything beside it. */
    text-align: start !important;
  }
  /* The first detail cell opens the second line; the rest sit beside it until they run out of
   * room. `order` alone cannot force a wrap, so the break is an empty flex item at full width. */
  .app-mobile-cards :deep(.p-datatable-tbody > tr:not(.p-datatable-row-expansion, .p-datatable-empty-message, .p-rowgroup-header))::after {
    content: "";
    order: 2;
    flex: 0 0 100%;
    height: 0;
  }

  /* Hang the expander into the card's left margin, so the detail line starts under the document
   * number rather than under the chevron. Only when there IS an expander — a table with no
   * secondary columns has nothing in that gutter to align around. */
  .app-mobile-cards.app-mobile-indent :deep(.p-datatable-tbody > tr:not(.p-datatable-row-expansion, .p-datatable-empty-message, .p-rowgroup-header)) {
    padding-inline-start: 2.5rem;
  }
  .app-mobile-cards.app-mobile-indent :deep(.app-col-expander) {
    margin-inline-start: -2.5rem;
  }

  /* Each detail value names itself, because the header row is gone. The text arrives from the
   * column's own `header`, stamped onto the cell as a custom property by `renderedColumns()`. */
  .app-mobile-cards :deep(.app-col-detail)::before {
    content: var(--app-col-label, "");
    margin-inline-end: 0.375rem;
    color: var(--p-text-muted-color, var(--text-color-secondary));
    font-weight: 400;
  }
  /* A label beside the icon needs ~7rem and the card has no such width to spare on the trailing
   * edge — which is what put "ອະນຸມັດ" on two lines inside a button barely wider than its own
   * tick. Drop to the icon; `title` / `aria-label` carry the name. */
  :deep(.app-col-actions .p-button-label) {
    display: none;
  }
  :deep(.app-col-actions .p-button) {
    padding-inline: 0.625rem;
  }
  :deep(.app-col-actions .p-button .p-button-icon) {
    margin: 0;
  }
}
</style>
