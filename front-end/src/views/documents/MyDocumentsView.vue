<script setup lang="ts">
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import AppDataTable from "@/components/AppDataTable.vue";
import Button from "primevue/button";
import Message from "primevue/message";
import Column from "primevue/column";
import Tag from "primevue/tag";
import Chip from "primevue/chip";
import Popover from "primevue/popover";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import ReviewApprovalDialog from "@/components/documents/ReviewApprovalDialog.vue";
import SignatureRequiredNotice from "@/components/documents/SignatureRequiredNotice.vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../../stores/auth";
import { useDocumentsStore } from "../../stores/documents";
import { useOrgStore } from "../../stores/org";
import { useMasterDataStore } from "../../stores/masterData";
import { useFeedback } from "../../composables/useFeedback";
import { documentsApi, downloadBlob } from "../../api/documents";
import type { DocumentListFilters, DocumentSummary } from "../../api/documents";
import { paymentsApi, type SlipStatus } from "../../api/payments";
import { pendingApproverNames } from "../../utils/approval";
import { formatDate } from "../../utils/date";
import { formatAmount } from "../../utils/money";

const router = useRouter();
const auth = useAuthStore();
const docs = useDocumentsStore();
const org = useOrgStore();
const master = useMasterDataStore();
const feedback = useFeedback();
const { t } = useI18n();

const copyDocNo = async (docNo: string) => {
  try {
    await navigator.clipboard.writeText(docNo);
    feedback.success(docNo, t("common.copied"));
  } catch (e) {
    feedback.error(e, t("common.saveFailed"));
  }
};

