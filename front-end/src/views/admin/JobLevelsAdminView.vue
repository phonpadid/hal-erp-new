<script setup lang="ts">
import { jobLevelSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import ToggleSwitch from 'primevue/toggleswitch';
import { FilterMatchMode } from '@primevue/core/api';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useJobLevelsStore } from '../../stores/jobLevels';
import type { JobLevel } from '../../api/jobLevels';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useJobLevelsStore();
const can = (c: string) => auth.can(c);

const dialog = ref<{ open: boolean; edit?: JobLevel }>({ open: false });
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

function initialValues(edit?: JobLevel) {
  return {
    code: edit?.code ?? '',
    name: edit?.name ?? '',
    rank: edit?.rank ?? 10,
  };
}

const togglingId = ref<string | null>(null);
async function toggleActive(row: JobLevel, value: boolean) {
  togglingId.value = row.id;
  const ok = await store.updateJobLevel(row.id, { isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(store.error);
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!dialog.value.edit;
  const payload = { ...e.values };
  // `code` is the immutable natural key once created.
  if (editing) delete payload.code;
  const ok = editing
    ? await store.updateJobLevel(dialog.value.edit!.id, payload)
    : await store.createJobLevel(e.values);
  if (ok) {
    dialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(store.error);
}

onMounted(() => store.loadJobLevels());
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.jobLevel.title')" :subtitle="$t('admin.jobLevel.subtitle')" />

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadJobLevels()" />

    <div v-else class="card">
      <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
        <template #actions>
          <Button
            v-if="can('JOB_LEVEL_MANAGE')"
            :label="$t('admin.jobLevel.newLevel')"
            icon="pi pi-plus"
            size="small"
            @click="dialog = { open: true }"
          />
        </template>
      </PageToolbar>

      <AppDataTable
        :value="store.jobLevels"
        :total="store.total"
        :loading="store.loading"
        :page="store.page"
        :rows="store.limit"
        dataKey="id"
        :filters="filters"
        :globalFilterFields="['code', 'name']"
        @page="(e: { page: number; limit: number }) => store.loadJobLevels(e.page, e.limit)"
        @refresh="store.loadJobLevels()"
      >
        <Column field="rank" :header="$t('admin.jobLevel.columns.rank')">
          <template #body="{ data }"><span class="tabular-nums">{{ data.rank }}</span></template>
        </Column>
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('admin.jobLevel.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch
              :modelValue="data.isActive"
              :disabled="!can('JOB_LEVEL_MANAGE') || togglingId === data.id"
              :aria-label="$t('admin.jobLevel.columns.active')"
              @update:modelValue="toggleActive(data as JobLevel, $event)"
            />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="can('JOB_LEVEL_MANAGE')"
              icon="pi pi-pencil"
              text
              size="small"
              :aria-label="$t('common.edit')"
              @click="dialog = { open: true, edit: data as JobLevel }"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-sort-amount-up" :title="$t('admin.jobLevel.empty')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog
      v-model:visible="dialog.open"
      :header="dialog.edit ? $t('admin.jobLevel.editLevel') : $t('admin.jobLevel.newLevel')"
      modal
      class="w-96"
    >
      <Form
        :key="dialog.edit?.id ?? 'new'"
        :resolver="zodResolver(jobLevelSchema)"
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
        <FormField v-slot="$f" name="rank" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.jobLevel.fields.rank') }}</label>
          <InputNumber :useGrouping="false" />
          <span class="text-muted-color text-xs">{{ $t('admin.jobLevel.fields.rankHelp') }}</span>
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
