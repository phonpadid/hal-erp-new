<script setup lang="ts">
/**
 * Approve-from-list modal, shared by the documents list and the approval inbox. Given a document
 * id it fetches the submitted reason (the requester's filled form fields) plus the total amount,
 * and — when the server says the current user may act — offers Approve / Reject / Return with an
 * optional remark. Eligibility (`canAct`) is fetched fresh on open and the server re-enforces the
 * action, so this is a UX gate only. Deliberately shows the headline total only (no line-item
 * table) to keep the dialog scannable.
 */
import BudgetMovements from './BudgetMovements.vue';
import SignatureRequiredNotice from './SignatureRequiredNotice.vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import Message from 'primevue/message';
import { Decimal } from 'decimal.js';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentsApi } from '../../api/documents';
import type { CanActResult, DocumentDetail } from '../../api/documents';
import type { ApprovalAction } from '../../api/approvals';
import PaymentSlips from '../payments/PaymentSlips.vue';
import { useApprovalsStore } from '../../stores/approvals';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { fieldComponent } from '../../utils/formFields';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { sumAmounts } from '../../utils/money';

const props = defineProps<{ docId: string; docNo: string }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ acted: [] }>();

const { t } = useI18n();
const approvals = useApprovalsStore();
const auth = useAuthStore();
const feedback = useFeedback();
const { fmt, fmtBase, baseCode } = useCurrencyFormat();

const state = reactive({
  loading: false,
  acting: false,
  canAct: false,
  /** Why Approve alone is closed although the user may act — the server's `can-act` reason. */
  canActReason: null as 'SIGNATURE_REQUIRED' | null,
  remark: '',
  detail: null as DocumentDetail | null,
});

/** Rich-text fields store an HTML fragment; render sanitized, plain fields as text. */
const isHtmlField = (fieldType: string) => !!fieldComponent(fieldType).html;

// Only the fields the requester actually filled in — an empty field rendered as "—" reads as noise.
const reviewFields = computed(() =>
  (state.detail?.fieldValues ?? []).filter((fv) => fv.value != null && String(fv.value).trim() !== ''),
);

// Headline amount. The document total is resolved in priority order so a figure always shows:
//   1. `totalAmount` — the requested amount in the document's own currency (if the wizard set it)
//   2. `baseTotalAmount` — the server-computed grand total in base currency, stamped on submit
//      (reliably present for anything IN_APPROVAL)
//   3. the summed line amounts — last-resort reconciliation, mirroring the detail page
// Money always routes through the currency formatters — never a JS number.
const lineTotal = computed(() => sumAmounts((state.detail?.lines ?? []).map((l) => l.lineAmount)));
const amount = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  if (!d) return '';
  if (d.totalAmount != null) return fmt(d.totalAmount, d.currency?.code);
  if (d.baseTotalAmount != null) return fmtBase(d.baseTotalAmount);
  return fmt(lineTotal.value, d.currency?.code);
});
// Secondary base-currency line, shown only when the headline is a foreign-currency figure.
const baseAmount = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  if (!d) return null;
  const code = d.currency?.code ?? baseCode();
  if (d.totalAmount == null || code === baseCode() || d.baseTotalAmount == null) return null;
  return fmtBase(d.baseTotalAmount);
});
/**
 * The budgets this document charges, as the server derived them. Never recomputed here: the balance
 * formula is invariant 3, and a screen doing its own arithmetic is how two views come to disagree
 * about the same pot.
 */
const budgets = computed(() => state.detail?.budgets ?? []);
/** Decimal, not Number — an overdrawn pot must be detected on the string that came off the wire. */
const isNegative = (amount: string) => {
  try {
    return new Decimal(amount).isNegative();
  } catch {
    return false;
  }
};

// The rate stamped on the document at submit, handed to the slip panel as the starting value for
// the rate finance confirms. Read as stamped, never recomputed (invariant 6).
const lockedRate = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  return d?.exchangeRate != null ? String(d.exchangeRate) : undefined;
});
/** The base total AT that locked rate — what the slip panel measures a different rate against. */
const baseLocked = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  return d?.baseTotalAmount != null ? String(d.baseTotalAmount) : undefined;
});
const meta = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  return {
    // requesterName is resolved server-side (createdBy username); fall back to any
    // embedded createdBy for older payloads, then to a dash.
    requester: state.detail?.requesterName ?? d?.createdBy?.username ?? d?.createdBy?.name ?? '—',
    type: d?.documentType?.name ?? '',
  };
});

async function load() {
  state.loading = true;
  state.acting = false;
  state.remark = '';
  state.canAct = false;
  state.canActReason = null;
  state.detail = null;
  try {
    const [detail, canAct] = await Promise.all([
      documentsApi.detail(props.docId),
      documentsApi.canAct(props.docId).catch((): CanActResult => ({ canAct: false })),
    ]);
    state.detail = detail;
    state.canAct = canAct.canAct;
    state.canActReason = canAct.reason ?? null;
  } catch (e) {
    visible.value = false;
    feedback.error(e, t('documents.review.loadFailed'));
  } finally {
    state.loading = false;
  }
}

