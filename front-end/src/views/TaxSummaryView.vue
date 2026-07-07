<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { onMounted } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useTaxCodesStore } from '../stores/taxCodes';

const store = useTaxCodesStore();

onMounted(() => store.loadVatSummary());
</script>

<template>
  <div>
    <PageHeader :title="$t('tax.summary.title')" />

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadVatSummary()" />

    <div v-else class="card">
      <TableSkeleton v-if="store.loading && !store.vatSummary.length" :columns="2" />
      <DataTable v-else :value="store.vatSummary" dataKey="period" class="text-sm">
        <Column field="period" :header="$t('tax.summary.period')" />
        <Column :header="$t('tax.summary.inputVat')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ data.vat }}</span></template>
        </Column>
        <Column :header="$t('tax.summary.wht')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums">{{ data.wht }}</span></template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-percentage" :title="$t('tax.summary.empty')" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
