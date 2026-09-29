<script setup lang="ts">
import Button from 'primevue/button';
import Chip from 'primevue/chip';
import Column from 'primevue/column';
import DatePicker from 'primevue/datepicker';
import InputText from 'primevue/inputtext';
import Popover from 'primevue/popover';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import ReviewApprovalDialog from '@/components/documents/ReviewApprovalDialog.vue';
import ApprovalTabs from '@/components/approvals/ApprovalTabs.vue';
import { useApprovalsStore } from '../../stores/approvals';
import { useAuthStore } from '../../stores/auth';
import { useOrgStore } from '../../stores/org';
import { useFeedback } from '../../composables/useFeedback';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { formatDate } from '../../utils/date';
import { formatAmount } from '../../utils/money';
import { approvalsApi } from '../../api/approvals';
import type { PendingApproval, PendingInboxFilters } from '../../api/approvals';
import { documentsApi, downloadBlob } from '../../api/documents';

const router = useRouter();
const approvals = useApprovalsStore();
const auth = useAuthStore();
const org = useOrgStore();
const feedback = useFeedback();
const { t } = useI18n();
const { fmtBase } = useCurrencyFormat();

/**
 * The search term, answered by the SERVER across the whole pending set.
 *
 * This used to bind PrimeVue's client-side `filters` / `globalFilterFields`. `AppDataTable` runs
 * the table in `lazy` mode, where PrimeVue delegates filtering to the server and ignores those
 * bindings entirely — nothing handled the filter event, so the box was decoration. And a
 * client-side filter would have been wrong anyway: in lazy mode the client holds one page, so it
 * would have searched a fraction of the queue while looking like it searched all of it.
 */
const search = ref(approvals.search);
function onSearch(term: string) {
  search.value = term;
  // Back to page 1: the term changes which documents exist, so the old offset means nothing.
  approvals.loadPending(1, approvals.limit, term);
}

// ---- Filters --------------------------------------------------------------
// Department, the submitted day range, the amount — and, for finance, whether the document has
// reached their desk. Every inbox row is pending by definition, so there is no status; a reader's
// own documents are never here, so there is no "only mine". Answered by the server across the
// whole pending set, like the search, so the export holds exactly what the filter shows.
const canDept = computed(() => auth.can('DEPARTMENT_VIEW'));

const f = reactive({
  departmentId: null as string | null,
  dateRange: null as (Date | null)[] | null,
  minAmount: '',
  maxAmount: '',
  intake: null as 'RECEIVED' | 'NOT_RECEIVED' | null,
});

const filterPanel = ref<InstanceType<typeof Popover>>();
const togglePanel = (e: Event) => filterPanel.value?.toggle(e);

const pad = (n: number) => String(n).padStart(2, '0');
// Local-date YYYY-MM-DD (no UTC shift); the server reads it as the company's calendar day.
const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function buildFilters(): PendingInboxFilters {
  const [from, to] = f.dateRange ?? [];
  return {
    departmentId: f.departmentId ?? undefined,
    submittedFrom: from ? toIsoDate(from) : undefined,
    submittedTo: to ? toIsoDate(to) : undefined,
    // Amount bounds stay strings end to end — never coerced to a JS number.
    minAmount: f.minAmount || undefined,
    maxAmount: f.maxAmount || undefined,
    intake: f.intake ?? undefined,
  };
}

const apply = () => approvals.applyFilters(buildFilters());

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
function applyDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(apply, 350);
}

function clearAll() {
  f.departmentId = null;
  f.dateRange = null;
  f.minAmount = '';
  f.maxAmount = '';
  f.intake = null;
  search.value = '';
  approvals.clearFilters();
}

const deptName = computed(() => org.departments.find((x) => x.id === f.departmentId)?.name);

interface ActiveChip {
  key: string;
  label: string;
  remove: () => void;
}

