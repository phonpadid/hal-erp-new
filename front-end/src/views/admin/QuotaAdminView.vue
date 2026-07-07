<script setup lang="ts">
import { quotaCreateSchema, quotaUpdateSchema, RESET_CYCLES } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useQuotaAdminStore } from '../../stores/quotaAdmin';
import type { FormSubmitEvent } from '@primevue/forms';
import type { QuotaSummary } from '../../api/quotas';

const { t } = useI18n();
const router = useRouter();
const fb = useFeedback();
const auth = useAuthStore();
const store = useQuotaAdminStore();
const can = (c: string) => auth.can(c);
const canManage = computed(() => can('QUOTA_MANAGE'));

const resetCycleOptions = RESET_CYCLES.map((c) => ({ label: c, value: c }));
const carryOptions = computed(() => [
  { label: t('common.yes'), value: true },
  { label: t('common.no'), value: false },
]);

const quotaDialog = ref<{ open: boolean; edit?: QuotaSummary }>({ open: false });

// Client-side filters over the loaded quota set (a company's quota definitions are a
// small set; the backend list endpoint is pagination-only, so filtering is local).
const COMPANY_LEVEL = '__company__';
const search = ref('');
const filterLevel = ref<string | null>(null);
const filterReset = ref<string | null>(null);
const filterCarry = ref<boolean | null>(null);
const clientPage = ref(1);
const pageSize = ref(20);

function levelLabel(q: { department?: { name?: string } | null }): string {
  return q.department?.name ?? t('admin.quotaAdmin.companyWide');
}

// Level options are derived from the loaded rows so QUOTA_VIEW users (who don't load
// the department option list) still get a working filter.
const levelOptions = computed(() => {
  const names = new Set<string>();
  let hasCompany = false;
  for (const q of store.list) {
    if (q.department?.name) names.add(q.department.name);
    else hasCompany = true;
  }
  const opts: Array<{ label: string; value: string }> = [];
  if (hasCompany) opts.push({ label: t('admin.quotaAdmin.companyWide'), value: COMPANY_LEVEL });
  for (const n of [...names].sort()) opts.push({ label: n, value: n });
  return opts;
});

const filteredList = computed(() =>
  store.list.filter((q) => {
    if (search.value && !q.quotaType.toLowerCase().includes(search.value.toLowerCase())) return false;
    if (filterLevel.value) {
      const isCompany = !q.department?.name;
      if (filterLevel.value === COMPANY_LEVEL ? !isCompany : q.department?.name !== filterLevel.value) return false;
    }
    if (filterReset.value && q.resetCycle !== filterReset.value) return false;
    if (filterCarry.value !== null && !!q.carryForward !== filterCarry.value) return false;
    return true;
  }),
);

const pagedList = computed(() => {
  const start = (clientPage.value - 1) * pageSize.value;
  return filteredList.value.slice(start, start + pageSize.value);
});

const hasActiveFilters = computed(
  () => !!search.value || !!filterLevel.value || !!filterReset.value || filterCarry.value !== null,
);

function clearFilters() {
  search.value = '';
  filterLevel.value = null;
  filterReset.value = null;
  filterCarry.value = null;
}

function refresh() {
  clientPage.value = 1;
  store.loadList(1, 100);
}

// A changed filter shrinks the result set — return to the first page.
watch([search, filterLevel, filterReset, filterCarry], () => {
  clientPage.value = 1;
});