// Fetch lazily each time the dialog opens, so the reason/amount and eligibility are always current.
watch(visible, (v) => {
  if (v && props.docId) load();
});

/** Whether this step's transfer-slip condition is currently met. */
const slipSatisfied = computed(() => !!state.detail?.hasSlip);
/** Approve stamps the approver's signature; without one on file it is closed, reject/return not. */
const signatureMissing = computed(() => !auth.hasSignature || state.canActReason === 'SIGNATURE_REQUIRED');
/** Approve alone is gated; reject and return are not. */
const approveBlocked = computed(() => (!!state.detail?.slipRequired && !slipSatisfied.value) || signatureMissing.value);
const canUploadSlip = computed(() => auth.can('PAYMENT_MANAGE'));

/**
 * Re-read the document after a slip is uploaded or removed, so the requirement flips without the
 * approver reloading. Cheap, and it comes from the server rather than being assumed locally — the
 * upload could have failed after the optimistic UI moved on.
 */
async function refreshSlipState() {
  if (!props.docId) return;
  state.detail = await documentsApi.detail(props.docId).catch(() => state.detail);
}

async function act(action: ApprovalAction) {
  state.acting = true;
  const ok = await approvals.act(props.docId, action, state.remark || undefined);
  state.acting = false;
  if (ok) {
    visible.value = false;
    feedback.success(t('feedback.done'));
    emit('acted');
  } else {
    // A slip deleted by someone else after this dialog rendered lands here. Say what is missing,
    // not that "the request failed", and re-read so the panel matches the refusal.
    feedback.error(approvals.error);
    if (approvals.errorCode === 'PAYMENT_SLIP_REQUIRED') await refreshSlipState();
    // The server is the authority on whether a signature is on file; a stale session learns here
    // and the notice with the profile link takes the place of a live Approve.
    if (approvals.errorCode === 'SIGNATURE_REQUIRED') auth.setHasSignature(false);
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    class="w-full max-w-xl"
    :header="docNo ? `${$t('documents.review.title')} · ${docNo}` : $t('documents.review.title')"
  >
    <div v-if="state.loading" class="py-10 text-center text-muted-color">
      <i class="pi pi-spinner pi-spin text-2xl" />
    </div>

    <div v-else-if="state.detail" class="flex flex-col gap-4">
      <!-- Amount requested — the headline figure being approved. -->
      <div class="flex items-baseline justify-between gap-3 rounded-lg bg-surface-100 p-3 dark:bg-surface-800">
        <span class="text-sm text-muted-color">{{ $t('documents.review.amount') }}</span>
        <span class="text-right">
          <span class="block text-xl font-semibold tabular-nums text-color">{{ amount }}</span>
          <span v-if="baseAmount" class="block text-xs text-muted-color tabular-nums">≈ {{ baseAmount }}</span>
        </span>
      </div>

      <!-- What the amount above actually DOES, from the SAME payload the figure came from — not a
           summary composed here. An approval is the control this system puts in front of every
           movement of money; showing an amount and a type without naming the budget asks a person
           to sign for twelve million kip going somewhere unstated. Absent when the document moves
           no budget, so every other approval looks as it did. -->
      <div v-if="state.detail.budgetMovements?.length">
        <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-color">
          {{ $t('documents.detail.budgetMovements') }}
        </div>
        <BudgetMovements :movements="state.detail.budgetMovements" />
      </div>

      <!-- Who asked, and for what type. -->
      <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>{{ $t('documents.review.requester') }}: <span class="text-color">{{ meta.requester }}</span></span>
        <span v-if="meta.type">{{ $t('documents.review.type') }}: <span class="text-color">{{ meta.type }}</span></span>
      </div>

      <!-- The reason / details the requester submitted (their filled form fields). -->
      <div>
        <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-color">
          {{ $t('documents.review.reason') }}
        </div>
        <dl v-if="reviewFields.length" class="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div v-for="fv in reviewFields" :key="fv.formFieldId" class="flex min-w-0 flex-col gap-0.5">
            <dt class="text-xs text-muted-color">{{ fv.fieldLabel }}</dt>
            <dd v-if="isHtmlField(fv.fieldType)" class="m-0 wrap-break-word text-color" v-html="sanitizeHtml(fv.value)" />
            <dd v-else class="m-0 wrap-break-word text-color">{{ fv.value }}</dd>
          </div>
        </dl>
        <p v-else class="m-0 text-sm text-muted-color">{{ $t('documents.review.noReason') }}</p>
      </div>

      <!-- Not this user's to act on (own request / not their step). Server also enforces. -->
      <Message v-if="!state.canAct" severity="warn" :closable="false">
        {{ $t('documents.review.cannotAct') }}
      </Message>

      <!-- Optional remark carried with the decision. -->
      <div v-else class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('documents.detail.remarkOptional') }}</label>
        <Textarea v-model="state.remark" rows="3" autoResize />
      </div>
    </div>

    <!-- What this document takes, and what is left in the pot it takes it from. Shown to whoever is
         about to sign or to move the money, because sending them to another screen to find out
         whether the budget covers it is how a document gets approved against a budget nobody
         looked at. -->
    <div
      v-if="budgets.length"
      class="mt-4 flex flex-col gap-2 rounded-md border border-surface-200 p-3 dark:border-surface-700"
      data-testid="document-budgets"
    >
      <div class="flex items-center gap-2 text-sm font-medium text-color">
        <i class="pi pi-wallet text-muted-color text-sm" />
        <span>{{ $t('documents.review.budget.title') }}</span>
      </div>
      <div
        v-for="b in budgets"
        :key="b.id"
        class="flex flex-col gap-1 text-sm"
        data-testid="document-budget"
      >
        <div class="font-medium" data-testid="document-budget-name">{{ b.name }}</div>
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div class="flex flex-col">
            <span class="text-muted-color">{{ $t('documents.review.budget.total') }}</span>
            <span class="tabular-nums">{{ fmtBase(b.amountTotal) }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-muted-color">{{ $t('documents.review.budget.charged') }}</span>
            <span class="tabular-nums" data-testid="document-budget-charged">{{ fmtBase(b.charged) }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-muted-color">{{ $t('documents.review.budget.available') }}</span>
            <!-- Coloured only when it is negative: a pot already overdrawn is the one fact on this
                 block that changes what the reader should do. -->
            <span
              class="tabular-nums"
              :class="isNegative(b.available) ? 'text-red-600 dark:text-red-400 font-medium' : ''"
              data-testid="document-budget-available"
            >
              {{ fmtBase(b.available) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- No signature on file: Approve below is disabled, and this says where to fix it. -->
    <SignatureRequiredNotice v-if="state.detail && state.canAct && signatureMissing" variant="approve" class="mt-4" />

    <!-- Past the slip step: the money is out and finance has checked it, so this approver only
         confirms. Said plainly so they do not go looking for something left to do. -->
    <div
      v-if="state.detail?.hasSlip && !state.detail?.slipRequired && state.canAct"
      class="mt-4 flex items-start gap-2 rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3 text-sm"
      data-testid="slip-uploaded-confirm"
    >
      <i class="pi pi-check-circle mt-0.5" />
      <span>{{ $t('documents.review.slipUploadedConfirm') }}</span>
    </div>

    <!-- The step's own condition, stated before the approver acts. A disabled approve button with
         no reason beside it is indistinguishable from a broken screen. -->
    <div
      v-if="state.detail?.slipRequired && state.canAct"
      class="mt-4 flex flex-col gap-3 rounded-md border p-3"
      :class="slipSatisfied
        ? 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30'
        : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'"
      data-testid="slip-requirement"
      :data-satisfied="slipSatisfied ? 'yes' : 'no'"
    >
      <div class="flex items-start gap-2 text-sm">
        <i :class="slipSatisfied ? 'pi pi-check-circle mt-0.5' : 'pi pi-exclamation-triangle mt-0.5'" />
        <span>
          {{ slipSatisfied ? $t('documents.review.slipAttached') : $t('documents.review.slipRequired') }}
        </span>
      </div>
      <!-- Uploading here rather than sending the approver to a payment screen: the document is not
           payable yet, so no payment screen applies to it. Shown only to a holder of
           PAYMENT_MANAGE, mirroring the server — the client guard is UX only. -->
      <PaymentSlips
        v-if="canUploadSlip"
        :documentId="props.docId"
        :lockedRate="lockedRate"
        :baseLocked="baseLocked"
        :paymentRecorded="state.detail?.hasPayment ?? false"
        :canRestateRate="state.detail?.canRestateRate ?? false"
        @changed="refreshSlipState"
      />
      <span v-else-if="!slipSatisfied" class="text-muted-color text-xs">
        {{ $t('documents.review.slipNoPermission') }}
      </span>
    </div>

    <template #footer>
      <Button :label="$t('common.close')" text :disabled="state.acting" @click="visible = false" />
      <template v-if="state.detail && state.canAct">
        <Button
          :label="$t('documents.detail.return')"
          icon="pi pi-undo"
          severity="secondary"
          outlined
          :loading="state.acting"
          data-testid="return-button"
          @click="act('RETURN')"
        />
        <Button
          :label="$t('documents.detail.reject')"
          icon="pi pi-times"
          severity="danger"
          outlined
          :loading="state.acting"
          data-testid="reject-button"
          @click="act('REJECT')"
        />
        <!-- Reject and Return above stay enabled whatever the requirement says: a document nobody
             can evidence must still have a way out of approval. Only Approve is gated. -->
        <Button
          :label="$t('documents.detail.approve')"
          icon="pi pi-check"
          severity="success"
          :loading="state.acting"
          :disabled="approveBlocked"
          :title="signatureMissing ? $t('documents.signatureRequired.title') : approveBlocked ? $t('documents.review.slipRequired') : undefined"
          data-testid="approve-button"
          @click="act('APPROVE')"
        />
      </template>
    </template>
  </Dialog>
</template>
