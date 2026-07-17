<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { usePaymentsStore } from '../../stores/payments';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';
import { taxCodesApi } from '../../api/taxCodes';
import { paymentBatchesApi } from '../../api/payments';
import type { PayableHandoff, PaymentResult } from '../../api/payments';
import type { SelectableVat } from '../../api/taxCodes';

const router = useRouter();
const { t } = useI18n();
const payments = usePaymentsStore();
const auth = useAuthStore();
const fb = useFeedback();
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const canManage = () => auth.can('PAYMENT_MANAGE');
const canBatch = () => auth.can('PAYMENT_BATCH_MANAGE');
const canTax = () => auth.can('TAX_VIEW');

// --- Build a payment run from the queue.
// Only a payable with an approved payee can go to the bank: the batch snapshots bank_code /
// account_no / account_name per line, and the server rejects a document without one. So rows
// with no payee are NOT selectable rather than failing after the user has picked them — a type
// that doesn't collect a payee (requires_payee off) is settled with Record payment instead.
//
// The checkboxes are hand-rolled rather than DataTable's `selectionMode`: PrimeVue 4 dropped
// v3's `isDataSelectable`, so its own selection cannot refuse a row. Owning the state lets the
// unpayable rows render a genuinely disabled box that explains itself.
const selected = ref<PayableHandoff[]>([]);
const isPayable = (row: PayableHandoff) => !!row.payee;
const building = ref(false);

const payableRows = computed(() => payments.handoffs.filter(isPayable));
const isSelected = (row: PayableHandoff) => selected.value.some((s) => s.documentId === row.documentId);
const allSelected = computed(
  () => payableRows.value.length > 0 && selected.value.length === payableRows.value.length,
);
function toggleRow(row: PayableHandoff, on: boolean) {
  if (!isPayable(row)) return;
  selected.value = on
    ? [...selected.value, row]
    : selected.value.filter((s) => s.documentId !== row.documentId);
}
function toggleAll(on: boolean) {
  selected.value = on ? [...payableRows.value] : [];
}

// The row opens its document, but the selection checkbox lives inside the row: a click there
// must tick the box, not navigate away from the queue.
function onRowClick(e: { originalEvent?: Event; data: PayableHandoff }) {
  const target = e.originalEvent?.target as HTMLElement | undefined;
  if (target?.closest('.p-checkbox, [data-p-selection-column="true"]')) return;
  router.push({ name: 'document-detail', params: { id: e.data.documentId } });
}

async function buildBatch() {
  if (!selected.value.length) return;
  building.value = true;
  try {
    // `format` is left to the server (defaults to CSV); pay date is set on the run itself.
    const batch = await paymentBatchesApi.build({ documentIds: selected.value.map((p) => p.documentId) });
    selected.value = [];
    await router.push({ name: 'payment-batch-detail', params: { id: batch.id } });
  } catch (e) {
    fb.error(e, t('payments.build.failed'));
  } finally {
    building.value = false;
  }
}
const whtCodes = ref<SelectableVat[]>([]);
const dialog = ref<{ open: boolean; doc?: PayableHandoff; rate: string; whtTaxCodeId?: string; result?: PaymentResult | null }>({ open: false, rate: '' });

// Preview of the WHT withheld and the net cash to be paid (base amount × WHT rate).
const whtPreview = computed(() => {
  const code = whtCodes.value.find((c) => c.id === dialog.value.whtTaxCodeId);
  const base = Number(dialog.value.doc?.baseAmount ?? 0);
  if (!code || !base) return { wht: '0', net: dialog.value.doc?.baseAmount ?? '0' };
  const wht = base * Number(code.rate);
  return { wht: wht.toFixed(2), net: (base - wht).toFixed(2) };
});

function openRecord(doc: PayableHandoff) {
  dialog.value = { open: true, doc, rate: '', whtTaxCodeId: undefined, result: null };
}
async function confirmRecord() {
  const doc = dialog.value.doc;
  if (!doc || !dialog.value.rate) return;
  const result = await payments.recordPayment(doc.documentId, dialog.value.rate, dialog.value.whtTaxCodeId);
  if (result) {
    dialog.value.result = result;
    fb.success(t('payments.record.done'));
  } else fb.error(payments.error);
}
const fxSeverity = (kind?: string) => (kind === 'LOSS' ? 'danger' : kind === 'GAIN' ? 'success' : 'secondary');

