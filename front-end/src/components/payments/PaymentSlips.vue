<script setup lang="ts">
/**
 * The slips proving a payment left the bank: list, attach, remove.
 *
 * Keyed by DOCUMENT id — a payment is unique per document and the client is never handed the
 * payment's own id. Mounted in two places: the record confirmation, where the slip is in hand,
 * and the paid disbursement's document, which is where it can still be read tomorrow (the
 * ready-to-pay queue drops a disbursement the moment it is paid).
 *
 * Attaching one also STATES which of the company's own accounts the transfer left and the rate the
 * money actually converted at. Those questions are asked here rather than on the record-payment
 * screen because here is where the answers are known: finance attaches the slip at the approval step
 * that demands it, which in this company is the moment the money actually goes out, and the bank's
 * rate for that day is on the slip in their hand. `PaymentService.record` adopts both onto the
 * payment later, so nobody is asked the same question twice.
 *
 * Controls follow permission CODES, mirroring the server; the client guard is UX only.
 *
 * Whether a document HAS a payment is the caller's business, answered by `hasPayment` on the
 * detail response. This panel used to answer it by asking for the slips and treating any
 * rejection as "never paid" — so a 500 or a dropped connection hid the evidence panel of a
 * document that does have evidence, and said nothing.
 */
import Button from 'primevue/button';
import FileUpload from 'primevue/fileupload';
import type { FileUploadUploaderEvent } from 'primevue/fileupload';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import RadioButton from 'primevue/radiobutton';
import { Decimal } from 'decimal.js';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { paymentsApi, TRANSFER_SOURCES, type PaymentSlip, type TransferSource } from '../../api/payments';
import { formatRate } from '../../utils/rate';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';

const props = defineProps<{
  documentId: string;
  /**
   * The document's base-currency total AT ITS LOCKED RATE. Used only to show what the rate being
   * typed would record — the effect nobody could see before, which made a correctly locked document
   * look as though it had ignored the rate finance entered.
   */
  baseLocked?: string;
  /**
   * The rate stamped on the document at submit. Offered as the starting value for the rate below,
   * so finance corrects a figure rather than retyping one — which is where a digit gets dropped.
   * Optional: a caller that does not know it leaves the field empty rather than inventing one.
   */
  lockedRate?: string;
  /**
   * Whether a payment has already been recorded for this document.
   *
   * Once it has, the account and the rate below are settled: a payment is written once, and a
   * different figure typed here would change nothing. The fields become a statement of what was
   * recorded rather than inputs that quietly do nothing — a box that accepts an edit and discards
   * it is worse than no box.
   */
  paymentRecorded?: boolean;
  /**
   * Whether the server would accept a restatement of this document's rate — in approval, with a
   * step left to decide, and unpaid. The rate control is offered only where it would be accepted:
   * a screen that offers an edit the server refuses teaches people that the screen lies.
   */
  canRestateRate?: boolean;
}>();
/**
 * Raised whenever the set of slips changed. The approval dialog listens so a step's transfer-slip
 * requirement flips the moment evidence arrives, without the approver reloading.
 */
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const auth = useAuthStore();
const fb = useFeedback();
const { fmtBase, baseCode } = useCurrencyFormat();

const slips = ref<PaymentSlip[]>([]);
const loading = ref(true);
const busy = ref(false);
const failed = ref(false);

/**
 * Which of the company's own accounts the transfer left. Both options are rendered at once,
 * deliberately: this is a confirmation of a fact the person already knows, and a dropdown
 * defaulting to "main" would be answered by not answering.
 *
 * The upload button stays disabled until it is chosen, rather than letting a slip be attached with
 * the question unanswered — an unanswered column is one no later reader can tell from a real answer.
 */
const transferSources = TRANSFER_SOURCES;
const transferFrom = ref<TransferSource | undefined>(undefined);

/**
 * The rate the money actually converted at, as a decimal STRING — never a JS number, like every
 * money figure on the wire.
 *
 * Started from the document's locked rate and editable: finance is confirming or correcting the
 * figure the document already carries, which is what the bank actually gave them on the day. What
 * they submit is what gets recorded; nothing here is substituted server-side.
 */
