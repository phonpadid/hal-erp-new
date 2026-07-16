<script setup lang="ts">
import { documentCategorySchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import type { DocCategoryRow } from '../../../api/docConfig';
import { useDocConfigStore } from '../../../stores/docConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const cfg = useDocConfigStore();

const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const createDialog = ref(false);
// code is immutable, so the edit dialog only carries name; the code is shown read-only.
const editDialog = ref<{ open: boolean; id?: string; code?: string; initial?: Record<string, unknown> }>({ open: false });

async function submitCreate(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await cfg.createDocumentCategory(e.values)) {
    createDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.error);
}

function openEdit(row: DocCategoryRow) {
  editDialog.value = { open: true, id: row.id, code: row.code, initial: { name: row.name } };
}

async function submitEdit(e: FormSubmitEvent) {
  if (!e.valid || !editDialog.value.id) return;
  if (await cfg.updateDocumentCategory(editDialog.value.id, e.values)) {
    editDialog.value.open = false;
    fb.success(t('feedback.done'));
  } else fb.error(cfg.error);
}

// Inline active toggle straight from the table row (one-way :modelValue, reverts on failure).
const togglingId = ref<string | null>(null);
async function toggleActive(row: DocCategoryRow, value: boolean) {
  togglingId.value = row.id;
  const ok = await cfg.updateDocumentCategory(row.id, { name: row.name, isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}

async function remove(row: DocCategoryRow) {
  const ok = await fb.confirm({ message: t('admin.docConfig.categories.confirmDelete', { code: row.code }) });
  if (!ok) return;
  if (await cfg.removeDocumentCategory(row.id)) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}

onMounted(() => {
  if (!cfg.categories.length) cfg.loadCategories();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.categories')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button :label="$t('admin.docConfig.categories.new')" icon="pi pi-plus" size="small" @click="createDialog = true" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadCategories()" />

    <div v-else class="card">
      <TableSkeleton v-if="cfg.loading && !cfg.categories.length" :columns="4" />
      <DataTable v-else :value="cfg.categories" dataKey="id" :filters="filters" :globalFilterFields="['code', 'name']" paginator :rows="20" :rowsPerPageOptions="[10, 20, 50, 100]">
        <Column header="#" headerStyle="width:3rem"><template #body="{ index }">{{ index + 1 }}</template></Column>
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('admin.docConfig.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch :modelValue="data.isActive" :disabled="togglingId === data.id" :aria-label="$t('admin.docConfig.columns.active')" @update:modelValue="toggleActive(data, $event)" />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text size="small" :aria-label="$t('common.edit')" @click="openEdit(data)" />
            <Button icon="pi pi-trash" text size="small" severity="danger" :aria-label="$t('common.delete')" @click="remove(data)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-tags" :title="$t('admin.docConfig.categories.empty')" />
        </template>
      </DataTable>
    </div>

    <!-- New category -->
    <Dialog v-model:visible="createDialog" :header="$t('admin.docConfig.categories.newTitle')" modal class="w-96">
      <Form :resolver="zodResolver(documentCategorySchema)" :initialValues="{ code: '', name: '' }" class="flex flex-col gap-3" @submit="submitCreate">
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText type="text" /><small class="text-muted-color">{{ $t('admin.docConfig.categories.codeHint') }}</small><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="createDialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>

    <!-- Edit category (code is immutable; shown read-only). -->
    <Dialog v-model:visible="editDialog.open" :header="$t('admin.docConfig.categories.edit')" modal class="w-96">
      <Form v-if="editDialog.initial" :key="editDialog.id" :initialValues="editDialog.initial" class="flex flex-col gap-3" @submit="submitEdit">
        <div class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText :modelValue="editDialog.code" type="text" disabled /></div>
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="editDialog.open = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
