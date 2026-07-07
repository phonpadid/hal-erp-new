<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import ErrorState from '@/components/ErrorState.vue';
import { useFinancialReportsStore } from '../../stores/financialReports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import type { StatementRow } from '../../api/financialReports';

const store = useFinancialReportsStore();
const { fmtBase } = useCurrencyFormat();
const asOf = ref<Date | null>(null);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function reload() {
  store.loadBalanceSheet(iso(asOf.value));
}
watch(asOf, reload);
onMounted(reload);

const section = (rows: StatementRow[]) => rows;
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.balanceSheet.title')" />

    <PageToolbar>
      <template #filters>
        <!-- <label class="self-center text-sm text-muted-color">{{ $t('reports.balanceSheet.asOf') }}</label> -->
        <DatePicker v-model="asOf" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.balanceSheet.asOf')" />
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error" :message="store.error" @retry="reload" />

    <div v-else-if="store.balanceSheet" class="flex flex-col gap-4">
      <Message :severity="store.balanceSheet.balanced ? 'success' : 'error'" size="small" icon="pi pi-info-circle" class="leading-relaxed">
        {{ store.balanceSheet.balanced ? $t('reports.balanceSheet.balancedNote') : $t('reports.balanceSheet.unbalancedNote') }}
        {{ $t('reports.balanceSheet.derivedNote') }}
      </Message>

      <div class="card">
        <h2 class="mb-2 font-semibold text-color">{{ $t('reports.balanceSheet.assets') }}</h2>
        <DataTable :value="section(store.balanceSheet.assets)" dataKey="accountId" class="text-sm">
          <Column field="code" :header="$t('common.code')" />
          <Column field="name" :header="$t('common.name')" />
          <Column :header="$t('reports.financial.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
        <div class="mt-2 flex justify-end px-2 text-sm font-medium">
          {{ $t('reports.balanceSheet.totalAssets') }}: <b class="ml-2 tabular-nums">{{ fmtBase(store.balanceSheet.assetsTotal) }}</b>
        </div>
      </div>

      <div class="card">
        <h2 class="mb-2 font-semibold text-color">{{ $t('reports.balanceSheet.liabilitiesEquity') }}</h2>
        <DataTable :value="section(store.balanceSheet.liabilities)" dataKey="accountId" class="text-sm">
          <Column field="code" :header="$t('common.code')" />
          <Column field="name" :header="$t('common.name')" />
          <Column :header="$t('reports.financial.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
        <DataTable :value="section(store.balanceSheet.equity)" dataKey="accountId" class="mt-2 text-sm">
          <Column field="code" :header="$t('common.code')" />
          <Column field="name" :header="$t('common.name')" />
          <Column :header="$t('reports.financial.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
        <div class="mt-2 flex items-center justify-between px-2 text-sm">
          <span>{{ $t('reports.balanceSheet.retainedEarnings') }}</span>
          <span class="tabular-nums">{{ fmtBase(store.balanceSheet.retainedEarnings) }}</span>
        </div>
        <div class="mt-1 flex justify-end px-2 text-sm font-medium">
          {{ $t('reports.balanceSheet.totalLiabilitiesEquity') }}: <b class="ml-2 tabular-nums">{{ fmtBase(store.balanceSheet.liabilitiesEquityTotal) }}</b>
        </div>
      </div>

      <div class="card flex items-center justify-between">
        <Tag
          :severity="store.balanceSheet.balanced ? 'success' : 'danger'"
          :value="store.balanceSheet.balanced ? $t('reports.financial.balanced') : $t('reports.financial.unbalanced')"
        />
        <span class="text-sm text-muted-color">{{ $t('reports.balanceSheet.check') }}: {{ fmtBase(store.balanceSheet.assetsTotal) }} = {{ fmtBase(store.balanceSheet.liabilitiesEquityTotal) }}</span>
      </div>
    </div>
  </div>
</template>
