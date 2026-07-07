<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { exportReportCsv } from '../../api/reports';
import { formatDate } from '../../utils/date';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';

const reports = useReportsStore();
const router = useRouter();
const { fmtBase } = useCurrencyFormat();
const from = ref<Date | null>(null);
const to = ref<Date | null>(null);
// Paginator offset so the # column keeps counting across pages (body-slot index is page-local).
const first = ref(0);

// txn-type tint: increases/in green, decreases/out/reserve/actual red, release/neutral.
const SEVERITY: Record<string, string> = {
  ADJUST_INCREASE: 'success', TRANSFER_IN: 'success', RELEASE: 'info',
  ADJUST_DECREASE: 'danger', TRANSFER_OUT: 'danger', RESERVE: 'warn', ACTUAL: 'contrast',
};
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function load() {
  reports.loadBudgetAudit({ from: iso(from.value), to: iso(to.value) });
}
onMounted(load);

// Reload as soon as either date is picked or cleared — no Apply button needed.
watch([from, to], () => load());
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.tabs.budgetAudit')" />
    <ErrorState v-if="reports.error" :message="reports.error" @retry="load()" />
    <PageToolbar>
      <template #filters>
        <DatePicker v-model="from" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.budgetAudit.from')" />
        <DatePicker v-model="to" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.budgetAudit.to')" />
      </template>
      <template #actions>
        <Button :label="$t('reports.export')" icon="pi pi-download" severity="secondary" outlined :disabled="!reports.audit.length" @click="exportReportCsv('budget-audit', { from: iso(from), to: iso(to) })" />
      </template>
    </PageToolbar>
    <DataTable :value="reports.audit" :loading="reports.loading" dataKey="id" class="text-sm" paginator :rows="20" v-model:first="first">
      <template #empty><EmptyState :title="$t('reports.budgetAudit.empty')" /></template>
      <Column header="#" class="w-12"><template #body="{ index }">{{ first + index + 1 }}</template></Column>
      <Column :header="$t('reports.budgetAudit.when')"><template #body="{ data }">{{ formatDate(data.createdAt) }}</template></Column>
      <Column :header="$t('reports.budgetAudit.type')"><template #body="{ data }"><Tag :severity="SEVERITY[data.txnType] ?? 'secondary'" :value="data.txnType" /></template></Column>
      <Column field="departmentName" :header="$t('reports.budgetAudit.department')" />
      <Column field="category" :header="$t('reports.budgetAudit.category')" />
      <Column :header="$t('reports.budgetAudit.amount')"><template #body="{ data }">{{ fmtBase(data.amount) }}</template></Column>
      <Column :header="$t('reports.budgetAudit.document')">
        <template #body="{ data }">
          <a v-if="data.documentId" class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.documentNo }}</a>
          <span v-else class="text-muted-color">—</span>
        </template>
      </Column>
      <Column field="actorName" :header="$t('reports.budgetAudit.by')"><template #body="{ data }">{{ data.actorName ?? '—' }}</template></Column>
      <Column field="remark" :header="$t('reports.budgetAudit.remark')"><template #body="{ data }">{{ data.remark ?? '—' }}</template></Column>
    </DataTable>
  </div>
</template>
