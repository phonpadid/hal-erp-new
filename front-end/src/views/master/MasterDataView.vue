<script setup lang="ts">
import { itemSchema, vendorSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import { FilterMatchMode } from '@primevue/core/api';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useMasterDataStore } from '../../stores/masterData';
import { accountsApi, type SelectableAccount } from '../../api/accounts';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const md = useMasterDataStore();
const canManage = () => auth.can('MASTER_MANAGE');

// Active company's postable accounts for the per-company item GL picker (label "name (code)").
const accounts = ref<SelectableAccount[]>([]);
const glOptions = computed(() =>
  accounts.value.map((a) => ({ code: a.code, label: `${a.name} (${a.code})` })),
);
// Set an item's GL for the active company (persists via re-enable with the chosen code).
function setItemGl(id: string, code: string | null) {
  md.setItemEnabled(id, true, code ?? '');
}
// Set a vendor's per-company payment terms. The InputNumber fires @update:model-value on every
// spinner step/keystroke, and each save reloads the whole vendor list — so debounce per vendor
// id and only persist ~500ms after the user stops, collapsing a burst into a single request.
const termTimers = new Map<string, ReturnType<typeof setTimeout>>();
function setVendorTerms(id: string, days: number | null) {
  clearTimeout(termTimers.get(id));
  termTimers.set(
    id,
    setTimeout(() => {
      termTimers.delete(id);
      md.setVendorEnabled(id, true, days ?? undefined);
    }, 500),
  );
}
onUnmounted(() => {
  for (const t of termTimers.values()) clearTimeout(t);
  termTimers.clear();
});

const vendorFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });
const itemFilters = ref({ global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS } });

const vendorResolver = zodResolver(vendorSchema);
const itemResolver = zodResolver(itemSchema);

// Edit dialog state — kind decides which schema/fields/save to use.
const dialog = ref<{ open: boolean; kind: 'vendor' | 'item'; id?: string; values: Record<string, any> }>({
  open: false, kind: 'vendor', values: {},
});

function newVendor() { dialog.value = { open: true, kind: 'vendor', values: { vendorCode: '', name: '' } }; }
function editVendor(v: any) { dialog.value = { open: true, kind: 'vendor', id: v.id, values: { ...v } }; }
function newItem() { dialog.value = { open: true, kind: 'item', values: { itemCode: '', name: '', defaultUnit: '', isActive: true } }; }
function editItem(i: any) { dialog.value = { open: true, kind: 'item', id: i.id, values: { ...i } }; }

function reload() {
  md.loadVendors();
  md.loadItems();
}

const dialogHeader = computed(() =>
  dialog.value.kind === 'vendor'
    ? t(dialog.value.id ? 'master.vendor.edit' : 'master.vendor.new')
    : t(dialog.value.id ? 'master.item.edit' : 'master.item.new'),
);

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!dialog.value.id;
  const ok = dialog.value.kind === 'vendor'
    ? await md.saveVendor(e.values, dialog.value.id)
    : await md.saveItem(e.values, dialog.value.id);
  if (ok) {
    dialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(md.error);
}

onMounted(async () => {
  reload();
  // Postable accounts for the item GL picker (best-effort; empty on read-only/no access).
  accounts.value = await accountsApi.selectable().catch(() => []);
});
</script>

