<script setup lang="ts">
import { itemSchema, vendorSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
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
import { useSearchTerm } from '@/composables/useSearchTerm';
import PageToolbar from '@/components/PageToolbar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import AppDataTable from '@/components/AppDataTable.vue';
import { useAuthStore } from '../../stores/auth';
import { useMasterDataStore } from '../../stores/masterData';
import VendorBankAccountsPanel from '../../components/master-data/VendorBankAccountsPanel.vue';
import { budgetsApi, type BudgetGlOption } from '../../api/budgets';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const md = useMasterDataStore();
const canManage = () => auth.can('MASTER_MANAGE');

// A vendor's bank accounts, opened from its registry row. The panel gates its own mutations on
// VENDOR_BANK_MANAGE — deliberately not MASTER_MANAGE, which is only the right to fix a typo in a
// vendor's name. Reaching the panel needs only MASTER_VIEW, since reading the accounts does.
const bankAccounts = ref<{ open: boolean; vendorId: string; vendorName: string }>({
  open: false,
  vendorId: '',
  vendorName: '',
});
function openBankAccounts(vendor: { id: string; name: string }) {
  bankAccounts.value = { open: true, vendorId: vendor.id, vendorName: vendor.name };
}

/**
 * The item's per-company account, chosen BY BUDGET.
 *
 * An admin maintaining the item registry knows account 5000 as "office supplies budget", not as
 * 5000, so the column asks in budgets. What it stores is still the account code — a budget is keyed
 * by fiscal year and department and an item is scoped to neither, so an item that named a budget
 * would go stale at every year-end and be wrong for every department but the one it was set from.
 */
const budgetOptions = ref<BudgetGlOption[]>([]);

/**
 * One option per ACCOUNT, labelled by the budgets that post to it.
 *
 * Collapsed rather than listed one row per budget, because the account is what gets stored: six
 * departments' office-supplies budgets all set 5000, so offering them separately would present six
 * choices with one outcome and no way to tell afterwards which was picked. Their shared names are
 * the label instead — at most two, then a count, so a wide account stays one readable line.
 */
const glOptions = computed(() => {
  const byGl = new Map<string, Set<string>>();
  for (const b of budgetOptions.value) {
    const names = byGl.get(b.glAccount) ?? new Set<string>();
    names.add(b.budgetName?.trim() || b.code);
    byGl.set(b.glAccount, names);
  }
  return [...byGl.entries()]
    .map(([code, set]) => {
      const names = [...set].sort((a, z) => a.localeCompare(z));
      const shown = names.slice(0, 2).join(', ');
      return {
        code,
        label: names.length > 2 ? t('master.item.glMore', { names: shown, n: names.length - 2 }) : shown,
      };
    })
    .sort((a, z) => a.label.localeCompare(z.label));
});

/**
 * The options a given row may show, including its OWN account when no budget names it.
 *
 * Without this a legacy account — or one whose budget was closed with the fiscal year — matches no
 * option and the Select renders empty, which reads as "not set" for a row that is set. The synthetic
 * option keeps the stored value visible and re-selectable, marked as belonging to no budget.
 */
function glOptionsFor(current?: string | null) {
  const opts = glOptions.value;
  if (!current || opts.some((o) => o.code === current)) return opts;
  return [{ code: current, label: t('master.item.glOrphan', { code: current }) }, ...opts];
}

// Set an item's account for the active company (persists via re-enable with the chosen code).
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

/**
 * The search term for the vendor and item lists, answered by the SERVER across the whole set.
 *
 * `AppDataTable` runs in `lazy` mode, where PrimeVue delegates filtering to the server and ignores
 * `filters` / `globalFilterFields` — the bindings these replace. They were decoration, and a
 * client-side filter would have been wrong regardless: the client holds one page, so it would have
 * searched a fraction of the set while looking like it searched all of it.
 */
const { term: vendorTerm, onSearch: onVendorSearch } = useSearchTerm((t) =>
  md.loadVendors(1, md.vendorLimit, t),
);
const { term: itemTerm, onSearch: onItemSearch } = useSearchTerm((t) => md.loadItems(1, md.itemLimit, t));

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
  const isVendor = dialog.value.kind === 'vendor';
  // The code (vendorCode/itemCode) is an immutable business key — the update DTO
  // doesn't accept it, so drop it from the payload when editing.
  const values = { ...e.values };
  if (editing) delete values[isVendor ? 'vendorCode' : 'itemCode'];
  const ok = isVendor
    ? await md.saveVendor(values, dialog.value.id)
    : await md.saveItem(values, dialog.value.id);
  if (ok) {
    dialog.value.open = false;
    fb.success(t(editing ? 'feedback.updated' : 'feedback.created'));
  } else fb.error(md.error);
}

