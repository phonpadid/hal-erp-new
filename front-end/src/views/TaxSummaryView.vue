<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useCurrencyFormat } from '../composables/useCurrencyFormat';
import { useFeedback } from '../composables/useFeedback';
import { useAuthStore } from '../stores/auth';
import { useTaxCodesStore } from '../stores/taxCodes';
import type { VatSummaryRow } from '../api/taxCodes';

/**
 * What each month claimed, and whether it has been claimed.
 *
 * Filing is the act that moves a month's input VAT from tax paid on purchases to a debt the revenue
 * authority owes, and it is the only thing that ever credits `VAT_INPUT`. Showing the figure without
 * showing whether it was filed invites the same month being claimed twice on paper while the ledger
 * says it was claimed once — so the filed state sits on the same row as the amount.
 */
const { t } = useI18n();
const store = useTaxCodesStore();
const auth = useAuthStore();
const fb = useFeedback();
// Figures a person copies onto a return: shown at the base currency's own decimal places, like
// every other amount in the app, rather than as the raw string the server sent.
const { fmtBase } = useCurrencyFormat();

/** Filing writes the ledger, so it is its own permission — reading a summary is not filing one. */
const canFile = computed(() => auth.can('VAT_FILE'));

onMounted(() => store.loadVatSummary());

/** `YYYY-MM` → the month's first and last company-day. Day 0 of the next month is this month's last. */
function boundsOf(period: string): { periodFrom: string; periodTo: string } {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { periodFrom: `${period}-01`, periodTo: `${period}-${String(lastDay).padStart(2, '0')}` };
}

const filedFor = (period: string) =>
  store.vatReturns.find((r) => r.periodFrom.startsWith(period));

/** Nothing to claim is not a filing failure — the server refuses it, and so does the control. */
const hasClaim = (row: VatSummaryRow) => Number(row.vat) > 0;

async function file(row: VatSummaryRow) {
  const bounds = boundsOf(row.period);
  const ok = await store.fileVatReturn({ ...bounds, returnId: crypto.randomUUID() });
  if (ok) fb.success(t('tax.summary.filed', { period: row.period }));
  else fb.error(store.error);
}
</script>

<template>
  <div>
    <PageHeader :title="$t('tax.summary.title')" :subtitle="$t('tax.summary.subtitle')" />

    <ErrorState v-if="store.error && !store.vatSummary.length" :message="store.error" @retry="store.loadVatSummary()" />

    <div v-else class="card">
      <TableSkeleton v-if="store.loading && !store.vatSummary.length" :columns="2" />
      <DataTable v-else :value="store.vatSummary" dataKey="period" class="text-sm">
        <Column field="period" :header="$t('tax.summary.period')" />
        <Column :header="$t('tax.summary.inputVat')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums" data-testid="summary-vat">{{ fmtBase(data.vat) }}</span></template>
        </Column>
        <Column :header="$t('tax.summary.wht')" headerStyle="text-align:right">
          <template #body="{ data }"><span class="tabular-nums" data-testid="summary-wht">{{ fmtBase(data.wht) }}</span></template>
        </Column>
        <Column :header="$t('tax.summary.status')">
          <template #body="{ data }">
            <!--
              The filed amount is shown, not just the fact of filing: it is what was claimed at the
              time, and a month whose entries changed afterwards shows a figure that no longer
              matches — which is exactly the thing somebody needs to see.
            -->
            <Tag
              v-if="filedFor(data.period)"
              severity="success"
              :value="$t('tax.summary.filedOn', {
                date: filedFor(data.period)!.filedOn,
                amount: fmtBase(filedFor(data.period)!.inputVat),
              })"
              data-testid="filed-tag"
            />
            <span v-else class="text-muted-color" data-testid="not-filed">{{ $t('tax.summary.notFiled') }}</span>
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex justify-end">
              <Button
                v-if="canFile && !filedFor(data.period)"
                :label="$t('tax.summary.file')"
                icon="pi pi-send"
                size="small"
                outlined
                :disabled="!hasClaim(data)"
                :loading="store.filing === boundsOf(data.period).periodFrom"
                data-testid="file-return"
                @click="file(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-percentage" :title="$t('tax.summary.empty')" />
        </template>
      </DataTable>
    </div>
  </div>
</template>
