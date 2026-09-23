<script setup lang="ts">
import { workflowSchema } from '@erp/shared';
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
import { useRouter } from 'vue-router';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useAuthStore } from '../../../stores/auth';
import { useDocConfigStore } from '../../../stores/docConfig';
import type { WorkflowRow } from '../../../api/docConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const router = useRouter();
const cfg = useDocConfigStore();
const canWorkflow = () => auth.can('WORKFLOW_MANAGE');

const wfDialog = ref(false);
const wfFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });
// Paginator offset so the # column keeps counting across pages (body-slot index is page-local).
const first = ref(0);

async function submitWf(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await cfg.createWorkflow(e.values)) {
    wfDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.actionError);
}
// Opening a workflow shows its full step configuration on a dedicated detail page.
function openWorkflow(workflowId: string) {
  router.push({ name: 'doc-config-workflow-detail', params: { workflowId } });
}
async function toggleActive(wf: WorkflowRow) {
  const ok = await cfg.updateWorkflow(wf.id, { isActive: !wf.isActive });
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(cfg.actionError);
}
async function removeWorkflow(wf: WorkflowRow) {
  const confirmed = await fb.confirm({ message: t('admin.docConfig.confirmDeleteWorkflow', { name: wf.name }) });
  if (!confirmed) return;
  const ok = await cfg.deleteWorkflow(wf.id);
  if (ok) fb.success(t('feedback.deleted'));
  else fb.error(cfg.actionError);
}
onMounted(() => { if (!cfg.documentTypes.length) cfg.loadAll(); });
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.workflows')" />

    <PageToolbar :search="wfFilters.global.value ?? ''" @update:search="wfFilters.global.value = $event">
      <template #actions>
        <Button v-if="canWorkflow()" :label="$t('admin.docConfig.newWorkflow')" icon="pi pi-plus" size="small" @click="wfDialog = true" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else class="card">
      <TableSkeleton v-if="cfg.loading && !cfg.workflows.length" :columns="4" />
      <DataTable
        v-else
        :value="cfg.workflows"
        dataKey="id"
        :filters="wfFilters"
        :globalFilterFields="['name']"
        rowHover
        class="cursor-pointer"
        paginator
        :rows="20"
        :rowsPerPageOptions="[10, 20, 50, 100]"
        v-model:first="first"
        @row-click="(e: { data: WorkflowRow }) => openWorkflow(e.data.id)"
      >
        <Column header="#" class="w-12"><template #body="{ index }">{{ first + index + 1 }}</template></Column>
        <Column field="name" :header="$t('admin.docConfig.columns.workflow')" />
        <Column :header="$t('admin.docConfig.columns.steps')" class="whitespace-nowrap">
          <template #body="{ data }">
            <span class="text-sm text-muted-color">{{ $t('admin.docConfig.stepCount', { n: data.steps.length }) }}</span>
          </template>
        </Column>
        <Column :header="$t('admin.docConfig.columns.active')" class="w-24">
          <template #body="{ data }">
            <ToggleSwitch
              :modelValue="data.isActive"
              :disabled="!canWorkflow()"
              :aria-label="data.isActive ? $t('admin.docConfig.deactivate') : $t('admin.docConfig.activate')"
              @click.stop
              @update:modelValue="toggleActive(data)"
            />
          </template>
        </Column>
        <Column header="" class="w-24">
          <template #body="{ data }">
            <div class="flex gap-1 justify-end flex-nowrap">
              <Button :label="$t('common.view')" icon="pi pi-eye" text size="small" @click.stop="openWorkflow(data.id)" />
              <Button v-if="canWorkflow()" icon="pi pi-trash" :aria-label="$t('common.delete')" text rounded size="small" severity="danger" @click.stop="removeWorkflow(data)" />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-share-alt" :title="$t('admin.docConfig.empty.workflows')" />
        </template>
      </DataTable>
    </div>

    <!-- New workflow -->
    <Dialog v-model:visible="wfDialog" :header="$t('admin.docConfig.newWorkflow')" modal class="w-96">
      <Form :resolver="zodResolver(workflowSchema)" :initialValues="{ name: '' }" class="flex flex-col gap-3" @submit="submitWf">
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="wfDialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>

  </div>
</template>
