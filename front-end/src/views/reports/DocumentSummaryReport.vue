<script setup lang="ts">
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import DatePicker from "primevue/datepicker";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { computed, onMounted, ref, watch } from "vue";
import { useReportsStore } from "../../stores/reports";
import { useCurrencyFormat } from "../../composables/useCurrencyFormat";
import { useChartTheme } from "../../composables/useChartTheme";
import { exportReportCsv } from "../../api/reports";
import { sumAmounts } from "../../utils/money";
import BarChart from "@/components/charts/BarChart.vue";
import DonutChart from "@/components/charts/DonutChart.vue";
import ReportCard from "@/components/reports/ReportCard.vue";
import StatTiles, { type StatTile } from "@/components/reports/StatTiles.vue";
import ErrorState from "@/components/ErrorState.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useI18n } from "vue-i18n";

const reports = useReportsStore();
const { fmtBase } = useCurrencyFormat();
const { t, te } = useI18n();
const { themeTick, severityColor } = useChartTheme();

// Document statuses share the canonical labels in documents.status.* (same keys the
// document views use). Fall back to the raw code for any status without a translation.
const statusLabel = (s: string) =>
  te("documents.status." + s) ? t("documents.status." + s) : s;

// Tag severity per status — drives both the table Tag color and the chart segment color so
// the charts read the same as the table (a REJECTED bar/slice is the same red as its Tag).
const STATUS_SEVERITY: Record<string, string> = {
  DRAFT: "secondary",
  SUBMITTED: "info",
  IN_APPROVAL: "warn",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "contrast",
  COMPLETED: "success",
};
const statusColor = (s: string) =>
  severityColor(STATUS_SEVERITY[s] ?? "secondary");
const from = ref<Date | null>(null);
const to = ref<Date | null>(null);
// Paginator offset so the # column keeps counting across pages (body-slot index is page-local).
const first = ref(0);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function load() {
  reports.loadDocumentSummary({ from: iso(from.value), to: iso(to.value) });
}
onMounted(load);

// Reload as soon as either date is picked or cleared — no Apply button needed.
watch([from, to], () => load());

const rows = computed(() => reports.documents?.rows ?? []);
const hasData = computed(() => rows.value.length > 0);

// KPI tiles: totals across the current result set.
const tiles = computed<StatTile[]>(() => {
  const r = rows.value;
  const byStatus = reports.documents?.byStatus ?? [];
  return [
    {
      label: t("reports.documentSummary.kpiDocs"),
      value: r.reduce((a, x) => a + x.count, 0),
      icon: "pi-file",
      tone: "primary",
    },
    {
      label: t("reports.documentSummary.kpiValue"),
      value: fmtBase(sumAmounts(r.map((x) => x.baseTotal))),
      icon: "pi-dollar",
      tone: "success",
    },
    {
      label: t("reports.documentSummary.kpiTypes"),
      value: new Set(r.map((x) => x.typeCode)).size,
      icon: "pi-tags",
      tone: "info",
    },
    {
      label: t("reports.documentSummary.kpiStatuses"),
      value: byStatus.length,
      icon: "pi-sliders-h",
      tone: "warn",
    },
  ];
});

// Statuses present, in a stable order — shared by the bar segments and their colors so the
// color array stays index-aligned to the datasets.
const statuses = computed(() => [...new Set(rows.value.map((r) => r.status))]);

// Stacked bar: one bar per document type, one stacked segment per status (counts).
// Grouped by type id and labelled by the type's configured name — `typeCode` is a per-company
// code (`PR`, `BUDGET_PLAN`), so labelling by it shows the chart's axis a different word from
// the table directly below it.
const typeChart = computed(() => {
  const seen = new Map<string, string>();
  for (const r of rows.value) if (!seen.has(r.documentTypeId)) seen.set(r.documentTypeId, r.typeName);
  const typeIds = [...seen.keys()];
  return {
    labels: typeIds.map((id) => seen.get(id)!),
    datasets: statuses.value.map((st) => ({
      label: statusLabel(st),
      data: typeIds.map((id) =>
        rows.value
          .filter((r) => r.documentTypeId === id && r.status === st)
          .reduce((a, r) => a + r.count, 0),
      ),
    })),
  };
});
// Bar segment colors, one per status dataset (depends on themeTick so it re-resolves on toggle).
const typeChartColors = computed(() => {
  void themeTick.value;
  return statuses.value.map(statusColor);
});

