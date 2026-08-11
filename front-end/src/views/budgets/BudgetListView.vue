<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Column from 'primevue/column';
import ProgressBar from 'primevue/progressbar';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useBudgetsStore } from '../../stores/budgets';
import type { BudgetSummary } from '../../api/budgets';
import { formatAmount } from '../../utils/money';

const router = useRouter();
const budgets = useBudgetsStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// Format money to the budget's company base-currency decimal_places (money rule), not a
// hardcoded 2 — correct for 0-decimal (JPY) and 3-decimal (KWD) currencies.
const decimalsOf = (row: BudgetSummary) => row.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2;

/**
 * Rows flattened out of the store's groups, each tagged with the group it belongs to so the table
 * can render a subheader. Ordering follows the groups, which is what DataTable's row grouping
 * requires; the ungoverned bucket sorts last because the store appends it.
 */
const rows = computed(() =>
  budgets.groupedBudgets.flatMap((g) =>
    g.budgets.map((b) => ({ ...b, __groupKey: g.key, __group: g })),
  ),
);

// The header's figures come from the control point, which covers the WHOLE governed set — including
// budgets on other pages. Nothing here adds up the visible children.
const groupOf = (row: any) => row.__group;

/**
 * Columns the table renders: the seven declared below plus the `#` column AppDataTable injects.
 *
 * PrimeVue hardcodes the row-group header cell to `columnsLength - 1`, which leaves the last column
 * with no cell at all — and a browser does not paint a row's background where no cell exists, so
 * the header band stopped short of the table's right edge. Overriding the colspan is the only way
 * to close it. A spec asserts this equals the real column count, so adding a column fails a test
 * instead of quietly going ragged again.
 */
const TOTAL_COLUMNS = 8;

const isOverdrawn = (available?: string) => available !== undefined && Number(available) < 0;

/**
 * How full a group is, as a percentage of its ceiling. Derived for DISPLAY only — the amounts
 * themselves stay strings; this never feeds a decision, the server's ladder does that.
 * A zero ceiling means anything spent is already past it.
 */
function usedPctOf(group: any): number {
  const cp = group.controlPoint;
  if (!cp) return 0;
  const ceiling = Number(cp.ceiling);
  const used = Number(cp.used);
  if (!ceiling) return used > 0 ? 100 : 0;
  return Math.round((used / ceiling) * 1000) / 10;
}

// Same thresholds the utilization report uses, so "amber means nearly full" reads the same
// wherever a user meets it.
/**
 * The value handed to ProgressBar. Floored just above zero because PrimeVue skips the label
 * entirely at `value === 0`, which would blank the figures on a group nothing has been spent from.
 * The true percentage is what the text and `aria-valuenow` report.
 */
const fillValue = (group: any) => Math.max(Math.min(usedPctOf(group), 100), 0.0001);

const utilColor = (pct: number) => (pct > 100 ? 'red' : pct >= 80 ? 'yellow' : 'green');