<template>
  <div>
    <PageHeader :title="$t('master.title')" />

    <ErrorState v-if="md.error" :message="md.error" @retry="reload" />

    <div v-else class="card">
      <Tabs value="vendors">
        <TabList>
          <Tab value="vendors">{{ $t('master.tabs.vendors') }}</Tab>
          <Tab value="items">{{ $t('master.tabs.items') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="vendors">
            <PageToolbar :search="vendorFilters.global.value ?? ''" @update:search="vendorFilters.global.value = $event">
              <template #actions>
                <Button v-if="canManage()" :label="$t('master.vendor.new')" icon="pi pi-plus" size="small" @click="newVendor" />
              </template>
            </PageToolbar>
            <AppDataTable
              :value="md.vendors"
              :total="md.vendorTotal"
              :loading="md.loading"
              :page="md.vendorPage"
              :rows="md.vendorLimit"
              :filters="vendorFilters"
              :globalFilterFields="['vendorCode', 'name']"
              @page="(e: { page: number; limit: number }) => md.loadVendors(e.page, e.limit)"
              @refresh="md.loadVendors()"
            >
              <Column field="vendorCode" :header="$t('master.vendor.columns.code')" />
              <Column field="name" :header="$t('master.vendor.columns.name')" />
              <!-- Per-company effective payment terms; editable for an enabled vendor (override). -->
              <Column :header="$t('master.vendor.columns.paymentTermDays')" style="min-width:9rem">
                <template #body="{ data }">
                  <InputNumber
                    v-if="canManage() && data.enabled"
                    :model-value="data.paymentTermDays"
                    :min="0"
                    showButtons
                    size="small"
                    fluid
                    @update:model-value="(v) => setVendorTerms(data.id, v as number | null)"
                  />
                  <span v-else>{{ data.paymentTermDays ?? '—' }}</span>
                </template>
              </Column>
              <Column :header="$t('master.vendor.columns.enabled')">
                <template #body="{ data }">
                  <ToggleSwitch :modelValue="data.enabled" :disabled="!canManage()" @update:modelValue="(v) => md.setVendorEnabled(data.id, v)" />
                </template>
              </Column>
              <Column :header="$t('common.actions')">
                <template #body="{ data }">
                  <Button v-if="canManage()" icon="pi pi-pencil" text size="small" @click="editVendor(data)" />
                </template>
              </Column>
              <template #empty>
                <EmptyState icon="pi pi-truck" :title="$t('master.vendor.empty')" />
              </template>
            </AppDataTable>
          </TabPanel>

          <TabPanel value="items">
            <PageToolbar :search="itemFilters.global.value ?? ''" @update:search="itemFilters.global.value = $event">
              <template #actions>
                <Button v-if="canManage()" :label="$t('master.item.new')" icon="pi pi-plus" size="small" @click="newItem" />
              </template>
            </PageToolbar>
            <AppDataTable
              :value="md.items"
              :total="md.itemTotal"
              :loading="md.loading"
              :page="md.itemPage"
              :rows="md.itemLimit"
              :filters="itemFilters"
              :globalFilterFields="['itemCode', 'name']"
              @page="(e: { page: number; limit: number }) => md.loadItems(e.page, e.limit)"
              @refresh="md.loadItems()"
            >
              <Column field="itemCode" :header="$t('master.item.columns.code')" />
              <Column field="name" :header="$t('master.item.columns.name')" />
              <Column field="defaultUnit" :header="$t('master.item.columns.unit')" />
              <!-- Per-company GL: set from the active company's postable accounts when enabled. -->
              <Column :header="$t('master.item.columns.gl')" style="min-width:14rem">
                <template #body="{ data }">
                  <Select
                    v-if="canManage() && data.enabled"
                    :model-value="data.defaultGlAccount ?? null"
                    :options="glOptions"
                    optionLabel="label"
                    optionValue="code"
                    :placeholder="$t('master.item.glPlaceholder')"
                    showClear
                    filter
                    size="small"
                    fluid
                    @update:model-value="(v) => setItemGl(data.id, v as string | null)"
                  />
                  <span v-else>{{ data.defaultGlAccount ?? '—' }}</span>
                </template>
              </Column>
              <Column :header="$t('master.item.columns.enabled')">
                <template #body="{ data }">
                  <ToggleSwitch :modelValue="data.enabled" :disabled="!canManage()" @update:modelValue="(v) => md.setItemEnabled(data.id, v)" />
                </template>
              </Column>
              <Column :header="$t('common.actions')">
                <template #body="{ data }">
                  <Button v-if="canManage()" icon="pi pi-pencil" text size="small" @click="editItem(data)" />
                </template>
              </Column>
              <template #empty>
                <EmptyState icon="pi pi-box" :title="$t('master.item.empty')" />
              </template>
            </AppDataTable>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <Dialog v-model:visible="dialog.open" :header="dialogHeader" modal class="w-96">
      <Form
        :key="dialog.kind + (dialog.id ?? 'new')"
        :resolver="dialog.kind === 'vendor' ? vendorResolver : itemResolver"
        :initialValues="dialog.values"
        class="flex flex-col gap-3"
        @submit="onSubmit"
      >
        <FormField v-slot="$field" :name="dialog.kind === 'vendor' ? 'vendorCode' : 'itemCode'" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.fields.code') }}</label>
          <InputText type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <FormField v-slot="$field" name="name" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.fields.name') }}</label>
          <InputText type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
        </FormField>
        <template v-if="dialog.kind === 'item'">
          <FormField v-slot="$field" name="defaultUnit" class="flex flex-col gap-1">
            <label class="text-sm text-muted-color">{{ $t('master.fields.unit') }}</label>
            <InputText type="text" />
            <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">{{ $field.error?.message }}</Message>
          </FormField>
          <!-- GL is set per company on the enablement row (item table), not on the group item. -->
          <FormField name="isActive" class="flex items-center gap-2">
            <ToggleSwitch />
            <label class="text-sm text-muted-color">{{ $t('master.fields.active') }}</label>
          </FormField>
        </template>
        <div class="flex justify-end gap-2 mt-2">
          <Button :label="$t('common.cancel')" text @click="dialog.open = false" />
          <Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
