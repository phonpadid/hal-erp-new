<script setup lang="ts">
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { Decimal } from 'decimal.js';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import FileUpload from 'primevue/fileupload';
import Textarea from 'primevue/textarea';
import PaymentSlips from '@/components/payments/PaymentSlips.vue';
import { usePaymentsStore } from '../../stores/payments';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { taxCodesApi } from '../../api/taxCodes';
import { paymentBatchesApi } from '../../api/payments';
import { PAYMENT_METHODS } from '../../api/payments';
import type { PayableHandoff, PaymentMethod, PaymentResult } from '../../api/payments';
import type { SelectableVat } from '../../api/taxCodes';

const router = useRouter();
const { t } = useI18n();
const payments = usePaymentsStore();
const auth = useAuthStore();
const fb = useFeedback();
// The queue's amounts are settled BASE amounts (the actual posted to the budget), so they
// format against the company's base currency — unlike a batch line, which is in the
// document's own currency.
const { fmtBase, baseCode } = useCurrencyFormat();
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
const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: `payments.record.method.${m}` }));
const dialog = ref<{
  open: boolean;
  doc?: PayableHandoff;
  rate: string;
  whtTaxCodeId?: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  file?: File;
  result?: PaymentResult | null;
}>({ open: false, rate: '', method: 'TRANSFER', reference: '', note: '' });

// Preview of the WHT withheld and the net cash to be paid (base amount × WHT rate).
// Decimal, never a JS number: `baseAmount` and `rate` are decimal strings, and float
// arithmetic on money drifts (0.1 + 0.2). The server recomputes the authoritative figures.
const whtPreview = computed(() => {
  const code = whtCodes.value.find((c) => c.id === dialog.value.whtTaxCodeId);
  const raw = dialog.value.doc?.baseAmount ?? '0';
  const base = new Decimal(raw || '0');
  if (!code || base.isZero()) return { wht: '0', net: raw };
  const wht = base.times(code.rate);
  return { wht: wht.toString(), net: base.minus(wht).toString() };
});

function openRecord(doc: PayableHandoff) {
  dialog.value = {
    open: true, doc, rate: '', whtTaxCodeId: undefined,
    method: 'TRANSFER', reference: '', note: '', file: undefined, result: null,
  };
}

/**
 * Evidence is required for everything recorded here: nothing on this screen came out of a bank
 * batch, so nothing on it has a file behind it already. The button stays disabled rather than
 * letting the server refuse — the refusal would be correct and the round-trip pointless.
 */
const canConfirm = computed(() => !!dialog.value.rate && !!dialog.value.file);