const statusDonut = computed(() => {
  const bs = reports.documents?.byStatus ?? [];
  return {
    labels: bs.map((s) => statusLabel(s.status)),
    data: bs.map((s) => s.count),
  };
});
// Donut slice colors, one per byStatus slice, in the same order.
const statusDonutColors = computed(() => {
  void themeTick.value;
  return (reports.documents?.byStatus ?? []).map((s) => statusColor(s.status));
});

const fmtCount = (v: number) => String(Math.round(v));
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="$t('reports.tabs.documentSummary')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="load()" />

    <PageToolbar>
      <template #filters>
        <DatePicker
          v-model="from"
          dateFormat="dd-mm-yy"
          showIcon
          showClear
          iconDisplay="input"
          :placeholder="$t('reports.documentSummary.from')"
        />
        <DatePicker
          v-model="to"
          dateFormat="dd-mm-yy"
          showIcon
          iconDisplay="input"
          showClear
          :placeholder="$t('reports.documentSummary.to')"
        />
      </template>
      <template #actions>
        <Button
          :label="$t('reports.export')"
          icon="pi pi-download"
          severity="secondary"
          outlined
          :disabled="!hasData"
          @click="
            exportReportCsv('document-summary', { from: iso(from), to: iso(to) })
          "
        />
      </template>
    </PageToolbar>

    <StatTiles :tiles="tiles" :loading="reports.loading" />

    <EmptyState
      v-if="!reports.loading && !hasData"
      icon="pi pi-inbox"
      :title="$t('reports.documentSummary.empty')"
    />
    <template v-else>
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ReportCard
          :title="$t('reports.documentSummary.byType')"
          icon="pi-chart-bar"
        >
          <BarChart
            :labels="typeChart.labels"
            :datasets="typeChart.datasets"
            :colors="typeChartColors"
            stacked
            :format-value="fmtCount"
          />
        </ReportCard>
        <ReportCard
          :title="$t('reports.documentSummary.byStatus')"
          icon="pi-chart-pie"
        >
          <DonutChart
            :labels="statusDonut.labels"
            :data="statusDonut.data"
            :colors="statusDonutColors"
            :format-value="fmtCount"
          />
        </ReportCard>
      </div>

      <ReportCard :title="$t('reports.documentSummary.detail')" icon="pi-table">
        <DataTable
          :value="rows"
          :loading="reports.loading"
          class="text-sm"
          :rowKey="(r: any) => r.documentTypeId + r.status"
          removableSort
          paginator
          :rows="20"
          :rowsPerPageOptions="[10, 20, 50, 100]"
          v-model:first="first"
        >
          <template #empty
            ><EmptyState :title="$t('reports.documentSummary.empty')"
          /></template>
          <Column header="#" class="w-12">
            <template #body="{ index }">{{ first + index + 1 }}</template>
          </Column>
          <Column
            field="typeName"
            :header="$t('reports.documentSummary.type')"
            sortable
          />
          <Column
            field="categoryName"
            :header="$t('reports.documentSummary.category')"
            sortable
          />
          <Column
            field="status"
            :header="$t('reports.documentSummary.status')"
            sortable
          >
            <template #body="{ data }"
              ><Tag
                :severity="STATUS_SEVERITY[data.status] ?? 'secondary'"
                :value="statusLabel(data.status)"
            /></template>
          </Column>
          <Column
            field="count"
            :header="$t('reports.documentSummary.count')"
            sortable
          />
          <Column
            :header="$t('reports.documentSummary.baseTotal')"
            sortable
            sortField="baseTotal"
          >
            <template #body="{ data }">{{ fmtBase(data.baseTotal) }}</template>
          </Column>
        </DataTable>
      </ReportCard>
    </template>
  </div>
</template>
