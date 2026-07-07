<script setup lang="ts">
import { TAX_KINDS, taxCodeSchema } from '@erp/shared';
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
import { FilterMatchMode } from '@primevue/core/api';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useTaxCodesStore } from '../../stores/taxCodes';
import type { TaxCode } from '../../api/taxCodes';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useTaxCodesStore();
const can = (c: string) => auth.can(c);

const kindOptions = computed(() => TAX_KINDS.map((k) => ({ label: t(`admin.tax.kinds.${k}`), value: k })));
const dialog = ref<{ open: boolean; edit?: TaxCode }>({ open: false });
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

function initialValues(edit?: TaxCode) {
  return {
    code: edit?.code ?? '',
    name: edit?.name ?? '',
    kind: edit?.kind ?? 'VAT',
    rate: edit?.rate ?? '0.07',
  };
}

const togglingId = ref<string | null>(null);
async function toggleActive(row: TaxCode, value: boolean) {
  togglingId.value = row.id;
  const ok = await store.updateTaxCode(row.id, { isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(store.error);
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!dialog.value.edit;
  const payload = { ...e.values };
  if (editing) { delete payload.code; delete payload.kind; }
  const ok = editing
    ? await store.updateTaxCode(dialog.value.edit!.id, payload)
    : await store.createTaxCode(e.values);
  if (ok) {
    dialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(store.error);
}

onMounted(() => store.loadTaxCodes());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.tax.title')" />

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadTaxCodes()" />

    <div v-else class="card">
      <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
        <template #actions>
          <Button
            v-if="can('TAX_MANAGE')"
            :label="$t('admin.tax.newCode')"
            icon="pi pi-plus"
            size="small"
            @click="dialog = { open: true }"
          />
        </template>
      </PageToolbar>

      <AppDataTable
        :value="store.taxCodes"
        :total="store.total"
        :loading="store.loading"
        :page="store.page"
        :rows="store.limit"
        dataKey="id"
        :filters="filters"
        :globalFilterFields="['code', 'name']"
        @page="(e: { page: number; limit: number }) => store.loadTaxCodes(e.page, e.limit)"
        @refresh="store.loadTaxCodes()"
      >
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('admin.tax.columns.kind')">
          <template #body="{ data }"><Tag :value="$t(`admin.tax.kinds.${data.kind}`)" severity="secondary" /></template>
        </Column>
        <Column :header="$t('admin.tax.columns.rate')">
          <template #body="{ data }"><span class="tabular-nums">{{ (Number(data.rate) * 100).toFixed(2) }}%</span></template>
        </Column>
        <Column :header="$t('admin.tax.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch
              :modelValue="data.isActive"
              :disabled="!can('TAX_MANAGE') || togglingId === data.id"
              :aria-label="$t('admin.tax.columns.active')"
              @update:modelValue="toggleActive(data as TaxCode, $event)"
            />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="can('TAX_MANAGE')"
              icon="pi pi-pencil"
              text
              size="small"
              :aria-label="$t('common.edit')"
              @click="dialog = { open: true, edit: data as TaxCode }"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-percentage" :title="$t('admin.tax.empty')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog
      v-model:visible="dialog.open"
      :header="dialog.edit ? $t('admin.tax.editCode') : $t('admin.tax.newCode')"
      modal
      class="w-96"
    >
      <Form
        :key="dialog.edit?.id ?? 'new'"
        :resolver="zodResolver(taxCodeSchema)"
        :initialValues="initialValues(dialog.edit)"
        class="flex flex-col gap-3"
        @submit="submit"
      >
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.code') }}</label>
          <InputText type="text" :disabled="!!dialog.edit" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('common.name') }}</label>
          <InputText type="text" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$f" name="kind" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.tax.columns.kind') }}</label>
          <Select :options="kindOptions" optionLabel="label" optionValue="value" :disabled="!!dialog.edit" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$f" name="rate" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.tax.fields.rate') }}</label>
          <InputText type="text" inputmode="decimal" :placeholder="$t('admin.tax.fields.ratePlaceholder')" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="dialog.open = false" />
          <Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