async function confirmRecord() {
  const doc = dialog.value.doc;
  if (!doc || !canConfirm.value) return;
  const result = await payments.recordPayment(doc.documentId, {
    actualRate: dialog.value.rate,
    whtTaxCodeId: dialog.value.whtTaxCodeId,
    method: dialog.value.method,
    reference: dialog.value.reference || undefined,
    note: dialog.value.note || undefined,
    file: dialog.value.file,
  });
  if (result) {
    dialog.value.result = result;
    fb.success(t('payments.record.done'));
  } else fb.error(payments.error);
}
const fxSeverity = (kind?: string) => (kind === 'LOSS' ? 'danger' : kind === 'GAIN' ? 'success' : 'secondary');
/** Whether a decimal-string amount is non-zero (Decimal, not Number — money rule). */
const nonZero = (amount?: string) => !!amount && !new Decimal(amount).isZero();

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
        clientPaged
        :value="payments.handoffs"
        :total="payments.handoffs.length"
        :loading="payments.loading"
        :rowHover="true"
        :filters="filters"
        :globalFilterFields="['docNo', 'vendorName', 'owedTo']"
        dataKey="documentId"
        @refresh="payments.loadHandoffs()"
        @row-click="onRowClick"
      >
        <!-- Selection for the bank run. The header is labelled like every other column: an
             unlabelled checkbox says nothing about what ticking it does. -->
        <Column v-if="canBatch()" headerStyle="width:7rem">
          <template #header>
            <span class="flex items-center gap-2">
              <Checkbox
                :modelValue="allSelected"
                binary
                :disabled="!payableRows.length"
                :aria-label="$t('payments.build.selectAll')"
                @update:modelValue="toggleAll"
              />
              <span class="font-normal">{{ $t('payments.columns.select') }}</span>
            </span>
          </template>
          <template #body="{ data }">
            <!-- No box at all for a payable the bank file cannot carry: a disabled checkbox reads
                 as broken, and the payee column already states the reason on the same row.
                 @click.stop sits on the wrapper so ticking never also opens the document. -->
            <span v-if="isPayable(data)" class="inline-flex" @click.stop>
              <Checkbox
                :modelValue="isSelected(data)"
                binary
                :aria-label="data.docNo"
                @update:modelValue="(v: boolean) => toggleRow(data, v)"
              />
            </span>
          </template>
        </Column>
        <Column field="docNo" :header="$t('payments.columns.docNo')" />
        <!-- Trade or other. A supplier invoice agreed on terms and a claim owed to a person now
             are different obligations; a list that renders them identically reports a total
             nobody can compose. -->
        <Column :header="$t('payments.columns.kind')">
          <template #body="{ data }">
            <Tag
              v-if="data.payableKind"
              :value="$t(`payments.kind.${data.payableKind}`)"
              :severity="data.payableKind === 'CLAIM' ? 'info' : 'secondary'"
              data-testid="payable-kind"
            />
            <span v-else class="text-sm text-muted-color">{{ $t('payments.kind.NONE') }}</span>
          </template>
        </Column>
        <!-- Who is owed: the vendor, or the person a claim relates to. Never the document's
             author — naming the wrong payee is worse than naming none, and the doc no identifies
             the row either way. -->
        <Column :header="$t('payments.columns.owedTo')">
          <template #body="{ data }">
            <span v-if="data.owedTo" data-testid="owed-to">{{ data.owedTo }}</span>
            <span v-else class="text-muted-color">—</span>
          </template>
        </Column>
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
        <!-- Money right-aligned and tabular so the column can be scanned down; formatted to the
             base currency's decimal places rather than printed as the raw decimal string. -->
        <Column
          field="baseAmount"
          :header="$t('payments.columns.amount')"
          headerClass="[&>div]:justify-end"
          bodyClass="text-right! tabular-nums"
        >
          <template #body="{ data }">
            {{ fmtBase(data.baseAmount) }} <span class="text-muted-color">{{ baseCode() }}</span>
          </template>
        </Column>
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
        <div class="text-sm text-muted-color">
          {{ dialog.doc?.docNo }} — <span class="tabular-nums">{{ fmtBase(dialog.doc?.baseAmount ?? '0') }}</span> {{ baseCode() }}
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.actualRate') }}</label>
          <InputText v-model="dialog.rate" inputmode="decimal" placeholder="1.0" />
        </div>
        <div v-if="whtCodes.length" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.wht') }}</label>
          <Select v-model="dialog.whtTaxCodeId" :options="whtCodes" optionLabel="code" optionValue="id" showClear :placeholder="$t('payments.record.noWht')" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.method.label') }}</label>
          <Select
            v-model="dialog.method"
            :options="methodOptions"
            optionValue="value"
            data-testid="method"
          >
            <template #value="{ value }">{{ value ? $t(`payments.record.method.${value}`) : '' }}</template>
            <template #option="{ option }">{{ $t(option.label) }}</template>
          </Select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.reference') }}</label>
          <InputText v-model="dialog.reference" data-testid="reference" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.note') }}</label>
          <Textarea v-model="dialog.note" rows="2" autoResize />
        </div>
        <!-- The evidence goes WITH the record. Nothing on this screen came from a bank batch, so
             nothing on it is evidenced by a file the company already sent. -->
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('payments.record.evidence') }}</label>
          <FileUpload
            mode="basic"
            :auto="false"
            :customUpload="true"
            :chooseLabel="dialog.file ? dialog.file.name : $t('payments.record.chooseEvidence')"
            data-testid="evidence"
            @select="(e: { files: File[] }) => (dialog.file = e.files[0])"
          />
          <small class="text-muted-color">{{ $t('payments.record.evidenceHint') }}</small>
        </div>
        <div v-if="dialog.whtTaxCodeId" class="rounded bg-surface-100 p-2 text-sm dark:bg-surface-800">
          <div>{{ $t('payments.record.whtAmount') }}: <span class="tabular-nums">{{ fmtBase(whtPreview.wht) }}</span> {{ baseCode() }}</div>
          <div class="font-medium">{{ $t('payments.record.netPaid') }}: <span class="tabular-nums">{{ fmtBase(whtPreview.net) }}</span> {{ baseCode() }}</div>
        </div>
      </div>
      <div v-else class="flex flex-col gap-2 text-sm">
        <div>
          {{ $t('payments.record.baseActual') }}:
          <span class="tabular-nums">{{ fmtBase(dialog.result.baseActual) }}</span> {{ baseCode() }}
        </div>
        <div class="flex items-center gap-2">
          {{ $t('payments.record.fx') }}:
          <Tag :severity="fxSeverity(dialog.result.fxKind)" :value="$t('payments.record.kind.' + dialog.result.fxKind) + ' ' + fmtBase(dialog.result.fxDelta)" />
        </div>
        <div v-if="nonZero(dialog.result.whtAmount)">
          {{ $t('payments.record.whtAmount') }}:
          <span class="tabular-nums">{{ fmtBase(dialog.result.whtAmount) }}</span> {{ baseCode() }}
        </div>
        <!-- Attach the bank's slip here, while it is in hand: this disbursement has just left the
             queue, and from now on its evidence is read from the document. -->
        <Divider class="my-1!" />
        <PaymentSlips v-if="dialog.doc" :documentId="dialog.doc.documentId" />
      </div>
      <template #footer>
        <Button :label="$t('common.close')" text @click="dialog.open = false" />
        <Button
          v-if="!dialog.result"
          :label="$t('payments.record.confirm')"
          :disabled="!canConfirm"
          data-testid="confirm-record"
          @click="confirmRecord"
        />
      </template>
    </Dialog>
  </div>
</template>