onMounted(async () => {
  reload();
  // Budgets of the open fiscal year for the item account picker (best-effort; empty without access).
  budgetOptions.value = await budgetsApi.glOptions().catch(() => []);
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
            <PageToolbar :search="vendorTerm" @update:search="onVendorSearch">
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
              <Column :header="$t('master.vendor.columns.bankAccount')">
                <template #body="{ data }">
                  <!-- A vendor with no active account cannot have a disbursement submitted against
                       it at all (DISB is requires_payee), and this registry is where someone comes
                       looking for the reason. -->
                  <div class="flex items-center gap-2">
                    <Tag
                      v-if="!data.hasBankAccount"
                      :value="$t('master.vendor.bank.none')"
                      severity="warn"
                      v-tooltip.top="$t('master.vendor.bank.noneHint')"
                      data-testid="no-account-tag"
                    />
                    <Button
                      icon="pi pi-credit-card"
                      text
                      size="small"
                      v-tooltip.top="$t('master.vendor.bank.manage')"
                      :aria-label="$t('master.vendor.bank.manage')"
                      data-testid="open-bank-accounts"
                      @click="openBankAccounts(data)"
                    />
                  </div>
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
            <PageToolbar :search="itemTerm" @update:search="onItemSearch">
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
              @page="(e: { page: number; limit: number }) => md.loadItems(e.page, e.limit)"
              @refresh="md.loadItems()"
            >
              <Column field="itemCode" :header="$t('master.item.columns.code')" />
              <Column field="name" :header="$t('master.item.columns.name')" />
              <Column field="defaultUnit" :header="$t('master.item.columns.unit')" />
              <!-- Per-company account, picked by budget. The value stored is the account code;
                   the budget names are only how an admin recognises it. -->
              <Column :header="$t('master.item.columns.gl')" style="min-width:18rem">
                <template #body="{ data }">
                  <Select
                    v-if="canManage() && data.enabled"
                    :model-value="data.defaultGlAccount ?? null"
                    :options="glOptionsFor(data.defaultGlAccount)"
                    optionLabel="label"
                    optionValue="code"
                    :placeholder="$t('master.item.glPlaceholder')"
                    :filterPlaceholder="$t('master.item.glFilterPlaceholder')"
                    :emptyMessage="$t('master.item.glEmpty')"
                    showClear
                    filter
                    size="small"
                    fluid
                    @update:model-value="(v) => setItemGl(data.id, v as string | null)"
                  >
                    <!-- The account code stays visible beside the budget name: it is the value
                         actually stored, and accounting reads the books by it. -->
                    <template #option="{ option }">
                      <div class="flex w-full items-center justify-between gap-3">
                        <span>{{ option.label }}</span>
                        <span class="text-xs text-muted-color">{{ option.code }}</span>
                      </div>
                    </template>
                  </Select>
                  <span v-else-if="data.defaultGlAccount">
                    {{ glOptionsFor(data.defaultGlAccount).find((o) => o.code === data.defaultGlAccount)?.label }}
                    <span class="text-xs text-muted-color">({{ data.defaultGlAccount }})</span>
                  </span>
                  <span v-else>—</span>
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
          <!-- Code is the immutable business key; view-only once the record exists. -->
          <InputText type="text" :disabled="!!dialog.id" />
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

  <!-- A vendor's payee accounts. Reachable with MASTER_VIEW; the panel itself hides every mutation
       from anyone without VENDOR_BANK_MANAGE. -->
  <Dialog v-model:visible="bankAccounts.open" :header="$t('master.vendor.bank.manage')" modal class="w-[44rem]" data-testid="bank-accounts-dialog">
    <VendorBankAccountsPanel
      v-if="bankAccounts.open"
      :vendorId="bankAccounts.vendorId"
      :vendorName="bankAccounts.vendorName"
      @changed="md.loadVendors()"
    />
  </Dialog>
</template>