const actualRate = ref<string>('');
/** The rate as the server last confirmed it, so an unsaved edit can be told from a stored one. */
const savedRate = ref<string>('');
const savingRate = ref(false);
const rateIsDirty = computed(() => actualRate.value.trim() !== savedRate.value.trim());
const rateIsPositive = computed(() => {
  const raw = actualRate.value.trim();
  if (!raw) return false;
  try {
    return new Decimal(raw).greaterThan(0);
  } catch {
    return false;
  }
});
/** Everything the slip has to say before it can be attached. */
const canAttachSlip = computed(() => !!transferFrom.value && rateIsPositive.value);

/**
 * What the rate being typed would actually record — and, just as importantly, what it would NOT.
 *
 * The document's rate is stamped at submit and never recomputed (invariant 6), so entering a
 * different rate here does not restate the document: its total and its base total stay exactly as
 * approved, and the difference becomes an FX gain or loss for accounting, which never touches the
 * budget. That is correct and it is also invisible, and a screen that shows a rate being entered
 * while every figure above it stays put reads as a screen that dropped the entry.
 *
 * A PREVIEW. `PaymentService.record` computes the authoritative figures the same way, from the same
 * two rates; this only says in advance what it will do.
 */
const rateEffect = computed(() => {
  const locked = props.lockedRate;
  if (!locked || !props.baseLocked || !rateIsPositive.value) return null;
  try {
    const lockedRate = new Decimal(locked);
    if (lockedRate.isZero()) return null;
    const actual = new Decimal(actualRate.value.trim());
    if (actual.equals(lockedRate)) return { same: true, baseActual: '', delta: '', kind: 'NONE' as const };
    // base_actual = base_locked × actual / locked — the server's formula, not a second one.
    const baseActual = new Decimal(props.baseLocked).times(actual).dividedBy(lockedRate);
    const delta = baseActual.minus(props.baseLocked);
    return {
      same: false,
      baseActual: baseActual.toFixed(),
      delta: delta.abs().toFixed(),
      kind: delta.isPositive() ? ('LOSS' as const) : ('GAIN' as const),
    };
  } catch {
    return null;
  }
});

