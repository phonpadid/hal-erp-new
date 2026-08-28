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
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import Message from 'primevue/message';
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { documentsApi } from '../../api/documents';
import type { DocumentDetail } from '../../api/documents';
import type { ApprovalAction } from '../../api/approvals';
import { useApprovalsStore } from '../../stores/approvals';
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
const feedback = useFeedback();
const { fmt, fmtBase, baseCode } = useCurrencyFormat();

const state = reactive({
  loading: false,
  acting: false,
  canAct: false,
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
const meta = computed(() => {
  const d = state.detail?.document as Record<string, any> | undefined;
  return {
    requester: d?.createdBy?.username ?? d?.createdBy?.name ?? '—',
    type: d?.documentType?.name ?? '',
  };
});

async function load() {
  state.loading = true;
  state.acting = false;
  state.remark = '';
  state.canAct = false;
  state.detail = null;
  try {
    const [detail, canAct] = await Promise.all([
      documentsApi.detail(props.docId),
      documentsApi.canAct(props.docId).catch(() => false),
    ]);
    state.detail = detail;
    state.canAct = canAct;
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

async function act(action: ApprovalAction) {
  state.acting = true;
  const ok = await approvals.act(props.docId, action, state.remark || undefined);
  state.acting = false;
  if (ok) {
    visible.value = false;
    feedback.success(t('feedback.done'));
    emit('acted');
  } else {
    feedback.error(approvals.error);
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

    <template #footer>
      <Button :label="$t('common.close')" text :disabled="state.acting" @click="visible = false" />
      <template v-if="state.detail && state.canAct">
        <Button
          :label="$t('documents.detail.return')"
          icon="pi pi-undo"
          severity="secondary"
          outlined
          :loading="state.acting"
          @click="act('RETURN')"
        />
        <Button
          :label="$t('documents.detail.reject')"
          icon="pi pi-times"
          severity="danger"
          outlined
          :loading="state.acting"
          @click="act('REJECT')"
        />
        <Button
          :label="$t('documents.detail.approve')"
          icon="pi pi-check"
          severity="success"
          :loading="state.acting"
          @click="act('APPROVE')"
        />
      </template>
    </template>
  </Dialog>
</template>
