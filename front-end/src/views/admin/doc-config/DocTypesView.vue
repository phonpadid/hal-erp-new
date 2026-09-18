<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Dialog from "primevue/dialog";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import Tag from "primevue/tag";
import ToggleSwitch from "primevue/toggleswitch";
import { FilterMatchMode } from "@primevue/core/api";
import { computed, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useFeedback } from "../../../composables/useFeedback";
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import TableSkeleton from "@/components/TableSkeleton.vue";
import RefChainEditor from "@/components/doc-config/RefChainEditor.vue";
import type { DocType } from "../../../api/docConfig";
import { useAccountsStore } from "../../../stores/accounts";
import { useDocConfigStore } from "../../../stores/docConfig";

const { t } = useI18n();

// The set is closed and every member is translated in all three locales, so there is nothing left
// to fall back to. This used to guard against a stored value the form list did not know about.
function postActionLabel(v: string) {
  return t(`admin.docConfig.postActions.${v}`);
}
const fb = useFeedback();
const router = useRouter();
const cfg = useDocConfigStore();
const accounts = useAccountsStore();

// Options for the category filter — the active company's active categories (document_category),
// fetched via the store, never a hardcoded list. The filter value is the category *code*.
const categories = computed(() =>
  cfg.activeCategories.map((c) => ({ label: c.name, value: c.code })),
);
// Resolve a category code to its display name (falls back to the raw code for a code whose
// category was since deactivated/removed, so an existing type's cell is never blank).
function categoryLabel(code: string) {
  return cfg.categories.find((c) => c.code === code)?.name ?? code;
}

// Reference-chain (document_type_ref) editor, opened per row.
const refChainDialog = ref<{ open: boolean; type?: DocType }>({ open: false });
function openRefChain(row: DocType) {
  refChainDialog.value = { open: true, type: row };
}

const typeFilters = ref({
  global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS },
});

// Page-specific filters (client-side, over the already company-scoped list). The global
// search field still filters code/name via DataTable; these narrow the list before that.
type FlagKey = "budget" | "quota" | "vendor" | "item" | "payee";
const FLAG_FIELDS: Record<
  FlagKey,
  | "requiresBudget"
  | "requiresQuota"
  | "requiresVendor"
  | "requiresItem"
  | "requiresPayee"
> = {
  budget: "requiresBudget",
  quota: "requiresQuota",
  vendor: "requiresVendor",
  item: "requiresItem",
  payee: "requiresPayee",
};
const categoryFilter = ref<string | null>(null);
// Default the status filter to Active so the list opens showing live types; the store still
// loads inactive ones (includeInactive), so switching to Inactive / clearing reveals them.
const activeFilter = ref<boolean | null>(true);
const flagFilter = ref<FlagKey[]>([]);

const activeOptions = computed(() => [
  { label: t("admin.docConfig.filters.active"), value: true },
  { label: t("admin.docConfig.filters.inactive"), value: false },
]);
const flagOptions = computed(() =>
  (Object.keys(FLAG_FIELDS) as FlagKey[]).map((k) => ({
    label: t(`admin.docConfig.flags.${k}`),
    value: k,
  })),
);

// A row passes when it matches every active filter (AND). Null/empty means "no constraint".
const filteredTypes = computed(() =>
  cfg.documentTypes.filter(
    (dt) =>
      (categoryFilter.value == null || dt.category === categoryFilter.value) &&
      (activeFilter.value == null || dt.isActive === activeFilter.value) &&
      flagFilter.value.every((f) => dt[FLAG_FIELDS[f]] === true),
  ),
);
const activeFilterCount = computed(
  () =>
    (categoryFilter.value != null ? 1 : 0) +
    (activeFilter.value != null ? 1 : 0) +
    (flagFilter.value.length ? 1 : 0),
);
function clearFilters() {
  categoryFilter.value = null;
  activeFilter.value = null;
  flagFilter.value = [];
}

