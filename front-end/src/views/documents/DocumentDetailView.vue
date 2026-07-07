<script setup lang="ts">
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EventTimeline from '@/components/EventTimeline.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import AttachmentUploader from '@/components/AttachmentUploader.vue';
import type { TimelineEntry } from '@/components/EventTimeline.vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { formatDate, formatDateTime } from '../../utils/date';
import { fieldComponent } from '../../utils/formFields';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { documentsApi } from '../../api/documents';
import type { CreatableType } from '../../api/documents';
import { useAuthStore } from '../../stores/auth';
import { useApprovalsStore } from '../../stores/approvals';
import { useDocumentsStore } from '../../stores/documents';
import { useFeedback } from '../../composables/useFeedback';
import { canActOn, pendingApproverNames } from '../../utils/approval';
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
const id = route.params.id as string;

/** Rich-text fields (the PrimeVue Editor) store an HTML fragment; render it as sanitized HTML
 * instead of showing the literal tags. Plain fields stay as text. */
function isHtmlField(fieldType: string): boolean {
  return !!fieldComponent(fieldType).html;
}

const { fmt, fmtBase, baseCode } = useCurrencyFormat();
const doc = computed(() => docs.current);

// Header meta: document type name and the key dates (created + submit/lock).
const docTypeName = computed(() => (doc.value as any)?.documentType?.name ?? '');
// Display-only line totals for the table footer. The summary/header headline figure
// stays the server's `doc.totalAmount` — this is a per-line reconciliation aid only,
// summed with Decimal so money is never coerced to a JS number.
const lineTotals = computed(() => ({
  line: sumAmounts(docs.lines.map((l: any) => l.lineAmount)),
  base: sumAmounts(docs.lines.map((l: any) => l.baseLineAmount)),
}));
const canSubmit = computed(() => auth.can('DOC_SUBMIT') && doc.value?.status === 'DRAFT');
// Cancel = withdraw your own request: only the creator, and only before it is finalized.
// The server re-enforces both. An approver who wants to stop it uses reject/return.
const canCancel = computed(
  () =>
    auth.can('DOC_CANCEL') &&
    doc.value?.createdBy?.id === auth.userId &&
    ['DRAFT', 'SUBMITTED', 'IN_APPROVAL'].includes(doc.value?.status),
);
// Server-computed eligibility for the current step (hides the buttons the moment the user
// acts and the step advances past them), still gated by the local DOC_APPROVE + not-creator
// UX mirror. The server re-enforces on act().
const canAct = computed(() => docs.canAct && canActOn(doc.value, auth.userId, (c) => auth.can(c)));
const canEdit = computed(() => auth.can('DOC_CREATE') && doc.value?.status === 'DRAFT');
const canCreateFrom = computed(() => auth.can('DOC_CREATE') && ['APPROVED', 'COMPLETED'].includes(doc.value?.status));
const canUpload = computed(() => auth.can('DOC_CREATE') && doc.value?.status === 'DRAFT');
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
  if (await docs.receive(id, lines)) {
    receiveDialog.value = false;
    fb.success(t('documents.receive.recorded'));
  } else fb.error(docs.error);
}
const LINE_STATUS_SEVERITY: Record<string, string> = { OPEN: 'secondary', PARTIAL: 'warn', RECEIVED: 'success', CLOSED: 'contrast' };

function goEdit() {
  router.push({ name: 'document-edit', params: { id } });
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
    const newId = await docs.createFrom(id, fromTypeId.value);
    fromDialog.value = false;
    fb.success(t('feedback.created'));
    await router.push({ name: 'document-edit', params: { id: newId } });
  } catch (e) {
    fb.error(e);
  }
}

const statusSeverity = (status: string) =>
  ({ DRAFT: 'secondary', SUBMITTED: 'info', IN_APPROVAL: 'warn', APPROVED: 'success', COMPLETED: 'success', REJECTED: 'danger', CANCELLED: 'contrast' } as Record<string, any>)[status] ?? 'secondary';

