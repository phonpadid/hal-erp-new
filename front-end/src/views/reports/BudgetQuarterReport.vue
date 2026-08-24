<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import TreeTable from 'primevue/treetable';
import { computed, onMounted } from 'vue';
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
      pct: d.yearUtilizationPct,
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
        pct: b.yearUtilizationPct,
        overspent: b.overspent,
        overspentBelow: false,
        isDepartment: false,
      },
    })),
  })),
);

const tiles = computed<StatTile[]>(() => {
  const d = report.value?.departments ?? [];
  const year = d.reduce((s, x) => s + x.quarters.reduce((a, q) => a + Number(q.consumed), 0), 0);
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
  const pct = q.changePct ?? 0;
  return `${pct > 0 ? '+' : ''}${pct}%`;
};
const changeTone = (q: QuarterFigure): string =>
  q.noComparison ? 'text-muted-color' : (q.changePct ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.budgetQuarter')" :subtitle="report ? $t('reports.budgetQuarter.asOf', { date: report.asOf, year: report.year }) : undefined" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reports.loadBudgetByQuarter()" />

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <EmptyState v-if="!reports.loading && !hasData" icon="pi pi-calendar" :title="$t('reports.budgetQuarter.empty')" />
    <ReportCard v-else :title="$t('reports.budgetQuarter.title')">
      <TreeTable :value="nodes" :loading="reports.loading" class="text-sm" data-testid="quarter-tree">
        <Column field="name" :header="$t('reports.budgetQuarter.department')" expander style="min-width: 18rem">
          <template #body="{ node }">
            <span :class="node.data.isDepartment ? 'font-semibold' : ''">{{ node.data.name }}</span>
            <!-- A budget of nothing that has been spent against. Said in words: a bar at 0% is what
                 this looked like before, and 0% reads as untouched. -->
            <Tag v-if="node.data.overspent && node.data.pct === null" severity="danger" class="ml-2" data-testid="no-budget">
              {{ $t('reports.budgetQuarter.noBudget') }}
            </Tag>
            <Tag
              v-else-if="node.data.overspentBelow"
              severity="warn"
              class="ml-2"
              data-testid="overspent-below"
            >
              {{ $t('reports.budgetQuarter.overspentBelow') }}
            </Tag>
          </template>
        </Column>
        <Column :header="$t('reports.budgetQuarter.annual')" bodyClass="text-right! tabular-nums" headerClass="justify-end">
          <template #body="{ node }">{{ fmtBase(node.data.amountTotal) }}</template>
        </Column>
        <Column v-for="i in 4" :key="i" :header="`Q${i}`" bodyClass="text-right! tabular-nums" headerClass="justify-end" style="min-width: 11rem">
          <template #body="{ node }">
            <div class="flex flex-col items-end" :data-testid="`q${i}`">
              <span>{{ fmtBase(node.data.quarters[i - 1].consumed) }}</span>
              <span class="text-xs" :class="changeTone(node.data.quarters[i - 1])">
                {{ changeLabel(node.data.quarters[i - 1]) }}
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
      </TreeTable>
    </ReportCard>
  </div>
</template>