// The chips a user sees under the toolbar — each removable on its own.
const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  if (f.departmentId)
    chips.push({ key: 'dept', label: `${t('documents.filters.department')}: ${deptName.value ?? '—'}`, remove: () => { f.departmentId = null; apply(); } });
  const [from, to] = f.dateRange ?? [];
  if (from || to)
    chips.push({ key: 'date', label: `${t('approvals.summary.filters.submitted')}: ${from ? toIsoDate(from) : '…'} – ${to ? toIsoDate(to) : '…'}`, remove: () => { f.dateRange = null; apply(); } });
  if (f.minAmount)
    chips.push({ key: 'min', label: `≥ ${formatAmount(f.minAmount)}`, remove: () => { f.minAmount = ''; apply(); } });
  if (f.maxAmount)
    chips.push({ key: 'max', label: `≤ ${formatAmount(f.maxAmount)}`, remove: () => { f.maxAmount = ''; apply(); } });
  if (f.intake)
    chips.push({ key: 'intake', label: `${t('documents.list.columns.intake')}: ${intakeOptions.value.find((o) => o.value === f.intake)?.label ?? ''}`, remove: () => { f.intake = null; apply(); } });
  return chips;
});

const activeCount = computed(() => activeChips.value.length);

// Received / not yet, worded as the intake column words them, so the filter and the rows agree.
const intakeOptions = computed(() => [
  { label: t('documents.list.intake.received'), value: 'RECEIVED' as const },
  { label: t('documents.list.intake.notReceived'), value: 'NOT_RECEIVED' as const },
]);

// ---- Export ---------------------------------------------------------------
// The payables sheet of the whole filtered inbox, every page. Built from the panel's current values
// rather than the store's applied ones, so what the person sees is what they get — an amount typed
// a moment ago is in the file even before the debounce lands.
const exporting = ref(false);
async function exportPending() {
  exporting.value = true;
  try {
    const { blob, fileName } = await approvalsApi.exportPending(buildFilters(), search.value || undefined);
    downloadBlob(blob, fileName);
  } catch (e) {
    feedback.error(e, t('documents.export.failed'));
  } finally {
    exporting.value = false;
  }
}

// ---- Intake: finance registering what reached their desk -----------------
// The same affordances, codes and endpoints as the documents list, so the two screens can never
// disagree about a document. Gated on the codes here as UX; the server also requires that the route
// actually reached this reader.
const canReceive = computed(() => auth.can('DOC_INTAKE_RECEIVE'));
const canReverse = computed(() => auth.can('DOC_INTAKE_REVERSE'));
const showIntakeActions = computed(() => canReceive.value || canReverse.value);

const selectedRows = ref<PendingApproval[]>([]);
const receiving = ref(false);

/** Only rows the SERVER says this reader may receive — never a guess made here. */
const isSelectable = (row: PendingApproval) => row.intake?.canReceive === true;
const selectableRows = computed(() => selectedRows.value.filter(isSelectable));

function receivedLabel(row: PendingApproval): string {
  const intake = row.intake;
  if (!intake?.received) return '';
  if (!intake.receivedByName) return t('documents.list.intake.received');
  return t('documents.list.intake.receivedBy', {
    name: intake.receivedByName,
    at: intake.receivedAt ? formatDate(intake.receivedAt) : '',
  });
}

/**
 * Receive the ticked rows. The server answers per document, so this reports per document: a
 * colleague who took one of them a minute ago must not look like a failure of the rest.
 */
async function receiveSelected() {
  const ids = selectableRows.value.map((r) => r.id);
  if (!ids.length) return;
  receiving.value = true;
  try {
    const outcomes = await documentsApi.receiveIntake(ids);
    const docNoOf = new Map(approvals.pending.map((d) => [d.id, d.docNo]));
    const received = outcomes.filter((o) => o.received).length;
    const refused = outcomes.filter((o) => o.refusal);

    if (received) feedback.success(t('documents.list.intake.done', { count: received }));
    if (refused.length) {
      const items = refused
        .map((o) => `${docNoOf.get(o.documentId) ?? o.documentId} (${t('documents.list.intake.refusal.' + o.refusal)})`)
        .join(', ');
      feedback.warn(t('documents.list.intake.refusedList', { items }));
    }
    selectedRows.value = [];
    await approvals.loadPending();
  } catch (e) {
    feedback.error(e, t('common.saveFailed'));
  } finally {
    receiving.value = false;
  }
}

