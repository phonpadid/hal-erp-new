<script setup lang="ts">
/**
 * The department's weekly view: what we submitted that is still waiting, where, on whom, for how
 * long — every IN_APPROVAL document the reader may SEE (their DOC_VIEW scope, exactly as the
 * documents list), not only what they must sign. Read-only; the act path stays on the inbox tab.
 *
 * Filters are sent to the server as day strings; the week presets compute Monday–Sunday in the
 * browser's calendar and the server turns a day into an instant in the company's timezone.
 */
import Button from 'primevue/button';
import Chip from 'primevue/chip';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import ReportCard from '@/components/reports/ReportCard.vue';
import ApprovalTabs from '@/components/approvals/ApprovalTabs.vue';
import { approvalsApi, type PendingSummary, type PendingSummaryFilters } from '../../api/approvals';
import { downloadBlob } from '../../api/documents';
import { useFeedback } from '../../composables/useFeedback';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { formatDate } from '../../utils/date';
import { messageOf } from '../../utils/apiError';
import { toDay, weekOf } from '../../utils/week';

const router = useRouter();
const feedback = useFeedback();
const { fmt } = useCurrencyFormat();
const { t } = useI18n();

// ---- Filters --------------------------------------------------------------------------------
const f = reactive({
  departmentId: null as string | null,
  documentTypeId: null as string | null,
  dateRange: null as [Date, Date | null] | null,
  overdueOnly: false,
});
type Preset = 'thisWeek' | 'lastWeek' | 'all';
const preset = ref<Preset>('all');

function applyPreset(p: Preset) {
  preset.value = p;
  f.dateRange = p === 'all' ? null : weekOf(new Date(), p === 'lastWeek' ? 1 : 0);
  void load();
}

function buildFilters(): PendingSummaryFilters {
  const [from, to] = f.dateRange ?? [];
  return {
    departmentId: f.departmentId ?? undefined,
    documentTypeId: f.documentTypeId ?? undefined,
    submittedFrom: from ? toDay(from) : undefined,
    submittedTo: to ? toDay(to) : undefined,
    overdueOnly: f.overdueOnly || undefined,
  };
}

// ---- Data -----------------------------------------------------------------------------------
const summary = ref<PendingSummary | null>(null);
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    summary.value = await approvalsApi.pendingSummary(buildFilters());
  } catch (e) {
    error.value = messageOf(e);
  } finally {
    loading.value = false;
  }
}

function onRangeChange() {
  preset.value = 'all';
  // A range picker emits [from, null] while the second day is still being chosen.
  if (!f.dateRange || f.dateRange[1]) void load();
}

// Options come from the facets — what this reader's pending set actually spans — so no
// permission-gated department or type list is needed to filter it.
const departmentOptions = computed(() =>
  (summary.value?.facets.departments ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.count})` })),
);
const typeOptions = computed(() =>
  (summary.value?.facets.documentTypes ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.count})` })),
);

interface ActiveChip { key: string; label: string; remove: () => void }
const chips = computed<ActiveChip[]>(() => {
  const out: ActiveChip[] = [];
  const s = summary.value;
  if (f.departmentId) {
    const name = s?.facets.departments.find((d) => d.id === f.departmentId)?.name ?? '—';
    out.push({ key: 'dept', label: `${t('approvals.summary.filters.department')}: ${name}`, remove: () => { f.departmentId = null; void load(); } });
  }
  if (f.documentTypeId) {
    const name = s?.facets.documentTypes.find((x) => x.id === f.documentTypeId)?.name ?? '—';
    out.push({ key: 'type', label: `${t('approvals.summary.filters.type')}: ${name}`, remove: () => { f.documentTypeId = null; void load(); } });
  }
  if (f.dateRange?.[0]) {
    const [from, to] = f.dateRange;
    out.push({ key: 'week', label: `${t('approvals.summary.filters.submitted')}: ${toDay(from)} – ${to ? toDay(to) : '…'}`, remove: () => applyPreset('all') });
  }
  if (f.overdueOnly) out.push({ key: 'overdue', label: t('approvals.summary.filters.overdueOnly'), remove: () => { f.overdueOnly = false; void load(); } });
  return out;
});

