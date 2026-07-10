<script setup lang="ts">
import { companyCreateSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Avatar from 'primevue/avatar';
import Button from 'primevue/button';
import DataView from 'primevue/dataview';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import ProfileImagePanel from '@/components/ProfileImagePanel.vue';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import { orgApi, uploadCompanyProfileImage } from '../../../api/org';
import type { FormSubmitEvent } from '@primevue/forms';
import type { Company } from '../../../api/org';

const auth = useAuthStore();
const org = useOrgStore();
const fb = useFeedback();
const { t } = useI18n();
const can = (c: string) => auth.can(c);

const companyDialog = ref<{ open: boolean; edit?: Company }>({ open: false });
const search = ref('');
// DataView layout: cards grid or single-column list; persisted so the choice sticks per browser.
const layout = ref<'grid' | 'list'>((localStorage.getItem('companiesLayout') as 'grid' | 'list') || 'grid');
// The edited company's current profile image (fetched on open; presign needs an existing id).
const companyImageUrl = ref<string | null>(null);

// Client-side filter over the loaded page (code / TH name / EN name), mirroring the old table's global search.
const filteredCompanies = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return org.companies;
  return org.companies.filter((c) =>
    [c.code, c.nameTh, c.nameEn].some((v) => v?.toLowerCase().includes(q)),
  );
});

async function openCompany(edit?: Company) {
  companyDialog.value = { open: true, edit };
  companyImageUrl.value = null;
  if (edit) companyImageUrl.value = (await orgApi.companies.profileImage(edit.id)).profileImageUrl;
}
function uploadCompanyImage(file: File): Promise<string> {
  return uploadCompanyProfileImage(companyDialog.value.edit!.id, file);
}

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

watch(layout, (v) => localStorage.setItem('companiesLayout', v));

function load() {
  org.loadCompanies();
  if (!org.currencies.length) org.loadCurrencies();
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.org.tabs.companies')" />
    <PageToolbar :search="search" @update:search="search = $event">
      <template #actions>
        <Button v-if="can('COMPANY_MANAGE')" :label="$t('admin.org.newCompany')" icon="pi pi-plus" size="small" @click="openCompany()" />
      </template>
    </PageToolbar>
    <ErrorState v-if="org.error" :message="org.error" @retry="org.loadCompanies()" />
    <div v-else class="card">
      <DataView
        :value="filteredCompanies"
        :layout="layout"
        dataKey="id"
        lazy
        :paginator="org.companiesTotal > org.companiesLimit"
        :rows="org.companiesLimit"
        :totalRecords="org.companiesTotal"
        :first="(org.companiesPage - 1) * org.companiesLimit"
        :loading="org.loading"
        @page="(e: any) => org.loadCompanies(e.page + 1, e.rows)"
      >
        <template #header>
          <div class="flex justify-end">
            <SelectButton v-model="layout" :options="['grid', 'list']" :allowEmpty="false" aria-label="Layout">
              <template #option="{ option }">
                <i :class="option === 'grid' ? 'pi pi-th-large' : 'pi pi-bars'" />
              </template>
            </SelectButton>
          </div>
        </template>

        <!-- Grid: one card per company -->
        <template #grid="{ items }">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-1">
            <div
              v-for="c in (items as Company[])"
              :key="c.id"
              class="flex flex-col gap-3 rounded-xl border border-surface p-4 bg-surface-0 dark:bg-surface-900"
            >
              <div class="flex items-start gap-3">
                <Avatar :image="c.profileImageUrl ?? undefined" :icon="c.profileImageUrl ? undefined : 'pi pi-building'" shape="circle" size="large" />
                <div class="min-w-0 flex-1">
                  <div class="font-semibold truncate">{{ c.nameTh }}</div>
                  <div class="text-sm text-muted-color truncate">{{ c.nameEn || c.code }}</div>
                </div>
                <Button v-if="can('COMPANY_MANAGE')" icon="pi pi-pencil" text rounded size="small" @click="openCompany(c)" />
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Tag :value="c.code" severity="secondary" />
                <Tag icon="pi pi-money-bill" :value="c.baseCurrency?.code ?? $t('common.none')" severity="info" />
                <Tag :value="c.isActive ? $t('common.yes') : $t('common.no')" :severity="c.isActive ? 'success' : 'secondary'" />
              </div>
            </div>
          </div>
        </template>

        <!-- List: one row per company -->
        <template #list="{ items }">
          <div class="flex flex-col">
            <div
              v-for="(c, i) in (items as Company[])"
              :key="c.id"
              class="flex items-center gap-4 p-4"
              :class="{ 'border-t border-surface': i !== 0 }"
            >
              <Avatar :image="c.profileImageUrl ?? undefined" :icon="c.profileImageUrl ? undefined : 'pi pi-building'" shape="circle" size="large" />
              <div class="min-w-0 flex-1">
                <div class="font-semibold truncate">{{ c.nameTh }}</div>
                <div class="text-sm text-muted-color truncate">{{ c.nameEn || c.code }}</div>
              </div>
              <Tag :value="c.code" severity="secondary" class="hidden sm:inline-flex" />
              <Tag icon="pi pi-money-bill" :value="c.baseCurrency?.code ?? $t('common.none')" severity="info" />
              <Tag :value="c.isActive ? $t('common.yes') : $t('common.no')" :severity="c.isActive ? 'success' : 'secondary'" />
              <Button v-if="can('COMPANY_MANAGE')" icon="pi pi-pencil" text rounded size="small" @click="openCompany(c)" />
            </div>
          </div>
        </template>

        <template #empty>
          <EmptyState icon="pi pi-building" :title="$t('admin.org.empty.companies')" />
        </template>
      </DataView>
    </div>

    <Dialog v-model:visible="companyDialog.open" :header="companyDialog.edit ? $t('admin.org.editCompany') : $t('admin.org.newCompany')" modal class="w-96">
      <Form
        :key="companyDialog.edit?.id ?? 'new'"
        :resolver="zodResolver(companyCreateSchema)"
        :initialValues="companyDialog.edit
          ? { code: companyDialog.edit.code, nameTh: companyDialog.edit.nameTh, nameEn: companyDialog.edit.nameEn ?? '', taxId: companyDialog.edit.taxId ?? '', branchCode: companyDialog.edit.branchCode, baseCurrency: companyDialog.edit.baseCurrency?.code ?? 'THB' }
          : { code: '', nameTh: '', nameEn: '', taxId: '', branchCode: '00000', baseCurrency: 'THB' }"
        class="flex flex-col gap-3"
        @submit="submitCompany"
      >
        <!-- Company 1:1 profile image/logo — only for existing companies (presign needs an id). -->
        <ProfileImagePanel
          v-if="companyDialog.edit"
          :url="companyImageUrl"
          :upload="uploadCompanyImage"
          :canEdit="can('COMPANY_MANAGE')"
          :size="140"
          class="mb-1"
          @uploaded="(u) => (companyImageUrl = u)"
        />
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
