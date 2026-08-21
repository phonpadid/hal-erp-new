<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
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
 * Nothing here is marked overdue BY THIS SCREEN. `dueDate` is a company-day and the browser's today
 * is not the company's, so a flag computed here would fire early or late by a timezone offset —
 * the defect the posting engine was corrected for. The ageing comes from the server, which is the
 * only party that knows the company's day; this file renders it and derives none of it.
 */
const store = useJournalStore();
const { fmtBase, baseCode } = useCurrencyFormat();

/**
 * The currency, said ONCE for the whole report rather than after every figure.
 *
 * Every amount here is already in the company's base currency — the payables balance is one
 * balance-sheet line — so repeating a code eight times down a column adds no information and costs
 * the alignment that makes a money column comparable. A report that never says it at all is the
 * defect this replaces: `Total owed: 35,000` of what.
 */
const amountsIn = computed(() => baseCode());

// Ordering is the table's `sortField`/`sortOrder`, not a second sort here — one mechanism, and the
// reader can re-sort by any column from the same control.
const rows = computed(() => store.payables);
const total = computed(() => sumAmounts(store.payables.map((p) => p.amount)));

onMounted(() => store.loadPayables());
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.payables.title')" :subtitle="$t('gl.payables.subtitle')">
      <!-- Said once for the whole report, beside the title. Every figure below is in the company's
           base currency — the payables balance is one balance-sheet line — so a code repeated after
           each one adds nothing and costs the alignment that makes a money column comparable. -->
      <template v-if="amountsIn" #actions>
        <span class="text-sm text-muted-color" data-testid="amounts-in">
          {{ $t('gl.payables.inCurrency', { code: amountsIn }) }}
        </span>
      </template>
    </PageHeader>

    <ErrorState v-if="store.error && !store.payables.length" :message="store.error" @retry="store.loadPayables()" />

    <!-- The bands, from the server: the client never decides which one a payable is in. -->
    <div v-if="store.ageing" class="card mb-3 flex flex-wrap gap-4" data-testid="ageing-summary">
      <!-- A band holding nothing is dimmed rather than dropped: which bands are empty is part of
           the picture, but giving an empty one the same weight as the one that holds the debt makes
           the reader find the number instead of being handed it. -->
      <div v-for="b in store.ageing.buckets" :key="b.bucket" class="flex flex-col" :class="Number(b.total) ? '' : 'opacity-60'">
        <span class="text-sm text-muted-color">{{ $t(`gl.payables.buckets.${b.bucket}`) }}</span>
        <b class="tabular-nums" :data-testid="`bucket-${b.bucket}`">{{ fmtBase(b.total) }}</b>
        <span class="text-xs text-muted-color">{{ $t('gl.payables.bucketCount', { count: b.count }) }}</span>
      </div>
    </div>

    <!--
      What the total is COMPOSED of, as the server reported it. A reported total answers what the
      company owes; its composition answers what of. Never recomputed here — a total derived in the
      browser is a second opinion about a figure the server already produced.
    -->
    <div v-if="store.ageing?.byKind?.length" class="card mb-3 flex flex-wrap gap-6" data-testid="ageing-by-kind">
      <div v-for="k in store.ageing.byKind" :key="k.payableKind" class="flex flex-col">
        <span class="text-sm text-muted-color">{{ $t(`gl.payables.kind.${k.payableKind}`) }}</span>
        <b class="tabular-nums" :data-testid="`kind-${k.payableKind}`">{{ fmtBase(k.total) }}</b>
        <span class="text-xs text-muted-color">{{ $t('gl.payables.bucketCount', { count: k.count }) }}</span>
      </div>
      <div class="flex flex-col">
        <span class="text-sm text-muted-color">{{ $t('gl.payables.total') }}</span>
        <b class="tabular-nums" data-testid="payables-total">{{ fmtBase(store.ageing.total) }}</b>
      </div>
    </div>

    <div v-if="!store.error || store.payables.length" class="card">
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
        <!-- Trade or other. One was agreed with a supplier on terms, the other is owed to a
             person now; a list that renders them identically reports a total nobody can compose. -->
        <Column field="payableKind" :header="$t('gl.payables.columns.kind')" sortable>
          <template #body="{ data }">
            <Tag
              :value="$t(`gl.payables.kind.${data.payableKind}`)"
              :severity="data.payableKind === 'CLAIM' ? 'info' : 'secondary'"
              data-testid="payable-kind"
            />
          </template>
        </Column>
        <!-- Who is owed. A row the server named nobody for is identified by its document number
             and names nobody: whoever raised a claim is frequently not whoever is owed it. -->
        <Column field="owedTo" :header="$t('gl.payables.columns.owedTo')" sortable>
          <template #body="{ data }">
            <span v-if="data.owedTo" data-testid="owed-to">{{ data.owedTo }}</span>
            <!-- A dash on its own is ambiguous between "loading", "nobody" and "zero". This one
                 means the document names no payee — a `requires_employee` the type does not set —
                 so it says so, and the document beside it is a link rather than a dead end. -->
            <span v-else class="text-muted-color" :title="$t('gl.payables.noPayee')" data-testid="owed-to-none">—</span>
          </template>
        </Column>
        <Column field="documentNo" :header="$t('gl.payables.columns.document')" sortable>
          <template #body="{ data }">
            <!-- The row identifies itself by its document, so the reader can get to it. That is
                 the only answer available for a row nobody is named on. -->
            <RouterLink
              v-if="data.documentId"
              :to="{ name: 'document-detail', params: { id: data.documentId } }"
              class="text-primary hover:underline"
              :aria-label="$t('gl.payables.openDocument', { docNo: data.documentNo ?? '' })"
              data-testid="payable-document-link"
            >
              {{ data.documentNo ?? data.documentId }}
            </RouterLink>
            <span v-else>{{ data.documentNo ?? '—' }}</span>
          </template>
        </Column>
        <Column field="invoiceDate" :header="$t('gl.payables.columns.invoiceDate')" sortable>
          <template #body="{ data }">{{ formatDate(data.invoiceDate) }}</template>
        </Column>
        <Column field="dueDate" :header="$t('gl.payables.columns.dueDate')" sortable>
          <template #body="{ data }">{{ formatDate(data.dueDate) }}</template>
        </Column>
        <Column field="daysOverdue" :header="$t('gl.payables.columns.ageing')" sortable>
          <!-- The band the SERVER put it in, rendered as given. -->
          <template #body="{ data }">
            <Tag
              :value="$t(`gl.payables.buckets.${data.bucket}`)"
              :severity="data.bucket === 'NOT_DUE' ? 'secondary' : data.bucket === 'D90_PLUS' ? 'danger' : 'warn'"
              data-testid="payable-bucket"
            />
          </template>
        </Column>
        <!-- Right-aligned in the BODY as well as the header: the header said right and the cells
             stayed left, so the column of figures did not line up with the total under it. -->
        <Column
          field="amount"
          :header="$t('gl.payables.columns.amount')"
          headerClass="justify-end"
          bodyClass="text-right!"
          sortable
        >
          <template #body="{ data }">
            <span class="tabular-nums" data-testid="payable-amount">{{ fmtBase(data.amount) }}</span>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('gl.payables.empty')" />
        </template>
      </DataTable>

      <!--
        The SERVER's total, the same figure the band above reports. This footer used to add the
        loaded rows up in the browser: a second opinion about a number the server had already
        produced, under the same test id as the first, agreeing with it only for as long as the read
        keeps returning every row in one response. The client sum stays as the fallback for a
        response that carried no ageing summary, and nothing else.
      -->
      <div v-if="rows.length" class="mt-2 flex justify-end px-2 text-sm font-medium">
        {{ $t('gl.payables.total') }}:
        <b class="ml-2 tabular-nums" data-testid="payables-footer-total">{{ fmtBase(store.ageing?.total ?? total) }}</b>
      </div>
    </div>
  </div>
</template>