// ---- Filters --------------------------------------------------------------
// Status options come from the known doc_status values; the option-backed
// filters (type/department/vendor) are gated by the relevant read permission.
const STATUS_VALUES = ["DRAFT", "SUBMITTED", "IN_APPROVAL", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED"];
const statusOptions = computed(() =>
  STATUS_VALUES.map((value) => ({ value, label: t("documents.status." + value) })),
);

// DOC_VIEW, not DOC_CREATE: filtering a list someone else raised is not authoring one. Gating on
// the authoring permission left every reviewer with an empty filter over a populated list.
const canType = computed(() => auth.can("DOC_VIEW"));
const canDept = computed(() => auth.can("DEPARTMENT_VIEW"));
const canVendor = computed(() => auth.can("MASTER_VIEW"));

const search = ref(""); // server-side doc-no search (replaces the old client filter)
const f = reactive({
  status: [] as string[],
  documentTypeId: null as string | null,
  departmentId: null as string | null,
  vendorId: null as string | null,
  dateRange: null as (Date | null)[] | null,
  minAmount: "",
  maxAmount: "",
  // "Only the ones I raised". A view preference, not a permission — the server decides what this
  // person MAY see and this only narrows within it.
  mine: false,
});

const filterPanel = ref<InstanceType<typeof Popover>>();
const togglePanel = (e: Event) => filterPanel.value?.toggle(e);

const pad = (n: number) => String(n).padStart(2, "0");
// Local-date YYYY-MM-DD (no UTC shift); the server treats createdTo as end-of-day inclusive.
const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function buildFilters(): DocumentListFilters {
  const [from, to] = f.dateRange ?? [];
  return {
    status: f.status,
    documentTypeId: f.documentTypeId ?? undefined,
    departmentId: f.departmentId ?? undefined,
    vendorId: f.vendorId ?? undefined,
    createdFrom: from ? toIsoDate(from) : undefined,
    createdTo: to ? toIsoDate(to) : undefined,
    docNo: search.value || undefined,
    // Amount bounds stay strings end to end — never coerced to a JS number.
    minAmount: f.minAmount || undefined,
    maxAmount: f.maxAmount || undefined,
    mine: f.mine || undefined,
  };
}

const apply = () => docs.applyFilters(buildFilters());

// ---- Export ---------------------------------------------------------------
// Finance's payables sheet, of the whole filtered set (no page). Built from the filter bar's
// current values rather than the store's applied ones, so what the person sees is what they get
// — a status chosen a moment ago is in the file even before the debounce lands. No status means
// the server's pending default, which the tooltip says.
const exporting = ref(false);
async function exportPayables() {
  exporting.value = true;
  try {
    const { blob, fileName } = await documentsApi.exportPayables(buildFilters());
    downloadBlob(blob, fileName);
  } catch (e) {
    feedback.error(e, t("documents.export.failed"));
  } finally {
    exporting.value = false;
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
function applyDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(apply, 350);
}

function clearAll() {
  f.status = [];
  f.documentTypeId = null;
  f.departmentId = null;
  f.vendorId = null;
  f.dateRange = null;
  f.minAmount = "";
  f.maxAmount = "";
  f.mine = false;
  search.value = "";
  docs.clearFilters();
}

// Resolve option labels for the active-filter chips.
const typeName = computed(
  () => docs.typeOptions.items.find((x) => x.id === f.documentTypeId)?.name,
);
const deptName = computed(() => org.departments.find((x) => x.id === f.departmentId)?.name);
const vendorName = computed(() => master.vendors.find((x: any) => x.id === f.vendorId)?.name);

interface ActiveChip {
  key: string;
  label: string;
  remove: () => void;
}

// The chips a user sees under the toolbar — each removable on its own.
const activeChips = computed<ActiveChip[]>(() => {
  const chips: ActiveChip[] = [];
  for (const s of f.status) {
    chips.push({
      key: `status:${s}`,
      label: t("documents.status." + s),
      remove: () => {
        f.status = f.status.filter((x) => x !== s);
        apply();
      },
    });
  }
  if (f.documentTypeId)
    chips.push({ key: "type", label: `${t("documents.filters.documentType")}: ${typeName.value ?? "—"}`, remove: () => { f.documentTypeId = null; apply(); } });
  if (f.departmentId)
    chips.push({ key: "dept", label: `${t("documents.filters.department")}: ${deptName.value ?? "—"}`, remove: () => { f.departmentId = null; apply(); } });
  if (f.vendorId)
    chips.push({ key: "vendor", label: `${t("documents.filters.vendor")}: ${vendorName.value ?? "—"}`, remove: () => { f.vendorId = null; apply(); } });
  const [from, to] = f.dateRange ?? [];
  if (from || to)
    chips.push({ key: "date", label: `${t("documents.filters.created")}: ${from ? toIsoDate(from) : "…"} – ${to ? toIsoDate(to) : "…"}`, remove: () => { f.dateRange = null; apply(); } });
  if (f.minAmount)
    chips.push({ key: "min", label: `≥ ${formatAmount(f.minAmount)}`, remove: () => { f.minAmount = ""; apply(); } });
  if (f.maxAmount)
    chips.push({ key: "max", label: `≤ ${formatAmount(f.maxAmount)}`, remove: () => { f.maxAmount = ""; apply(); } });
  if (f.mine)
    chips.push({ key: "mine", label: t("documents.filters.mine"), remove: () => { f.mine = false; apply(); } });
  return chips;
});

const activeCount = computed(() => activeChips.value.length);

const severity = (status: string) =>
  (
    ({
      DRAFT: "secondary",
      SUBMITTED: "info",
      IN_APPROVAL: "warn",
      APPROVED: "success",
      COMPLETED: "success",
      REJECTED: "danger",
      CANCELLED: "contrast",
    }) as Record<string, string>
  )[status] ?? "secondary";

// ---- Approve-from-list modal --------------------------------------------
// A row is only actionable while it is IN_APPROVAL and the user holds DOC_APPROVE. The shared
// dialog fetches the authoritative eligibility + reason/amount on open; the server re-enforces.
const canReviewRow = (row: DocumentSummary) => row.status === "IN_APPROVAL" && auth.can("DOC_APPROVE");

const reviewOpen = ref(false);
const reviewDoc = ref<{ id: string; docNo: string }>({ id: "", docNo: "" });
function openReview(row: DocumentSummary) {
  reviewDoc.value = { id: row.id, docNo: row.docNo };
  reviewOpen.value = true;
}

// ---- Next approver (current pending step) --------------------------------
// Show who the document is waiting on right now, per row. There's no list-level field for this,
// so we reuse the per-document pending-approvers read for the IN_APPROVAL rows on the visible
// page only. That endpoint enforces participant visibility (a non-participant gets null), so a
// user who may not see the approvers simply gets a dash — no extra gating needed here.
// `undefined` = still loading; `""` = loaded but nothing to show (dash).
const nextApprovers = ref<Record<string, string | undefined>>({});
async function loadNextApprovers() {
  const rows = docs.list.filter((d) => d.status === "IN_APPROVAL");
  const entries = await Promise.all(
    rows.map(async (d) => {
      const res = await documentsApi.pendingApprovers(d.id);
      if (!res.pending) return [d.id, ""] as const;
      const names = pendingApproverNames(res.pending.approvers, (name) =>
        t("documents.detail.pending.viaDelegation", { name }),
      );
      // Prefer the eligible people's names; fall back to the step's role label.
      return [d.id, names.length ? names.join(", ") : res.pending.roleName ?? ""] as const;
    }),
  );
  nextApprovers.value = Object.fromEntries(entries);
}

// ---- Transfer-slip status -----------------------------------------------
// After a document is fully approved (COMPLETED) a payable still needs its bank transfer slip
// uploaded (via the /payments flow). Show that state per row. The backend batch read returns a
// status only for CUT_BUDGET documents, so a non-payable simply gets no entry (shows a dash).
// Needs PAYMENT_VIEW — a user without it just sees dashes, which is fine (payment-domain info).
const slipStatus = ref<Record<string, SlipStatus>>({});
async function loadSlipStatus() {
  if (!auth.can("PAYMENT_VIEW")) return;
  // Every visible row, not just the completed ones: a slip can be attached during approval to
  // satisfy a step that demands one, and filtering those out here would show a dash for a document
  // whose evidence is already stored. The server answers only for documents that have an answer.
  const ids = docs.list.map((d) => d.id);
  slipStatus.value = ids.length ? await paymentsApi.slipStatus(ids).catch(() => ({})) : {};
}

// Refetch whenever the visible page changes (new list reference from loadList / paging / filters).
watch(() => docs.list, () => {
  loadNextApprovers();
  loadSlipStatus();
});

onMounted(() => {
  docs.loadList();
  if (canType.value) docs.loadTypeOptions();
  if (canDept.value) org.loadDepartments();
  if (canVendor.value) master.loadVendors();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('documents.list.title')" />

    <PageToolbar
      :search="search"
      @update:search="
        (v) => {
          search = v;
          applyDebounced();
        }
      "
    >
      <template #filters>
        <Button
          type="button"
          icon="pi pi-filter"
          :label="$t('documents.filters.button')"
          :badge="activeCount ? String(activeCount) : undefined"
          badgeSeverity="contrast"
          severity="secondary"
          outlined
          @click="togglePanel"
        />
      </template>
      <template #actions>
        <Button
          v-if="auth.can('DOC_VIEW')"
          v-tooltip.bottom="$t('documents.export.tooltip')"
          :label="$t('documents.export.button')"
          icon="pi pi-file-excel"
          severity="secondary"
          outlined
          :loading="exporting"
          :disabled="exporting"
          data-testid="export-payables"
          @click="exportPayables"
        />
        <Button
          v-if="auth.can('DOC_CREATE')"
          :label="$t('documents.list.newDocument')"
          icon="pi pi-plus"
          :disabled="!auth.hasSignature"
          data-testid="new-document"
          @click="router.push({ name: 'document-new' })"
        />
      </template>
    </PageToolbar>

    <!-- A new document ends in a submit, which stamps a signature: closed until one is on file. -->
    <SignatureRequiredNotice v-if="auth.can('DOC_CREATE') && !auth.hasSignature" class="mb-4" />

    <!-- Filter panel: stacked label-over-field rows so inputs never overflow w-80. -->
    <Popover ref="filterPanel">
      <div class="w-80 flex flex-col gap-3">
        <div class="flex flex-col gap-3">
          <!-- First, because it is the one people reach for most and it answers a different kind of
               question from the rest: not "which documents" but "whose". -->
          <div class="flex items-start gap-3" data-testid="filter-mine-row">
            <ToggleSwitch v-model="f.mine" inputId="filter-mine" data-testid="filter-mine" @update:modelValue="apply" />
            <div class="flex flex-col gap-0.5">
              <label for="filter-mine" class="text-sm font-medium text-color">
                {{ $t("documents.filters.mine") }}
              </label>
              <span class="text-muted-color text-xs">{{ $t("documents.filters.mineHelp") }}</span>
            </div>
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("documents.filters.status") }}</label>
            <MultiSelect
              v-model="f.status"
              :options="statusOptions"
              optionLabel="label"
              optionValue="value"
              :placeholder="$t('documents.filters.status')"
              :maxSelectedLabels="2"
              fluid
              appendTo="self"
              class="min-w-0"
              @change="apply"
            />
          </div>

          <div v-if="canType" class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("documents.filters.documentType") }}</label>
            <Select
              v-model="f.documentTypeId"
              :options="docs.typeOptions.items"
              optionLabel="name"
              optionValue="id"
              showClear
              :disabled="docs.typeOptions.status === 'failed'"
              :placeholder="$t('documents.filters.anyType')"
              :emptyMessage="$t('documents.filters.noTypes')"
              fluid
              appendTo="self"
              class="min-w-0"
              @change="apply"
            />
            <!-- A control that could not read its choices says so where it stands. Left to the
                 dropdown's own empty text, a failed read reads as a fact about the data. -->
            <Message
              v-if="docs.typeOptions.status === 'failed'"
              severity="warn"
              size="small"
              variant="simple"
              data-testid="type-options-failed"
            >
              {{ $t('documents.filters.optionsFailed') }}
              <Button
                :label="$t('common.retry')"
                link
                size="small"
                class="p-0"
                @click="docs.loadTypeOptions()"
              />
            </Message>
          </div>

          <div v-if="canDept" class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("documents.filters.department") }}</label>
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
              @change="apply"
            />
          </div>

          <div v-if="canVendor" class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("documents.filters.vendor") }}</label>
            <Select
              v-model="f.vendorId"
              :options="master.vendors"
              optionLabel="name"
              optionValue="id"
              showClear
              :disabled="master.vendorsStatus === 'failed'"
              :placeholder="$t('documents.filters.anyVendor')"
              :emptyMessage="$t('documents.filters.noVendors')"
              fluid
              appendTo="self"
              class="min-w-0"
              @change="apply"
            />
            <Message
              v-if="master.vendorsStatus === 'failed'"
              severity="warn"
              size="small"
              variant="simple"
              data-testid="vendor-options-failed"
            >
              {{ $t('documents.filters.optionsFailed') }}
              <Button
                :label="$t('common.retry')"
                link
                size="small"
                class="p-0"
                @click="master.loadVendors()"
              />
            </Message>
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("documents.filters.created") }}</label>
            <DatePicker
              v-model="f.dateRange"
              selectionMode="range"
              dateFormat="yy-mm-dd"
              showButtonBar
              :placeholder="$t('documents.filters.created')"
              fluid
              appendTo="self"
              class="min-w-0"
              @update:modelValue="apply"
            />
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            <label class="text-sm text-muted-color">{{ $t("common.amount") }}</label>
            <div class="flex items-center gap-2 min-w-0">
              <InputText
                v-model="f.minAmount"
                inputmode="decimal"
                :placeholder="$t('documents.filters.minAmount')"
                class="flex-1 min-w-0"
                @input="applyDebounced"
              />
              <span class="text-muted-color shrink-0">–</span>
              <InputText
                v-model="f.maxAmount"
                inputmode="decimal"
                :placeholder="$t('documents.filters.maxAmount')"
                class="flex-1 min-w-0"
                @input="applyDebounced"
              />
            </div>
          </div>
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
          <Button
            size="small"
            :label="$t('documents.filters.done')"
            @click="filterPanel?.hide()"
          />
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
        @remove="chip.remove()"
      />
      <Button
        text
        size="small"
        severity="secondary"
        :label="$t('documents.filters.clear')"
        @click="clearAll"
      />
    </div>

    <ErrorState
      v-if="docs.error"
      :message="docs.error"
      @retry="docs.loadList()"
    />

    <div v-else class="card">
      <AppDataTable
        :value="docs.list"
        :total="docs.total"
        :loading="docs.loading"
        :page="docs.page"
        :rows="docs.limit"
        :rowHover="true"
        @page="
          (e: { page: number; limit: number }) => docs.loadList(e.page, e.limit)
        "
        @refresh="docs.loadList()"
        @row-click="
          (e: any) =>
            router.push({ name: 'document-detail', params: { id: e.data.id } })
        "
      >
        <Column data-priority="identity" field="docNo" :header="$t('documents.list.columns.docNo')">
          <template #body="{ data }">
            <span class="inline-flex items-center gap-1">
              <span>{{ data.docNo }}</span>
              <Button
                v-if="data.docNo"
                icon="pi pi-copy"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="$t('common.copy')"
                :title="$t('common.copy')"
                @click.stop="copyDocNo(data.docNo)"
              />
            </span>
          </template>
        </Column>
        <Column :header="$t('documents.list.columns.status')">
          <template #body="{ data }"
            ><Tag
              :value="$t('documents.status.' + data.status)"
              :severity="severity(data.status)"
          /></template>
        </Column>
        <!-- `data-label`, not `header`: this column draws its title through the #header slot
             below, and PrimeVue renders the prop AND the slot when given both. The wrapper reads
             the attribute to name this value on the card layout below `md`. -->
        <Column :data-label="$t('documents.list.columns.baseTotal')" bodyStyle="text-align:right" bodyClass="tabular-nums">
          <!-- PrimeVue wraps the header in a flex box, so `text-align` on the cell is ignored;
               a full-width right-aligned span makes the title line up over the numbers. -->
          <template #header>
            <span class="block w-full text-right">{{ $t("documents.list.columns.baseTotal") }}</span>
          </template>
          <template #body="{ data }">{{
            data.baseTotalAmount != null
              ? formatAmount(data.baseTotalAmount)
              : $t("common.none")
          }}</template>
        </Column>
        <Column data-priority="secondary" :header="$t('documents.list.columns.created')"
          ><template #body="{ data }">{{
            formatDate(data.createdAt)
          }}</template></Column
        >
        <Column data-priority="secondary" :header="$t('documents.list.columns.nextApprover')" style="min-width: 12rem">
          <template #body="{ data }">
            <!-- Fully approved (or settled): the chain is done, so name the outcome instead of a next approver. -->
            <span
              v-if="['APPROVED', 'COMPLETED'].includes(data.status)"
              class="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
            >
              <i class="pi pi-check-circle text-xs" />
              {{ $t("documents.list.columns.approvalDone") }}
            </span>
            <span v-else-if="data.status !== 'IN_APPROVAL'" class="text-muted-color">{{ $t("common.none") }}</span>
            <span v-else-if="nextApprovers[data.id] === undefined" class="text-muted-color">…</span>
            <span v-else-if="nextApprovers[data.id]" class="inline-flex items-center gap-1.5 text-sm">
              <i class="pi pi-user text-xs text-muted-color" />
              <span class="text-color">{{ nextApprovers[data.id] }}</span>
            </span>
            <span v-else class="text-muted-color">{{ $t("common.none") }}</span>
          </template>
        </Column>
        <Column data-priority="secondary" :header="$t('documents.list.columns.slip')" style="min-width: 13rem">
          <template #body="{ data }">
            <span
              v-if="slipStatus[data.id] === 'UPLOADED'"
              class="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"
              data-testid="slip-uploaded"
            >
              <i class="pi pi-check-circle text-xs" />
              {{ $t("documents.list.slip.uploaded") }}
            </span>
            <span
              v-else-if="slipStatus[data.id] === 'PENDING'"
              class="inline-flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400"
              data-testid="slip-pending"
            >
              <i class="pi pi-exclamation-circle text-xs" />
              {{ $t("documents.list.slip.pending") }}
            </span>
            <span v-else class="text-muted-color">{{ $t("common.none") }}</span>
          </template>
        </Column>
        <Column data-priority="actions" :header="$t('common.actions')" style="width: 7rem">
          <template #body="{ data }">
            <!-- Always shown, but disabled unless this row is actionable by the current user
                 (IN_APPROVAL + holds DOC_APPROVE) — so a user without rights, or an
                 already-approved document, can't be acted on. The server re-enforces too. -->
            <Button
              :label="$t('documents.detail.approve')"
              icon="pi pi-check-circle"
              size="small"
              severity="success"
              outlined
              :disabled="!canReviewRow(data)"
              :aria-label="$t('documents.detail.approve')"
              :title="canReviewRow(data) ? $t('documents.detail.approve') : $t('documents.review.disabled')"
              @click.stop="openReview(data)"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-file" :title="$t('documents.list.empty')">
            <template v-if="auth.can('DOC_CREATE')" #action>
              <Button
                :label="$t('documents.list.newDocument')"
                icon="pi pi-plus"
                :disabled="!auth.hasSignature"
                data-testid="new-document-empty"
                @click="router.push({ name: 'document-new' })"
              />
            </template>
          </EmptyState>
        </template>
      </AppDataTable>
    </div>

    <!-- Approve-from-list modal: submitted reason/details + total amount, with approve /
         reject / return for an eligible approver, without leaving the list. -->
    <ReviewApprovalDialog
      v-model:visible="reviewOpen"
      :doc-id="reviewDoc.id"
      :doc-no="reviewDoc.docNo"
      @acted="docs.loadList()"
    />
  </div>
</template>
