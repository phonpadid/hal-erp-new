<script setup lang="ts">
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import AppDataTable from "@/components/AppDataTable.vue";
import Button from "primevue/button";
import Column from "primevue/column";
import Tag from "primevue/tag";
import Chip from "primevue/chip";
import Popover from "primevue/popover";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../../stores/auth";
import { useDocumentsStore } from "../../stores/documents";
import { useOrgStore } from "../../stores/org";
import { useMasterDataStore } from "../../stores/masterData";
import { useFeedback } from "../../composables/useFeedback";
import type { DocumentListFilters } from "../../api/documents";
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

const canType = computed(() => auth.can("DOC_CREATE"));
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
  };
}

const apply = () => docs.applyFilters(buildFilters());

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
  search.value = "";
  docs.clearFilters();
}

// Resolve option labels for the active-filter chips.
const typeName = computed(() => docs.types.find((x) => x.id === f.documentTypeId)?.name);
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

onMounted(() => {
  docs.loadList();
  if (canType.value) docs.loadTypes();
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
          v-if="auth.can('DOC_CREATE')"
          :label="$t('documents.list.newDocument')"
          icon="pi pi-plus"
          @click="router.push({ name: 'document-new' })"
        />
      </template>
    </PageToolbar>

    <!-- Filter panel: stacked label-over-field rows so inputs never overflow w-80. -->
    <Popover ref="filterPanel">
      <div class="w-80 flex flex-col gap-3">
        <div class="flex flex-col gap-3">
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
              :options="docs.types"
              optionLabel="name"
              optionValue="id"
              showClear
              :placeholder="$t('documents.filters.anyType')"
              fluid
              appendTo="self"
              class="min-w-0"
              @change="apply"
            />
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
              :placeholder="$t('documents.filters.anyVendor')"
              fluid
              appendTo="self"
              class="min-w-0"
              @change="apply"
            />
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
        <Column field="docNo" :header="$t('documents.list.columns.docNo')">
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
        <Column :header="$t('documents.list.columns.baseTotal')">
          <template #body="{ data }">
            <span class="block text-right tabular-nums">{{
              data.baseTotalAmount != null
                ? formatAmount(data.baseTotalAmount)
                : $t("common.none")
            }}</span>
          </template>
        </Column>
        <Column :header="$t('documents.list.columns.created')"
          ><template #body="{ data }">{{
            formatDate(data.createdAt)
          }}</template></Column
        >
        <template #empty>
          <EmptyState icon="pi pi-file" :title="$t('documents.list.empty')">
            <template v-if="auth.can('DOC_CREATE')" #action>
              <Button
                :label="$t('documents.list.newDocument')"
                icon="pi pi-plus"
                @click="router.push({ name: 'document-new' })"
              />
            </template>
          </EmptyState>
        </template>
      </AppDataTable>
    </div>
  </div>
</template>