// Inline active toggle straight from the table row. The Select stays controlled by the
// row data (one-way :modelValue): the switch only moves once the reload confirms the
// change, so a failed update visually reverts on its own. Disable the specific row while
// its own update is in flight to avoid double-fires.
const togglingId = ref<string | null>(null);
async function toggleActive(row: { id: string }, value: boolean) {
  togglingId.value = row.id;
  const ok = await cfg.updateDocumentType(row.id, { isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t("feedback.done"));
  else {
    // The refusal — translated by the feedback seam when the server named its sentence — and a
    // re-read, so the row shows what is stored rather than what was attempted.
    fb.error(cfg.actionError);
    await cfg.loadDocumentTypes().catch(() => undefined);
  }
}

// Shared config data is loaded once for the whole Configuration area; only fetch when
// this is the first section entered (the store reloads itself after every mutation).
onMounted(() => {
  if (!cfg.documentTypes.length) cfg.loadAll();
  if (!accounts.selectable.length) accounts.loadSelectable(); // GL picker options
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.types')" />

    <PageToolbar
      :search="typeFilters.global.value ?? ''"
      @update:search="typeFilters.global.value = $event"
    >
      <template #filters>
        <Select
          v-model="categoryFilter"
          :options="categories"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.docConfig.filters.category')"
          class="w-40"
        />
        <Select
          v-model="activeFilter"
          :options="activeOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.docConfig.filters.status')"
          class="w-40"
        />
        <MultiSelect
          v-model="flagFilter"
          :options="flagOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.docConfig.filters.flags')"
          class="w-48"
        />
        <Button
          v-if="activeFilterCount > 0"
          icon="pi pi-filter-slash"
          :label="$t('admin.docConfig.filters.clear')"
          text
          size="small"
          @click="clearFilters"
        />
      </template>
      <template #actions>
        <Button
          :label="$t('admin.docConfig.newType')"
          icon="pi pi-plus"
          size="small"
          @click="router.push({ name: 'doc-config-type-new' })"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else class="card">
      <TableSkeleton
        v-if="cfg.loading && !cfg.documentTypes.length"
        :columns="5"
      />
      <DataTable
        v-else
        :value="filteredTypes"
        dataKey="id"
        :filters="typeFilters"
        :globalFilterFields="['code', 'name']"
        paginator
        :rows="20"
        :rowsPerPageOptions="[10, 20, 50, 100]"
      >
        <Column header="#" headerStyle="width:3rem"
          ><template #body="{ index }">{{ index + 1 }}</template></Column
        >
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('admin.docConfig.columns.category')">
          <template #body="{ data }">{{
            categoryLabel(data.category)
          }}</template>
        </Column>
        <Column :header="$t('admin.docConfig.columns.flags')">
          <template #body="{ data }">
            <Tag
              v-if="data.requiresBudget"
              :value="$t('admin.docConfig.flags.budget')"
              class="mr-1"
            />
            <Tag
              v-if="data.requiresQuota"
              :value="$t('admin.docConfig.flags.quota')"
              severity="warn"
              class="mr-1"
            />
            <Tag
              v-if="data.requiresVendor"
              :value="$t('admin.docConfig.flags.vendor')"
              severity="info"
              class="mr-1"
            />
            <Tag
              v-if="data.requiresItem"
              :value="$t('admin.docConfig.flags.item')"
              severity="success"
              class="mr-1"
            />
            <Tag
              v-if="data.requiresPayee"
              :value="$t('admin.docConfig.flags.payee')"
              severity="warn"
              class="mr-1"
            />
            <span v-if="data.postAction" class="text-xs text-muted-color">{{
              postActionLabel(data.postAction)
            }}</span>
          </template>
        </Column>
        <Column :header="$t('admin.docConfig.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch
              :modelValue="data.isActive"
              :disabled="togglingId === data.id"
              :aria-label="$t('admin.docConfig.columns.active')"
              @update:modelValue="toggleActive(data, $event)"
            />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              icon="pi pi-sitemap"
              text
              size="small"
              :aria-label="$t('admin.docConfig.refChain.manage')"
              v-tooltip.top="$t('admin.docConfig.refChain.manage')"
              @click="openRefChain(data)"
            />
            <Button
              icon="pi pi-pencil"
              text
              size="small"
              :aria-label="$t('common.edit')"
              @click="router.push({ name: 'doc-config-type-edit', params: { id: data.id } })"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState
            icon="pi pi-file-edit"
            :title="$t('admin.docConfig.empty.types')"
          />
        </template>
      </DataTable>
    </div>

    <!-- Reference-chain pairings (document_type_ref) for a document type. -->
    <Dialog
      v-model:visible="refChainDialog.open"
      :header="
        refChainDialog.type
          ? $t('admin.docConfig.refChain.title', {
              code: refChainDialog.type.code,
            })
          : ''
      "
      modal
      class="w-lg"
    >
      <RefChainEditor
        v-if="refChainDialog.type"
        :key="refChainDialog.type.id"
        :documentType="refChainDialog.type"
        :allTypes="cfg.documentTypes"
      />
    </Dialog>
  </div>
</template>