onMounted(async () => {
  // Both halves of the list: the budgets, and the control points they group under.
  await Promise.all([budgets.loadList(), budgets.loadControlPoints()]);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('budgets.list.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button
          v-can="'BUDGET_MANAGE'"
          :label="$t('budgets.form.createTitle')"
          icon="pi pi-plus"
          size="small"
          @click="router.push({ name: 'budget-new' })"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadList()" />

    <div v-else class="card">
      <AppDataTable
        :value="rows"
        :total="budgets.total"
        :loading="budgets.loading"
        :page="budgets.page"
        :rows="budgets.limit"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['budgetName', 'glAccount']"
        rowGroupMode="subheader"
        groupRowsBy="__groupKey"
        scrollHeight="500px"
        :pt="{ rowGroupHeaderCell: { colspan: TOTAL_COLUMNS } }"
        @page="(e: { page: number; limit: number }) => budgets.loadList(e.page, e.limit)"
        @refresh="budgets.loadList()"
        @row-click="(e: any) => router.push({ name: 'budget-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetName" :header="$t('common.name')"><template #body="{ data }">{{ data.budgetName ?? $t('common.none') }}</template></Column>
        <Column field="glAccount" :header="$t('budgets.list.gl')" />
        <Column :header="$t('budgets.list.fiscalYear')"><template #body="{ data }">{{ data.fiscalYear?.year ?? $t('common.none') }}</template></Column>
        <Column :header="$t('budgets.list.department')"><template #body="{ data }">{{ data.department?.name ?? $t('common.none') }}</template></Column>
        <!-- Status sits with the other descriptive columns, before the money. Everything from here
             right is amounts, so the table ends in one unbroken money block — and because the group
             header spans the whole row, its own figures then land against the same right edge as
             the children's, instead of stopping a column short. -->
        <Column :header="$t('common.status')"><template #body="{ data }"><Tag :value="$t('budgets.status.' + data.status)" :severity="data.status === 'ACTIVE' ? 'success' : 'secondary'" /></template></Column>
        <!-- Money right-aligned with tabular figures so digits line up down the column and two
             budgets can be compared at a glance — the house pattern from ReadyToPayView and
             SettlementsView. -->
        <Column :header="$t('common.total')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ data }">{{ formatAmount(data.amountTotal, decimalsOf(data)) }}</template>
        </Column>
        <Column :header="$t('budgets.list.available')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ data }">
            <!-- A line spent past its own amount is the number the whole screen is about; it must
                 not read the same as a healthy one. -->
            <span :class="isOverdrawn(data.available) ? 'text-red-600 dark:text-red-400 font-semibold' : ''">
              {{ formatAmount(data.available, decimalsOf(data)) }}
            </span>
          </template>
        </Column>
        <!-- The group header is a CONTROL POINT, not a budget: no status chip, no link to a
             budget detail, not selectable. It holds no money of its own — rendering it as another
             budget line would put back the parent/child confusion the data model avoids. -->
        <template #groupheader="{ data }">
          <div class="flex items-center justify-between gap-4 py-1">
            <div v-if="groupOf(data).ungoverned" class="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold">
              <i class="pi pi-exclamation-triangle" />
              <span>{{ $t('budgets.groups.ungoverned') }}</span>
              <span class="font-normal text-sm text-muted-color">{{ $t('budgets.groups.ungovernedHint') }}</span>
            </div>
            <template v-else>
              <RouterLink
                class="text-primary no-underline hover:underline font-semibold flex-1 min-w-0 truncate"
                :to="{ name: 'control-point-detail', params: { id: groupOf(data).controlPoint.id } }"
              >
                {{ groupOf(data).controlPoint.accountNodeCode }} ·
                {{ groupOf(data).controlPoint.accountNodeName }}
                <span class="font-normal text-muted-color">
                  / {{ groupOf(data).controlPoint.departmentNodeCode }}
                </span>
            
              </RouterLink>
              <!-- One block to read instead of four: the figures sit INSIDE the bar, so how full
                   and how much are the same glance.

                   Two pass-throughs make that safe. PrimeVue puts the label inside
                   `.p-progressbar-value`, which is `position: absolute; overflow: hidden`, so the
                   text is clipped to the filled width — 20px at 6%. Making the value `static` hands
                   the positioning back to `.p-progressbar` (already `position: relative`), so the
                   label can span the whole track at any percentage.

                   The value is also floored just above zero because the label is skipped entirely
                   when `value === 0` (progressbar/index.mjs), which would blank the figures on every
                   untouched group. `aria-valuenow` is set back to the true percentage so the
                   accessible value stays honest. -->
              <ProgressBar
                :value="fillValue(groupOf(data))"
                class="w-96 h-7 shrink-0"
                :pt="{
                  root: {
                    'aria-valuenow': usedPctOf(groupOf(data)),
                    // The component paints its own track, which is lighter than the row and
                    // washed the figures out. Only the fill should be visible here.
                    style: { background: 'transparent' },
                  },
                  value: {
                    style: {
                      position: 'static',
                      overflow: 'visible',
                      // Translucency has to live in the COLOUR, not in `opacity`: the label is a
                      // child of this element, so an opacity here would fade the figures with it —
                      // which is exactly what it did, to 18% white on a dark row.
                      background: `color-mix(in srgb, var(--p-${utilColor(usedPctOf(groupOf(data)))}-500) 22%, transparent)`,
                    },
                  },
                  label: { class: 'absolute inset-0 flex items-center justify-end gap-3 pl-2 whitespace-nowrap' },
                }"
              >
                <span
                  class="text-sm font-semibold tabular-nums w-14 text-right shrink-0"
                  :style="{ color: `var(--p-${utilColor(usedPctOf(groupOf(data)))}-600)` }"
                >{{ usedPctOf(groupOf(data)) }}%</span>
                <span class="text-sm text-muted-color shrink-0">{{ $t('budgets.groups.wholeGroup') }}</span>
                <!-- Fixed slot: without it a short pair like "200,000 / 200,000" pulls the figures
                     right and a long one pushes it left, and the column goes ragged again. -->
                <span class="text-color font-semibold tabular-nums shrink-0 w-64 text-right">
                  {{ formatAmount(groupOf(data).controlPoint.available, decimalsOf(data)) }}
                  <span class="font-normal text-muted-color">
                    / {{ formatAmount(groupOf(data).controlPoint.ceiling, decimalsOf(data)) }}
                  </span>
                </span>
              </ProgressBar>
            </template>
          </div>
        </template>
        <template #empty>
          <EmptyState icon="pi pi-wallet" :title="$t('budgets.list.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>

<style scoped>
/* The grouping has to be legible without reading the colour: a tinted header band with children
 * indented under it. Without this a child row looks identical to an ungrouped one — which is how
 * the hierarchy got lost in the source spreadsheet in the first place.
 *
 * Semantic PrimeVue tokens, not surface-100/800 pairs: these already flip with the theme, so there
 * is no second rule to keep in sync and no way for light and dark to drift apart. */
:deep(.p-datatable-tbody > tr.p-datatable-row-group-header) {
  background: var(--p-content-hover-background);
  border-top: 1px solid var(--p-content-border-color);
}

/* Children sit under their group header. */
:deep(.p-datatable-tbody > tr:not(.p-datatable-row-group-header) > td:first-child) {
  padding-left: 1.75rem;
}
</style>
