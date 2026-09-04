<script setup lang="ts">
import SectionCard from '@/components/SectionCard.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import AttachmentUploader from '@/components/AttachmentUploader.vue';
import PaymentSlips from '@/components/payments/PaymentSlips.vue';
import StatTiles from '@/components/reports/StatTiles.vue';
import type { StatTile } from '@/components/reports/StatTiles.vue';
import type { TimelineEntry } from '@/components/EventTimeline.vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import RadioButton from 'primevue/radiobutton';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { missingRequiredFields, type ExportParts } from '@erp/shared';
import { Decimal } from 'decimal.js';
import type { FormDef } from '../../api/documents';
import { formatDate, formatDateTime } from '../../utils/date';
import { fieldComponent } from '../../utils/formFields';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { documentsApi, downloadBlob } from '../../api/documents';
import type { CreatableType } from '../../api/documents';
import { useAuthStore } from '../../stores/auth';
import { useApprovalsStore } from '../../stores/approvals';
import { useDocumentsStore } from '../../stores/documents';
import { useFeedback } from '../../composables/useFeedback';
import { useBreadcrumb } from '../../composables/useBreadcrumb';
import { canActOn, creatorId, pendingApproverNames } from '../../utils/approval';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { sumAmounts } from '../../utils/money';
import type { ApprovalAction } from '../../api/approvals';

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const docs = useDocumentsStore();
const approvals = useApprovalsStore();
const fb = useFeedback();
// Reactive so detail→detail navigation (same route, different :id) reloads instead of
// showing the previous document's stale data. Template usages auto-unwrap the ref.
const id = computed(() => route.params.id as string);

/** Rich-text fields (the PrimeVue Editor) store an HTML fragment; render it as sanitized HTML
 * instead of showing the literal tags. Plain fields stay as text. */
function isHtmlField(fieldType: string): boolean {
  return !!fieldComponent(fieldType).html;
}

const { fmt, fmtBase, baseCode } = useCurrencyFormat();

// Quantities are stored with 4 decimals but read cleaner at 2 on screen. Format via Decimal
// (never a JS float) so rounding is exact; fall back to the raw string on any parse error.
function fmtQty(v: unknown): string {
  if (v == null || v === '') return '0.00';
  try {
    return new Decimal(v as Decimal.Value).toFixed(2);
  } catch {
    return String(v);
  }
}
const doc = computed(() => docs.current);

// Header meta: document type name and the key dates (created + submit/lock).
const docTypeName = computed(() => (doc.value as any)?.documentType?.name ?? '');

// Contribute the breadcrumb leaf: Documents (from route meta) → doc type → doc number.
// The shared shell breadcrumb renders these; they auto-clear when this view unmounts.
useBreadcrumb(() =>
  [
    docTypeName.value ? { label: docTypeName.value } : null,
    doc.value?.docNo ? { label: doc.value.docNo } : null,
  ].filter((c): c is { label: string } => c !== null),
);
// Display-only line totals for the table footer. The summary/header headline figure
// stays the server's `doc.totalAmount` — this is a per-line reconciliation aid only,
// summed with Decimal so money is never coerced to a JS number.
const lineTotals = computed(() => ({
  line: sumAmounts(docs.lines.map((l: any) => l.lineAmount)),
  base: sumAmounts(docs.lines.map((l: any) => l.baseLineAmount)),
}));
// Headline figures shown as a scannable KPI row above the content — the single source of
// the document's numbers, so the hero header carries no total and there is no Summary card
// to duplicate them. Money always routes through `fmt`/`fmtBase` (currency `decimal_places`,
// never a JS number). Status stays only on the hero badge; base total and exchange rate are
// added only for a foreign-currency document.
const isForeignCurrency = computed(() => (doc.value?.currency?.code ?? baseCode()) !== baseCode());
const statTiles = computed<StatTile[]>(() => {
  const d = doc.value as any;
  if (!d) return [];
  const code = d.currency?.code ?? baseCode() ?? '';
  // Fall back to the summed line total when the header total isn't set, so the tile never
  // shows an empty dash while the line-items footer shows a figure.
  const totalVal = d.totalAmount != null ? d.totalAmount : lineTotals.value.line;
  const tiles: StatTile[] = [
    {
      label: t('documents.detail.total'),
      value: fmt(totalVal, d.currency?.code),
      hint: code || undefined,
      icon: 'pi-wallet',
      tone: 'success',
    },
    {
      label: t('documents.detail.lineItems'),
      value: docs.lines.length,
      icon: 'pi-list',
      tone: 'info',
    },
    {
      label: t('documents.detail.attachments'),
      value: docs.attachments.length,
      icon: 'pi-paperclip',
      tone: 'warn',
    },
  ];
  if (isForeignCurrency.value) {
    tiles.push({
      label: t('documents.detail.baseTotal'),
      value: d.baseTotalAmount != null ? fmtBase(d.baseTotalAmount) : '—',
      hint: baseCode() ?? undefined,
      icon: 'pi-money-bill',
      tone: 'success',
    });
    tiles.push({
      label: t('documents.detail.exchangeRate'),
      value: d.exchangeRate ?? '—',
      icon: 'pi-percentage',
      tone: 'info',
    });
  }
  return tiles;
});

