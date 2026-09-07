<script setup lang="ts">
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useReportsStore } from '../../stores/reports';
import type { ReconciliationRow } from '../../api/reports';

/**
 * What the budget says, what the ledger says, and why they differ.
 *
 * The screen belongs here rather than under Budgets because its audience is whoever has to explain
 * the difference in the financial statements — the person who closes the period and files the
 * return — not the budget holder asking what they have left.
 *
 * Nothing on it is recomputed. Every figure, including the unexplained remainder, is the server's;
 * a client that re-derived the arithmetic would be a second opinion about a number whose whole
 * value is that there is only one of it.
 */
const store = useReportsStore();
const { fmtBase, baseCode } = useCurrencyFormat();

const expanded = ref<ReconciliationRow[]>([]);
const chosenYearId = ref<string | null>(null);

onMounted(() => store.loadBudgetLedgerReconciliation());

// The server picks the year when none is asked for; adopt its choice so the picker shows what is
// actually on screen rather than an empty box.
watch(
  () => store.reconciliation?.fiscalYear.id,
  (id) => {
    if (id && !chosenYearId.value) chosenYearId.value = id;
  },
);

function reload(fiscalYearId?: string | null) {
  store.loadBudgetLedgerReconciliation(fiscalYearId ? { fiscalYearId } : {});
}

const years = computed(() =>
  (store.reconciliation?.fiscalYears ?? []).map((y) => ({ label: String(y.year), value: y.id })),
);
const rows = computed(() => store.reconciliation?.rows ?? []);
const vouchers = computed(() => store.reconciliation?.vouchersOnBudgetedAccounts ?? null);

/** Decimal-string comparison. A remainder of '0.00' and one of '0' are both nothing to look at. */
const isZero = (amount: string) => Number(amount) === 0;
const unexplainedRows = computed(() => rows.value.filter((r) => !isZero(r.unexplained)));

/** The causes the server named, in the order it named them, plus the two it derives per document. */
function causesOf(row: ReconciliationRow): Array<{ key: string; label: string; amount: string }> {
  return [
    ...row.sourcesWithoutBudget.map((c) => ({
      key: `src-${c.sourceType}`,
      label: c.sourceType,
      amount: c.amount,
    })),
    // Before the capitalisation, as the server attributes them: a budget may post to several
    // accounts, and until that is taken off, spending sent to another EXPENSE account looks exactly
    // like a diversion to stock. Signed opposite each other because one row's send is another's
    // receive — netting them would report nothing on an account that did both.
    { key: 'spentElsewhere', label: 'spentElsewhere', amount: `-${row.spentOnAnotherAccount}` },
    { key: 'receivedElsewhere', label: 'receivedElsewhere', amount: row.receivedFromAnotherAccount },
    { key: 'capitalised', label: 'capitalised', amount: `-${row.capitalisedIntoStock}` },
    { key: 'neverArrived', label: 'neverArrived', amount: `-${row.postingNeverArrived}` },
    // Kept apart rather than netted: money charged to this year's pot on a day before it began and
    // on a day after it ended are different facts about a cutoff, and they cancel when added.
    { key: 'crossedBefore', label: 'crossedBefore', amount: `-${row.consumedBeforeItsYear}` },
    { key: 'crossedAfter', label: 'crossedAfter', amount: `-${row.consumedAfterItsYear}` },
  ].filter((c) => !isZero(c.amount));
}

/** The documents behind an account's crossings — the question the figure provokes is which ones. */
function crossingsOf(row: ReconciliationRow) {
  return { shown: row.crossings, hidden: Math.max(0, row.crossingCount - row.crossings.length) };
}
</script>