const canAttach = () => auth.can('PAYMENT_MANAGE');
const canDelete = () => auth.can('PAYMENT_SLIP_DELETE');

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    slips.value = await paymentsApi.slips.list(props.documentId);
    // Carry forward what an earlier slip on this document already said, so attaching a second one
    // confirms rather than re-asks. Still editable — a later slip may correct the first.
    transferFrom.value = transferFrom.value ?? slips.value.find((s) => s.transferFrom)?.transferFrom;
    // The same carry-forward for the rate: an earlier slip's figure, else the document's locked
    // rate, else empty. Never a value this screen invented.
    // Trimmed for the person reading it: the column is NUMERIC(_, 8), so an untouched kip rate
    // arrives as `23000.00000000`. Only zeros are dropped, so nothing they submit is a rounded
    // version of what the document said.
    const stored =
      formatRate(slips.value.find((s) => s.actualRate)?.actualRate) || formatRate(props.lockedRate);
    savedRate.value = stored;
    actualRate.value = actualRate.value || stored;
  } catch {
    // A failure is a failure. `list` now answers for a document with no payment too — a slip can
    // be attached during approval — so an empty result means "no slips", and only a thrown error
    // means "could not read them".
    slips.value = [];
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

async function onUpload(event: FileUploadUploaderEvent) {
  const files = (Array.isArray(event.files) ? event.files : [event.files]) as File[];
  // Nothing left to state once the payment is recorded, so nothing left to require.
  if (!props.paymentRecorded && !canAttachSlip.value) return;
  busy.value = true;
  try {
    for (const file of files)
      await paymentsApi.slips.upload(
        props.documentId,
        file,
        props.paymentRecorded
          ? {}
          : { transferFrom: transferFrom.value, actualRate: actualRate.value.trim() },
      );
    await load();
    emit('changed');
    fb.success(t('payments.slips.attached'));
  } catch (e) {
    fb.error(e, t('payments.slips.uploadFailed'));
  } finally {
    busy.value = false;
  }
}

/**
 * Save the rate on its own — no file, because a correction to a figure and a second copy of a slip
 * already on file are different acts.
 *
 * The document is restated by it: its worth and its budget hold both move (the server decides
 * whether the hold moves, and refuses a restatement that would breach a ceiling). The reload
 * afterwards is what makes the saved figure the one on screen rather than the one that was typed.
 */
async function saveRate() {
  if (!rateIsPositive.value || savingRate.value) return;
  savingRate.value = true;
  try {
    await paymentsApi.slips.stateRate(props.documentId, actualRate.value.trim());
    savedRate.value = actualRate.value.trim();
    await load();
    emit('changed');
    fb.success(t('payments.slips.rateSaved'));
  } catch (e) {
    fb.error(e, t('payments.slips.rateSaveFailed'));
  } finally {
    savingRate.value = false;
  }
}

async function download(slip: PaymentSlip) {
  try {
    // A short-lived presigned URL — the storage key never reaches the client.
    window.open(await paymentsApi.slips.downloadUrl(props.documentId, slip.id), '_blank');
  } catch (e) {
    fb.error(e, t('payments.slips.downloadFailed'));
  }
}

async function remove(slip: PaymentSlip) {
  busy.value = true;
  try {
    await paymentsApi.slips.remove(props.documentId, slip.id);
    await load();
    emit('changed');
    fb.success(t('payments.slips.deleted'));
  } catch (e) {
    fb.error(e, t('payments.slips.deleteFailed'));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="payment-slips">
    <div class="flex items-center gap-2">
      <i class="pi pi-paperclip text-muted-color text-sm" />
      <span class="text-sm font-medium text-color">{{ $t('payments.slips.title') }}</span>
    </div>

    <div v-if="loading" class="text-xs text-muted-color">{{ $t('common.loading') }}</div>

    <template v-else>
      <!-- A failed read is not an absence of evidence, and must not be drawn as one. -->
      <Message v-if="failed" severity="warn" variant="simple" size="small" data-testid="slips-failed">
        {{ $t('payments.slips.failed') }}
        <Button :label="$t('common.retry')" link size="small" class="p-0" @click="load()" />
      </Message>

      <!-- Say it plainly: an empty area reads as a broken panel. -->
      <Message v-else-if="!slips.length" severity="secondary" variant="simple" size="small" data-testid="no-slips">
        {{ $t('payments.slips.empty') }}
      </Message>

      <ul v-else class="flex flex-col gap-1" data-testid="slip-list">
        <li
          v-for="slip in slips"
          :key="slip.id"
          class="flex items-center gap-2 rounded border border-surface-200 px-2 py-1 dark:border-surface-700"
        >
          <i class="pi pi-file text-xs text-muted-color" />
          <button type="button" class="flex-1 truncate text-left text-sm text-primary hover:underline" @click="download(slip)">
            {{ slip.fileName }}
          </button>
          <!-- What the person who attached it said, beside the file it belongs to. -->
          <span
            v-if="slip.transferFrom"
            class="text-xs text-muted-color"
            data-testid="slip-stated-account"
          >
            {{ $t(`payments.record.transferFrom.${slip.transferFrom}`) }}
          </span>
          <span
            v-if="slip.actualRate"
            class="text-xs text-muted-color tabular-nums"
            data-testid="slip-stated-rate"
          >
            @ {{ formatRate(slip.actualRate) }}
          </span>
          <span v-if="slip.fileSizeKb" class="text-xs text-muted-color tabular-nums">{{ slip.fileSizeKb }} KB</span>
          <Button
            v-if="canDelete()"
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            :disabled="busy"
            :aria-label="$t('common.delete')"
            data-testid="slip-delete"
            @click="remove(slip)"
          />
        </li>
      </ul>

      <!-- Already paid: the account and rate are settled, so they are stated, not asked. -->
      <Message
        v-if="canAttach() && paymentRecorded"
        severity="secondary"
        variant="simple"
        size="small"
        data-testid="slip-payment-recorded"
      >
        {{ $t('payments.slips.alreadyRecorded') }}
      </Message>

      <!-- Which of the company's own accounts the money left, stated with the slip because that is
           when it is known. Asked before the file can be chosen: a slip attached with the question
           unanswered leaves a column nobody can read later. -->
      <template v-if="canAttach() && !paymentRecorded">
        <div class="flex flex-col gap-1" data-testid="slip-transfer-from">
          <label class="text-sm text-muted-color">{{ $t('payments.record.transferFrom.label') }}</label>
          <div class="flex gap-4">
            <label v-for="src in transferSources" :key="src" class="flex items-center gap-2 text-sm">
              <RadioButton
                v-model="transferFrom"
                :value="src"
                :inputId="`slip-transfer-from-${src}`"
                :data-testid="`slip-transfer-from-${src}`"
              />
              <span>{{ $t(`payments.record.transferFrom.${src}`) }}</span>
            </label>
          </div>
          <small v-if="!transferFrom" class="text-muted-color" data-testid="slip-transfer-from-required">
            {{ $t('payments.slips.transferFromRequired') }}
          </small>
        </div>

        <!-- The rate the money actually converted at, on the day. Started from the document's locked
             rate so finance corrects a figure instead of retyping one, and editable because the bank
             is what decides it, not the document.

             It saves on its own where the server would accept a restatement: a correction to a
             figure and a second copy of a slip already on file are different acts, and tying them
             together is what silently discarded a rate finance had already typed. -->
        <div class="flex flex-col gap-1" data-testid="slip-actual-rate">
          <label class="text-sm text-muted-color">{{ $t('payments.record.actualRate') }}</label>
          <div class="flex items-center gap-2">
            <InputText
              v-model="actualRate"
              inputmode="decimal"
              placeholder="1.0"
              class="flex-1"
              data-testid="slip-actual-rate-input"
            />
            <Button
              v-if="canRestateRate"
              :label="$t('common.save')"
              size="small"
              :disabled="!rateIsPositive || !rateIsDirty || savingRate"
              :loading="savingRate"
              data-testid="slip-rate-save"
              @click="saveRate"
            />
          </div>
          <!-- Typed is not stored, and the difference has to be visible: the box that accepted a
               correction and threw it away showed nothing at all. -->
          <small v-if="canRestateRate && rateIsDirty && rateIsPositive" class="text-amber-600 dark:text-amber-400" data-testid="slip-rate-unsaved">
            {{ $t('payments.slips.rateUnsaved') }}
          </small>
          <small v-else-if="!canRestateRate" class="text-muted-color" data-testid="slip-rate-locked">
            {{ $t('payments.slips.rateLocked') }}
          </small>
          <small v-if="!rateIsPositive" class="text-muted-color" data-testid="slip-actual-rate-required">
            {{ $t('payments.slips.actualRateRequired') }}
          </small>
          <!-- What this rate does, said before it is submitted. Without it a correctly locked
               document looks as though it ignored the entry: every figure above stays put, because
               the document's rate is stamped at submit and never recomputed (invariant 6). -->
          <small v-else-if="rateEffect?.same" class="text-muted-color" data-testid="slip-rate-same">
            {{ $t('payments.slips.rateSame') }}
          </small>
          <small v-else-if="rateEffect && canRestateRate" class="text-muted-color" data-testid="slip-rate-effect-restates">
            {{ $t('payments.slips.rateEffectRestates', {
              actual: `${fmtBase(rateEffect.baseActual)} ${baseCode() ?? ''}`.trim(),
              locked: formatRate(props.lockedRate),
            }) }}
          </small>
          <small v-else-if="rateEffect" class="text-muted-color" data-testid="slip-rate-effect">
            {{ $t('payments.slips.rateEffect', {
              actual: `${fmtBase(rateEffect.baseActual)} ${baseCode() ?? ''}`.trim(),
              locked: formatRate(props.lockedRate),
              kind: `${$t('payments.slips.rateEffectKind.' + rateEffect.kind)} ${fmtBase(rateEffect.delta)}`,
            }) }}
          </small>
        </div>

        <FileUpload
          mode="basic"
          name="file"
          customUpload
          auto
          multiple
          :disabled="busy || !canAttachSlip"
          :chooseLabel="$t('payments.slips.attach')"
          chooseIcon="pi pi-upload"
          data-testid="slip-upload"
          @uploader="onUpload"
        />
      </template>

      <!-- More evidence is still welcome after the payment is recorded — a second slip, a bank
           statement. It simply has nothing left to state. -->
      <FileUpload
        v-else-if="canAttach()"
        mode="basic"
        name="file"
        customUpload
        auto
        multiple
        :disabled="busy"
        :chooseLabel="$t('payments.slips.attach')"
        chooseIcon="pi pi-upload"
        data-testid="slip-upload"
        @uploader="onUpload"
      />
    </template>
  </div>
</template>
