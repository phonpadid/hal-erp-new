<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import TreeTable from 'primevue/treetable';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import ReportCard from '@/components/reports/ReportCard.vue';
import StatTiles, { type StatTile } from '@/components/reports/StatTiles.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import type { QuarterFigure } from '../../api/reports';

/**
 * Budget consumption by quarter, department first with the budgets beneath.
 *
 * Two rules from the design carry the whole screen. A quarter that has not ended is marked with how
 * much of it has passed, and is compared against the SAME window of the quarter before it — whole
 * comparison reads as a collapse that is only the calendar not having caught up. And a comparison
 * with nothing on one side is written in words: `−100%` on a line that pays an annual licence is
 * correct and useless, and a blank cell reads as "still loading".
 */
const reports = useReportsStore();
const { fmtBase } = useCurrencyFormat();
const { t } = useI18n();

onMounted(() => reports.loadBudgetByQuarter());

const report = computed(() => reports.quarters);
const hasData = computed(() => (report.value?.departments.length ?? 0) > 0);

/** Departments as parents, their budgets as children. */
const nodes = computed(() =>
  (report.value?.departments ?? []).map((d) => ({
    key: d.departmentId,
    data: {
      name: d.departmentName,
      amountTotal: d.amountTotal,
      quarters: d.quarters,
      yearConsumed: d.yearConsumed,
      remaining: d.remaining,
      pct: d.yearUtilizationPct,
      remainingPct: d.remainingPct,
      overspent: d.overspent,
      // A department can read healthy while a line beneath it has overspent — that is exactly how
      // the customer's own spreadsheet hides 31.6 billion kip: every department it rolls up into
      // still shows a positive remaining. The department carries the warning so nobody has to
      // expand twenty rows to find out.
      overspentBelow: d.budgets.some((b) => b.overspent),
      isDepartment: true,
    },
    children: d.budgets.map((b) => ({
      key: b.budgetId,
      data: {
        name: `${b.code} · ${b.budgetName}`,
        amountTotal: b.amountTotal,
        quarters: b.quarters,
        yearConsumed: b.yearConsumed,
        remaining: b.remaining,
        pct: b.yearUtilizationPct,
        remainingPct: b.remainingPct,
        overspent: b.overspent,
        overspentBelow: false,
        isDepartment: false,
      },
    })),
  })),
);

const tiles = computed<StatTile[]>(() => {
  const d = report.value?.departments ?? [];
  const year = d.reduce((s, x) => s + Number(x.yearConsumed), 0);
  const over = d.filter((x) => x.overspent).length;
  const open = d[0]?.quarters.find((q) => !q.complete);
  return [
    { label: t('reports.budgetQuarter.kpiYear'), value: fmtBase(String(year)), icon: 'pi-dollar', tone: 'info' },
    {
      label: t('reports.budgetQuarter.kpiOpenQuarter'),
      value: open ? `Q${open.quarter} — ${open.elapsedDays}/${open.days}` : '—',
      icon: 'pi-hourglass',
      tone: 'primary',
    },
    { label: t('reports.budgetQuarter.kpiOverspent'), value: over, icon: 'pi-exclamation-triangle', tone: over ? 'danger' : 'success' },
  ];
});

