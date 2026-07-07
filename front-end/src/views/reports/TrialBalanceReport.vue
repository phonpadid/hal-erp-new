<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useFinancialReportsStore } from '../../stores/financialReports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import type { TrialBalanceAccount } from '../../api/financialReports';

const store = useFinancialReportsStore();
const router = useRouter();
const { fmtBase } = useCurrencyFormat();
const from = ref<Date | null>(null);
const to = ref<Date | null>(null);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function reload() {
  store.loadTrialBalance(iso(from.value), iso(to.value));
}
// Reload as soon as either date is picked or cleared — no Apply button needed.
watch([from, to], reload);
onMounted(reload);
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.trialBalance.title')" />

    <PageToolbar>
      <template #filters>
        <DatePicker v-model="from" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.financial.from')" />
        <DatePicker v-model="to" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.financial.to')" />
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error" :message="store.error" @retry="reload" />

    <div v-else class="card">
      <DataTable :value="store.trialBalance?.accounts ?? []" :loading="store.loading" dataKey="accountId" class="text-sm">
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('reports.financial.type')"><template #body="{ data }">{{ $t(`admin.accounting.types.${data.accountType}`) }}</template></Column>
        <Column :header="$t('reports.financial.debit')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ Number(data.debit) ? fmtBase(data.debit) : '' }}</span></template>
        </Column>
        <Column :header="$t('reports.financial.credit')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ Number(data.credit) ? fmtBase(data.credit) : '' }}</span></template>
        </Column>
        <Column :header="$t('reports.financial.balance')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums font-medium">{{ fmtBase(data.balance) }}</span></template>
        </Column>
        <Column headerStyle="width:3rem">
          <template #body="{ data }">
            <Button
              icon="pi pi-search"
              text
              size="small"
              :aria-label="$t('reports.trialBalance.viewLedger')"
              @click="router.push({ name: 'report-account-ledger', params: { accountId: (data as TrialBalanceAccount).accountId } })"
            />
          </template>
        </Column>
        <template #footer>
          <div v-if="store.trialBalance" class="flex items-center justify-between px-2">
            <Tag
              :severity="store.trialBalance.balanced ? 'success' : 'danger'"
              :value="store.trialBalance.balanced ? $t('reports.financial.balanced') : $t('reports.financial.unbalanced')"
            />
            <div class="flex gap-6 tabular-nums">
              <span>{{ $t('reports.financial.totalDebit') }}: <b>{{ fmtBase(store.trialBalance.totalDebit) }}</b></span>
              <span>{{ $t('reports.financial.totalCredit') }}: <b>{{ fmtBase(store.trialBalance.totalCredit) }}</b></span>
            </div>
          </div>
        </template>
        <template #empty><EmptyState icon="pi pi-list" :title="$t('reports.financial.empty')" /></template>
      </DataTable>
    </div>
  </div>
</template>