async function submitQuota(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!quotaDialog.value.edit;
  const values = { ...e.values };
  if (!values.departmentId) delete values.departmentId; // empty = company-level
  const ok = editing
    ? await store.update(quotaDialog.value.edit!.id, values)
    : await store.create(values);
  if (ok) {
    quotaDialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(store.error);
}

async function deactivate(q: QuotaSummary) {
  const ok = await fb.confirm({ message: t('admin.quotaAdmin.confirmDeactivate', { type: q.quotaType }) });
  if (!ok) return;
  if (await store.deactivate(q.id)) fb.success(t('feedback.updated'));
  else fb.error(store.error);
}

function manageEntitlements(q: QuotaSummary) {
  router.push({ name: 'quota-admin-detail', params: { id: q.id } });
}

onMounted(() => {
  // Load the full (small) quota set so the client-side filters see every row.
  store.loadList(1, 100);
  if (canManage.value) store.loadOptions();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.quotaAdmin.title')" />

    <PageToolbar v-model:search="search" :searchPlaceholder="$t('admin.quotaAdmin.filterByType')">
      <template #filters>
        <Select
          v-model="filterLevel"
          :options="levelOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.quotaAdmin.columns.level')"
          class="w-44"
        />
        <Select
          v-model="filterReset"
          :options="resetCycleOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.quotaAdmin.columns.reset')"
          class="w-36"
        />
        <Select
          v-model="filterCarry"
          :options="carryOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          :placeholder="$t('admin.quotaAdmin.columns.carry')"
          class="w-36"
        />
        <Button v-if="hasActiveFilters" :label="$t('common.clear')" text size="small" icon="pi pi-filter-slash" @click="clearFilters" />
      </template>
      <template #actions>
        <Button
          v-if="canManage"
          :label="$t('admin.quotaAdmin.newQuota')"
          icon="pi pi-plus"
          size="small"
          @click="quotaDialog = { open: true }"
        />
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error && !store.list.length" :message="store.error" @retry="store.loadList()" />

    <div v-else class="card">
      <AppDataTable
        :value="pagedList"
        :total="filteredList.length"
        :loading="store.loading"
        :page="clientPage"
        :rows="pageSize"
        dataKey="id"
        @page="(e: { page: number; limit: number }) => { clientPage = e.page; pageSize = e.limit; }"
        @refresh="refresh"
      >
        <Column field="quotaType" :header="$t('admin.quotaAdmin.columns.type')" />
        <Column field="unit" :header="$t('admin.quotaAdmin.columns.unit')" />
        <Column :header="$t('admin.quotaAdmin.columns.level')"><template #body="{ data }">{{ levelLabel(data) }}</template></Column>
        <Column field="limitValue" :header="$t('admin.quotaAdmin.columns.limit')" />
        <Column field="resetCycle" :header="$t('admin.quotaAdmin.columns.reset')" />
        <Column :header="$t('admin.quotaAdmin.columns.carry')">
          <template #body="{ data }"><Tag :value="data.carryForward ? $t('common.yes') : $t('common.no')" :severity="data.carryForward ? 'success' : 'secondary'" /></template>
        </Column>
        <Column :header="$t('admin.quotaAdmin.columns.poolRemaining')"><template #body="{ data }">{{ data.remaining ?? '—' }}</template></Column>
        <Column header="">
          <template #body="{ data }">
            <div class="flex gap-1 justify-end">
              <Button icon="pi pi-users" text size="small" :title="$t('admin.quotaAdmin.manageEntitlements')" @click="manageEntitlements(data)" />
              <Button v-if="canManage" icon="pi pi-pencil" text size="small" @click="quotaDialog = { open: true, edit: data }" />
              <Button v-if="canManage" icon="pi pi-ban" text size="small" severity="danger" @click="deactivate(data)" />
            </div>
          </template>
        </Column>
        <template #empty><EmptyState icon="pi pi-sliders-h" :title="$t('admin.quotaAdmin.empty.quotas')" /></template>
      </AppDataTable>
    </div>

    <!-- Quota create/edit dialog -->
    <Dialog v-model:visible="quotaDialog.open" :header="quotaDialog.edit ? $t('admin.quotaAdmin.editQuota') : $t('admin.quotaAdmin.newQuota')" modal class="w-96">
      <Form
        :key="quotaDialog.edit?.id ?? 'new'"
        :resolver="zodResolver(quotaDialog.edit ? quotaUpdateSchema : quotaCreateSchema)"
        :initialValues="quotaDialog.edit
          ? { quotaType: quotaDialog.edit.quotaType, unit: quotaDialog.edit.unit, limitValue: quotaDialog.edit.limitValue, resetCycle: quotaDialog.edit.resetCycle, carryForward: quotaDialog.edit.carryForward ?? true, isActive: true }
          : { quotaType: '', unit: 'day', limitValue: '', resetCycle: 'YEARLY', carryForward: true, departmentId: undefined }"
        class="flex flex-col gap-3"
        @submit="submitQuota"
      >
        <FormField v-slot="$f" name="quotaType" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.type') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="unit" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.unit') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="limitValue" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.limit') }}</label><InputText type="text" inputmode="decimal" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="resetCycle" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.reset') }}</label><Select :options="resetCycleOptions" optionLabel="label" optionValue="value" /></FormField>
        <FormField v-if="!quotaDialog.edit" name="departmentId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.level') }}</label><Select :options="store.departments" optionLabel="name" optionValue="id" showClear :placeholder="$t('admin.quotaAdmin.companyWide')" /></FormField>
        <FormField name="carryForward" class="flex items-center gap-2"><ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.quotaAdmin.fields.carryForward') }}</label></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="quotaDialog.open = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
