<script setup lang="ts">
/**
 * Record an actual payment at its real rate; show the FX gain/loss.
 *
 * Extracted from `ReadyToPayView.vue` so `DocumentDetailView.vue` can mount the same form: a
 * document whose current step already requires and has payment evidence attached can be paid
 * right there, instead of forcing a second visit to the ready-to-pay queue once every remaining
 * step finally approves.
 */
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Divider from 'primevue/divider';
import FileUpload from 'primevue/fileupload';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { Decimal } from 'decimal.js';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import PaymentSlips from './PaymentSlips.vue';
import { usePaymentsStore } from '../../stores/payments';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { taxCodesApi } from '../../api/taxCodes';
import { PAYMENT_METHODS } from '../../api/payments';
import type { PaymentMethod, PaymentResult } from '../../api/payments';
import type { SelectableVat } from '../../api/taxCodes';

const props = defineProps<{
  visible: boolean;
  documentId: string;
  docNo?: string;
  /** Base-currency amount to show while the form is open (display only). */
  baseAmount?: string;
  /**
   * True when the caller already knows a slip is attached to this document (the mid-approval
   * case — the Record action only appears once one exists). Defaults to false, matching the
   * ready-to-pay queue: nothing there came out of a bank batch, so nothing has a file behind it
   * yet, and a file is required with the record exactly as it always has been.
   */
  evidenceAlreadyAttached?: boolean;
}>();
const emit = defineEmits<{ 'update:visible': [boolean]; recorded: [PaymentResult] }>();

const { t } = useI18n();
const payments = usePaymentsStore();
const auth = useAuthStore();
const fb = useFeedback();
const { fmtBase, baseCode } = useCurrencyFormat();

const canTax = () => auth.can('TAX_VIEW');
const whtCodes = ref<SelectableVat[]>([]);
const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: `payments.record.method.${m}` }));

const form = ref<{
  rate: string;
  whtTaxCodeId?: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  file?: File;
  result?: PaymentResult | null;
}>({ rate: '', method: 'TRANSFER', reference: '', note: '', result: null });

// Reset whenever the dialog opens for a (possibly different) document — a stale rate or result
// from the previous document must never bleed into this one.
watch(
  () => props.visible,
  (open) => {
    if (open) form.value = { rate: '', whtTaxCodeId: undefined, method: 'TRANSFER', reference: '', note: '', file: undefined, result: null };
  },
);

const whtPreview = computed(() => {
  const code = whtCodes.value.find((c) => c.id === form.value.whtTaxCodeId);
  const raw = props.baseAmount ?? '0';
  const base = new Decimal(raw || '0');
  if (!code || base.isZero()) return { wht: '0', net: raw };
  const wht = base.times(code.rate);
  return { wht: wht.toString(), net: base.minus(wht).toString() };
});

/**
 * Evidence is required unless it is already attached — a step gating approval on a slip may
 * already have one, and the server does not ask twice for the same money (`alreadyEvidenced`).
 * The button stays disabled rather than letting the server refuse — the refusal would be
 * correct and the round-trip pointless.
 */
const canConfirm = computed(
  () => !!form.value.rate && (props.evidenceAlreadyAttached || !!form.value.file),
);

async function confirmRecord() {
  if (!canConfirm.value) return;
  const result = await payments.recordPayment(props.documentId, {
    actualRate: form.value.rate,
    whtTaxCodeId: form.value.whtTaxCodeId,
    method: form.value.method,
    reference: form.value.reference || undefined,
    note: form.value.note || undefined,
    file: form.value.file,
  });
  if (result) {
    form.value.result = result;
    fb.success(t('payments.record.done'));
    emit('recorded', result);
  } else fb.error(payments.error);
}
const fxSeverity = (kind?: string) => (kind === 'LOSS' ? 'danger' : kind === 'GAIN' ? 'success' : 'secondary');
const nonZero = (amount?: string) => !!amount && !new Decimal(amount).isZero();

onMounted(async () => {
  if (canTax()) whtCodes.value = await taxCodesApi.selectableWht().catch(() => []);
});
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(v: boolean) => emit('update:visible', v)"
    :header="$t('payments.record.action')"
    modal
    class="w-96"
  >
    <div v-if="!form.result" class="flex flex-col gap-3">
      <div class="text-sm text-muted-color">
        {{ docNo }} — <span class="tabular-nums">{{ fmtBase(baseAmount ?? '0') }}</span> {{ baseCode() }}
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.actualRate') }}</label>
        <InputText v-model="form.rate" inputmode="decimal" placeholder="1.0" />
      </div>
      <div v-if="whtCodes.length" class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.wht') }}</label>
        <Select v-model="form.whtTaxCodeId" :options="whtCodes" optionLabel="code" optionValue="id" showClear :placeholder="$t('payments.record.noWht')" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.method.label') }}</label>
        <Select v-model="form.method" :options="methodOptions" optionValue="value" data-testid="method">
          <template #value="{ value }">{{ value ? $t(`payments.record.method.${value}`) : '' }}</template>
          <template #option="{ option }">{{ $t(option.label) }}</template>
        </Select>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.reference') }}</label>
        <InputText v-model="form.reference" data-testid="reference" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.note') }}</label>
        <Textarea v-model="form.note" rows="2" autoResize />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('payments.record.evidence') }}</label>
        <FileUpload
          mode="basic"
          :auto="false"
          :customUpload="true"
          :chooseLabel="form.file ? form.file.name : $t('payments.record.chooseEvidence')"
          data-testid="evidence"
          @select="(e: { files: File[] }) => (form.file = e.files[0])"
        />
        <small class="text-muted-color">
          {{ evidenceAlreadyAttached ? $t('payments.record.evidenceAlreadyAttachedHint') : $t('payments.record.evidenceHint') }}
        </small>
      </div>
      <div v-if="form.whtTaxCodeId" class="rounded bg-surface-100 p-2 text-sm dark:bg-surface-800">
        <div>{{ $t('payments.record.whtAmount') }}: <span class="tabular-nums">{{ fmtBase(whtPreview.wht) }}</span> {{ baseCode() }}</div>
        <div class="font-medium">{{ $t('payments.record.netPaid') }}: <span class="tabular-nums">{{ fmtBase(whtPreview.net) }}</span> {{ baseCode() }}</div>
      </div>
    </div>
    <div v-else class="flex flex-col gap-2 text-sm">
      <div>
        {{ $t('payments.record.baseActual') }}:
        <span class="tabular-nums">{{ fmtBase(form.result.baseActual) }}</span> {{ baseCode() }}
      </div>
      <div class="flex items-center gap-2">
        {{ $t('payments.record.fx') }}:
        <Tag :severity="fxSeverity(form.result.fxKind)" :value="$t('payments.record.kind.' + form.result.fxKind) + ' ' + fmtBase(form.result.fxDelta)" />
      </div>
      <div v-if="nonZero(form.result.whtAmount)">
        {{ $t('payments.record.whtAmount') }}:
        <span class="tabular-nums">{{ fmtBase(form.result.whtAmount) }}</span> {{ baseCode() }}
      </div>
      <Divider class="my-1!" />
      <PaymentSlips :documentId="documentId" />
    </div>
    <template #footer>
      <Button :label="$t('common.close')" text @click="emit('update:visible', false)" />
      <Button
        v-if="!form.result"
        :label="$t('payments.record.confirm')"
        :disabled="!canConfirm"
        data-testid="confirm-record"
        @click="confirmRecord"
      />
    </template>
  </Dialog>
</template>