onMounted(async () => {
  payments.loadHandoffs();
  if (canTax()) whtCodes.value = await taxCodesApi.selectableWht().catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('payments.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button
          v-if="canBatch()"
          :label="selected.length ? $t('payments.build.selected', { count: selected.length }) : $t('payments.build.action')"
          icon="pi pi-send"
          size="small"
          :disabled="!selected.length || building"
          :loading="building"
          data-testid="build-batch"
          @click="buildBatch"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="payments.error" :message="payments.error" @retry="payments.loadHandoffs()" />

    <div v-else class="card">
      <AppDataTable
        :value="payments.handoffs"
        :total="payments.handoffs.length"
        :loading="payments.loading"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['docNo', 'vendorName']"
        dataKey="documentId"
        @refresh="payments.loadHandoffs()"
        @row-click="onRowClick"
      >
        <Column v-if="canBatch()" headerStyle="width:3rem">
          <template #header>
            <Checkbox
              :modelValue="allSelected"
              binary
              :disabled="!payableRows.length"
              :aria-label="$t('payments.build.selectAll')"
              @update:modelValue="toggleAll"
            />
          </template>
          <template #body="{ data }">
            <!-- Disabled, with the reason on hover, for a payable the bank file cannot carry.
                 @click.stop sits on the wrapper, not the Checkbox: a disabled PrimeVue checkbox
                 takes no pointer events, so the click would otherwise reach the row and navigate
                 to the document — picking a box must never leave the queue. -->
            <span
              v-tooltip.top="isPayable(data) ? undefined : $t('payments.noPayeeHint')"
              class="inline-flex"
              @click.stop
            >
              <Checkbox
                :modelValue="isSelected(data)"
                binary
                :disabled="!isPayable(data)"
                :aria-label="data.docNo"
                @update:modelValue="(v: boolean) => toggleRow(data, v)"
              />
            </span>
          </template>
        </Column>
        <Column field="docNo" :header="$t('payments.columns.docNo')" />
        <Column :header="$t('payments.columns.vendor')"><template #body="{ data }">{{ data.vendorName ?? '—' }}</template></Column>
        <!-- Where the money lands. A row without one cannot join a run — say so on the row
             rather than only failing when the user tries. -->
        <Column :header="$t('payments.columns.payee')">
          <template #body="{ data }">
            <span v-if="data.payee" class="text-sm">{{ data.payee.bankCode }} · {{ data.payee.accountNo }}</span>
            <span v-else v-tooltip.top="$t('payments.noPayeeHint')" class="text-sm text-muted-color">
              <i class="pi pi-info-circle mr-1 text-xs" />{{ $t('payments.noPayee') }}
            </span>
          </template>
        </Column>
        <Column field="baseAmount" :header="$t('payments.columns.amount')" />
        <Column :header="$t('payments.columns.gl')"><template #body="{ data }">{{ data.glAccounts.join(', ') || '—' }}</template></Column>
        <Column v-if="canManage()" :header="$t('payments.columns.action')">
          <template #body="{ data }">
            <Button :label="$t('payments.record.action')" size="small" text @click.stop="openRecord(data)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-wallet" :title="$t('payments.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Record an actual payment at its real rate; show the FX gain/loss. -->
    <Dialog v-model:visible="dialog.open" :header="$t('payments.record.action')" modal class="w-96">
      <div v-if="!dialog.result" class="flex flex-col gap-3">
        <div class="text-sm text-muted-color">{{ dialog.doc?.docNo }} — {{ dialog.doc?.baseAmount }}</div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.actualRate') }}</label>
          <InputText v-model="dialog.rate" inputmode="decimal" placeholder="1.0" />
        </div>
        <div v-if="whtCodes.length" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.wht') }}</label>
          <Select v-model="dialog.whtTaxCodeId" :options="whtCodes" optionLabel="code" optionValue="id" showClear :placeholder="$t('payments.record.noWht')" />
        </div>
        <div v-if="dialog.whtTaxCodeId" class="rounded bg-surface-100 p-2 text-sm dark:bg-surface-800">
          <div>{{ $t('payments.record.whtAmount') }}: <span class="tabular-nums">{{ whtPreview.wht }}</span></div>
          <div class="font-medium">{{ $t('payments.record.netPaid') }}: <span class="tabular-nums">{{ whtPreview.net }}</span></div>
        </div>
      </div>
      <div v-else class="flex flex-col gap-2 text-sm">
        <div>{{ $t('payments.record.baseActual') }}: {{ dialog.result.baseActual }}</div>
        <div class="flex items-center gap-2">
          {{ $t('payments.record.fx') }}:
          <Tag :severity="fxSeverity(dialog.result.fxKind)" :value="$t('payments.record.kind.' + dialog.result.fxKind) + ' ' + dialog.result.fxDelta" />
        </div>
        <div v-if="Number(dialog.result.whtAmount)">{{ $t('payments.record.whtAmount') }}: <span class="tabular-nums">{{ dialog.result.whtAmount }}</span></div>
      </div>
      <template #footer>
        <Button :label="$t('common.close')" text @click="dialog.open = false" />
        <Button v-if="!dialog.result" :label="$t('payments.record.confirm')" :disabled="!dialog.rate" @click="confirmRecord" />
      </template>
    </Dialog>
  </div>
</template>
