<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useApprovalsStore } from '../../stores/approvals';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { formatDate } from '../../utils/date';

const router = useRouter();
const approvals = useApprovalsStore();
const { fmtBase } = useCurrencyFormat();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

onMounted(() => approvals.loadPending());
</script>

<template>
  <div>
    <PageHeader :title="$t('approvals.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event" />

    <ErrorState v-if="approvals.error" :message="approvals.error" @retry="approvals.loadPending()" />

    <div v-else class="card">
      <AppDataTable
        :value="approvals.pending"
        :total="approvals.total"
        :loading="approvals.loading"
        :page="approvals.page"
        :rows="approvals.limit"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['docNo', 'requesterName']"
        @page="(e: { page: number; limit: number }) => approvals.loadPending(e.page, e.limit)"
        @refresh="approvals.loadPending()"
        @row-click="(e: any) => router.push({ name: 'document-detail', params: { id: e.data.id } })"
      >
        <Column field="docNo" :header="$t('approvals.columns.docNo')" />
        <Column :header="$t('approvals.columns.type')"><template #body="{ data }">{{ data.documentType?.name }}</template></Column>
        <Column field="requesterName" :header="$t('approvals.columns.requester')" />
        <Column :header="$t('approvals.columns.baseTotal')"><template #body="{ data }">{{ data.baseTotalAmount != null ? fmtBase(data.baseTotalAmount) : '—' }}</template></Column>
        <Column field="currentStepNo" :header="$t('approvals.columns.step')" />
        <Column :header="$t('approvals.columns.submitted')"><template #body="{ data }">{{ formatDate(data.submittedAt) }}</template></Column>
        <Column :header="$t('approvals.columns.sla')">
          <template #body="{ data }">
            <Tag v-if="data.overdue" severity="danger" :value="$t('approvals.overdue')" />
            <span v-else-if="data.slaDueAt" class="text-muted-color text-sm">{{ formatDate(data.slaDueAt) }}</span>
            <span v-else class="text-muted-color text-sm">—</span>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('approvals.empty')" />
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
