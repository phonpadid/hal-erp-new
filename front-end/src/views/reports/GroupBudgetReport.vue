<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { onMounted, ref, watch } from 'vue';
import { useReportsStore } from '../../stores/reports';
import { useCurrencyStore } from '../../stores/currency';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';

const reports = useReportsStore();
const cur = useCurrencyStore();
const { fmt } = useCurrencyFormat();
const currency = ref<string>('');
const asOf = ref<Date | null>(null);

function load() {
  if (!currency.value) return;
  reports.loadGroupBudgetBalance({
    currency: currency.value,
    asOf: asOf.value ? asOf.value.toISOString().slice(0, 10) : undefined,
  });
}

onMounted(async () => {
  if (!cur.currencies.length) await cur.loadCurrencies().catch(() => undefined);
  currency.value = cur.currencies[0]?.code ?? 'THB';
  load();
});

// Reload as soon as the as-of date is picked or cleared (currency reloads via @change).
watch(asOf, () => load());
</script>

<template>
  <div>
    <PageHeader :title="$t('reports.group.title')" :subtitle="$t('reports.group.subtitle')" />
    <PageToolbar>
      <template #filters>
        <Select v-model="currency" :options="cur.currencies" optionLabel="code" optionValue="code" class="w-40" :placeholder="$t('reports.group.currency')" @change="load()" />
        <DatePicker v-model="asOf" dateFormat="dd-mm-yy" showIcon showClear iconDisplay="input" :placeholder="$t('reports.group.asOf')" />
      </template>
    </PageToolbar>
    <ErrorState v-if="reports.error" :message="reports.error" @retry="load()" />

    <div class="card">
      <p class="text-muted-color text-sm mb-3">{{ $t('reports.group.hint', { currency }) }}</p>

      <DataTable :value="reports.group?.companies ?? []" :loading="reports.loading" dataKey="companyId" class="text-sm">
        <template #empty><EmptyState :title="$t('reports.group.empty')" /></template>
        <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
        <Column field="companyName" :header="$t('reports.group.company')" />
        <Column field="baseCurrency" :header="$t('reports.group.baseCurrency')"><template #body="{ data }">{{ data.baseCurrency ?? '—' }}</template></Column>
        <Column :header="$t('reports.group.rate')">
          <template #body="{ data }">
            <span v-if="data.convertible">{{ data.rate }} <span class="text-muted-color text-xs">({{ data.rateSource }})</span></span>
            <Tag v-else severity="warn" :value="$t('reports.group.noRate')" />
          </template>
        </Column>
        <Column :header="$t('reports.group.nativeAvailable')">
          <template #body="{ data }">{{ fmt(data.nativeTotal.available, data.baseCurrency) }} {{ data.baseCurrency }}</template>
        </Column>
        <Column :header="$t('reports.group.convertedAvailable')">
          <template #body="{ data }">
            <span v-if="data.convertedTotal" class="font-semibold">{{ fmt(data.convertedTotal.available, reports.group?.currency) }}</span>
            <span v-else class="text-muted-color">—</span>
          </template>
        </Column>
      </DataTable>

      <!-- Group total (presentation currency), over the convertible companies only. -->
      <div v-if="reports.group" class="flex justify-end mt-4">
        <div class="text-right">
          <div class="text-muted-color text-xs">{{ $t('reports.group.groupTotal', { currency: reports.group.currency }) }}</div>
          <div class="text-xl font-semibold text-color">{{ fmt(reports.group.groupTotal.available, reports.group.currency) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
