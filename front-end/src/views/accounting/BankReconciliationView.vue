<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { formatDate } from '@/utils/date';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useBankAccountsStore } from '../../stores/bankAccounts';
import type { OutstandingPayment } from '../../api/bankAccounts';

/**
 * What the books say has left and the bank has not moved.
 *
 * A payment credits the CLEARING account when finance records it; the bank confirming it moves the
 * money to the account it actually left. So this list IS the clearing balance, and confirming a row
 * is what takes it out.
 *
 * The unattributed panel is not decoration: a payment naming no bank account credits the clearing
 * account and belongs to no reconciliation, so without showing them the clearing balance could
 * never be explained. Every payment recorded before bank accounts existed is one.
 */
const { t } = useI18n();
const fb = useFeedback();
const { fmtBase } = useCurrencyFormat();
const auth = useAuthStore();
const store = useBankAccountsStore();

const canConfirm = computed(() => auth.can('PAYMENT_MANAGE'));
const selectedId = ref<string>('');
const confirmDialog = ref<{ open: boolean; payment: OutstandingPayment | null; on: Date | null }>({
  open: false,
  payment: null,
  on: null,
});

const accountOptions = computed(() =>
  store.accounts.map((a) => ({ label: `${a.name} — ${a.accountNo}`, value: a.id })),
);

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function confirm() {
  const { payment, on } = confirmDialog.value;
  if (!payment || !on || !selectedId.value) return;
  const ok = await store.confirmCleared(payment.paymentId, toIsoDate(on), selectedId.value);
  if (ok) {
    confirmDialog.value = { open: false, payment: null, on: null };
    fb.success(t('gl.bank.confirmed'));
  } else fb.error(store.error);
}

watch(selectedId, (id) => id && store.loadReconciliation(id));

onMounted(async () => {
  await store.load();
  if (store.accounts.length) selectedId.value = store.accounts[0].id;
});
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.bank.title')" :subtitle="$t('gl.bank.subtitle')" />

    <ErrorState v-if="store.error && !store.accounts.length" :message="store.error" @retry="store.load()" />

    <div v-else class="flex flex-col gap-3">
      <div class="card flex flex-wrap items-end gap-4">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bank.account') }}
          <Select
            v-model="selectedId"
            :options="accountOptions"
            optionLabel="label"
            optionValue="value"
            class="w-72"
            data-testid="bank-account-picker"
          />
        </label>
        <div v-if="store.reconciliation" class="flex flex-col">
          <span class="text-sm text-muted-color">{{ $t('gl.bank.glBalance') }}</span>
          <b class="tabular-nums" data-testid="gl-balance">{{ fmtBase(store.reconciliation.glBalance) }}</b>
        </div>
        <div v-if="store.reconciliation" class="flex flex-col">
          <span class="text-sm text-muted-color">{{ $t('gl.bank.inFlight') }}</span>
          <b class="tabular-nums" data-testid="outstanding-total">{{ fmtBase(store.reconciliation.total) }}</b>
        </div>
      </div>

      <div class="card">
        <DataTable :value="store.reconciliation?.items ?? []" dataKey="paymentId" class="text-sm">
          <Column field="documentNo" :header="$t('gl.payables.columns.document')">
            <template #body="{ data }">{{ data.documentNo ?? '—' }}</template>
          </Column>
          <Column :header="$t('gl.bank.paidAt')">
            <template #body="{ data }">{{ data.paidAt ? formatDate(data.paidAt) : '—' }}</template>
          </Column>
          <Column :header="$t('gl.payables.columns.amount')" headerStyle="text-align:right">
            <template #body="{ data }">
              <span class="tabular-nums" data-testid="outstanding-amount">{{ fmtBase(data.amount) }}</span>
            </template>
          </Column>
          <Column>
            <template #body="{ data }">
              <div class="flex justify-end">
                <Button
                  v-if="canConfirm"
                  :label="$t('gl.bank.confirm')"
                  size="small"
                  data-testid="confirm-cleared"
                  @click="confirmDialog = { open: true, payment: data, on: null }"
                />
              </div>
            </template>
          </Column>
          <template #empty>
            <EmptyState icon="pi pi-check-circle" :title="$t('gl.bank.empty')" />
          </template>
        </DataTable>
      </div>

      <!-- Cash in flight that belongs to no account. Surfaced, because a clearing balance that
           cannot be explained is worse than one that is only partly attributed. -->
      <div v-if="store.unattributed.items.length" class="card" data-testid="unattributed">
        <Message severity="warn" size="small" variant="simple">
          {{ $t('gl.bank.unattributedExplain', { amount: fmtBase(store.unattributed.total) }) }}
        </Message>
        <DataTable :value="store.unattributed.items" dataKey="paymentId" class="mt-2 text-sm">
          <Column field="documentNo" :header="$t('gl.payables.columns.document')">
            <template #body="{ data }">{{ data.documentNo ?? '—' }}</template>
          </Column>
          <!-- What the person recording the transfer stated, where they stated anything. It does not
               attribute the payment — that is why the row is here — but it is the lead whoever
               attributes it works from, and nowhere else records it. -->
          <Column :header="$t('payments.record.transferFrom.label')">
            <template #body="{ data }">
              <span v-if="data.transferFrom" data-testid="unattributed-transfer-from">
                {{ $t(`payments.record.transferFrom.${data.transferFrom}`) }}
              </span>
              <span v-else class="text-muted-color">—</span>
            </template>
          </Column>
          <Column :header="$t('gl.payables.columns.amount')" headerStyle="text-align:right">
            <template #body="{ data }"><span class="tabular-nums">{{ fmtBase(data.amount) }}</span></template>
          </Column>
        </DataTable>
      </div>
    </div>

    <Dialog v-model:visible="confirmDialog.open" modal :header="$t('gl.bank.confirm')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <Message severity="info" size="small" variant="simple">{{ $t('gl.bank.confirmExplain') }}</Message>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bank.clearedOn') }}
          <DatePicker v-model="confirmDialog.on" dateFormat="yy-mm-dd" showIcon />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="confirmDialog.open = false" />
        <Button
          :label="$t('gl.bank.confirm')"
          :disabled="!confirmDialog.on"
          :loading="store.working"
          data-testid="confirm-cleared-submit"
          @click="confirm"
        />
      </template>
    </Dialog>
  </div>
</template>
