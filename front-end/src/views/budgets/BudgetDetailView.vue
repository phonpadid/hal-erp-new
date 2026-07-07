<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import { budgetsApi } from '../../api/budgets';
import { useBudgetsStore } from '../../stores/budgets';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';
import { formatAmount } from '../../utils/money';
import { formatDate } from '../../utils/date';
import BudgetTransferDialog from './BudgetTransferDialog.vue';
import BudgetWaterfallChart from './BudgetWaterfallChart.vue';

const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const budgets = useBudgetsStore();
const auth = useAuthStore();
const id = route.params.id as string;

const b = computed(() => budgets.breakdown);

// Ledger direction: `amount` is always a positive magnitude — the txn type carries the
// sign (mirrors the backend balance formula, invariant 3). These types add to the
// balance (inflow); all others subtract (outflow).
const LEDGER_INFLOW_TYPES = new Set(['ADJUST_INCREASE', 'TRANSFER_IN', 'RELEASE']);
const isLedgerInflow = (txnType: string) => LEDGER_INFLOW_TYPES.has(txnType);

// Budget adjustment — creates an approvable document; the balance changes only on
// full approval. Validation mirrors the backend CreateAdjustmentDto (positive amount,
// non-empty reason); amount stays a string (never a JS number) end to end.
const adjustOpen = ref(false);
const adjustBusy = ref(false);
// InputNumber binds a JS number for the editor only; the wire value is stringified on
// submit so money never crosses the wire as a number (invariant).
const adjustModel = ref<{ direction: 'INCREASE' | 'DECREASE'; amount: number | null; reason: string }>({
  direction: 'INCREASE',
  amount: null,
  reason: '',
});
const adjustErr = ref<Record<string, string>>({});
const directionOptions = computed(() => [
  { label: t('budgets.adjust.increase'), value: 'INCREASE' },
  { label: t('budgets.adjust.decrease'), value: 'DECREASE' },
]);
// Configured currency of this budget (company base currency), for the amount field.
const currency = computed(() => budgets.current?.fiscalYear?.company?.baseCurrency ?? null);
const currencyDecimals = computed<number>(() => currency.value?.decimalPlaces ?? 2);
const amountSuffix = computed(() => (currency.value?.code ? ` ${currency.value.code}` : undefined));

function openAdjust() {
  adjustErr.value = {};
  adjustModel.value = { direction: 'INCREASE', amount: null, reason: '' };
  adjustOpen.value = true;
}
async function submitAdjust() {
  const errs: Record<string, string> = {};
  if (!(typeof adjustModel.value.amount === 'number' && adjustModel.value.amount > 0)) {
    errs.amount = t('budgets.adjust.amountError');
  }
  if (!adjustModel.value.reason.trim()) errs.reason = t('budgets.adjust.reasonError');
  adjustErr.value = errs;
  if (Object.keys(errs).length) return;
  adjustBusy.value = true;
  try {
    const { documentId } = await budgetsApi.createAdjustment(id, {
      direction: adjustModel.value.direction,
      amount: String(adjustModel.value.amount),
      reason: adjustModel.value.reason.trim(),
    });
    adjustOpen.value = false;
    fb.success(t('feedback.created'));
    await router.push({ name: 'document-detail', params: { id: documentId } });
  } catch (e: any) {
    fb.error(e, t('budgets.adjust.failed'));
  } finally {
    adjustBusy.value = false;
  }
}

// Budget transfer — opens a dialog to raise an approvable transfer document. The client
// never moves money; balances change only on full approval.
const transferOpen = ref(false);
// Source passed to the dialog: the current budget plus its derived available balance.
const transferSource = computed(() => ({
  id,
  glAccount: budgets.current?.glAccount,
  budgetName: budgets.current?.budgetName,
  amountTotal: budgets.current?.amountTotal,
  status: budgets.current?.status,
  fiscalYear: budgets.current?.fiscalYear,
  available: b.value?.available,
}));
function onTransferred(documentId: string) {
  router.push({ name: 'document-detail', params: { id: documentId } });
}

// total → +adjust → ±transfer → −reserved − actual + released = available
const rows = computed(() =>
  b.value
    ? [
        { key: 'amountTotal', value: b.value.amountTotal, sign: '' },
        { key: 'adjustIncrease', value: b.value.adjustIncrease, sign: '+' },
        { key: 'adjustDecrease', value: b.value.adjustDecrease, sign: '−' },
        { key: 'transferIn', value: b.value.transferIn, sign: '+' },
        { key: 'transferOut', value: b.value.transferOut, sign: '−' },
        { key: 'reserved', value: b.value.reserved, sign: '−' },
        { key: 'actual', value: b.value.actual, sign: '−' },
        { key: 'released', value: b.value.released, sign: '+' },
      ]
    : [],
);

// Server-side ledger paging: DataTable emits 0-based page + rows; the store fetches
// that window (newest-first ordering is fixed on the server).
function onLedgerPage(e: { page: number; rows: number }) {
  budgets.loadLedger(id, e.page + 1, e.rows);
}

onMounted(() => budgets.loadOne(id));
</script>

