<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted } from 'vue';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import BarChart from '@/components/charts/BarChart.vue';
import ReportCard from '@/components/reports/ReportCard.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useI18n } from 'vue-i18n';

const reports = useReportsStore();
const { fmtBase, baseCode } = useCurrencyFormat();
const { t } = useI18n();

onMounted(() => reports.loadBudgetBalance());

// Actual vs available by department (summed across categories) — a grouped bar over the groups.
const chart = computed(() => {
  const byDept = new Map<string, { name: string; actual: number; available: number }>();
  for (const g of reports.budgetGroups) {
    const e = byDept.get(g.departmentId) ?? { name: g.departmentName, actual: 0, available: 0 };
    e.actual += Number(g.actual);
    e.available += Number(g.available);
    byDept.set(g.departmentId, e);
  }
  const rows = [...byDept.values()];
  return {
    labels: rows.map((r) => r.name),
    datasets: [
      { label: t('reports.budgetBalance.actual'), data: rows.map((r) => r.actual) },
      { label: t('reports.budgetBalance.available'), data: rows.map((r) => r.available) },
    ],
  };
});
const hasData = computed(() => reports.budgetGroups.length > 0);
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.tabs.budgetBalance')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reports.loadBudgetBalance()" />
    <p class="text-muted-color text-sm mb-3">
      {{ $t('reports.budgetBalance.hint', { currency: baseCode() }) }}
    </p>
    <ReportCard v-if="hasData" :title="$t('reports.budgetBalance.chartTitle')" icon="pi-chart-bar" class="mb-4">
      <BarChart :labels="chart.labels" :datasets="chart.datasets" :format-value="(v: number) => fmtBase(String(v))" />
    </ReportCard>
    <!-- Grouped subtotals by department + category. -->
    <DataTable :value="reports.budgetGroups" :loading="reports.loading" dataKey="departmentId" class="text-sm" rowGroupMode="subheader" groupRowsBy="departmentName" sortField="departmentName" :sortOrder="1">
      <template #empty><EmptyState :title="$t('reports.budgetBalance.empty')" /></template>
      <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
      <Column field="departmentName" :header="$t('reports.budgetBalance.department')" />
      <Column field="category" :header="$t('reports.budgetBalance.category')" />
      <Column :header="$t('reports.budgetBalance.amountTotal')"><template #body="{ data }">{{ fmtBase(data.amountTotal) }}</template></Column>
      <Column :header="$t('reports.budgetBalance.reserved')"><template #body="{ data }">{{ fmtBase(data.reserved) }}</template></Column>
      <Column :header="$t('reports.budgetBalance.actual')"><template #body="{ data }">{{ fmtBase(data.actual) }}</template></Column>
      <Column :header="$t('reports.budgetBalance.released')"><template #body="{ data }">{{ fmtBase(data.released) }}</template></Column>
      <Column :header="$t('reports.budgetBalance.available')"><template #body="{ data }"><span class="font-semibold">{{ fmtBase(data.available) }}</span></template></Column>
    </DataTable>
  </div>
</template>
