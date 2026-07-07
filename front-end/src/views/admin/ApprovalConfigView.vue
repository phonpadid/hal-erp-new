<script setup lang="ts">
import { delegationSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { FilterMatchMode } from '@primevue/core/api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { formatDate } from '@/utils/date';
import { useAuthStore } from '../../stores/auth';
import { useApprovalConfigStore } from '../../stores/approvalConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const auth = useAuthStore();
const cfg = useApprovalConfigStore();
const fb = useFeedback();
const { t } = useI18n();
const canManage = () => auth.can('WORKFLOW_MANAGE');
const dialog = ref(false);
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  if (await cfg.createDelegation(e.values)) {
    dialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.error);
}
async function cancelDelegation(id: string) {
  if (!(await fb.confirm({ message: t('feedback.confirm.cancelDelegation') }))) return;
  if (await cfg.cancelDelegation(id)) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}

onMounted(() => cfg.loadAll());

const onPage = (e: { page: number; limit: number }) => cfg.loadDelegations(e.page, e.limit);
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.approvalConfig.title')" />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <Button v-if="canManage()" :label="$t('admin.approvalConfig.newDelegation')" icon="pi pi-plus" size="small" @click="dialog = true" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else class="card">
    <AppDataTable
      :value="cfg.delegations"
      :total="cfg.total"
      :loading="cfg.loading"
      :page="cfg.page"
      :rows="cfg.limit"
      :filters="filters"
      :globalFilterFields="['delegatorName', 'delegateName']"
      @page="onPage"
      @refresh="cfg.loadDelegations()"
    >
      <Column :header="$t('admin.approvalConfig.columns.delegator')"><template #body="{ data }">{{ data.delegatorName }}</template></Column>
      <Column :header="$t('admin.approvalConfig.columns.delegate')"><template #body="{ data }">{{ data.delegateName }}</template></Column>
      <Column :header="$t('admin.approvalConfig.columns.docType')"><template #body="{ data }">{{ data.documentTypeCode ?? $t('admin.approvalConfig.allTypes') }}</template></Column>
      <Column field="amountLimit" :header="$t('admin.approvalConfig.columns.amountLimit')" />
      <Column :header="$t('admin.approvalConfig.columns.window')"><template #body="{ data }">{{ formatDate(data.startDate) }} → {{ formatDate(data.endDate) }}</template></Column>
      <Column :header="$t('common.status')"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === 'ACTIVE' ? 'success' : 'contrast'" /></template></Column>
      <Column header="">
        <template #body="{ data }">
          <Button v-if="canManage() && data.status === 'ACTIVE'" :label="$t('common.cancel')" text size="small" severity="danger" @click="cancelDelegation(data.id)" />
        </template>
      </Column>
      <template #empty>
        <EmptyState icon="pi pi-send" :title="$t('admin.approvalConfig.empty')" />
      </template>
    </AppDataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="$t('admin.approvalConfig.newDelegation')" modal class="w-96">
      <Form :resolver="zodResolver(delegationSchema)" :initialValues="{ delegatorId: '', delegateId: '', documentTypeId: undefined, amountLimit: '', startDate: '', endDate: '', reason: '' }" class="flex flex-col gap-3" @submit="submit">
        <FormField v-slot="$f" name="delegatorId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.delegator') }}</label><Select :options="cfg.users" optionLabel="username" optionValue="id" filter :placeholder="$t('admin.approvalConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="delegateId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.delegate') }}</label><Select :options="cfg.users" optionLabel="username" optionValue="id" filter :placeholder="$t('admin.approvalConfig.fields.select')" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="documentTypeId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.documentType') }}</label><Select :options="cfg.documentTypes" optionLabel="code" optionValue="id" showClear :placeholder="$t('admin.approvalConfig.fields.allTypesPlaceholder')" /></FormField>
        <FormField name="amountLimit" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.amountLimit') }}</label><InputText type="text" inputmode="decimal" /></FormField>
        <FormField v-slot="$f" name="startDate" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.startDate') }}</label><InputText type="date" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="endDate" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.endDate') }}</label><InputText type="date" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="reason" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.approvalConfig.fields.reason') }}</label><InputText type="text" /></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="dialog = false" /><Button type="submit" :label="$t('common.create')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
