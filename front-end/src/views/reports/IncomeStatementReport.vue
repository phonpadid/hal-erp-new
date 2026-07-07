<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import { onMounted, ref, watch } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import ErrorState from '@/components/ErrorState.vue';
import { useFinancialReportsStore } from '../../stores/financialReports';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';

const store = useFinancialReportsStore();
const { fmtBase } = useCurrencyFormat();
const from = ref<Date | null>(null);
const to = ref<Date | null>(null);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

function reload() {
  store.loadIncomeStatement(iso(from.value), iso(to.value));
}
watch([from, to], reload);
onMounted(reload);
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.incomeStatement.title')" />

    <PageToolbar>
      <template #filters>
        <DatePicker v-model="from" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.financial.from')" />
        <DatePicker v-model="to" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.financial.to')" />
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error" :message="store.error" @retry="reload" />

    <div v-else-if="store.incomeStatement" class="flex flex-col gap-4">
      <div class="card">
        <h2 class="mb-2 font-semibold text-color">{{ $t('reports.incomeStatement.revenue') }}</h2>
        <DataTable :value="store.incomeStatement.revenue" dataKey="accountId" class="text-sm">
          <Column field="code" :header="$t('common.code')" />
          <Column field="name" :header="$t('common.name')" />
          <Column :header="$t('reports.financial.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
        <div class="mt-2 flex justify-end px-2 text-sm">
          {{ $t('reports.incomeStatement.totalRevenue') }}: <b class="ml-2 tabular-nums">{{ fmtBase(store.incomeStatement.revenueTotal) }}</b>
        </div>
      </div>

      <div class="card">
        <h2 class="mb-2 font-semibold text-color">{{ $t('reports.incomeStatement.expense') }}</h2>
        <DataTable :value="store.incomeStatement.expense" dataKey="accountId" class="text-sm">
          <Column field="code" :header="$t('common.code')" />
          <Column field="name" :header="$t('common.name')" />
          <Column :header="$t('reports.financial.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
        <div class="mt-2 flex justify-end px-2 text-sm">
          {{ $t('reports.incomeStatement.totalExpense') }}: <b class="ml-2 tabular-nums">{{ fmtBase(store.incomeStatement.expenseTotal) }}</b>
        </div>
      </div>

      <div class="card flex items-center justify-between">
        <span class="font-semibold text-color">{{ $t('reports.incomeStatement.netIncome') }}</span>
        <span class="text-lg font-bold tabular-nums" :class="Number(store.incomeStatement.netIncome) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
          {{ fmtBase(store.incomeStatement.netIncome) }}
        </span>
      </div>
    </div>
  </div>
</template>
