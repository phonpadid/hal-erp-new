<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import { formatDate } from '@/utils/date';
import { useFinancialReportsStore } from '../../stores/financialReports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';

const route = useRoute();
const router = useRouter();
const store = useFinancialReportsStore();
const { fmtBase } = useCurrencyFormat();

onMounted(() => store.loadLedger(route.params.accountId as string));
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.accountLedger.title')" />

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadLedger(route.params.accountId as string)" />

    <div v-else class="card">
      <div v-if="store.ledger?.account" class="mb-3 text-sm font-medium text-color">
        {{ store.ledger.account.code }} — {{ store.ledger.account.name }}
      </div>
      <DataTable :value="store.ledger?.lines ?? []" :loading="store.loading" dataKey="lineId" class="text-sm">
        <Column :header="$t('reports.financial.date')"><template #body="{ data }">{{ formatDate(data.entryDate) }}</template></Column>
        <Column :header="$t('gl.journal.columns.source')">
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <Tag :value="data.sourceType" severity="secondary" />
              <a
                v-if="data.sourceDocNo"
                class="cursor-pointer text-primary"
                @click="router.push({ name: 'document-detail', params: { id: data.sourceId } })"
              >{{ data.sourceDocNo }}</a>
            </div>
          </template>
        </Column>
        <Column :header="$t('reports.financial.debit')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums text-green-600 dark:text-green-400">{{ Number(data.debit) ? fmtBase(data.debit) : '' }}</span></template>
        </Column>
        <Column :header="$t('reports.financial.credit')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums text-red-600 dark:text-red-400">{{ Number(data.credit) ? fmtBase(data.credit) : '' }}</span></template>
        </Column>
        <Column :header="$t('reports.financial.runningBalance')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums font-medium">{{ fmtBase(data.runningBalance) }}</span></template>
        </Column>
        <template #empty><EmptyState icon="pi pi-list" :title="$t('reports.financial.empty')" /></template>
      </DataTable>
    </div>
  </div>
</template>
