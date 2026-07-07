<script setup lang="ts">
import { ACCOUNT_TYPES, accountSchema } from '@erp/shared';
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
import { useAccountsStore } from '../../stores/accounts';
import type { Account } from '../../api/accounts';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useAccountsStore();
const can = (c: string) => auth.can(c);

const typeOptions = computed(() =>
  ACCOUNT_TYPES.map((v) => ({ label: t(`admin.accounting.types.${v}`), value: v })),
);
const typeLabel = (v: string) => t(`admin.accounting.types.${v}`);

const dialog = ref<{ open: boolean; edit?: Account }>({ open: false });
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

// Parent options: same account list, excluding the row being edited (an account can't be its
// own parent). The server also enforces same-type + no-cycle.
const parentOptions = computed(() =>
  store.parents
    .filter((a) => a.id !== dialog.value.edit?.id)
    .map((a) => ({ label: `${a.code} — ${a.name}`, value: a.id })),
);

function initialValues(edit?: Account) {
  return {
    code: edit?.code ?? '',
    name: edit?.name ?? '',
    accountType: edit?.accountType ?? 'EXPENSE',
    parentId: edit?.parent?.id ?? undefined,
    isPostable: edit?.isPostable ?? true,
  };
}

// Inline active toggle from the table row. One-way :modelValue keeps the switch driven by
// the row data, so a failed update reverts on its own; disable the row while its own
// update is in flight to avoid double-fires.
const togglingId = ref<string | null>(null);
async function toggleActive(row: Account, value: boolean) {
  togglingId.value = row.id;
  const ok = await store.updateAccount(row.id, { isActive: value });
  togglingId.value = null;
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(store.error);
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!dialog.value.edit;
  // `code` is immutable on edit (disabled in the form); omit it from the update payload.
  const payload = { ...e.values };
  if (editing) delete payload.code;
  const ok = editing
    ? await store.updateAccount(dialog.value.edit!.id, payload)
    : await store.createAccount(e.values);
  if (ok) {
    dialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(store.error);
}

onMounted(() => {
  store.loadAccounts();
  store.loadParents();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.accounting.title')" />

    <ErrorState v-if="store.error" :message="store.error" @retry="store.loadAccounts()" />

    <div v-else class="card">
      <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
        <template #actions>
          <Button
            v-if="can('COA_MANAGE')"
            :label="$t('admin.accounting.newAccount')"
            icon="pi pi-plus"
            size="small"
            @click="dialog = { open: true }"
          />
        </template>
      </PageToolbar>

      <AppDataTable
        :value="store.accounts"
        :total="store.total"
        :loading="store.loading"
        :page="store.page"
        :rows="store.limit"
        dataKey="id"
        :filters="filters"
        :globalFilterFields="['code', 'name']"
        @page="(e: { page: number; limit: number }) => store.loadAccounts(e.page, e.limit)"
        @refresh="store.loadAccounts()"
      >
        <Column field="code" :header="$t('common.code')" />
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('admin.accounting.columns.type')">
          <template #body="{ data }">{{ typeLabel(data.accountType) }}</template>
        </Column>
        <Column :header="$t('admin.accounting.columns.parent')">
          <template #body="{ data }">{{ data.parent?.code ?? '—' }}</template>
        </Column>
        <Column :header="$t('admin.accounting.columns.postable')">
          <template #body="{ data }">
            <Tag
              :value="data.isPostable ? $t('common.yes') : $t('common.no')"
              :severity="data.isPostable ? 'info' : 'secondary'"
            />
          </template>
        </Column>
        <Column :header="$t('admin.accounting.columns.active')">
          <template #body="{ data }">
            <ToggleSwitch
              :modelValue="data.isActive"
              :disabled="!can('COA_MANAGE') || togglingId === data.id"
              :aria-label="$t('admin.accounting.columns.active')"
              @update:modelValue="toggleActive(data as Account, $event)"
            />
          </template>
        </Column>
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="can('COA_MANAGE')"
              icon="pi pi-pencil"
              text
              size="small"
              :aria-label="$t('common.edit')"
              @click="dialog = { open: true, edit: data as Account }"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-book" :title="$t('admin.accounting.empty')" />
        </template>
      </AppDataTable>
    </div>

    <!-- Account create/edit dialog -->
    <Dialog
      v-model:visible="dialog.open"
      :header="dialog.edit ? $t('admin.accounting.editAccount') : $t('admin.accounting.newAccount')"
      modal
      class="w-96"
    >
      <Form
        :key="dialog.edit?.id ?? 'new'"
        :resolver="zodResolver(accountSchema)"
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
        <FormField v-slot="$f" name="accountType" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.accounting.columns.type') }}</label>
          <Select :options="typeOptions" optionLabel="label" optionValue="value" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
        <FormField name="parentId" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('admin.accounting.fields.parent') }}</label>
          <Select :options="parentOptions" optionLabel="label" optionValue="value" showClear :placeholder="$t('admin.accounting.fields.noParent')" />
        </FormField>
        <FormField name="isPostable" class="flex items-center gap-2">
          <ToggleSwitch /><label class="text-sm text-muted-color">{{ $t('admin.accounting.fields.postable') }}</label>
        </FormField>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="dialog.open = false" />
          <Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
