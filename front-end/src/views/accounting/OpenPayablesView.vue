<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed, onMounted } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatDate } from '@/utils/date';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useJournalStore } from '../../stores/journal';
import { sumAmounts } from '../../utils/money';

/**
 * What the company owes its vendors and has not paid.
 *
 * Derived from the journal — an accrual that credited ACCOUNTS_PAYABLE with no payment entry
 * against the same source — so this is the breakdown of the balance sheet's payables figure and
 * cannot disagree with it.
 *
 * Nothing here is marked overdue. `dueDate` is a company-day, and the browser's today is not the
 * company's: an "overdue" flag computed here would fire early or late by a timezone offset, which
 * is the defect the posting engine was corrected for. The list orders by due date, which needs no
 * today at all.
 */
const store = useJournalStore();
const { fmtBase } = useCurrencyFormat();

// Ordering is the table's `sortField`/`sortOrder`, not a second sort here — one mechanism, and the
// reader can re-sort by any column from the same control.
const rows = computed(() => store.payables);
const total = computed(() => sumAmounts(store.payables.map((p) => p.amount)));

onMounted(() => store.loadPayables());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.payables.title')" :subtitle="$t('gl.payables.subtitle')" />

    <ErrorState v-if="store.error && !store.payables.length" :message="store.error" @retry="store.loadPayables()" />

    <div v-else class="card">
      <!--
        Client-side paging: `open-payables` accepts paging parameters and ignores them, returning
        every row in one response. A lazy table would refetch the same page.
      -->
      <DataTable
        :value="rows"
        dataKey="documentId"
        class="text-sm"
        paginator
        :rows="20"
        :loading="store.loading"
        sortField="dueDate"
        :sortOrder="1"
      >
        <Column field="vendorName" :header="$t('gl.payables.columns.vendor')" sortable>
          <template #body="{ data }">{{ data.vendorName ?? '—' }}</template>
        </Column>
        <Column field="documentNo" :header="$t('gl.payables.columns.document')" sortable>
          <template #body="{ data }">{{ data.documentNo ?? '—' }}</template>
        </Column>
        <Column field="invoiceDate" :header="$t('gl.payables.columns.invoiceDate')" sortable>
          <template #body="{ data }">{{ formatDate(data.invoiceDate) }}</template>
        </Column>
        <Column field="dueDate" :header="$t('gl.payables.columns.dueDate')" sortable>
          <template #body="{ data }">{{ formatDate(data.dueDate) }}</template>
        </Column>
        <Column field="amount" :header="$t('gl.payables.columns.amount')" headerStyle="text-align:right" sortable>
          <template #body="{ data }">
            <span class="tabular-nums" data-testid="payable-amount">{{ fmtBase(data.amount) }}</span>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('gl.payables.empty')" />
        </template>
      </DataTable>

      <div v-if="rows.length" class="mt-2 flex justify-end px-2 text-sm font-medium">
        {{ $t('gl.payables.total') }}:
        <b class="ml-2 tabular-nums" data-testid="payables-total">{{ fmtBase(total) }}</b>
      </div>
    </div>
  </div>
</template>