// Which optional line-item columns actually carry data across all rows — hide the rest so
// the table isn't a wall of "—". Base amount only adds info for a foreign-currency document.
const lineCols = computed(() => {
  const ls = docs.lines as any[];
  return {
    item: ls.some((l) => l.item?.name),
    gl: ls.some((l) => l.glAccount),
    desc: ls.some((l) => l.description),
    base: isForeignCurrency.value && ls.some((l) => l.baseLineAmount != null),
    received: ls.some((l) => Number(l.receivedQty ?? 0) > 0 || l.lineStatus),
  };
});

// Only field values that were actually filled in — an empty field rendered as "—" reads like
// a bug. Rich-text fields count as filled only when their HTML has text content.
const filledFields = computed(() =>
  docs.fieldValues.filter((fv: any) => fv.value != null && String(fv.value).trim() !== ''),
);

const canSubmit = computed(() => auth.can('DOC_SUBMIT') && doc.value?.status === 'DRAFT');
// Cancel = withdraw your own request: only the creator, and only before it is finalized.
// The server re-enforces both. An approver who wants to stop it uses reject/return.
// Only the raiser withdraws their own document, so this reads the creator off the detail —
// through `creatorId`, which tolerates the id arriving either populated or bare. Reading
// `.id` directly is what kept this button off the screen for every user: the detail served
// `createdBy` as a plain id string, so the comparison was undefined === userId, forever false.
const canCancel = computed(
  () =>
    auth.can('DOC_CANCEL') &&
    !!auth.userId &&
    creatorId(doc.value?.createdBy) === auth.userId &&
    ['DRAFT', 'SUBMITTED', 'IN_APPROVAL'].includes(doc.value?.status),
);
// Server-computed eligibility for the current step (hides the buttons the moment the user
// acts and the step advances past them), still gated by the local DOC_APPROVE + not-creator
// UX mirror. The server re-enforces on act().
const canAct = computed(() => docs.canAct && canActOn(doc.value, auth.userId, (c) => auth.can(c)));
const canEdit = computed(() => auth.can('DOC_CREATE') && doc.value?.status === 'DRAFT');
// Payment evidence: only a settled document can have any, and only a PAYMENT_VIEW user may read
// it. Whether there IS any comes from the detail response. It used to come from asking for the
// slips and reading the 404 — which fired on every unpaid document, and made a genuine failure
// of that read look like a document that was never paid.
// A slip can also arrive DURING approval, to satisfy a step that demands one, so "completed and
// paid" is no longer the only state with evidence to show. The panel appears when there is evidence
// to read, or when the step the document is on asks for some and there is therefore an upload to
// offer. A document with none of those has nothing for a slip to be evidence of.
const showSlips = computed(
  () =>
    auth.can('PAYMENT_VIEW') &&
    ((doc.value?.status === 'COMPLETED' && docs.hasPayment) || docs.hasSlip || docs.slipRequired),
);
const canCreateFrom = computed(() => auth.can('DOC_CREATE') && ['APPROVED', 'COMPLETED'].includes(doc.value?.status));
const canUpload = computed(() => auth.can('DOC_CREATE') && doc.value?.status === 'DRAFT');
// Export the document (with its approval-trail signatures) to PDF — anyone who may view it.
const canExportPdf = computed(() => auth.can('DOC_VIEW'));
const exportingPdf = ref(false);
// What the print dialog is set to. SELF is preselected: printing the document in front of you is
// the common case, and the whole set is the deliberate one.
const printDialog = ref<{ open: boolean; parts: ExportParts }>({ open: false, parts: 'SELF' });
function openPrint() {
  printDialog.value = { open: true, parts: 'SELF' };
}
async function confirmPrint() {
  const parts = printDialog.value.parts;
  exportingPdf.value = true;
  try {
    const blob = await documentsApi.exportPdf(id.value, parts);
    const stem = (doc.value?.docNo ?? id.value).replace(/[/\\]/g, '-');
    downloadBlob(blob, `${stem}${parts === 'CHAIN' ? '-set' : ''}.pdf`);
    printDialog.value.open = false;
  } catch {
    // The dialog stays open on failure: the user asked for a file and did not get one, and
    // closing it would leave them looking at the document wondering whether it downloaded.
    fb.error(t('documents.detail.exportPdfError'));
  } finally {
    exportingPdf.value = false;
  }
}
// Goods receipt: record received qty on a PO's lines (APPROVED/COMPLETED), DOC_RECEIVE-gated.
const canReceive = computed(
  () => auth.can('DOC_RECEIVE') && docs.lines.length > 0 && ['APPROVED', 'COMPLETED'].includes(doc.value?.status),
);
const receiveDialog = ref(false);
const receiveQtys = ref<Record<string, string>>({});
function openReceive() {
  receiveQtys.value = {};
  receiveDialog.value = true;
}
async function confirmReceive() {
  const lines = docs.lines
    .filter((l) => l.id && receiveQtys.value[l.id] && Number(receiveQtys.value[l.id]) > 0)
    .map((l) => ({ lineId: l.id as string, qty: receiveQtys.value[l.id as string] }));
  if (!lines.length) {
    receiveDialog.value = false;
    return;
  }
  if (await docs.receive(id.value, lines)) {
    receiveDialog.value = false;
    fb.success(t('documents.receive.recorded'));
  } else fb.error(docs.error);
}
const LINE_STATUS_SEVERITY: Record<string, string> = { OPEN: 'secondary', PARTIAL: 'warn', RECEIVED: 'success', CLOSED: 'contrast' };