// Left-accent tint on the hero header, keyed off status (same semantic tints as the timeline).
const statusAccent = (status: string) =>
  ({
    DRAFT: 'border-l-surface-400 dark:border-l-surface-500',
    SUBMITTED: 'border-l-blue-500',
    IN_APPROVAL: 'border-l-amber-500',
    APPROVED: 'border-l-emerald-500',
    COMPLETED: 'border-l-emerald-500',
    REJECTED: 'border-l-red-500',
    CANCELLED: 'border-l-surface-400 dark:border-l-surface-500',
  } as Record<string, string>)[status] ?? 'border-l-surface-400 dark:border-l-surface-500';

// Approval history → timeline entries. Marker colour/icon follow the action.
const ACTION_SEVERITY: Record<string, TimelineEntry['severity']> = { APPROVE: 'success', REJECT: 'danger', RETURN: 'warn', SUBMIT: 'info', ESCALATE: 'warn', DELEGATE: 'info' };
const ACTION_ICON: Record<string, string> = { APPROVE: 'pi pi-check', REJECT: 'pi pi-times', RETURN: 'pi pi-undo', SUBMIT: 'pi pi-send', ESCALATE: 'pi pi-angle-double-up', DELEGATE: 'pi pi-user-edit' };
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
const timelineEvents = computed<TimelineEntry[]>(() => {
  const history = docs.approvalLog.map((l: any) => ({
    icon: ACTION_ICON[l.action] ?? 'pi pi-circle-fill',
    severity: ACTION_SEVERITY[l.action] ?? 'secondary',
    title: actionLabel(l.action),
    subtitle: l.approver?.username ?? l.actorName ?? l.actedByName ?? undefined,
    at: formatDateTime(l.actedAt),
    body: l.remark ?? l.comment ?? undefined,
  }));
  return pendingEntry.value ? [...history, pendingEntry.value] : history;
});

const dialog = ref<{ open: boolean; action: ApprovalAction; remark: string }>({ open: false, action: 'APPROVE', remark: '' });
function openAct(action: ApprovalAction) {
  dialog.value = { open: true, action, remark: '' };
}
async function confirmAct() {
  const ok = await approvals.act(id, dialog.value.action, dialog.value.remark || undefined);
  dialog.value.open = false;
  if (ok) {
    await docs.loadDetail(id);
    fb.success(t('feedback.done'));
  } else {
    fb.error(approvals.error);
  }
}

// Action errors are toasted; clear the store's `error` afterwards so the inline
// ErrorState (page-load path) doesn't also show it.
async function submitDoc() {
  if (await docs.submit(id)) fb.success(t('feedback.submitted'));
  else { const m = docs.error; docs.error = ''; fb.error(m); }
}

async function cancelDoc() {
  if (!(await fb.confirm({ message: t('feedback.confirm.documentCancel') }))) return;
  if (await docs.cancel(id)) fb.success(t('feedback.done'));
  else { const m = docs.error; docs.error = ''; fb.error(m); }
}

onMounted(() => docs.loadDetail(id));
</script>