/** The change cell: a percentage when there is one, and words when there is not. */
const changeLabel = (q: QuarterFigure): string => {
  if (q.noComparison === 'NOT_STARTED') return t('reports.budgetQuarter.notStarted');
  if (q.noComparison === 'NO_EARLIER_QUARTER') return t('reports.budgetQuarter.noEarlier');
  if (q.noComparison === 'STARTED') return t('reports.budgetQuarter.started');
  if (q.noComparison === 'STOPPED') return t('reports.budgetQuarter.stopped');
  if (q.noComparison === 'NO_ACTIVITY') return t('reports.budgetQuarter.noActivity');
  const pct = q.changePct ?? 0;
  return `${pct > 0 ? '+' : ''}${pct}%`;
};
const changeTone = (q: QuarterFigure): string =>
  q.noComparison ? 'text-muted-color' : (q.changePct ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

/**
 * Which quarters have their months open. Per quarter, not one switch for all four: twelve monthly
 * columns beside the quarter, share and year columns is a table nobody reads, and the question the
 * budget department actually asks is "which month of Q2".
 */
const openMonths = ref<Set<number>>(new Set());
const monthsOpen = (quarter: number): boolean => openMonths.value.has(quarter);
const toggleMonths = (quarter: number): void => {
  const next = new Set(openMonths.value);
  if (!next.delete(quarter)) next.add(quarter);
  openMonths.value = next;
};

/**
 * The classes every money and percentage column carries.
 *
 * The header alignment has to reach INSIDE the `th`: PrimeVue renders the label in a flex child,
 * `.p-treetable-column-header-content`, and the `th` itself is a `table-cell`, where
 * `justify-content` does nothing at all. Aligning the `th` looked right in the markup and left
 * every header hugging the left edge above right-aligned figures.
 */
const NUM_HEADER = '[&_.p-treetable-column-header-content]:justify-end whitespace-nowrap';
/**
 * Figures never wrap, and they sit against the right edge of the cell.
 *
 * The alignment has to reach inside the `td` for the same reason the header does: PrimeVue wraps
 * every body cell in `.p-treetable-body-cell-content`, a ROW flex container. Whatever the cell
 * renders becomes a flex item, which shrinks to its content and parks at the start — so
 * `text-align: right` on the `td` moved nothing, and the figures sat up to 106px short of the edge
 * while reporting `text-align: right` to anyone who only asked the computed style.
 */
const NUM_BODY =
  'text-right! tabular-nums whitespace-nowrap [&_.p-treetable-body-cell-content]:justify-end';

/** A share, or nothing. Never `0%`, which is what every reader takes for untouched. */
const pctLabel = (pct: number | null): string => (pct === null ? '—' : `${pct}%`);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.budgetQuarter')" :subtitle="report ? $t('reports.budgetQuarter.asOf', { date: report.asOf, year: report.year }) : undefined" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reports.loadBudgetByQuarter()" />

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <EmptyState v-if="!reports.loading && !hasData" icon="pi pi-calendar" :title="$t('reports.budgetQuarter.empty')" />
    <ReportCard v-else :title="$t('reports.budgetQuarter.title')">
      <!-- Scrollable so the department column can be frozen: PrimeVue only honours `frozen` on a
           scrollable table. The row is wide by design — four quarters, their months on demand and
           four year columns — and a figure whose row you can no longer name is not a figure. -->
      <TreeTable
        :value="nodes"
        :loading="reports.loading"
        scrollable
        scrollHeight="500px"
        showGridlines
        class="text-sm"
        data-testid="quarter-tree"
      >
        <Column
          field="name"
          :header="$t('reports.budgetQuarter.department')"
          expander
          frozen
          class="bg-surface-0! dark:bg-surface-900!"
          headerClass="whitespace-nowrap"
          style="min-width: 18rem; max-width: 18rem"
        >
          <!-- One line, cut with an ellipsis rather than wrapped. A wrapped name makes its row
               twice as tall as its neighbours, and the figures beside it stop lining up across the
               table. The whole name stays reachable on hover. -->
          <template #body="{ node }">
            <span
              class="block truncate"
              :class="node.data.isDepartment ? 'font-semibold' : ''"
              :title="node.data.name"
              >{{ node.data.name }}</span
            >
          </template>
        </Column>
        <!-- The warnings, in a column of their own. Sharing the name column made a long Lao label
             wrap the name it sat beside, so the one column a reader uses to find their row was the
             one the tag pushed around. -->
        <Column
          :header="$t('reports.budgetQuarter.status')"
          bodyClass="whitespace-nowrap"
          headerClass="whitespace-nowrap"
          style="min-width: 12rem"
        >
          <template #body="{ node }">
            <!-- A budget of nothing that has been spent against. Said in words: a bar at 0% is what
                 this looked like before, and 0% reads as untouched. -->
            <Tag v-if="node.data.overspent && node.data.pct === null" severity="danger" data-testid="no-budget">
              {{ $t('reports.budgetQuarter.noBudget') }}
            </Tag>
            <Tag v-else-if="node.data.overspentBelow" severity="warn" data-testid="overspent-below">
              {{ $t('reports.budgetQuarter.overspentBelow') }}
            </Tag>
            <!-- A row with nothing to warn about says so, rather than leaving a cell that reads as
                 "still loading". -->
            <span v-else class="text-muted-color" data-testid="status-none">—</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.annual')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">{{ fmtBase(node.data.amountTotal) }}</template>
        </Column>
        <!-- Each quarter: its three months when they are asked for, then the quarter itself —
             the order the customer's own sheet puts them in. -->
        <template v-for="i in 4" :key="i">
          <Column
            v-for="mi in monthsOpen(i) ? 3 : 0"
            :key="`q${i}m${mi}`"
            :header="$t('reports.budgetQuarter.month', { month: (i - 1) * 3 + mi })"
            :bodyClass="NUM_BODY"
            :headerClass="NUM_HEADER"
            style="min-width: 8rem"
          >
            <!-- An amount and nothing else. Every question about direction is answered by the
                 quarter that contains it; a monthly comparison would label far more than it says. -->
            <template #body="{ node }">
              <span :data-testid="`q${i}-m${mi}`" class="text-muted-color">
                {{ fmtBase(node.data.quarters[i - 1].months[mi - 1].consumed) }}
              </span>
            </template>
          </Column>
          <Column :bodyClass="NUM_BODY" :headerClass="NUM_HEADER" style="min-width: 11rem">
            <template #header>
              <span class="flex items-center gap-1">
                {{ `Q${i}` }}
                <button
                  type="button"
                  class="pi text-xs text-muted-color hover:text-color cursor-pointer"
                  :class="monthsOpen(i) ? 'pi-chevron-left' : 'pi-chevron-right'"
                  :title="$t(monthsOpen(i) ? 'reports.budgetQuarter.hideMonths' : 'reports.budgetQuarter.showMonths', { quarter: i })"
                  :aria-label="$t(monthsOpen(i) ? 'reports.budgetQuarter.hideMonths' : 'reports.budgetQuarter.showMonths', { quarter: i })"
                  :aria-expanded="monthsOpen(i)"
                  :data-testid="`q${i}-months-toggle`"
                  @click="toggleMonths(i)"
                />
              </span>
            </template>
            <template #body="{ node }">
              <div class="flex flex-col items-end whitespace-nowrap" :data-testid="`q${i}`">
                <span>{{ fmtBase(node.data.quarters[i - 1].consumed) }}</span>
                <span class="text-xs" :class="changeTone(node.data.quarters[i - 1])">
                  {{ changeLabel(node.data.quarters[i - 1]) }}
                </span>
                <!-- The quarter's share of the ANNUAL budget. `—` where there is no budget to take
                     a share of: `0%` is what every reader takes for untouched. -->
                <span class="text-xs text-muted-color" :data-testid="`q${i}-pct`">
                  {{ pctLabel(node.data.quarters[i - 1].utilizationPct) }}
                </span>
                <!-- An unfinished quarter is never presented as a whole one. -->
                <span
                  v-if="!node.data.quarters[i - 1].complete && node.data.quarters[i - 1].elapsedDays > 0"
                  class="text-xs text-muted-color"
                  :data-testid="`q${i}-partial`"
                >
                  {{ $t('reports.budgetQuarter.elapsed', { elapsed: node.data.quarters[i - 1].elapsedDays, days: node.data.quarters[i - 1].days }) }}
                </span>
              </div>
            </template>
          </Column>
        </template>
        <Column :header="$t('reports.budgetQuarter.yearConsumed')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="year-consumed">{{ fmtBase(node.data.yearConsumed) }}</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.remaining')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <!-- Left negative when overspent, and coloured for it. Flooring it at zero is how the
               customer's own sheet shows every department with something still left. -->
          <template #body="{ node }">
            <span
              data-testid="remaining"
              :class="Number(node.data.remaining) < 0 ? 'text-red-600 dark:text-red-400' : ''"
            >
              {{ fmtBase(node.data.remaining) }}
            </span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.yearPct')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="year-pct" class="text-muted-color">{{ pctLabel(node.data.pct) }}</span>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.remainingPct')" :bodyClass="NUM_BODY" :headerClass="NUM_HEADER">
          <template #body="{ node }">
            <span data-testid="remaining-pct" class="text-muted-color">
              {{ pctLabel(node.data.remainingPct) }}
            </span>
          </template>
        </Column>
      </TreeTable>
    </ReportCard>
  </div>
</template>
