<script setup lang="ts">
import { deptDocTypeSchema, deptDocTypeUpdateSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useDocConfigStore } from '../../../stores/docConfig';
import type { Mapping } from '../../../api/docConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const cfg = useDocConfigStore();

const mapDialog = ref(false);
const mapTypeId = ref<string>(''); // drives the template options in the mapping dialog
const mapFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const mapTemplates = computed(() => (mapTypeId.value ? cfg.templatesByType[mapTypeId.value] ?? [] : []));
function onMapTypeChange(id: string) { mapTypeId.value = id; if (id) cfg.loadTemplates(id); }

async function submitMap(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await cfg.createMapping(e.values)) {
    mapDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.error);
}

// --- Edit an existing mapping (workflow / template / active state only) ---
const editDialog = ref(false);
const editing = ref<Mapping | null>(null);
// Templates for the editing row's (fixed) document type.
const editTemplates = computed(() =>
  editing.value ? cfg.templatesByType[editing.value.documentTypeId] ?? [] : [],
);
const editInitial = computed(() => ({
  formTemplateId: editing.value?.formTemplateId ?? '',
  workflowId: editing.value?.workflowId ?? '',
}));

function openEdit(row: Mapping) {
  editing.value = row;
  cfg.loadTemplates(row.documentTypeId); // ensure template options are available
  editDialog.value = true;
}

// Inline active toggle from the table row. One-way :modelValue keeps the switch driven by
// the row data, so a failed update reverts on its own; disable the row while its own
// update is in flight to avoid double-fires.
const togglingId = ref<string | null>(null);
async function toggleActive(row: Mapping, value: boolean) {
  togglingId.value = row.id;
  const ok = await cfg.updateMapping(row.id, { isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t('feedback.saved'));
  else fb.error(cfg.error);
}

async function submitEdit(e: FormSubmitEvent) {
  if (!e.valid || !editing.value) return;
  if (await cfg.updateMapping(editing.value.id, e.values)) {
    editDialog.value = false;
    fb.success(t('feedback.saved'));
  } else fb.error(cfg.error);
}

onMounted(() => { if (!cfg.documentTypes.length) cfg.loadAll(); });
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.mappings')" />

    <PageToolbar :search="mapFilters.global.value ?? ''" @update:search="mapFilters.global.value = $event">
      <template #actions>
        <Button :label="$t('admin.docConfig.newMapping')" icon="pi pi-plus" size="small" @click="mapDialog = true" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else class="card">
      <AppDataTable
        :value="cfg.mappings"
        :total="cfg.mappingsTotal"
        :loading="cfg.loading"
        :page="cfg.mappingsPage"
        :rows="cfg.mappingsLimit"
        :filters="mapFilters"
        :globalFilterFields="['departmentName', 'documentTypeCode', 'workflowName']"
        @page="(e: any) => cfg.loadMappings(e.page, e.limit)"
        @refresh="cfg.loadMappings()"
      >
        <Column field="departmentName" :header="$t('admin.docConfig.columns.department')" />
        <Column field="documentTypeCode" :header="$t('admin.docConfig.columns.documentType')" />
        <Column :header="$t('admin.docConfig.columns.template')"><template #body="{ data }">v{{ data.templateVersion }}</template></Column><!-- i18n-ignore: "v" is a version-number prefix, not translatable copy -->
        <Column field="workflowName" :header="$t('admin.docConfig.columns.workflow')" />
        <Column :header="$t('admin.docConfig.columns.active')" class="w-24">
          <template #body="{ data }">
            <ToggleSwitch :modelValue="data.isActive" :disabled="togglingId === data.id" :aria-label="$t('admin.docConfig.columns.active')" @update:modelValue="toggleActive(data as Mapping, $event)" />
          </template>
        </Column>
        <Column class="w-16">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded size="small" :aria-label="$t('admin.docConfig.editMapping')" @click="openEdit(data as Mapping)" />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-sitemap" :title="$t('admin.docConfig.empty.mappings')" />
        </template>
      </AppDataTable>
    </div>

    <!-- New mapping -->
    <Dialog v-model:visible="mapDialog" :header="$t('admin.docConfig.newMapping')" modal class="w-96">
      <Form :resolver="zodResolver(deptDocTypeSchema)" :initialValues="{ departmentId: '', documentTypeId: '', formTemplateId: '', workflowId: '' }" class="flex flex-col gap-3" @submit="submitMap">
        <FormField v-slot="$f" name="departmentId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.department') }}</label><Select :options="cfg.departments" optionLabel="name" optionValue="id" :placeholder="$t('admin.docConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="documentTypeId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.documentType') }}</label><Select :options="cfg.documentTypes" optionLabel="code" optionValue="id" :placeholder="$t('admin.docConfig.fields.select')" @update:modelValue="onMapTypeChange" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="formTemplateId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.template') }}</label><Select :options="mapTemplates" :optionLabel="(t) => `v${t.version} (${t.status})`" optionValue="id" :placeholder="$t('admin.docConfig.fields.selectTypeFirst')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="workflowId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.workflow') }}</label><Select :options="cfg.workflows" optionLabel="name" optionValue="id" :placeholder="$t('admin.docConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="mapDialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>

    <!-- Edit mapping: department + document type are fixed; only workflow / template / active change -->
    <Dialog v-model:visible="editDialog" :header="$t('admin.docConfig.editMapping')" modal class="w-96">
      <Form v-if="editing" :resolver="zodResolver(deptDocTypeUpdateSchema)" :initialValues="editInitial" class="flex flex-col gap-3" @submit="submitEdit">
        <div class="text-sm text-muted-color">{{ editing.departmentName }} · {{ editing.documentTypeCode }}</div>
        <FormField v-slot="$f" name="formTemplateId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.template') }}</label><Select :options="editTemplates" :optionLabel="(tpl) => `v${tpl.version} (${tpl.status})`" optionValue="id" :placeholder="$t('admin.docConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="workflowId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.workflow') }}</label><Select :options="cfg.workflows" optionLabel="name" optionValue="id" :placeholder="$t('admin.docConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <Message severity="info" size="small" icon="pi pi-info-circle" class="leading-relaxed">{{ $t('admin.docConfig.mappingFutureNote') }}</Message>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="editDialog = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