<template>
  <div v-if="budgets.current">
    <DetailHeader
      :title="budgets.current.budgetName ?? budgets.current.glAccount"
      :subtitle="$t('budgets.detail.glLabel', { account: budgets.current.glAccount })"
      :status="budgets.current.status ? $t('budgets.status.' + budgets.current.status) : undefined"
      :status-severity="budgets.current.status === 'ACTIVE' ? 'success' : 'secondary'"
    >
      <template #actions>
        <Button v-can="'BUDGET_MANAGE'" :label="$t('common.edit')" icon="pi pi-pencil" size="small" outlined @click="router.push({ name: 'budget-edit', params: { id } })" />
        <Button v-can="'BUDGET_MANAGE'" :label="$t('budgets.transfer.button')" icon="pi pi-arrow-right-arrow-left" size="small" outlined @click="transferOpen = true" />
        <Button v-can="'BUDGET_MANAGE'" :label="$t('budgets.adjust.button')" icon="pi pi-sliders-h" size="small" @click="openAdjust()" />
      </template>
    </DetailHeader>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadOne(id)" />

    <SectionCard v-if="b" :title="$t('budgets.balance.available')">
      <div class="max-w-md">
        <div v-for="r in rows" :key="r.key" class="flex justify-between text-sm py-1">
          <span class="text-muted-color">{{ r.sign }} {{ $t('budgets.balance.' + r.key) }}</span>
          <span>{{ formatAmount(r.value, currencyDecimals) }}</span>
        </div>
        <div class="flex justify-between font-semibold border-t border-surface mt-2 pt-2">
          <span>{{ $t('budgets.balance.available') }}</span>
          <span>{{ formatAmount(b.available, currencyDecimals) }}</span>
        </div>
      </div>
    </SectionCard>

    <SectionCard v-if="b && auth.can('BUDGET_VIEW')" :title="$t('budgets.waterfall.title')">
      <BudgetWaterfallChart :breakdown="b" :currency-decimals="currencyDecimals" />
    </SectionCard>

    <SectionCard :title="$t('budgets.detail.ledgerTitle')">
      <DataTable
        :value="budgets.ledger"
        dataKey="id"
        class="text-sm"
        lazy
        paginator
        :rows="budgets.ledgerLimit"
        :totalRecords="budgets.ledgerTotal"
        :first="(budgets.ledgerPage - 1) * budgets.ledgerLimit"
        :loading="budgets.ledgerLoading"
        @page="onLedgerPage"
      >
        <Column header="#" headerStyle="width:3rem">
          <template #body="{ index }">{{ (budgets.ledgerPage - 1) * budgets.ledgerLimit + index + 1 }}</template>
        </Column>
        <Column :header="$t('common.type')">
          <template #body="{ data }">{{ $t(`budgets.detail.txnTypes.${data.txnType}`) }}</template>
        </Column>
        <Column :header="$t('common.amount')">
          <template #body="{ data }">
            <span
              class="inline-flex items-center gap-1 font-medium tabular-nums"
              :class="isLedgerInflow(data.txnType) ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              <i class="pi text-xs" :class="isLedgerInflow(data.txnType) ? 'pi-arrow-down-left' : 'pi-arrow-up-right'" />
              {{ isLedgerInflow(data.txnType) ? '+' : '−' }}{{ formatAmount(data.amount, currencyDecimals) }}
            </span>
          </template>
        </Column>
        <Column :header="$t('budgets.detail.ledgerDocument')">
          <template #body="{ data }">
            <a v-if="data.documentNo && data.documentId" class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.documentNo }}</a>
            <span v-else>{{ $t('common.none') }}</span>
          </template>
        </Column>
        <Column field="remark" :header="$t('budgets.detail.ledgerRemark')" />
        <Column :header="$t('budgets.detail.ledgerAt')"><template #body="{ data }">{{ formatDate(data.createdAt) }}</template></Column>
        <template #empty>
          <EmptyState icon="pi pi-book" :title="$t('budgets.detail.ledgerEmpty')" />
        </template>
      </DataTable>
    </SectionCard>

    <Dialog v-model:visible="adjustOpen" :header="$t('budgets.adjust.title')" modal class="w-96">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.direction') }}</label>
          <SelectButton v-model="adjustModel.direction" :options="directionOptions" optionLabel="label" optionValue="value" :allowEmpty="false" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.amount') }}</label>
          <InputNumber v-model="adjustModel.amount" :suffix="amountSuffix" :min="0" :minFractionDigits="0" :maxFractionDigits="currencyDecimals" fluid />
          <Message v-if="adjustErr.amount" severity="error" size="small" variant="simple">{{ adjustErr.amount }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.reason') }}</label>
          <Textarea v-model="adjustModel.reason" rows="3" autoResize />
          <Message v-if="adjustErr.reason" severity="error" size="small" variant="simple">{{ adjustErr.reason }}</Message>
        </div>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="adjustOpen = false" />
          <Button :label="$t('budgets.adjust.submit')" :loading="adjustBusy" @click="submitAdjust()" />
        </div>
      </div>
    </Dialog>

    <BudgetTransferDialog v-model:visible="transferOpen" :source="transferSource as any" @submitted="onTransferred" />
  </div>
</template>
