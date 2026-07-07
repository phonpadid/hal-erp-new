<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useReportsStore } from '../../stores/reports';
import BarChart from '@/components/charts/BarChart.vue';
import ReportCard from '@/components/reports/ReportCard.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';

const reports = useReportsStore();
const router = useRouter();
const { t } = useI18n();

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
}

onMounted(() => reports.loadApprovalAging());

// Pending count by workflow step — where approvals pile up.
const stepChart = computed(() => {
  const steps = reports.aging?.byStep ?? [];
  return {
    labels: steps.map((s) => `${s.stepNo}${s.stepName ? ' · ' + s.stepName : ''}`),
    datasets: [{ label: t('reports.approvalAging.pending'), data: steps.map((s) => s.pendingCount) }],
  };
});
const hasSteps = computed(() => (reports.aging?.byStep.length ?? 0) > 0);
const fmtCount = (v: number) => String(Math.round(v));
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.tabs.approvalAging')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="reports.loadApprovalAging()" />
    <p class="text-muted-color text-sm mb-3">{{ $t('reports.approvalAging.hint') }}</p>

    <ReportCard v-if="hasSteps" :title="$t('reports.approvalAging.byStep')" icon="pi-chart-bar" class="mb-4">
      <BarChart :labels="stepChart.labels" :datasets="stepChart.datasets" :format-value="fmtCount" />
    </ReportCard>

    <!-- Bottleneck roll-ups — each in its own card; equal height via a fixed 400px scroll body. -->
    <div v-if="reports.aging" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 mt-4">
      <ReportCard :title="$t('reports.approvalAging.byApprover')" icon="pi-users">
        <DataTable :value="reports.aging.byApprover" dataKey="approverId" class="text-sm" scrollable scrollHeight="400px">
          <template #empty><EmptyState :title="$t('reports.approvalAging.empty')" /></template>
          <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
          <Column field="approverName" :header="$t('reports.approvalAging.approver')" />
          <Column field="pendingCount" :header="$t('reports.approvalAging.pending')" />
          <Column :header="$t('reports.approvalAging.oldest')"><template #body="{ data }">{{ fmtHours(data.oldestAgeHours) }}</template></Column>
        </DataTable>
      </ReportCard>
      <ReportCard :title="$t('reports.approvalAging.byStep')" icon="pi-sitemap">
        <DataTable :value="reports.aging.byStep" dataKey="stepNo" class="text-sm" scrollable scrollHeight="400px">
          <template #empty><EmptyState :title="$t('reports.approvalAging.empty')" /></template>
          <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
          <Column field="stepNo" :header="$t('reports.approvalAging.step')" />
          <Column field="stepName" :header="$t('reports.approvalAging.stepName')" />
          <Column field="pendingCount" :header="$t('reports.approvalAging.pending')" />
          <Column :header="$t('reports.approvalAging.oldest')"><template #body="{ data }">{{ fmtHours(data.oldestAgeHours) }}</template></Column>
        </DataTable>
      </ReportCard>
    </div>

    <!-- Per-document detail. -->
    <ReportCard :title="$t('reports.approvalAging.detail')" icon="pi-table">
      <DataTable :value="reports.aging?.rows ?? []" :loading="reports.loading" dataKey="documentId" class="text-sm" sortField="ageHours" :sortOrder="-1">
        <template #empty><EmptyState :title="$t('reports.approvalAging.empty')" /></template>
        <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
        <Column :header="$t('reports.approvalAging.docNo')">
          <template #body="{ data }">
            <a class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.docNo }}</a>
          </template>
        </Column>
        <Column :header="$t('reports.approvalAging.type')"><template #body="{ data }">{{ data.documentType.name }}</template></Column>
        <Column field="requesterName" :header="$t('reports.approvalAging.requester')" />
        <Column :header="$t('reports.approvalAging.step')"><template #body="{ data }">{{ data.currentStepNo }}{{ data.stepName ? ' · ' + data.stepName : '' }}</template></Column>
        <Column :header="$t('reports.approvalAging.waitingOn')">
          <template #body="{ data }">{{ data.approvers.map((a: { username: string }) => a.username).join(', ') || '—' }}</template>
        </Column>
        <Column :header="$t('reports.approvalAging.age')"><template #body="{ data }">{{ fmtHours(data.ageHours) }}</template></Column>
        <Column :header="$t('reports.approvalAging.inStep')"><template #body="{ data }">{{ fmtHours(data.timeInStepHours) }}</template></Column>
        <Column :header="$t('reports.approvalAging.sla')">
          <template #body="{ data }">
            <Tag v-if="data.overdue" severity="danger" :value="$t('reports.approvalAging.overdue')" />
            <Tag v-else-if="data.slaDueAt" severity="info" :value="$t('reports.approvalAging.onTime')" />
            <span v-else class="text-muted-color">—</span>
          </template>
        </Column>
      </DataTable>
    </ReportCard>
  </div>
</template>
