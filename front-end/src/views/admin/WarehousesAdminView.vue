<script setup lang="ts">
import { warehouseSchema } from '@erp/shared';
import { FilterMatchMode } from '@primevue/core/api';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { useI18n } from 'vue-i18n';
import AppDataTable from '@/components/AppDataTable.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAuthStore } from '../../stores/auth';
import { useInventoryStore } from '../../stores/inventory';
import type { Warehouse } from '../../api/inventory';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const confirm = useConfirm();
const auth = useAuthStore();
const store = useInventoryStore();
const can = (c: string) => auth.can(c);

const dialog = ref<{ open: boolean; edit?: Warehouse }>({ open: false });
const includeInactive = ref(false);
const filters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });
/** Server-side conflicts land on the field that caused them, not in a toast. */
const codeError = ref('');

const resolver = zodResolver(warehouseSchema);

function initialValues(edit?: Warehouse) {
  return { code: edit?.code ?? '', name: edit?.name ?? '' };
}

function openCreate() {
  codeError.value = '';
  dialog.value = { open: true };
}

function openEdit(row: Warehouse) {
  codeError.value = '';
  dialog.value = { open: true, edit: row };
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  codeError.value = '';
  const editing = dialog.value.edit;
  try {
    if (editing) {
      // `code` is immutable after creation: historical movements are read by it.
      await store.updateWarehouse(editing.id, { name: e.values.name }, includeInactive.value);
    } else {
      await store.createWarehouse(
        { code: e.values.code, name: e.values.name },
        includeInactive.value,
      );
    }
    dialog.value = { open: false };
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } catch (err) {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? '';
    // A duplicate code is a property of the field the user typed, so it belongs beside it.
    if (/already exists/i.test(message)) codeError.value = t('inventory.warehouses.duplicateCode');
    else fb.error(message || t('feedback.error'));
  }
}

function confirmDeactivate(row: Warehouse) {
  confirm.require({
    message: t('inventory.warehouses.deactivateConfirm'),
    header: t('inventory.warehouses.deactivate'),
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      await store.deactivateWarehouse(row.id, includeInactive.value);
      fb.success(t('feedback.updated'));
    },
  });
}

function reload() {
  return store.loadWarehouses(undefined, undefined, includeInactive.value);
}

onMounted(() => store.loadWarehouses(1, undefined, false));
</script>

<template>
  <div>
    <PageHeader
      :title="$t('inventory.warehouses.title')"
      :subtitle="$t('inventory.warehouses.subtitle')"
    />

    <PageToolbar :search="filters.global.value ?? ''" @update:search="filters.global.value = $event">
      <template #actions>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 text-sm">
            <ToggleSwitch
              :modelValue="includeInactive"
              @update:modelValue="includeInactive = $event; reload()"
            />
            {{ $t('inventory.warehouses.showInactive') }}
          </label>
          <Button
            v-if="can('INV_MANAGE')"
            icon="pi pi-plus"
            :label="$t('inventory.warehouses.create')"
            @click="openCreate"
          />
        </div>
      </template>
    </PageToolbar>

    <ErrorState v-if="store.error" :message="store.error" @retry="reload()" />

    <div v-else class="card">
      <AppDataTable
        :value="store.warehouses"
        :total="store.warehousesTotal"
        :loading="store.loading"
        :page="store.warehousesPage"
        :rows="store.warehousesLimit"
        :filters="filters"
        :globalFilterFields="['code', 'name']"
        @page="(e: any) => store.loadWarehouses(e.page, e.limit, includeInactive)"
        @refresh="reload()"
      >
        <Column field="code" :header="$t('inventory.warehouses.columns.code')" />
        <Column field="name" :header="$t('inventory.warehouses.columns.name')" />
        <Column :header="$t('inventory.warehouses.columns.status')">
          <template #body="{ data }">
            <Tag
              :severity="data.isActive ? 'success' : 'secondary'"
              :value="$t(data.isActive ? 'inventory.warehouses.active' : 'inventory.warehouses.inactive')"
            />
          </template>
        </Column>
        <Column v-if="can('INV_MANAGE')" class="w-28">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded @click="openEdit(data)" />
            <!-- Deactivation, never deletion: past movements still point at this row. -->
            <Button
              v-if="data.isActive"
              icon="pi pi-ban"
              text
              rounded
              severity="danger"
              :aria-label="$t('inventory.warehouses.deactivate')"
              @click="confirmDeactivate(data)"
            />
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-warehouse" :title="$t('inventory.warehouses.empty')" />
        </template>
      </AppDataTable>
    </div>

    <Dialog
      v-model:visible="dialog.open"
      modal
      :header="$t(dialog.edit ? 'inventory.warehouses.edit' : 'inventory.warehouses.create')"
      class="w-full max-w-md"
    >
      <Form
        :resolver="resolver"
        :initialValues="initialValues(dialog.edit)"
        class="flex flex-col gap-4"
        @submit="submit"
      >
        <FormField v-slot="$field" name="code" class="flex flex-col gap-1">
          <label for="wh-code">{{ $t('inventory.warehouses.fields.code') }}</label>
          <InputText id="wh-code" :disabled="!!dialog.edit" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
            {{ $field.error?.message }}
          </Message>
          <Message v-else-if="codeError" severity="error" size="small" variant="simple">
            {{ codeError }}
          </Message>
        </FormField>

        <FormField v-slot="$field" name="name" class="flex flex-col gap-1">
          <label for="wh-name">{{ $t('inventory.warehouses.fields.name') }}</label>
          <InputText id="wh-name" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
            {{ $field.error?.message }}
          </Message>
        </FormField>

        <div class="flex justify-end gap-2">
          <Button
            type="button"
            severity="secondary"
            :label="$t('common.cancel')"
            @click="dialog.open = false"
          />
          <Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