function goEdit() {
  router.push({ name: 'document-edit', params: { id: id.value } });
}

// Missing-required-fields prompt: an auto-created draft (e.g. a PO created from an approved
// PROC) copies header + lines but not field values, so a required field like `reason` starts
// empty and the submit gate blocks it. We surface which visible required fields are still empty
// and deep-link to the wizard's Details step. The form definition (isRequired + conditionJson)
// isn't in the detail payload — the detail's fieldValues omit empty fields — so fetch it via the
// same formForType endpoint the wizard uses, but only for a draft this user may edit.
const formDef = ref<FormDef | null>(null);
async function loadFormForDraft() {
  formDef.value = null;
  const typeId = (docs.current as any)?.documentType?.id;
  if (canEdit.value && typeId) formDef.value = await documentsApi.formForType(typeId).catch(() => null);
}
// Visible required fields whose value is empty, by label.
//
// Presence is asked through the SHARED rule, which reads each field where its TYPE stores its
// value: a `file` field's value is an attachment and a `line_items` field's value is a line —
// neither ever produces a `doc_field_value` row. This prompt used to consult that table alone and
// so reported a required file as missing on every draft, attachment or not. Worse, the banner
// stands while the toast carrying a real refusal expires, leaving the reader with one instruction
// on screen: attach the file they already attached.
const missingRequiredLabels = computed<string[]>(() => {
  if (!canEdit.value || !formDef.value) return [];
  const values: Record<string, string | undefined> = {};
  for (const fv of docs.fieldValues as any[]) values[fv.fieldName] = fv.value || undefined;
  return missingRequiredFields(formDef.value.fields, {
    values,
    attachmentCount: docs.attachments.length,
    lineCount: docs.lines.length,
  }).map((f) => f.fieldLabel);
});
// Deep-link to the wizard's Details step so the user lands straight on the fields to complete.
function goCompleteFields() {
  router.push({ name: 'document-edit', params: { id: id.value }, query: { step: 'details' } });
}

// Create-from-predecessor: pick a successor type, the server validates the pairing.
const fromDialog = ref(false);
const fromTypeId = ref('');
const creatableTypes = ref<CreatableType[]>([]);
async function openCreateFrom() {
  creatableTypes.value = await documentsApi.creatableTypes().catch(() => []);
  fromTypeId.value = '';
  fromDialog.value = true;
}
async function confirmCreateFrom() {
  if (!fromTypeId.value) return;
  try {
    const newId = await docs.createFrom(id.value, fromTypeId.value);
    fromDialog.value = false;
    fb.success(t('feedback.created'));
    await router.push({ name: 'document-edit', params: { id: newId } });
  } catch (e) {
    fb.error(e);
  }
}

