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
import { computed, ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import { useSearchTerm } from '@/composables/useSearchTerm';
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
/**
 * The search term, answered by the SERVER across the whole mapping list.
 *
 * `AppDataTable` runs in `lazy` mode, where PrimeVue delegates filtering to the server and ignores
 * `filters` / `globalFilterFields` — the bindings this replaces. They were decoration, and a
 * client-side filter would have been wrong regardless: the client holds one page, so it would have
 * searched a fraction of the set while looking like it searched all of it.
 */
const { term: term, onSearch: onSearch } = useSearchTerm((t) => cfg.narrowMappings({ search: t }));

/**
 * The three dimensions this table shows columns for, and could not be narrowed by.
 *
 * Server-side like the search above and for the same reason: the list is paged, so a filter over
 * the loaded page would narrow 20 of 80 rows while presenting itself as having narrowed all of
 * them. Each resets to page 1 — a filter applied on page 3 would otherwise show page 3 of a
 * shorter list, which is usually empty.
 *
 * The department options come from the departments that HOLD a mapping, not from `GET
 * /departments`: that read needs `DEPARTMENT_VIEW`, which a `DOC_CONFIG_MANAGE` holder need not
 * have, so the dropdown would be empty for exactly the administrator this filter is for. It also
 * means the filter can never offer an option that yields nothing.
 */
const typeOptions = computed(() =>
  cfg.documentTypes.map((d) => ({ label: `${d.code} — ${d.name}`, value: d.id })),
);
/**
 * Three states, not two. "Show me the deactivated ones" is the question this screen exists for —
 * it is how an administrator finds out why a department lost a document type — and a checkbox can
 * only say two of unset / active / inactive. Nothing defaults: a list that hid the deactivated
 * mappings could not answer that question at all.
 */
const activeOptions = computed(() => [
  { label: t('admin.docConfig.filters.active'), value: true },
  { label: t('admin.docConfig.filters.inactive'), value: false },
]);

/** Shown only while something is narrowing: a count beside a whole list is noise. */
const showingOf = computed(() =>
  cfg.mappingsNarrowing
    ? t('admin.docConfig.filters.showingOf', { shown: cfg.mappingsTotal, total: cfg.mappingsTotalUnfiltered })
    : '',
);

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

onMounted(() => {
  if (!cfg.documentTypes.length) cfg.loadAll();
  // The filter's own option list. Loaded here rather than in `loadAll` because only this screen
  // needs it, and it must not be paid for by every other doc-config page.
  if (!cfg.mappingDepartments.length) cfg.loadMappingDepartments();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.mappings')" />

    <PageToolbar :search="term" @update:search="onSearch">
      <template #filters>
        <Select
          :modelValue="cfg.mappingsDepartmentId || null"
          :options="cfg.mappingDepartments"
          optionLabel="name"
          optionValue="id"
          showClear
          filter
          size="small"
          class="w-56"
          :placeholder="$t('admin.docConfig.filters.department')"
          :aria-label="$t('admin.docConfig.filters.department')"
          data-testid="filter-department"
          @update:modelValue="cfg.narrowMappings({ departmentId: $event ?? '' })"
        />
        <Select
          :modelValue="cfg.mappingsDocumentTypeId || null"
          :options="typeOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-56"
          :placeholder="$t('admin.docConfig.filters.documentType')"
          :aria-label="$t('admin.docConfig.filters.documentType')"
          data-testid="filter-type"
          @update:modelValue="cfg.narrowMappings({ documentTypeId: $event ?? '' })"
        />
        <Select
          :modelValue="cfg.mappingsIsActive ?? null"
          :options="activeOptions"
          optionLabel="label"
          optionValue="value"
          showClear
          size="small"
          class="w-40"
          :placeholder="$t('admin.docConfig.filters.activeState')"
          :aria-label="$t('admin.docConfig.filters.activeState')"
          data-testid="filter-active"
          @update:modelValue="cfg.narrowMappings({ isActive: $event ?? undefined })"
        />
        <!-- What the filters are hiding. A filter, unlike a term, can be set and scrolled past. -->
        <span v-if="showingOf" class="text-sm text-muted-color" data-testid="showing-of">{{ showingOf }}</span>
      </template>
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