// ---- Export ---------------------------------------------------------------------------------
const exporting = ref(false);
async function exportExcel() {
  exporting.value = true;
  try {
    const { blob, fileName } = await approvalsApi.exportPendingSummary(buildFilters());
    downloadBlob(blob, fileName);
  } catch (e) {
    feedback.error(e, t('approvals.summary.exportFailed'));
  } finally {
    exporting.value = false;
  }
}

/** Per-currency totals as "1,500,000 LAK · 100.00 USD" — never added across currencies. */
function amountsText(amounts: Record<string, string>): string {
  const parts = Object.entries(amounts).map(([code, v]) => `${fmt(v, code)} ${code}`);
  return parts.length ? parts.join(' · ') : '—';
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="$t('approvals.summary.title')" />
    <ApprovalTabs />
    <p class="text-muted-color text-sm mb-3">{{ $t('approvals.summary.hint') }}</p>

    <!-- Filter bar: the week first, because it is the one that changes every time. -->
    <div class="card mb-4 flex flex-wrap items-end gap-3" data-testid="summary-filters">
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('approvals.summary.filters.submitted') }}</label>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            v-for="p in (['thisWeek', 'lastWeek', 'all'] as const)"
            :key="p"
            :label="$t(`approvals.summary.presets.${p}`)"
            size="small"
            :severity="preset === p ? 'primary' : 'secondary'"
            :outlined="preset !== p"
            :data-testid="`preset-${p}`"
            @click="applyPreset(p)"
          />
          <DatePicker
            v-model="f.dateRange"
            selectionMode="range"
            dateFormat="yy-mm-dd"
            showIcon
            :manualInput="false"
            :placeholder="$t('approvals.summary.filters.pickRange')"
            @update:modelValue="onRangeChange"
          />
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('approvals.summary.filters.department') }}</label>
        <Select
          v-model="f.departmentId"
          :options="departmentOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('approvals.summary.filters.allDepartments')"
          class="min-w-56"
          data-testid="filter-department"
          @update:modelValue="load"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('approvals.summary.filters.type') }}</label>
        <Select
          v-model="f.documentTypeId"
          :options="typeOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('approvals.summary.filters.allTypes')"
          class="min-w-56"
          data-testid="filter-type"
          @update:modelValue="load"
        />
      </div>
      <div class="flex items-center gap-2 pb-2">
        <ToggleSwitch v-model="f.overdueOnly" inputId="summary-overdue" data-testid="filter-overdue" @update:modelValue="load" />
        <label for="summary-overdue" class="text-sm">{{ $t('approvals.summary.filters.overdueOnly') }}</label>
      </div>
      <div class="ml-auto">
        <Button
          v-tooltip.bottom="$t('approvals.summary.exportTooltip')"
          :label="$t('approvals.summary.export')"
          icon="pi pi-file-excel"
          severity="secondary"
          outlined
          :loading="exporting"
          :disabled="exporting"
          data-testid="export-summary"
          @click="exportExcel"
        />
      </div>
      <div v-if="chips.length" class="basis-full flex flex-wrap gap-2">
        <Chip v-for="c in chips" :key="c.key" :label="c.label" removable @remove="c.remove" />
      </div>
    </div>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <template v-else-if="summary">
      <!-- The head's numbers first. -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4" data-testid="summary-totals">
        <ReportCard :title="$t('approvals.summary.cards.pending')" icon="pi-clock">
          <p class="text-3xl font-semibold tabular-nums m-0">{{ summary.totals.pendingCount }}</p>
        </ReportCard>
        <ReportCard :title="$t('approvals.summary.cards.overdue')" icon="pi-exclamation-triangle">
          <p class="text-3xl font-semibold tabular-nums m-0" :class="summary.totals.overdueCount ? 'text-red-500' : ''">{{ summary.totals.overdueCount }}</p>
        </ReportCard>
        <ReportCard :title="$t('approvals.summary.cards.amounts')" icon="pi-money-bill">
          <p class="text-lg font-semibold tabular-nums m-0">{{ amountsText(summary.totals.amounts) }}</p>
        </ReportCard>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <ReportCard :title="$t('approvals.summary.cards.byDepartment')" icon="pi-sitemap">
          <DataTable :value="summary.byDepartment" dataKey="id" class="text-sm" scrollable scrollHeight="320px">
            <template #empty><EmptyState :title="$t('approvals.summary.empty')" /></template>
            <Column :header="$t('approvals.summary.filters.department')"><template #body="{ data }">{{ data.name }}</template></Column>
            <Column field="pendingCount" :header="$t('approvals.summary.columns.count')" />
            <Column :header="$t('approvals.summary.columns.oldest')"><template #body="{ data }">{{ data.oldestWaitingDays ?? '—' }}</template></Column>
            <Column :header="$t('approvals.summary.columns.amount')"><template #body="{ data }">{{ amountsText(data.totals) }}</template></Column>
          </DataTable>
        </ReportCard>
        <ReportCard :title="$t('approvals.summary.cards.byStep')" icon="pi-list">
          <DataTable :value="summary.byStep" dataKey="stepNo" class="text-sm" scrollable scrollHeight="320px">
            <template #empty><EmptyState :title="$t('approvals.summary.empty')" /></template>
            <Column :header="$t('approvals.summary.columns.step')"><template #body="{ data }">{{ data.stepNo }}{{ data.stepName ? ' · ' + data.stepName : '' }}</template></Column>
            <Column field="pendingCount" :header="$t('approvals.summary.columns.count')" />
            <Column :header="$t('approvals.summary.columns.oldest')"><template #body="{ data }">{{ data.oldestWaitingDays ?? '—' }}</template></Column>
          </DataTable>
        </ReportCard>
        <ReportCard :title="$t('approvals.summary.cards.byApprover')" icon="pi-users">
          <DataTable :value="summary.byApprover" dataKey="userId" class="text-sm" scrollable scrollHeight="320px">
            <template #empty><EmptyState :title="$t('approvals.summary.empty')" /></template>
            <Column field="name" :header="$t('approvals.summary.columns.waitingOn')" />
            <Column field="pendingCount" :header="$t('approvals.summary.columns.count')" />
            <Column :header="$t('approvals.summary.columns.oldest')"><template #body="{ data }">{{ data.oldestWaitingDays ?? '—' }}</template></Column>
          </DataTable>
        </ReportCard>
      </div>

      <ReportCard :title="$t('approvals.summary.cards.detail')" icon="pi-table">
        <DataTable :value="summary.rows" :loading="loading" dataKey="documentId" class="text-sm" data-testid="summary-rows">
          <template #empty><EmptyState icon="pi pi-check-circle" :title="$t('approvals.summary.empty')" /></template>
          <Column header="#" class="w-12"><template #body="{ index }">{{ index + 1 }}</template></Column>
          <Column :header="$t('approvals.columns.docNo')">
            <template #body="{ data }">
              <a class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.docNo }}</a>
            </template>
          </Column>
          <Column :header="$t('approvals.columns.type')"><template #body="{ data }">{{ data.documentType.name }}</template></Column>
          <Column field="requesterName" :header="$t('approvals.columns.requester')" />
          <Column :header="$t('approvals.summary.filters.department')"><template #body="{ data }">{{ data.department.name }}</template></Column>
          <Column :header="$t('approvals.columns.submitted')"><template #body="{ data }">{{ formatDate(data.submittedAt) }}</template></Column>
          <Column :header="$t('approvals.summary.columns.waitingDays')" bodyClass="tabular-nums"><template #body="{ data }">{{ data.waitingDays ?? '—' }}</template></Column>
          <Column :header="$t('approvals.columns.step')"><template #body="{ data }">{{ data.currentStepNo }}{{ data.stepName ? ' · ' + data.stepName : '' }}</template></Column>
          <Column :header="$t('approvals.summary.columns.waitingOn')"><template #body="{ data }">{{ data.waitingOn.map((a: { name: string }) => a.name).join(', ') || '—' }}</template></Column>
          <Column :header="$t('approvals.summary.columns.amount')" bodyStyle="text-align:right" bodyClass="tabular-nums">
            <template #body="{ data }">{{ fmt(data.grandTotal, data.currencyCode) }} {{ data.currencyCode }}</template>
          </Column>
          <Column :header="$t('approvals.columns.sla')">
            <template #body="{ data }">
              <Tag v-if="data.overdue" severity="danger" :value="$t('approvals.overdue')" />
              <span v-else-if="data.slaDueAt" class="text-muted-color">{{ formatDate(data.slaDueAt) }}</span>
              <span v-else class="text-muted-color">—</span>
            </template>
          </Column>
        </DataTable>
      </ReportCard>
    </template>
  </div>
</template>
