<script setup lang="ts">
import { companyCreateSchema } from '@erp/shared';
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
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import type { FormSubmitEvent } from '@primevue/forms';
import type { Company } from '../../../api/org';

const auth = useAuthStore();
const org = useOrgStore();
const fb = useFeedback();
const { t } = useI18n();
const can = (c: string) => auth.can(c);

const companyDialog = ref<{ open: boolean; edit?: Company }>({ open: false });
const companyFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

async function submitCompany(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!companyDialog.value.edit;
  // `code` is immutable: the field is disabled when editing but @primevue/forms still submits its
  // initial value, and the update DTO (whitelist) rejects it. Omit it from the update payload.
  const updatable = { ...e.values };
  delete updatable.code;
  const ok = editing
    ? await org.updateCompany(companyDialog.value.edit!.id, updatable)
    : await org.createCompany(e.values);
  if (ok) {
    companyDialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(org.error);
}

function load() {
  org.loadCompanies();
  if (!org.currencies.length) org.loadCurrencies();
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.companies')" />
    <PageToolbar :search="companyFilters.global.value ?? ''" @update:search="companyFilters.global.value = $event">
      <template #actions>
        <Button v-if="can('COMPANY_MANAGE')" :label="$t('admin.org.newCompany')" icon="pi pi-plus" size="small" @click="companyDialog = { open: true }" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadCompanies()" />
    <div v-else class="card">
      <AppDataTable
        :value="org.companies"
        :total="org.companiesTotal"
        :loading="org.loading"
        :page="org.companiesPage"
        :rows="org.companiesLimit"
        :filters="companyFilters"
        :globalFilterFields="['code', 'nameTh']"
        @page="(e: any) => org.loadCompanies(e.page, e.limit)"
        @refresh="org.loadCompanies()"
      >
        <Column field="code" :header="$t('common.code')" />
        <Column field="nameTh" :header="$t('admin.org.columns.nameTh')" />
        <Column :header="$t('admin.org.columns.currency')"><template #body="{ data }">{{ data.baseCurrency?.code ?? $t('common.none') }}</template></Column>
        <Column :header="$t('admin.org.columns.active')"><template #body="{ data }"><Tag :value="data.isActive ? $t('common.yes') : $t('common.no')" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
        <Column header=""><template #body="{ data }"><Button v-if="can('COMPANY_MANAGE')" icon="pi pi-pencil" text size="small" @click="companyDialog = { open: true, edit: data }" /></template></Column>
        <template #empty>
          <EmptyState icon="pi pi-building" :title="$t('admin.org.empty.companies')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog v-model:visible="companyDialog.open" :header="companyDialog.edit ? $t('admin.org.editCompany') : $t('admin.org.newCompany')" modal class="w-96">
      <Form
        :key="companyDialog.edit?.id ?? 'new'"
        :resolver="zodResolver(companyCreateSchema)"
        :initialValues="companyDialog.edit
          ? { code: companyDialog.edit.code, nameTh: companyDialog.edit.nameTh, nameEn: companyDialog.edit.nameEn ?? '', taxId: companyDialog.edit.taxId, branchCode: companyDialog.edit.branchCode, baseCurrency: companyDialog.edit.baseCurrency?.code ?? 'THB' }
          : { code: '', nameTh: '', nameEn: '', taxId: '', branchCode: '00000', baseCurrency: 'THB' }"
        class="flex flex-col gap-3"
        @submit="submitCompany"
      >
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.code') }}</label><InputText type="text" :disabled="!!companyDialog.edit" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField v-slot="$f" name="nameTh" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.nameTh') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="nameEn" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.nameEn') }}</label><InputText type="text" /></FormField>
        <FormField v-slot="$f" name="taxId" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.taxId') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
        <FormField name="baseCurrency" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.org.fields.baseCurrency') }}</label><Select :options="org.currencies" optionLabel="code" optionValue="code" editable /></FormField>
        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="companyDialog.open = false" /><Button type="submit" :label="$t('common.save')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
