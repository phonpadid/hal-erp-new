<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Button from 'primevue/button';
import { computed, onMounted, ref, watch } from 'vue';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { exportReportCsv } from '../../api/reports';
import { sumAmounts } from '../../utils/money';
import ParetoChart from '@/components/charts/ParetoChart.vue';
import ReportCard from '@/components/reports/ReportCard.vue';
import StatTiles, { type StatTile } from '@/components/reports/StatTiles.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useI18n } from 'vue-i18n';

const reports = useReportsStore();
const { fmtBase } = useCurrencyFormat();
const { t } = useI18n();
const from = ref<Date | null>(null);
const to = ref<Date | null>(null);
// Paginator offset so the # column keeps counting across pages (body-slot index is page-local).
const first = ref(0);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function load() {
  reports.loadSpendByVendor({ from: iso(from.value), to: iso(to.value) });
}
onMounted(load);

// Reload as soon as either date is picked or cleared — no Apply button needed.
watch([from, to], () => load());

const hasData = computed(() => reports.spend.length > 0);

const tiles = computed<StatTile[]>(() => {
  const s = reports.spend;
  const top = s[0];
  return [
    { label: t('reports.spendByVendor.kpiTotal'), value: fmtBase(sumAmounts(s.map((r) => r.baseTotal))), icon: 'pi-dollar', tone: 'success' },
    { label: t('reports.spendByVendor.kpiVendors'), value: s.length, icon: 'pi-building', tone: 'primary' },
    { label: t('reports.spendByVendor.kpiTop'), value: top?.vendorName ?? '—', icon: 'pi-crown', tone: 'warn' },
    { label: t('reports.spendByVendor.kpiTopShare'), value: top ? `${top.cumulativePct}%` : '—', icon: 'pi-percentage', tone: 'info' },
  ];
});

// Cap the Pareto to the top 12 vendors for legibility; the table shows all.
const pareto = computed(() => {
  const rows = reports.spend.slice(0, 12);
  return {
    labels: rows.map((r) => r.vendorName),
    bars: rows.map((r) => Number(r.baseTotal)),
    cumulative: rows.map((r) => r.cumulativePct),
  };
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.spendByVendor')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="load()" />

    <PageToolbar>
      <template #filters>
        <DatePicker v-model="from" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.spendByVendor.from')" />
        <DatePicker v-model="to" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.spendByVendor.to')" />
      </template>
      <template #actions>
        <Button :label="$t('reports.export')" icon="pi pi-download" severity="secondary" outlined :disabled="!hasData" @click="exportReportCsv('spend-by-vendor', { from: iso(from), to: iso(to) })" />
      </template>
    </PageToolbar>

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <!-- Four branches, not two. `v-if="!loading && !hasData"` with a bare `v-else` put the chart
         on screen while the request was still in flight: both sides of the condition were false,
         so the data branch mounted, and the chart initialised against a canvas about to be torn
         down — which is what `can't acquire context` was. It also drew a chart as though the
         request had returned. -->
    <div v-if="reports.loading" class="py-12 text-center text-muted-color">
      {{ $t('common.loading') }}
    </div>
    <EmptyState
      v-else-if="!hasData"
      icon="pi pi-shopping-cart"
      :title="$t('reports.spendByVendor.empty')"
      :message="$t('reports.spendByVendor.emptyHint')"
    />
    <template v-else>
      <ReportCard :title="$t('reports.spendByVendor.chartTitle')" :subtitle="$t('reports.spendByVendor.hint')" icon="pi-chart-bar">
        <ParetoChart :labels="pareto.labels" :bars="pareto.bars" :cumulative="pareto.cumulative" :bar-label="$t('reports.spendByVendor.spend')" :line-label="$t('reports.spendByVendor.cumulative')" :format-value="(v: number) => fmtBase(String(v))" />
      </ReportCard>

      <ReportCard :title="$t('reports.spendByVendor.detail')" icon="pi-table">
        <DataTable :value="reports.spend" :loading="reports.loading" class="text-sm" dataKey="vendorId" paginator :rows="20" v-model:first="first" removableSort>
          <template #empty
            ><EmptyState
              :title="$t('reports.spendByVendor.empty')"
              :message="$t('reports.spendByVendor.emptyHint')" /></template>
          <Column header="#" class="w-12"><template #body="{ index }">{{ first + index + 1 }}</template></Column>
          <Column field="vendorName" :header="$t('reports.spendByVendor.vendor')" sortable />
          <Column field="count" :header="$t('reports.spendByVendor.count')" sortable />
          <Column :header="$t('reports.spendByVendor.spend')" sortable sortField="baseTotal">
            <template #body="{ data }"><span class="font-medium">{{ fmtBase(data.baseTotal) }}</span></template>
          </Column>
          <Column field="cumulativePct" :header="$t('reports.spendByVendor.cumulative')" sortable>
            <template #body="{ data }">{{ data.cumulativePct }}%</template>
          </Column>
        </DataTable>
      </ReportCard>
    </template>
  </div>
</template>