// "Stamped ticket" hero: a status-colored left stripe + a matching status badge. Theme
// tokens so light and dark both render.
const STATUS_COLOR: Record<string, { stripe: string; badge: string }> = {
  DRAFT: { stripe: 'bg-surface-400 dark:bg-surface-500', badge: 'bg-surface-100 text-muted-color border-surface-300 dark:bg-surface-800 dark:border-surface-600' },
  SUBMITTED: { stripe: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30' },
  IN_APPROVAL: { stripe: 'bg-amber-500', badge: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30' },
  APPROVED: { stripe: 'bg-emerald-500', badge: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30' },
  COMPLETED: { stripe: 'bg-emerald-500', badge: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30' },
  REJECTED: { stripe: 'bg-red-500', badge: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30' },
  CANCELLED: { stripe: 'bg-surface-400 dark:bg-surface-500', badge: 'bg-surface-100 text-muted-color border-surface-300 dark:bg-surface-800 dark:border-surface-600' },
};
const statusColor = computed(() => STATUS_COLOR[doc.value?.status] ?? STATUS_COLOR.DRAFT);
const hasActions = computed(
  () =>
    canAct.value || canEdit.value || canSubmit.value || canCancel.value || canCreateFrom.value || canReceive.value ||
    canExportPdf.value,
);

// Approval history → timeline entries. Marker colour/icon follow the action.
const ACTION_SEVERITY: Record<string, TimelineEntry['severity']> = { APPROVE: 'success', REJECT: 'danger', RETURN: 'warn', SUBMIT: 'info', ESCALATE: 'warn', CANCEL: 'secondary' };
const ACTION_ICON: Record<string, string> = { APPROVE: 'pi pi-check', REJECT: 'pi pi-times', RETURN: 'pi pi-undo', SUBMIT: 'pi pi-send', ESCALATE: 'pi pi-angle-double-up', CANCEL: 'pi pi-ban' };
function actionLabel(a: string) {
  const key = `documents.detail.action.${a}`;
  return te(key) ? t(key) : a;
}
// A trailing "waiting on" entry for the current step: who the document is pending with. Shown
// only while IN_APPROVAL and only to participants (the server returns null otherwise). For a
// role step it names the role plus its eligible people; a delegate is annotated with its principal.
const pendingEntry = computed<TimelineEntry | null>(() => {
  const p = docs.pendingApprovers;
  if (!p) return null;
  const stepLabel = p.stepName
    ? t('documents.detail.pending.stepNamed', { no: p.stepNo, name: p.stepName })
    : t('documents.detail.pending.step', { no: p.stepNo });
  const subtitle = p.roleName ? `${stepLabel} · ${p.roleName}` : stepLabel;
  const people = pendingApproverNames(p.approvers, (name) => t('documents.detail.pending.viaDelegation', { name }));
  return {
    icon: 'pi pi-hourglass',
    severity: 'warn',
    title: t('documents.detail.pending.title'),
    subtitle,
    body: people.length ? people.join(', ') : t('documents.detail.pending.none'),
  };
});
// Approval rendered as a stepper: each acted step is "done"; the current waiting step is
// "active" (pulsing node). Built from the same log + pending data as the timeline.
type StepState = 'done' | 'active';
interface ApprovalStep {
  state: StepState;
  icon: string;
  tone: TimelineEntry['severity'];
  title: string;
  subtitle?: string;
  at?: string;
  body?: string;
}
const approvalSteps = computed<ApprovalStep[]>(() => {
  const steps: ApprovalStep[] = docs.approvalLog.map((l: any) => ({
    state: 'done',
    icon: ACTION_ICON[l.action] ?? 'pi pi-check',
    tone: ACTION_SEVERITY[l.action] ?? 'secondary',
    title: actionLabel(l.action),
    subtitle: l.approver?.username ?? l.actorName ?? l.actedByName ?? undefined,
    at: formatDateTime(l.actedAt),
    body: l.remark ?? l.comment ?? undefined,
  }));
  if (pendingEntry.value) {
    steps.push({
      state: 'active',
      icon: pendingEntry.value.icon ?? 'pi pi-hourglass',
      tone: 'warn',
      title: pendingEntry.value.title,
      subtitle: pendingEntry.value.subtitle,
      body: pendingEntry.value.body,
    });
  }
  return steps;
});

// Node tint per step state/tone — theme tokens so light/dark both render.
const STEP_TONE: Record<string, string> = {
  success: 'bg-green-100 text-green-700 border-green-500 dark:bg-green-500/15 dark:text-green-300',
  danger: 'bg-red-100 text-red-700 border-red-500 dark:bg-red-500/15 dark:text-red-300',
  warn: 'bg-yellow-100 text-yellow-700 border-yellow-500 dark:bg-yellow-500/15 dark:text-yellow-300',
  info: 'bg-cyan-100 text-cyan-700 border-cyan-500 dark:bg-cyan-500/15 dark:text-cyan-300',
  secondary: 'bg-surface-100 text-muted-color border-surface-300 dark:bg-surface-800 dark:border-surface-600',
};
const stepNodeClass = (s: ApprovalStep) => STEP_TONE[s.tone ?? 'secondary'] ?? STEP_TONE.secondary;

// Pulsing dot on the status badge only while the document is actively moving.
const isActiveStatus = computed(() => ['SUBMITTED', 'IN_APPROVAL'].includes(doc.value?.status));

const dialog = ref<{ open: boolean; action: ApprovalAction; remark: string }>({ open: false, action: 'APPROVE', remark: '' });
function openAct(action: ApprovalAction) {
  dialog.value = { open: true, action, remark: '' };
}
async function confirmAct() {
  const ok = await approvals.act(id.value, dialog.value.action, dialog.value.remark || undefined);
  dialog.value.open = false;
  if (ok) {
    await docs.loadDetail(id.value);
    fb.success(t('feedback.done'));
  } else {
    fb.error(approvals.error);
  }
}

// A quota-controlled type reserves quota from a payload the wizard owns; the detail page can't
// build it. Route such a draft into the wizard's quota step instead of submitting an empty body
// (which the server would reject with "declares no quota reservations").
const requiresQuota = computed(() => !!(doc.value as any)?.documentType?.requiresQuota);

// Action errors are toasted; clear the store's `error` afterwards so the inline
// ErrorState (page-load path) doesn't also show it.
/**
 * Why the last submit was refused, kept on screen for as long as the document is still refused.
 *
 * A toast expires in seconds; the completeness banner beside it does not. When the two disagreed,
 * the reader was left acting on whichever survived — which is how an over-budget refusal came to
 * be read as "attach the file", the file already being attached. The toast still fires for the
 * moment of the click; this is what remains afterwards.
 */
const submitRefusal = ref(typeof route.query.refused === 'string' ? route.query.refused : '');

async function submitDoc() {
  if (requiresQuota.value) {
    router.push({ name: 'document-edit', params: { id: id.value }, query: { step: 'quota' } });
    return;
  }
  submitRefusal.value = '';
  if (await docs.submit(id.value)) fb.success(t('feedback.submitted'));
  else {
    const m = docs.error;
    docs.error = '';
    submitRefusal.value = m;
    fb.error(m);
  }
}

// Withdrawing takes the document away from whoever is holding it, so the reason travels with the
// act (it lands on the audit row) and the prompt says who is affected. A draft interrupts nobody
// and keeps the plain wording.
const cancelDialog = ref<{ open: boolean; remark: string }>({ open: false, remark: '' });
const cancelIsRouting = computed(() => ['SUBMITTED', 'IN_APPROVAL'].includes(doc.value?.status ?? ''));

function openCancel() {
  cancelDialog.value = { open: true, remark: '' };
}

async function cancelDoc() {
  const ok = await docs.cancel(id.value, cancelDialog.value.remark || undefined);
  cancelDialog.value.open = false;
  if (ok) fb.success(t('feedback.done'));
  else { const m = docs.error; docs.error = ''; fb.error(m); }
}

watch(id, async (v) => {
  await docs.loadDetail(v);
  await loadFormForDraft();
}, { immediate: true });
</script>

<template>
  <div v-if="doc">
    <!-- Breadcrumb is rendered by the shared shell (AppBreadcrumb); this view contributes
         its leaf crumbs (doc type + number) via useBreadcrumb in the script above. -->

    <!-- "Stamped ticket" header: status stripe + doc type + number + badge + meta + actions. -->
    <header class="flex items-stretch overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 shadow-sm mb-4">
      <div class="w-1.5 shrink-0" :class="statusColor.stripe" aria-hidden="true" />
      <div class="flex-1 min-w-0 flex flex-col lg:flex-row lg:items-stretch">
        <div class="flex-1 min-w-0 p-5 sm:p-6">
          <div v-if="docTypeName" class="text-xs font-semibold uppercase tracking-wider text-muted-color mb-1.5">{{ docTypeName }}</div>
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight text-color wrap-break-word">{{ doc.docNo }}</h1>
            <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold border" :class="statusColor.badge">
              <span v-if="isActiveStatus" class="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />
              {{ $t('documents.status.' + doc.status) }}
            </span>
          </div>
          <div class="flex items-center gap-x-5 gap-y-1 flex-wrap text-sm text-muted-color mt-3">
            <span v-if="doc.createdAt">{{ $t('documents.detail.created') }} <span class="text-color">{{ formatDate(doc.createdAt) }}</span></span>
            <span v-if="doc.submittedAt">{{ $t('documents.detail.rateLockedAt') }} <span class="text-color">{{ formatDate(doc.submittedAt) }}</span></span>
            <span v-if="doc.vendor">{{ $t('documents.detail.vendor') }}: <span class="text-color">{{ doc.vendor.name }}</span></span>
            <!-- Where the money lands. Shown to anyone who can read the document — an approver
                 should see the destination before approving, not trust it implicitly. Stays visible
                 after the account is deactivated, so an old document is still legible. -->
            <span v-if="doc.vendorBankAccount" data-testid="doc-payee">
              {{ $t('documents.detail.payee') }}:
              <span class="text-color">{{ doc.vendorBankAccount.bankCode }} · {{ doc.vendorBankAccount.accountNo }} — {{ doc.vendorBankAccount.accountName }}</span>
            </span>
            <span v-if="docs.refDocument" class="inline-flex items-center gap-1">
              {{ $t('documents.detail.predecessor') }}:
              <Button :label="docs.refDocument.docNo" link class="p-0!" @click="router.push({ name: 'document-detail', params: { id: docs.refDocument!.id } })" />
            </span>
          </div>
        </div>
        <!-- Actions: a bordered column on wide screens, a wrapping row below the info otherwise. -->
        <div v-if="hasActions" class="flex flex-row lg:flex-col justify-center gap-2 flex-wrap p-4 sm:px-6 border-t lg:border-t-0 lg:border-l border-surface-200 dark:border-surface-700">
          <Button v-if="canAct" :label="$t('documents.detail.approve')" icon="pi pi-check" severity="success" @click="openAct('APPROVE')" />
          <Button v-if="canAct" :label="$t('documents.detail.reject')" icon="pi pi-times" severity="danger" outlined @click="openAct('REJECT')" />
          <Button v-if="canAct" :label="$t('documents.detail.return')" icon="pi pi-undo" severity="secondary" outlined @click="openAct('RETURN')" />
          <Button v-if="canEdit" :label="$t('common.edit')" icon="pi pi-pencil" severity="secondary" outlined @click="goEdit()" />
          <Button v-if="canSubmit" :label="$t('documents.detail.submit')" icon="pi pi-send" :loading="docs.loading" @click="submitDoc()" />
          <Button v-if="canCancel" :label="$t('documents.detail.cancel')" severity="secondary" outlined :loading="docs.loading" data-testid="cancel-btn" @click="openCancel()" />
          <Button v-if="canCreateFrom" :label="$t('documents.detail.createSuccessor')" icon="pi pi-arrow-right" severity="secondary" outlined @click="openCreateFrom()" />
          <Button v-if="canReceive" :label="$t('documents.receive.action')" icon="pi pi-inbox" severity="secondary" outlined @click="openReceive()" />
          <Button
            v-if="canExportPdf"
            :label="$t('documents.detail.print')"
            icon="pi pi-print"
            severity="secondary"
            outlined
            :loading="exportingPdf"
            data-testid="export-pdf-btn"
            @click="openPrint()"
          />
        </div>
      </div>
    </header>

    <Dialog v-model:visible="dialog.open" :header="$t('documents.detail.actionDialogTitle', { action: $t('documents.detail.action.' + dialog.action) })" modal class="w-96">
      <div class="flex flex-col gap-2">
        <label class="text-sm text-muted-color">{{ $t('documents.detail.remarkOptional') }}</label>
        <Textarea v-model="dialog.remark" rows="3" autoResize />
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="dialog.open = false" />
        <Button :label="$t('documents.detail.action.' + dialog.action)" @click="confirmAct" />
      </template>
    </Dialog>

    <!-- Print: this document, or the whole reference chain (PR + PO + Receipt) as one file. The
         set choice is offered on every document — a document knows its predecessor but not its
         successors, so only the server can say what the set contains. -->
    <Dialog v-model:visible="printDialog.open" :header="$t('documents.detail.printDialogTitle')" modal class="w-96" data-testid="print-dialog">
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <RadioButton v-model="printDialog.parts" input-id="print-self" value="SELF" data-testid="print-self" />
          <label for="print-self" class="text-sm">{{ $t('documents.detail.printSelf') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <RadioButton v-model="printDialog.parts" input-id="print-chain" value="CHAIN" data-testid="print-chain" />
          <label for="print-chain" class="text-sm">{{ $t('documents.detail.printChain') }}</label>
        </div>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text data-testid="print-cancel" @click="printDialog.open = false" />
        <Button :label="$t('documents.detail.printConfirm')" icon="pi pi-print" :loading="exportingPdf" data-testid="print-confirm" @click="confirmPrint()" />
      </template>
    </Dialog>

    <Dialog v-model:visible="cancelDialog.open" :header="$t('documents.detail.cancelDialogTitle')" modal class="w-96">
      <div class="flex flex-col gap-2">
        <p class="text-sm text-muted-color">
          {{ cancelIsRouting ? $t('feedback.confirm.documentCancelRouting') : $t('feedback.confirm.documentCancel') }}
        </p>
        <label class="text-sm text-muted-color">{{ $t('documents.detail.remarkOptional') }}</label>
        <Textarea v-model="cancelDialog.remark" rows="3" autoResize data-testid="cancel-remark" />
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="cancelDialog.open = false" />
        <Button :label="$t('documents.detail.cancelConfirm')" severity="danger" :loading="docs.loading" data-testid="cancel-confirm" @click="cancelDoc()" />
      </template>
    </Dialog>

    <!-- Why the last submit was refused. Rendered above the completeness prompt, and it outlives
         the toast: the reason has to be readable for as long as it is still true. -->
    <Message v-if="submitRefusal" severity="error" :closable="false" class="mb-4" data-testid="submit-refusal">
      {{ submitRefusal }}
    </Message>

    <!-- Draft with empty required fields (e.g. an auto-created PO): prompt to complete them,
         deep-linking straight to the wizard's Details step. -->
    <Message v-if="missingRequiredLabels.length" severity="warn" :closable="false" class="mb-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <span>{{ $t('documents.detail.missingRequired.text', { fields: missingRequiredLabels.join(', ') }) }}</span>
        <Button :label="$t('documents.detail.missingRequired.action')" icon="pi pi-pencil" size="small" @click="goCompleteFields" />
      </div>
    </Message>

    <!-- At-a-glance KPI row: the document's headline figures (3 per row = 4/12 each). -->
    <StatTiles :tiles="statTiles" :cols="3" class="mb-4" />

    <ErrorState v-if="docs.error" :message="docs.error" @retry="docs.loadOne(id)" />

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-x-4 items-start">
      <!-- Main column: the document's own data. `min-w-0` lets it shrink so wide
           scrollable tables scroll inside their card instead of overflowing it. -->
      <div class="xl:col-span-2 min-w-0">
    <!-- Field values from the document's pinned form. -->
    <SectionCard v-if="filledFields.length" icon="pi pi-align-left" :title="$t('documents.detail.fields')">
      <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 m-0">
        <div v-for="fv in filledFields" :key="fv.formFieldId" class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ fv.fieldLabel }}</dt>
          <!-- Rich-text fields render their (sanitized) HTML; plain fields show literal text. -->
          <dd v-if="isHtmlField(fv.fieldType)" class="prose-review text-color m-0 wrap-break-word" v-html="sanitizeHtml(fv.value)" />
          <dd v-else class="text-color m-0 wrap-break-word">{{ fv.value }}</dd>
        </div>
      </dl>
    </SectionCard>

    <!-- Line items. -->
    <SectionCard icon="pi pi-shopping-cart" :title="$t('documents.detail.lineItems')">
      <!-- Grand total in the header's right side (was a table footer row). -->
      <template v-if="docs.lines.length" #actions>
        <div class="flex items-baseline gap-2">
          <span class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.tableTotal') }}</span>
          <span class="font-semibold text-color tabular-nums">{{ fmt(lineTotals.line, doc.currency?.code) }}</span>
          <span class="text-xs text-muted-color">{{ doc.currency?.code ?? baseCode() ?? '' }}</span>
        </div>
      </template>
      <EmptyState v-if="!docs.lines.length" icon="pi pi-list" :title="$t('documents.detail.noLines')" />
      <DataTable v-else :value="docs.lines" dataKey="lineNo" showGridlines scrollable scrollHeight="24rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" style="width:3rem" />
        <Column v-if="lineCols.item" :header="$t('documents.create.line.item')" style="min-width:12rem"><template #body="{ data }">{{ data.item?.name ?? '—' }}</template></Column>
        <Column v-if="lineCols.gl" :header="$t('documents.create.line.glAccount')" style="min-width:8rem"><template #body="{ data }">{{ data.glAccount ?? '—' }}</template></Column>
        <Column v-if="lineCols.desc" field="description" :header="$t('documents.create.line.description')" style="min-width:12rem" />
        <Column :header="$t('documents.create.line.qty')" style="width:7rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ fmtQty(data.qty) }}</template></Column>
        <Column field="unitPrice" :header="$t('documents.create.line.unitPrice')" style="width:9rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column :header="$t('documents.detail.lineAmount')" style="width:10rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <template #body="{ data }">{{ fmt(data.lineAmount, doc.currency?.code) }}</template>
        </Column>
        <Column v-if="lineCols.base" :header="$t('documents.detail.baseLineAmount')" style="width:10rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <template #body="{ data }">{{ data.baseLineAmount != null ? fmtBase(data.baseLineAmount) : '—' }}</template>
        </Column>
        <Column v-if="lineCols.received" :header="$t('documents.receive.received')" style="width:8rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ fmtQty(data.receivedQty) }}</template></Column>
        <Column v-if="lineCols.received" :header="$t('documents.receive.status')" style="width:8rem">
          <template #body="{ data }">
            <Tag v-if="data.lineStatus" :severity="LINE_STATUS_SEVERITY[data.lineStatus] ?? 'secondary'" :value="$t('documents.receive.lineStatus.' + data.lineStatus)" />
          </template>
        </Column>
      </DataTable>
    </SectionCard>

    <!-- 3-way matching: ordered (PO) vs received vs invoiced, when this document references a PO. -->
    <SectionCard v-if="docs.matching && docs.matching.lines.length" icon="pi pi-check-square" :title="$t('documents.matching.title')">
      <div class="mb-2">
        <Tag :severity="docs.matching.ok ? 'success' : 'danger'" :value="docs.matching.ok ? $t('documents.matching.ok') : $t('documents.matching.failed')" />
      </div>
      <DataTable :value="docs.matching.lines" dataKey="lineNo" showGridlines scrollable scrollHeight="24rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" style="width:3rem" />
        <Column :header="$t('documents.matching.ordered')" style="width:8rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ fmtQty(data.orderedQty) }}</template></Column>
        <Column :header="$t('documents.matching.receivedQty')" style="width:8rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ fmtQty(data.receivedQty) }}</template></Column>
        <Column :header="$t('documents.matching.invoiced')" style="width:8rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ fmtQty(data.invoicedQty) }}</template></Column>
        <Column field="orderedAmount" :header="$t('documents.matching.orderedAmount')" style="width:10rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="invoicedAmount" :header="$t('documents.matching.invoicedAmount')" style="width:10rem" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column :header="$t('documents.matching.result')" style="min-width:12rem">
          <template #body="{ data }">
            <Tag :severity="data.pass ? 'success' : 'danger'" :value="data.pass ? $t('documents.matching.pass') : (data.reason || $t('documents.matching.fail'))" />
          </template>
        </Column>
      </DataTable>
    </SectionCard>
      </div>

      <!-- Side column: process context (approvals + files). -->
      <div class="xl:col-span-1 min-w-0">
    <SectionCard icon="pi pi-history" :title="$t('documents.detail.approvalHistory')">
      <div v-if="docs.sla" class="mb-3 flex items-center gap-2">
        <Tag v-if="docs.sla.overdue" severity="danger" icon="pi pi-exclamation-triangle" :value="$t('approvals.overdue')" />
        <Tag v-else-if="docs.sla.slaDueAt" severity="info" icon="pi pi-clock" :value="$t('approvals.dueBy')" />
        <span v-if="docs.sla.slaDueAt" class="text-muted-color text-sm tabular-nums">{{ formatDate(docs.sla.slaDueAt) }}</span>
      </div>

      <EmptyState v-if="!approvalSteps.length" icon="pi pi-history" :title="$t('documents.detail.noApprovalActions')" />
      <!-- Stepper: each acted step is a filled node with a connector; the current waiting step pulses. -->
      <ol v-else class="m-0 p-0 list-none">
        <li v-for="(s, i) in approvalSteps" :key="i" class="flex gap-3.5 relative pb-4 last:pb-0">
          <!-- connector line to the next node -->
          <span v-if="i < approvalSteps.length - 1" class="absolute left-4 top-9 bottom-0 w-px bg-surface-200 dark:bg-surface-700" aria-hidden="true" />
          <span class="relative z-10 grid place-items-center w-8 h-8 rounded-full border-2 shrink-0" :class="stepNodeClass(s)">
            <span v-if="s.state === 'active'" class="absolute inset-0 rounded-full border-2 border-current opacity-40 motion-safe:animate-ping" aria-hidden="true" />
            <i :class="s.icon" class="text-xs" />
          </span>
          <div class="min-w-0 flex-1 pt-1">
            <div class="text-sm font-semibold text-color">{{ s.title }}</div>
            <div v-if="s.subtitle" class="text-sm text-muted-color wrap-break-word">{{ s.subtitle }}</div>
            <div v-if="s.at" class="text-xs text-muted-color tabular-nums mt-0.5">{{ s.at }}</div>
            <div v-if="s.body" class="text-sm text-color mt-1 wrap-break-word">{{ s.body }}</div>
          </div>
        </li>
      </ol>
    </SectionCard>

    <!-- Attachments — uploadable while the document is an editable draft. -->
    <SectionCard icon="pi pi-paperclip" :title="$t('documents.detail.attachments')">
      <template v-if="docs.attachments.length" #actions>
        <span class="text-sm text-muted-color tabular-nums">{{ docs.attachments.length }}</span>
      </template>
      <AttachmentUploader :document-id="id" :attachments="docs.attachments" :readonly="!canUpload" @uploaded="docs.reloadAttachments(id)" />
    </SectionCard>

    <!-- Evidence that the money moved. Deliberately its own card, apart from the requester's
         attachments above: those are what was asked for, this is what the bank did.
         The panel hides itself when this document has no payment (`absent`) — most documents
         never have one — so the card is not rendered for them. This is the only place a paid
         disbursement's slips can be read: the ready-to-pay queue drops it the moment it is paid. -->
    <SectionCard v-if="showSlips" icon="pi pi-wallet" :title="$t('payments.slips.title')">
      <PaymentSlips :documentId="id" />
    </SectionCard>

      </div>
    </div>

    <!-- Create a successor (PR→PO, advance→clear). Server validates the type pairing. -->
    <Dialog v-model:visible="fromDialog" :header="$t('documents.detail.createSuccessor')" modal class="w-96">
      <div class="flex flex-col gap-2">
        <label class="text-sm text-muted-color">{{ $t('documents.create.documentType') }}</label>
        <Select v-model="fromTypeId" :options="creatableTypes" optionLabel="name" optionValue="id" :placeholder="$t('documents.create.chooseType')" class="w-full" />
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="fromDialog = false" />
        <Button :label="$t('common.create')" :disabled="!fromTypeId" @click="confirmCreateFrom" />
      </template>
    </Dialog>

    <!-- Goods receipt: enter the quantity received now per line. -->
    <Dialog v-model:visible="receiveDialog" :header="$t('documents.receive.action')" modal class="w-lg">
      <DataTable :value="docs.lines" dataKey="lineNo" showGridlines scrollable scrollHeight="20rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" />
        <Column field="description" :header="$t('documents.create.line.description')" />
        <Column :header="$t('documents.create.line.qty')"><template #body="{ data }">{{ fmtQty(data.qty) }}</template></Column>
        <Column :header="$t('documents.receive.received')"><template #body="{ data }">{{ fmtQty(data.receivedQty) }}</template></Column>
        <Column :header="$t('documents.receive.receiveNow')">
          <template #body="{ data }">
            <InputText v-if="data.id" v-model="receiveQtys[data.id]" inputmode="decimal" class="w-24" placeholder="0" />
          </template>
        </Column>
      </DataTable>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="receiveDialog = false" />
        <Button :label="$t('documents.receive.confirm')" @click="confirmReceive" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
/* Restore basic block formatting for sanitized rich-text rendered via v-html (Tailwind's
   preflight strips list/heading defaults). Mirrors the create-document review summary. */
.prose-review :deep(h1),
.prose-review :deep(h2),
.prose-review :deep(h3) {
  font-weight: 600;
  margin: 0.25rem 0;
}
.prose-review :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}
.prose-review :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}
.prose-review :deep(a) {
  color: var(--p-primary-color);
  text-decoration: underline;
}
.prose-review :deep(p) {
  margin: 0.15rem 0;
}
</style>
