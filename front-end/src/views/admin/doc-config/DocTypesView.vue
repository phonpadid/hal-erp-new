<script setup lang="ts">
import { DOC_CATEGORIES, POST_ACTIONS, documentTypeSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useDocConfigStore } from '../../../stores/docConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const { t, te } = useI18n();

// post_action is a free-form varchar whose real values (CREATE_PO, UPDATE_EMPLOYEE, …)
// are a superset of the POST_ACTIONS form enum. Fall back to the raw value for any
// type we don't have a translation for, rather than showing the key path.
function postActionLabel(v: string) {
  const key = `admin.docConfig.postActions.${v}`;
  return te(key) ? t(key) : v;
}
const fb = useFeedback();
const cfg = useDocConfigStore();

const opt = (v: readonly string[]) => v.map((x) => ({ label: x, value: x }));
const categories = opt(DOC_CATEGORIES);
const postActions = computed(() => POST_ACTIONS.map((x) => ({ label: t(`admin.docConfig.postActions.${x}`), value: x })));

const typeDialog = ref(false);
const editTypeDialog = ref<{ open: boolean; id?: string; initial?: Record<string, unknown> }>({ open: false });

// The edited row may carry a post_action outside the POST_ACTIONS form enum (it's a
// free-form varchar, e.g. CREATE_PO). Include the current value so the Select isn't
// blank when the stored value has no matching option.
const editPostActions = computed(() => {
  const cur = editTypeDialog.value.initial?.postAction as string | undefined;
  if (cur && !postActions.value.some((o) => o.value === cur)) {
    return [...postActions.value, { label: postActionLabel(cur), value: cur }];
  }
  return postActions.value;
});
const typeFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// Page-specific filters (client-side, over the already company-scoped list). The global
// search field still filters code/name via DataTable; these narrow the list before that.
type FlagKey = 'budget' | 'quota' | 'vendor' | 'item';
const FLAG_FIELDS: Record<FlagKey, 'requiresBudget' | 'requiresQuota' | 'requiresVendor' | 'requiresItem'> = {
  budget: 'requiresBudget',
  quota: 'requiresQuota',
  vendor: 'requiresVendor',
  item: 'requiresItem',
};
const categoryFilter = ref<string | null>(null);
const activeFilter = ref<boolean | null>(null);
const flagFilter = ref<FlagKey[]>([]);

const activeOptions = computed(() => [
  { label: t('admin.docConfig.filters.active'), value: true },
  { label: t('admin.docConfig.filters.inactive'), value: false },
]);
const flagOptions = computed(() =>
  (Object.keys(FLAG_FIELDS) as FlagKey[]).map((k) => ({ label: t(`admin.docConfig.flags.${k}`), value: k })),
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
  () => (categoryFilter.value != null ? 1 : 0) + (activeFilter.value != null ? 1 : 0) + (flagFilter.value.length ? 1 : 0),
);
function clearFilters() {
  categoryFilter.value = null;
  activeFilter.value = null;
  flagFilter.value = [];
}

async function submitType(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await cfg.createDocumentType(e.values)) {
    typeDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.error);
}

function openEditType(row: { id: string; name: string; requiresBudget: boolean; requiresQuota: boolean; requiresVendor: boolean; requiresItem: boolean; postAction?: string; isActive: boolean }) {
  editTypeDialog.value = {
    open: true,
    id: row.id,
    initial: {
      name: row.name,
      requiresBudget: row.requiresBudget,
      requiresQuota: row.requiresQuota,
      requiresVendor: row.requiresVendor,
      requiresItem: row.requiresItem,
      postAction: row.postAction ?? 'NONE',
    },
  };
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
  if (ok) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}

async function submitEditType(e: FormSubmitEvent) {
  if (!e.valid || !editTypeDialog.value.id) return;
  if (await cfg.updateDocumentType(editTypeDialog.value.id, e.values)) {
    editTypeDialog.value.open = false;
    fb.success(t('feedback.done'));
  } else fb.error(cfg.error);
}

