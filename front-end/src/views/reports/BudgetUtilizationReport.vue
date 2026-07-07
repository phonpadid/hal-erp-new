<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import ProgressBar from 'primevue/progressbar';
import { computed, onMounted } from 'vue';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { sumAmounts } from '../../utils/money';
import BarChart from '@/components/charts/BarChart.vue';
import ReportCard from '@/components/reports/ReportCard.vue';
import StatTiles, { type StatTile } from '@/components/reports/StatTiles.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useI18n } from 'vue-i18n';

const reports = useReportsStore();
const { fmtBase, baseCode } = useCurrencyFormat();
const { t } = useI18n();

onMounted(() => reports.loadBudgetUtilization());

const rows = computed(() => reports.utilization);
const hasData = computed(() => rows.value.length > 0);

const tiles = computed<StatTile[]>(() => {
  const r = rows.value;
  const avg = r.length ? Math.round((r.reduce((a, x) => a + x.utilizationPct, 0) / r.length) * 10) / 10 : 0;
  const over = r.filter((x) => x.utilizationPct > 100).length;
  return [
    { label: t('reports.budgetUtilization.kpiAvg'), value: `${avg}%`, icon: 'pi-gauge', tone: avg > 90 ? 'danger' : 'primary' },
    { label: t('reports.budgetUtilization.kpiOver'), value: over, icon: 'pi-exclamation-triangle', tone: over ? 'danger' : 'success' },
    { label: t('reports.budgetUtilization.kpiAllocated'), value: fmtBase(sumAmounts(r.map((x) => x.amountTotal))), icon: 'pi-wallet', tone: 'info' },
    { label: t('reports.budgetUtilization.kpiConsumed'), value: fmtBase(sumAmounts(r.map((x) => x.consumed))), icon: 'pi-dollar', tone: 'warn' },
  ];
});

// Horizontal bar of utilization % by department, highest first.
const chart = computed(() => ({
  labels: rows.value.map((r) => r.departmentName),
  datasets: [{ label: '%', data: rows.value.map((r) => r.utilizationPct) }],
}));

// Traffic-light color (PrimeUI palette name) for a utilization figure.
const utilColor = (pct: number) => (pct > 100 ? 'red' : pct >= 80 ? 'yellow' : 'green');
const fmtPct = (v: number) => `${Math.round(v * 10) / 10}%`;
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.budgetUtilization')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reports.loadBudgetUtilization()" />

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <EmptyState v-if="!reports.loading && !hasData" icon="pi pi-wallet" :title="$t('reports.budgetUtilization.empty')" />
    <template v-else>
      <ReportCard :title="$t('reports.budgetUtilization.chartTitle')" :subtitle="$t('reports.budgetUtilization.hint', { currency: baseCode() })" icon="pi-chart-bar">
        <BarChart :labels="chart.labels" :datasets="chart.datasets" horizontal :format-value="fmtPct" />
      </ReportCard>

      <ReportCard :title="$t('reports.budgetUtilization.detail')" icon="pi-table">
        <DataTable :value="rows" :loading="reports.loading" class="text-sm" dataKey="departmentId" removableSort>
          <template #empty><EmptyState :title="$t('reports.budgetUtilization.empty')" /></template>
          <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
          <Column field="departmentName" :header="$t('reports.budgetUtilization.department')" sortable />
          <Column :header="$t('reports.budgetUtilization.amountTotal')" sortable sortField="amountTotal"><template #body="{ data }">{{ fmtBase(data.amountTotal) }}</template></Column>
          <Column :header="$t('reports.budgetUtilization.consumed')" sortable sortField="consumed"><template #body="{ data }">{{ fmtBase(data.consumed) }}</template></Column>
          <Column :header="$t('reports.budgetUtilization.available')" sortable sortField="available"><template #body="{ data }">{{ fmtBase(data.available) }}</template></Column>
          <Column :header="$t('reports.budgetUtilization.utilization')" sortable sortField="utilizationPct" style="min-width: 12rem">
            <template #body="{ data }">
              <div class="flex items-center gap-2">
                <ProgressBar :value="Math.min(data.utilizationPct, 100)" :show-value="false" class="flex-1 h-2" :pt="{ value: { style: { background: `var(--p-${utilColor(data.utilizationPct)}-500)` } } }" />
                <span class="text-sm font-semibold tabular-nums w-14 text-right" :style="{ color: `var(--p-${utilColor(data.utilizationPct)}-600)` }">{{ data.utilizationPct }}%</span>
              </div>
            </template>
          </Column>
        </DataTable>
      </ReportCard>
    </template>
  </div>
</template>