<template>
  <div v-if="doc">
    <div class="rounded-xl border border-surface-200 dark:border-surface-700 border-l-4 bg-surface-0 dark:bg-surface-900 shadow-sm p-4 sm:p-5 mb-4" :class="statusAccent(doc.status)">
    <DetailHeader class="mb-0!" :title="doc.docNo" :status="$t('documents.status.' + doc.status)" :status-severity="statusSeverity(doc.status)">
      <template #meta>
        <div class="flex items-center gap-x-2 gap-y-1 flex-wrap text-sm text-muted-color mt-1">
          <span v-if="docTypeName" class="text-color font-medium">{{ docTypeName }}</span>
          <template v-if="doc.createdAt">
            <span aria-hidden="true">·</span>
            <span>{{ $t('documents.detail.created') }} {{ formatDate(doc.createdAt) }}</span>
          </template>
          <template v-if="doc.submittedAt">
            <span aria-hidden="true">·</span>
            <span>{{ $t('documents.detail.rateLockedAt') }} {{ formatDate(doc.submittedAt) }}</span>
          </template>
        </div>
      </template>
      <template v-if="doc.totalAmount != null" #headline>
        <div class="sm:text-right">
          <div class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.total') }}</div>
          <div class="text-2xl font-semibold text-color tabular-nums leading-tight">
            {{ fmt(doc.totalAmount, doc.currency?.code) }}
            <span class="text-sm font-normal text-muted-color">{{ doc.currency?.code ?? baseCode() ?? '' }}</span>
          </div>
          <!-- Base-currency line only adds information for a foreign-currency document;
               when the document is already in the company base currency it just repeats
               the figure above, so hide it. -->
          <div
            v-if="doc.baseTotalAmount != null && (doc.currency?.code ?? baseCode()) !== baseCode()"
            class="text-xs text-muted-color tabular-nums mt-0.5"
          >
            {{ fmtBase(doc.baseTotalAmount) }} {{ baseCode() ?? '' }}
          </div>
        </div>
      </template>
      <template #actions>
        <!-- Primary group: the approval decision. -->
        <div v-if="canAct" class="flex items-center gap-2">
          <Button :label="$t('documents.detail.approve')" icon="pi pi-check" severity="success" @click="openAct('APPROVE')" />
          <Button :label="$t('documents.detail.reject')" icon="pi pi-times" severity="danger" outlined @click="openAct('REJECT')" />
          <Button :label="$t('documents.detail.return')" icon="pi pi-undo" severity="secondary" outlined @click="openAct('RETURN')" />
        </div>
        <!-- Divider between primary decision and secondary utilities. -->
        <span v-if="canAct" class="hidden sm:inline-block w-px h-6 bg-surface-200 dark:bg-surface-700" aria-hidden="true" />
        <!-- Secondary group: utilities. -->
        <div class="flex items-center gap-2 flex-wrap">
          <Button v-if="canEdit" :label="$t('common.edit')" icon="pi pi-pencil" severity="secondary" outlined @click="goEdit()" />
          <Button v-if="canSubmit" :label="$t('documents.detail.submit')" icon="pi pi-send" :loading="docs.loading" @click="submitDoc()" />
          <Button v-if="canCancel" :label="$t('documents.detail.cancel')" severity="secondary" outlined :loading="docs.loading" @click="cancelDoc()" />
          <Button v-if="canCreateFrom" :label="$t('documents.detail.createSuccessor')" icon="pi pi-arrow-right" severity="secondary" outlined @click="openCreateFrom()" />
          <Button v-if="canReceive" :label="$t('documents.receive.action')" icon="pi pi-inbox" severity="secondary" outlined @click="openReceive()" />
        </div>
      </template>
    </DetailHeader>
    </div>

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

    <ErrorState v-if="docs.error" :message="docs.error" @retry="docs.loadOne(id)" />

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-x-4 items-start">
      <!-- Main column: the document's own data. `min-w-0` lets it shrink so wide
           scrollable tables scroll inside their card instead of overflowing it. -->
      <div class="xl:col-span-2 min-w-0">
    <SectionCard icon="pi pi-file" :title="$t('documents.detail.summary')">
      <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 m-0">
        <div class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.currency') }}</dt>
          <dd class="text-color m-0">{{ doc.currency?.code ?? baseCode() ?? $t('common.none') }}</dd>
        </div>
        <div class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.exchangeRate') }}</dt>
          <dd class="text-color m-0 tabular-nums">{{ doc.exchangeRate ?? $t('common.none') }}</dd>
        </div>
        <div class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.total') }}</dt>
          <dd class="text-color font-semibold m-0 tabular-nums">{{ doc.totalAmount != null ? fmt(doc.totalAmount, doc.currency?.code) : $t('common.none') }}</dd>
        </div>
        <div class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.baseTotal') }}</dt>
          <dd class="text-color font-semibold m-0 tabular-nums">{{ doc.baseTotalAmount != null ? fmtBase(doc.baseTotalAmount) + ' ' + (baseCode() ?? '') : $t('common.none') }}</dd>
        </div>
        <div v-if="doc.vendor" class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.vendor') }}</dt>
          <dd class="text-color m-0 truncate">{{ doc.vendor.name }}</dd>
        </div>
        <div v-if="doc.submittedAt" class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.rateLockedAt') }}</dt>
          <dd class="text-color m-0">{{ formatDate(doc.submittedAt) }}</dd>
        </div>
        <div v-if="docs.refDocument" class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ $t('documents.detail.predecessor') }}</dt>
          <dd class="m-0">
            <Button :label="docs.refDocument.docNo" link class="p-0!" @click="router.push({ name: 'document-detail', params: { id: docs.refDocument!.id } })" />
          </dd>
        </div>
      </dl>
    </SectionCard>

    <!-- Field values from the document's pinned form. -->
    <SectionCard v-if="docs.fieldValues.length" icon="pi pi-align-left" :title="$t('documents.detail.fields')">
      <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 m-0">
        <div v-for="fv in docs.fieldValues" :key="fv.formFieldId" class="flex flex-col gap-0.5 min-w-0">
          <dt class="text-xs text-muted-color uppercase tracking-wide">{{ fv.fieldLabel }}</dt>
          <!-- Rich-text fields render their (sanitized) HTML; plain fields show literal text. -->
          <dd v-if="isHtmlField(fv.fieldType) && fv.value" class="prose-review text-color m-0 wrap-break-word" v-html="sanitizeHtml(fv.value)" />
          <dd v-else class="text-color m-0 wrap-break-word">{{ fv.value || $t('common.none') }}</dd>
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
      <DataTable v-else :value="docs.lines" dataKey="lineNo" scrollable scrollHeight="24rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" />
        <Column :header="$t('documents.create.line.item')"><template #body="{ data }">{{ data.item?.name ?? '—' }}</template></Column>
        <Column :header="$t('documents.create.line.glAccount')"><template #body="{ data }">{{ data.glAccount ?? '—' }}</template></Column>
        <Column field="description" :header="$t('documents.create.line.description')" />
        <Column field="qty" :header="$t('documents.create.line.qty')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="unitPrice" :header="$t('documents.create.line.unitPrice')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column :header="$t('documents.detail.lineAmount')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <template #body="{ data }">{{ fmt(data.lineAmount, doc.currency?.code) }}</template>
        </Column>
        <Column :header="$t('documents.detail.baseLineAmount')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <template #body="{ data }">{{ data.baseLineAmount != null ? fmtBase(data.baseLineAmount) : '—' }}</template>
        </Column>
        <Column :header="$t('documents.receive.received')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums"><template #body="{ data }">{{ data.receivedQty ?? '0' }}</template></Column>
        <Column :header="$t('documents.receive.status')">
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
      <DataTable :value="docs.matching.lines" dataKey="lineNo" scrollable scrollHeight="24rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" />
        <Column field="orderedQty" :header="$t('documents.matching.ordered')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="receivedQty" :header="$t('documents.matching.receivedQty')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="invoicedQty" :header="$t('documents.matching.invoiced')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="orderedAmount" :header="$t('documents.matching.orderedAmount')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column field="invoicedAmount" :header="$t('documents.matching.invoicedAmount')" headerStyle="text-align:right" bodyStyle="text-align:right" bodyClass="tabular-nums" />
        <Column :header="$t('documents.matching.result')">
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
      <EventTimeline :events="timelineEvents" :empty-message="$t('documents.detail.noApprovalActions')" />
    </SectionCard>

    <!-- Attachments — uploadable while the document is an editable draft. -->
    <SectionCard icon="pi pi-paperclip" :title="$t('documents.detail.attachments')">
      <AttachmentUploader :document-id="id" :attachments="docs.attachments" :readonly="!canUpload" @uploaded="docs.reloadAttachments(id)" />
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
      <DataTable :value="docs.lines" dataKey="lineNo" scrollable scrollHeight="20rem" class="text-sm min-w-0 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
        <Column field="lineNo" header="#" />
        <Column field="description" :header="$t('documents.create.line.description')" />
        <Column :header="$t('documents.create.line.qty')"><template #body="{ data }">{{ data.qty }}</template></Column>
        <Column :header="$t('documents.receive.received')"><template #body="{ data }">{{ data.receivedQty ?? '0' }}</template></Column>
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