/** One row, through the same call as the batch — so a refusal reads the same either way. */
async function receiveOne(row: PendingApproval) {
  selectedRows.value = [row];
  await receiveSelected();
}

async function reverseIntake(row: PendingApproval) {
  try {
    await documentsApi.reverseIntake(row.id);
    feedback.success(t('documents.list.intake.reversed'), row.docNo);
    await approvals.loadPending();
  } catch (e) {
    feedback.error(e, t('common.saveFailed'));
  }
}

// A page that changed underneath a selection would apply the action to rows nobody ticked.
watch(() => approvals.pending, () => { selectedRows.value = []; });

// Act on a row without leaving the inbox. Every inbox row is pending this user, so the
// shared dialog's `canAct` fetch will confirm eligibility and the server re-enforces act().
const reviewOpen = ref(false);
const reviewDoc = ref<{ id: string; docNo: string }>({ id: '', docNo: '' });
function openReview(row: PendingApproval) {
  reviewDoc.value = { id: row.id, docNo: row.docNo };
  reviewOpen.value = true;
}

onMounted(() => {
  // A fresh visit starts unfiltered: filters left in the store from an earlier visit would narrow
  // the queue with nothing on screen saying so.
  if (Object.keys(approvals.filters).length) approvals.filters = {};
  approvals.loadPending();
  if (canDept.value) org.loadDepartments();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('approvals.title')" />
    <ApprovalTabs />

    <PageToolbar :search="search" @update:search="onSearch">
      <template #filters>
        <Button
          type="button"
          icon="pi pi-filter"
          :label="$t('documents.filters.button')"
          :badge="activeCount ? String(activeCount) : undefined"
          badgeSeverity="contrast"
          severity="secondary"
          outlined
          data-testid="inbox-filters"
          @click="togglePanel"
        />
      </template>
      <template #actions>
        <!-- Counts only the ticked rows the server says may be received, so a selection that
             includes one a colleague took does not advertise a number it will not deliver. -->
        <Button
          v-if="canReceive"
          :label="$t('documents.list.intake.receive')"
          icon="pi pi-inbox"
          :badge="selectableRows.length ? String(selectableRows.length) : undefined"
          badgeSeverity="contrast"
          severity="secondary"
          outlined
          :disabled="!selectableRows.length || receiving"
          :loading="receiving"
          data-testid="receive-selected"
          @click="receiveSelected"
        />
        <Button
          v-tooltip.bottom="$t('approvals.export.tooltip')"
          :label="$t('documents.export.button')"
          icon="pi pi-file-excel"
          severity="secondary"
          outlined
          :loading="exporting"
          :disabled="exporting"
          data-testid="export-pending"
          @click="exportPending"
        />
      </template>
    </PageToolbar>

    <!-- Filter panel: stacked label-over-field rows so inputs never overflow w-80. -->
    <Popover ref="filterPanel">
      <div class="w-80 flex flex-col gap-3" data-testid="inbox-filter-panel">
        <div v-if="canDept" class="flex flex-col gap-1 min-w-0">
          <label class="text-sm text-muted-color">{{ $t('documents.filters.department') }}</label>
          <Select
            v-model="f.departmentId"
            :options="org.departments"
            optionLabel="name"
            optionValue="id"
            showClear
            :placeholder="$t('documents.filters.anyDepartment')"
            fluid
            appendTo="self"
            class="min-w-0"
            data-testid="filter-department"
            @change="apply"
          />
        </div>

        <div class="flex flex-col gap-1 min-w-0">
          <label class="text-sm text-muted-color">{{ $t('approvals.summary.filters.submitted') }}</label>
          <DatePicker
            v-model="f.dateRange"
            selectionMode="range"
            dateFormat="yy-mm-dd"
            showButtonBar
            :placeholder="$t('approvals.summary.filters.pickRange')"
            fluid
            appendTo="self"
            class="min-w-0"
            data-testid="filter-submitted"
            @update:modelValue="apply"
          />
        </div>

        <div class="flex flex-col gap-1 min-w-0">
          <label class="text-sm text-muted-color">{{ $t('common.amount') }}</label>
          <div class="flex items-center gap-2 min-w-0">
            <InputText
              v-model="f.minAmount"
              inputmode="decimal"
              :placeholder="$t('documents.filters.minAmount')"
              class="flex-1 min-w-0"
              data-testid="filter-min-amount"
              @input="applyDebounced"
            />
            <span class="text-muted-color shrink-0">–</span>
            <InputText
              v-model="f.maxAmount"
              inputmode="decimal"
              :placeholder="$t('documents.filters.maxAmount')"
              class="flex-1 min-w-0"
              data-testid="filter-max-amount"
              @input="applyDebounced"
            />
          </div>
        </div>

        <!-- Finance's own filter, shown with the intake column it narrows by and on the same codes. -->
        <div v-if="showIntakeActions" class="flex flex-col gap-1 min-w-0">
          <label class="text-sm text-muted-color">{{ $t('documents.list.columns.intake') }}</label>
          <Select
            v-model="f.intake"
            :options="intakeOptions"
            optionLabel="label"
            optionValue="value"
            showClear
            :placeholder="$t('common.all')"
            fluid
            appendTo="self"
            class="min-w-0"
            data-testid="filter-intake"
            @change="apply"
          />
        </div>

        <div class="flex justify-between items-center pt-1 border-t border-surface">
          <Button
            text
            size="small"
            icon="pi pi-filter-slash"
            :label="$t('documents.filters.clear')"
            :disabled="!activeCount"
            @click="clearAll"
          />
          <Button size="small" :label="$t('documents.filters.done')" @click="filterPanel?.hide()" />
        </div>
      </div>
    </Popover>

    <!-- Active filters as removable chips, so applied filters stay visible. -->
    <div v-if="activeChips.length" class="flex flex-wrap items-center gap-2 mb-4">
      <Chip
        v-for="chip in activeChips"
        :key="chip.key"
        :label="chip.label"
        removable
        :data-testid="'chip-' + chip.key"
        @remove="chip.remove()"
      />
      <Button text size="small" severity="secondary" :label="$t('documents.filters.clear')" @click="clearAll" />
    </div>

    <ErrorState v-if="approvals.error" :message="approvals.error" @retry="approvals.loadPending()" />

    <div v-else class="card">
      <AppDataTable
        v-model:selection="selectedRows"
        :value="approvals.pending"
        :total="approvals.total"
        :loading="approvals.loading"
        :page="approvals.page"
        :rows="approvals.limit"
        :rowHover="true"
        @page="(e: { page: number; limit: number }) => approvals.loadPending(e.page, e.limit)"
        @refresh="approvals.loadPending()"
        @row-click="(e: any) => router.push({ name: 'document-detail', params: { id: e.data.id } })"
      >
        <!-- Ticking rows is the intake workflow and nothing else, so it is not offered to an
             approver with no intake duty. -->
        <Column
          v-if="showIntakeActions"
          data-priority="identity"
          selectionMode="multiple"
          style="width: 3rem"
          headerStyle="width: 3rem"
        />
        <!-- What a phone-sized inbox has room for is the three things an approver acts on: which
             document, for how much, and the button. Everything else — type, requester, step,
             submitted, SLA — is marked secondary and folds into the per-row expander below `md`.
             Unmarked, all nine columns took an equal slice of a 375px viewport and Lao, which has
             no spaces to break at, stacked one character per line. -->
        <Column data-priority="identity" field="docNo" :header="$t('approvals.columns.docNo')" />
        <Column data-priority="secondary" :header="$t('approvals.columns.type')"><template #body="{ data }">{{ data.documentType?.name }}</template></Column>
        <Column data-priority="secondary" :header="$t('approvals.columns.requester')" style="min-width: 10rem">
          <template #body="{ data }">
            <div class="leading-tight">
              <div data-testid="requester" class="text-sm text-color">{{ data.requesterName }}</div>
              <div v-if="data.requesterDepartment" data-testid="requester-department" class="text-xs text-muted-color">
                {{ data.requesterDepartment }}
              </div>
            </div>
          </template>
        </Column>
        <!-- `data-label`, not `header`: this column draws its title through the #header slot
             below, and PrimeVue renders the prop AND the slot when given both. The wrapper reads
             the attribute to name this value on the card layout below `md`. -->
        <Column :data-label="$t('approvals.columns.baseTotal')" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <!-- PrimeVue wraps the header in a flex box, so `text-align` on the cell alone leaves
               the title off the numbers it heads. -->
          <template #header><span class="block w-full text-right">{{ $t('approvals.columns.baseTotal') }}</span></template>
          <template #body="{ data }">{{ data.baseTotalAmount != null ? fmtBase(data.baseTotalAmount) : '—' }}</template>
        </Column>
        <Column data-priority="secondary" field="currentStepNo" :header="$t('approvals.columns.step')" />
        <Column data-priority="secondary" :header="$t('approvals.columns.submitted')"><template #body="{ data }">{{ formatDate(data.submittedAt) }}</template></Column>
        <Column data-priority="secondary" :header="$t('approvals.columns.sla')">
          <template #body="{ data }">
            <Tag v-if="data.overdue" severity="danger" :value="$t('approvals.overdue')" />
            <span v-else-if="data.slaDueAt" class="text-muted-color text-sm">{{ formatDate(data.slaDueAt) }}</span>
            <span v-else class="text-muted-color text-sm">—</span>
          </template>
        </Column>
        <!-- Finance's intake book, and only finance's — gated on the same codes as the actions. -->
        <Column
          v-if="showIntakeActions"
          data-priority="secondary"
          :header="$t('documents.list.columns.intake')"
          style="min-width: 13rem"
        >
          <template #body="{ data }">
            <div class="flex items-center gap-2">
              <span
                v-if="data.intake?.received"
                class="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
                data-testid="intake-received"
                :title="receivedLabel(data)"
              >
                <i class="pi pi-check-circle text-xs" />
                {{ $t('documents.list.intake.received') }}
              </span>
              <span v-else class="text-muted-color text-sm" data-testid="intake-not-received">
                {{ $t('documents.list.intake.notReceived') }}
              </span>
              <!-- The row action beside the state it changes; `intake.canReceive` is the server's
                   verdict for this row, so it never offers what would be refused. -->
              <Button
                v-if="data.intake?.canReceive && canReceive"
                :label="$t('documents.list.intake.receiveOne')"
                icon="pi pi-inbox"
                size="small"
                severity="secondary"
                outlined
                :loading="receiving"
                :disabled="receiving"
                data-testid="intake-receive-row"
                @click.stop="receiveOne(data)"
              />
              <Button
                v-if="data.intake?.received && canReverse"
                icon="pi pi-undo"
                text
                rounded
                size="small"
                severity="secondary"
                data-testid="intake-reverse"
                :aria-label="$t('documents.list.intake.reverse')"
                :title="$t('documents.list.intake.reverse')"
                @click.stop="reverseIntake(data)"
              />
            </div>
          </template>
        </Column>
        <Column data-priority="actions" :header="$t('common.actions')" style="width: 7rem">
          <template #body="{ data }">
            <!-- `title` / `aria-label` rather than the label alone: below `md` the wrapper hides
                 the label and the button is its icon, so the name has to live somewhere a
                 screen reader and a long-press can still find it. -->
            <Button
              :label="$t('documents.detail.approve')"
              :aria-label="$t('documents.detail.approve')"
              :title="$t('documents.detail.approve')"
              icon="pi pi-check-circle"
              size="small"
              severity="success"
              outlined
              @click.stop="openReview(data)"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-check-circle" :title="$t('approvals.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Approve-from-inbox modal: submitted reason/details + total amount, with approve /
         reject / return, without leaving the inbox. -->
    <ReviewApprovalDialog
      v-model:visible="reviewOpen"
      :doc-id="reviewDoc.id"
      :doc-no="reviewDoc.docNo"
      @acted="approvals.loadPending()"
    />
  </div>
</template>
