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
        @page="(e: { page: number; limit: number }) => budgets.loadList(e.page, e.limit)"
        @refresh="budgets.loadList()"
        @row-click="(e: any) => router.push({ name: 'budget-detail', params: { id: e.data.id } })"
      >
        <Column field="budgetName" :header="$t('common.name')"><template #body="{ data }">{{ data.budgetName ?? $t('common.none') }}</template></Column>
        <Column field="glAccount" :header="$t('budgets.list.gl')" />
        <Column :header="$t('budgets.list.fiscalYear')"><template #body="{ data }">{{ data.fiscalYear?.year ?? $t('common.none') }}</template></Column>
        <Column :header="$t('budgets.list.department')"><template #body="{ data }">{{ data.department?.name ?? $t('common.none') }}</template></Column>
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
        <Column :header="$t('common.status')"><template #body="{ data }"><Tag :value="$t('budgets.status.' + data.status)" :severity="data.status === 'ACTIVE' ? 'success' : 'secondary'" /></template></Column>
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
                class="text-primary no-underline hover:underline font-semibold shrink-0"
                :to="{ name: 'control-point-detail', params: { id: groupOf(data).controlPoint.id } }"
              >
                {{ groupOf(data).controlPoint.accountNodeCode }} ·
                {{ groupOf(data).controlPoint.accountNodeName }}
                <span class="font-normal text-muted-color">
                  / {{ groupOf(data).controlPoint.departmentNodeCode }}
                </span>
              </RouterLink>
              <!-- The ceiling decides whether every row below it can be submitted, so it reads at
                   least as loudly as a child's amount, not as trailing small print. The bar is the
                   fastest answer to "how full is this" — the same idiom the utilization report uses. -->
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <!-- The bar takes the slack between the name and the amounts: this row is mostly
                     empty otherwise, and a longer track is a finer-grained read of how full the
                     group is. Everything after it is shrink-0 so the bar is what absorbs resizing. -->
                <ProgressBar
                  :value="Math.min(usedPctOf(groupOf(data)), 100)"
                  :show-value="false"
                  class="flex-1 min-w-16 h-2"
                  :pt="{ value: { style: { background: `var(--p-${utilColor(usedPctOf(groupOf(data)))}-500)` } } }"
                />
                <span
                  class="text-sm font-semibold tabular-nums w-14 text-right shrink-0"
                  :style="{ color: `var(--p-${utilColor(usedPctOf(groupOf(data)))}-600)` }"
                >{{ usedPctOf(groupOf(data)) }}%</span>
                <span class="text-sm text-muted-color shrink-0">{{ $t('budgets.groups.wholeGroup') }}</span>
                <span class="font-semibold tabular-nums shrink-0">
                  {{ formatAmount(groupOf(data).controlPoint.available, decimalsOf(data)) }}
                  <span class="font-normal text-muted-color">
                    / {{ formatAmount(groupOf(data).controlPoint.ceiling, decimalsOf(data)) }}
                  </span>
                </span>
              </div>
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