<template>
  <div>
    <PageHeader
      :title="$t('gl.reconciliation.title')"
      :subtitle="$t('gl.reconciliation.subtitle')"
    >
      <template #actions>
        <Select
          v-model="chosenYearId"
          :options="years"
          optionLabel="label"
          optionValue="value"
          :placeholder="$t('gl.reconciliation.fiscalYear')"
          class="w-40"
          data-testid="fiscal-year"
          @change="reload(chosenYearId)"
        />
      </template>
    </PageHeader>

    <ErrorState
      v-if="store.error && !store.reconciliation"
      :message="store.error"
      @retry="reload(chosenYearId)"
    />

    <template v-else>
      <!--
        The headline the report exists to produce, stated before any table. A discrepancy printed in
        the same neutral typeface as a reconciliation asks the reader to do the report's job.
      -->
      <Message
        v-if="unexplainedRows.length"
        severity="warn"
        :closable="false"
        class="mb-4"
        data-testid="unexplained-banner"
      >
        {{ $t('gl.reconciliation.unexplainedWarning', { count: unexplainedRows.length }) }}
      </Message>

      <div class="card mb-4">
        <p class="text-muted-color text-sm mt-0 mb-3">
          {{ $t('gl.reconciliation.hint', { currency: baseCode() }) }}
        </p>
        <TableSkeleton v-if="store.loading && !rows.length" :columns="7" />
        <DataTable
          v-else
          v-model:expandedRows="expanded"
          :value="rows"
          dataKey="accountCode"
          class="text-sm"
          :loading="store.loading"
        >
          <Column expander headerStyle="width:3rem" />
          <Column :header="$t('gl.reconciliation.columns.account')">
            <template #body="{ data }">
              <span class="font-medium">{{ data.accountCode }}</span>
              <span v-if="data.accountName" class="text-muted-color"> — {{ data.accountName }}</span>
            </template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.appropriated')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.appropriated) }}</span></template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.committed')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.committed) }}</span></template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.consumed')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.consumed) }}</span></template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.moved')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.moved) }}</span></template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.difference')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.difference) }}</span></template>
          </Column>
          <!--
            On the ROW, not only inside the expansion. It is the one figure the screen exists to
            surface, and a number that has to be opened to be seen is a number nobody sees.
          -->
          <Column :header="$t('gl.reconciliation.columns.unexplained')" headerStyle="text-align:right">
            <template #body="{ data }">
              <span
                class="tabular-nums"
                :class="isZero(data.unexplained) ? '' : 'font-semibold text-red-600 dark:text-red-400'"
                :data-testid="isZero(data.unexplained) ? 'unexplained' : 'unexplained-flagged'"
              >{{ fmtBase(data.unexplained) }}</span>
            </template>
          </Column>

          <template #expansion="{ data }">
            <div class="p-3">
              <p class="text-muted-color text-sm mt-0 mb-2">{{ $t('gl.reconciliation.causesHint') }}</p>
              <DataTable :value="causesOf(data)" dataKey="key" class="text-sm">
                <Column :header="$t('gl.reconciliation.columns.cause')">
                  <template #body="{ data: cause }">
                    <Tag
                      v-if="cause.key.startsWith('src-')"
                      :value="cause.label"
                      severity="secondary"
                      data-testid="cause-source"
                    />
                    <span v-else>{{ $t(`gl.reconciliation.causes.${cause.label}`) }}</span>
                  </template>
                </Column>
                <Column :header="$t('gl.reconciliation.columns.amount')" headerStyle="text-align:right">
                  <template #body="{ data: cause }">
                    <span class="tabular-nums" data-testid="cause-amount">{{ fmtBase(cause.amount) }}</span>
                  </template>
                </Column>
              </DataTable>

              <!-- Which documents crossed the boundary. The figure above says how much; this says
                   which ones, which is the only follow-up question it provokes. -->
              <template v-if="crossingsOf(data).shown.length">
                <p class="text-muted-color text-sm mt-3 mb-2" data-testid="crossings-hint">
                  {{ $t('gl.reconciliation.crossingsHint') }}
                </p>
                <DataTable :value="crossingsOf(data).shown" dataKey="documentId" class="text-sm">
                  <Column :header="$t('gl.reconciliation.columns.document')">
                    <template #body="{ data: c }">{{ c.documentNo ?? c.documentId }}</template>
                  </Column>
                  <Column :header="$t('gl.reconciliation.columns.date')">
                    <template #body="{ data: c }">{{ c.txnDate }}</template>
                  </Column>
                  <Column :header="$t('gl.reconciliation.columns.amount')" headerStyle="text-align:right">
                    <template #body="{ data: c }">
                      <span class="tabular-nums">{{ fmtBase(c.amount) }}</span>
                    </template>
                  </Column>
                </DataTable>
                <p v-if="crossingsOf(data).hidden" class="text-muted-color text-sm mt-2">
                  {{ $t('gl.reconciliation.crossingsMore', { count: crossingsOf(data).hidden }) }}
                </p>
              </template>
            </div>
          </template>
          <template #empty>
            <EmptyState icon="pi pi-book" :title="$t('gl.reconciliation.empty')" />
          </template>
        </DataTable>
      </div>

      <!-- The back door: expense that reached a budgeted account with no availability check. -->
      <div class="card mb-4">
        <h2 class="text-base font-semibold text-color mt-0 mb-1">
          {{ $t('gl.reconciliation.vouchers.title') }}
        </h2>
        <p class="text-muted-color text-sm mt-0 mb-3">{{ $t('gl.reconciliation.vouchers.hint') }}</p>
        <p class="text-lg font-semibold tabular-nums mb-3" data-testid="voucher-total">
          {{ fmtBase(vouchers?.total ?? '0') }}
        </p>
        <DataTable :value="vouchers?.entries ?? []" dataKey="entryId" class="text-sm">
          <Column field="entryDate" :header="$t('gl.reconciliation.columns.date')" />
          <Column :header="$t('gl.reconciliation.columns.voucher')">
            <template #body="{ data }">{{ data.docNo ?? '—' }}</template>
          </Column>
          <Column field="memo" :header="$t('gl.reconciliation.columns.memo')" />
          <Column :header="$t('gl.reconciliation.columns.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
          <template #empty>
            <EmptyState icon="pi pi-check-circle" :title="$t('gl.reconciliation.vouchers.empty')" />
          </template>
        </DataTable>
      </div>

      <!--
        The blind spot, shown beside the reconciliation rather than on a screen somebody has to know
        to look for: these expenses are in neither book, so every row above reconciles to zero while
        they are missing.
      -->
      <div class="card">
        <h2 class="text-base font-semibold text-color mt-0 mb-1">
          {{ $t('gl.reconciliation.skipped.title') }}
        </h2>
        <p class="text-muted-color text-sm mt-0 mb-3">{{ $t('gl.reconciliation.skipped.hint') }}</p>
        <DataTable :value="store.skipped" dataKey="id" class="text-sm">
          <Column :header="$t('gl.reconciliation.columns.document')">
            <template #body="{ data }">
              <span class="font-medium" data-testid="skipped-doc">{{ data.documentNo }}</span>
            </template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.source')">
            <template #body="{ data }"><Tag :value="data.sourceType" severity="secondary" /></template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.status')">
            <template #body="{ data }">{{ data.documentStatus }}</template>
          </Column>
          <Column :header="$t('gl.reconciliation.columns.total')" headerStyle="text-align:right">
            <template #body="{ data }">
              <span class="tabular-nums" data-testid="skipped-total">{{ fmtBase(data.baseTotalAmount) }}</span>
            </template>
          </Column>
          <template #empty>
            <EmptyState icon="pi pi-check-circle" :title="$t('gl.reconciliation.skipped.empty')" />
          </template>
        </DataTable>
      </div>
    </template>
  </div>
</template>