// Shared config data is loaded once for the whole Configuration area; only fetch when
// this is the first section entered (the store reloads itself after every mutation).
onMounted(() => { if (!cfg.documentTypes.length) cfg.loadAll(); });
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.types')" />

    <PageToolbar :search="typeFilters.global.value ?? ''" @update:search="typeFilters.global.value = $event">
      <template #filters>
        <Select v-model="categoryFilter" :options="categories" optionLabel="label" optionValue="value" showClear :placeholder="$t('admin.docConfig.filters.category')" class="w-40" />
        <Select v-model="activeFilter" :options="activeOptions" optionLabel="label" optionValue="value" showClear :placeholder="$t('admin.docConfig.filters.status')" class="w-40" />
        <MultiSelect v-model="flagFilter" :options="flagOptions" optionLabel="label" optionValue="value" showClear :placeholder="$t('admin.docConfig.filters.flags')" class="w-48" />
        <Button v-if="activeFilterCount > 0" icon="pi pi-filter-slash" :label="$t('admin.docConfig.filters.clear')" text size="small" @click="clearFilters" />
      </template>
      <template #actions>
        <Button :label="$t('admin.docConfig.newType')" icon="pi pi-plus" size="small" @click="typeDialog = true" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else class="card">
      <TableSkeleton v-if="cfg.loading && !cfg.documentTypes.length" :columns="5" />
      <DataTable v-else :value="filteredTypes" dataKey="id" :filters="typeFilters" :globalFilterFields="['code', 'name']" paginator :rows="20" :rowsPerPageOptions="[10, 20, 50, 100]">
        <Column header="#" headerStyle="width:3rem"><template #body="{ index }">{{ index + 1 }}</template></Column>
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column field="category" :header="$t('admin.docConfig.columns.category')" />
        <Column :header="$t('admin.docConfig.columns.flags')">
          <template #body="{ data }">
            <Tag v-if="data.requiresBudget" :value="$t('admin.docConfig.flags.budget')" class="mr-1" />
            <Tag v-if="data.requiresQuota" :value="$t('admin.docConfig.flags.quota')" severity="warn" class="mr-1" />
            <Tag v-if="data.requiresVendor" :value="$t('admin.docConfig.flags.vendor')" severity="info" class="mr-1" />
            <Tag v-if="data.requiresItem" :value="$t('admin.docConfig.flags.item')" severity="success" class="mr-1" />
            <span v-if="data.postAction" class="text-xs text-muted-color">{{ postActionLabel(data.postAction) }}</span>
          </template>
        </Column>
        <Column :header="$t('admin.docConfig.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch :modelValue="data.isActive" :disabled="togglingId === data.id" :aria-label="$t('admin.docConfig.columns.active')" @update:modelValue="toggleActive(data, $event)" />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text size="small" :aria-label="$t('common.edit')" @click="openEditType(data)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-file-edit" :title="$t('admin.docConfig.empty.types')" />
        </template>
      </DataTable>
    </div>

    <!-- New document type -->
    <Dialog v-model:visible="typeDialog" :header="$t('admin.docConfig.newDocumentType')" modal class="w-96">
      <Form :resolver="zodResolver(documentTypeSchema)" :initialValues="{ code: '', name: '', category: 'ADMIN', requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false, postAction: 'NONE' }" class="flex flex-col gap-3" @submit="submitType">
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="category" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.category') }}</label><Select :options="categories" optionLabel="label" optionValue="value" /></FormField>
        <FormField name="postAction" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.postAction') }}</label><Select :options="postActions" optionLabel="label" optionValue="value" /></FormField>
        <FormField name="requiresBudget" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresBudget') }}</label></FormField>
        <FormField name="requiresQuota" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresQuota') }}</label></FormField>
        <FormField name="requiresVendor" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresVendor') }}</label></FormField>
        <FormField name="requiresItem" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresItem') }}</label></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="typeDialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>

    <!-- Edit document type (code + category are immutable; active state is toggled inline in the table). -->
    <Dialog v-model:visible="editTypeDialog.open" :header="$t('admin.docConfig.editType')" modal class="w-96">
      <Form v-if="editTypeDialog.initial" :key="editTypeDialog.id" :initialValues="editTypeDialog.initial" class="flex flex-col gap-3" @submit="submitEditType">
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="postAction" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.postAction') }}</label><Select :options="editPostActions" optionLabel="label" optionValue="value" /></FormField>
        <FormField name="requiresBudget" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresBudget') }}</label></FormField>
        <FormField name="requiresQuota" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresQuota') }}</label></FormField>
        <FormField name="requiresVendor" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresVendor') }}</label></FormField>
        <FormField name="requiresItem" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.requiresItem') }}</label></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="editTypeDialog.open = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
