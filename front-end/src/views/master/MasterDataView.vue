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
 * The item's per-company budget.
 *
 * An item names ONE budget, stored as that budget's plan code (`6.101`) — the language the
 * organisation actually uses. Not the account: 612.06 is the account of ຄ່າເຊົ່າ ເຊີເວີ HAL Express,
 * AMAZON Web Services, PubNub and Mail Express alike, so an account names four budgets at once and
 * could never record which one an admin picked. The account the item posts to is stamped
 * server-side from the budget chosen here.
 *
 * Not the budget's id either: a budget is a per-year row, so an id would name a closed year's
 * budget every time a new year opens. A plan code keeps meaning the same budget across years.
 */
const budgetOptions = ref<BudgetGlOption[]>([]);

/**
 * One option per BUDGET — flat, never grouped or folded together.
 *
 * Budgets sharing an account are separate rows with separate outcomes, which is the whole point:
 * folding them by account presented four choices with one result and no way to tell afterwards
 * which was meant. Ordered by plan code, the order the plan itself is written in.
 */
const budgetChoices = computed(() =>
  [...budgetOptions.value]
    .map((b) => ({
      code: b.code,
      name: b.budgetName?.trim() || b.code,
      departmentName: b.departmentName,
      glAccount: b.glAccount,
    }))
    .sort((a, z) => a.code.localeCompare(z.code, undefined, { numeric: true })),
);

/**
 * The options a given row may show, including its OWN binding when the open year has no such code.
 *
 * Without this a plan line retired at year-end matches no option and the Select renders empty,
 * which reads as "not set" for a row that is set. The synthetic option keeps the stored code
 * visible and replaceable, marked as belonging to no budget of the open year.
 */
function budgetChoicesFor(current?: string | null) {
  const choices = budgetChoices.value;
  if (!current || choices.some((o) => o.code === current)) return choices;
  return [
    { code: current, name: t('master.item.budgetOutsideYear', { code: current }), departmentName: '', glAccount: '' },
    ...choices,
  ];
}

/** What a bound item reads as: the budget's name in the open year, else its bare plan code. */
function budgetLabel(item: { defaultBudgetCode?: string; defaultBudgetName?: string }) {
  if (!item.defaultBudgetCode) return '';
  return item.defaultBudgetName || t('master.item.budgetOutsideYear', { code: item.defaultBudgetCode });
}

/**
 * Bind an item to a budget for the active company (persists via re-enable with the plan code).
 * The account follows from the budget, so nothing here sends one.
 *
 * A refused save is REPORTED. The row simply reloads as it was, so without this the screen shows
 * the old value again and the user reads it as "it saved and then lost it" — which is exactly how
 * a server that does not know this field yet appears.
 */
async function setItemBudget(id: string, code: string | null) {
  const failure = await md.setItemEnabled(id, true, code ?? '');
  if (failure) fb.error(failure);
}

/** Enable/disable an item here, reporting a refusal for the same reason. */
async function setItemActive(id: string, on: boolean) {
  const failure = await md.setItemEnabled(id, on);
  if (failure) fb.error(failure);
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
              <!-- Per-company budget. The row stores the budget's plan code; the account the item
                   posts to is stamped from that budget server-side. -->
              <Column :header="$t('master.item.columns.budget')" style="min-width:20rem">
                <template #body="{ data }">
                  <Select
                    v-if="canManage() && data.enabled"
                    :model-value="data.defaultBudgetCode ?? null"
                    :options="budgetChoicesFor(data.defaultBudgetCode)"
                    optionLabel="name"
                    optionValue="code"
                    :filterFields="['name', 'code', 'departmentName', 'glAccount']"
                    :placeholder="$t('master.item.budgetPlaceholder')"
                    :filterPlaceholder="$t('master.item.budgetFilterPlaceholder')"
                    :emptyMessage="$t('master.item.budgetEmpty')"
                    showClear
                    filter
                    size="small"
                    fluid
                    @update:model-value="(v) => setItemBudget(data.id, v as string | null)"
                  >
                    <!-- Closed, the field shows the budget it is bound to, by name — the account
                         beside it, since accounting reads the books by that. -->
                    <template #value="{ value, placeholder }">
                      <span v-if="!value" class="text-muted-color">{{ placeholder }}</span>
                      <span v-else class="flex items-center gap-2 truncate">
                        <span class="truncate">{{ budgetLabel(data) || value }}</span>
                        <span v-if="data.defaultGlAccount" class="text-xs text-muted-color">{{ data.defaultGlAccount }}</span>
                      </span>
                    </template>
                    <!-- One budget per row: its name, the department that holds it, and its plan
                         code with the account it posts to. Budgets sharing an account stay apart. -->
                    <template #option="{ option }">
                      <div class="flex w-full items-start justify-between gap-3">
                        <div class="flex flex-col">
                          <span>{{ option.name }}</span>
                          <span v-if="option.departmentName" class="text-xs text-muted-color">{{ option.departmentName }}</span>
                        </div>
                        <div class="flex flex-col items-end">
                          <span class="text-xs">{{ option.code }}</span>
                          <span v-if="option.glAccount" class="text-xs text-muted-color">{{ option.glAccount }}</span>
                        </div>
                      </div>
                    </template>
                  </Select>
                  <span v-else-if="data.defaultBudgetCode">
                    {{ budgetLabel(data) }}
                    <span class="text-xs text-muted-color">({{ data.defaultBudgetCode }})</span>
                  </span>
                  <!-- Enabled before an item could name a budget: it carries only the account it
                       posts to, and keeps posting to it until someone binds a budget. -->
                  <span v-else-if="data.defaultGlAccount" class="text-muted-color">
                    {{ $t('master.item.budgetUnbound', { code: data.defaultGlAccount }) }}
                  </span>
                  <span v-else>—</span>
                </template>
              </Column>
              <Column :header="$t('master.item.columns.enabled')">
                <template #body="{ data }">
                  <ToggleSwitch :modelValue="data.enabled" :disabled="!canManage()" @update:modelValue="(v) => setItemActive(data.id, v)" />
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
