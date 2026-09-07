<script setup lang="ts">
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { z } from 'zod';
import AppDataTable from '@/components/AppDataTable.vue';
import BankOption from '@/components/BankOption.vue';
import EmptyState from '@/components/EmptyState.vue';
import { bankLogoFor, bankOptions } from '../../shared/banks';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyStore } from '../../stores/currency';
import { useFeedback } from '../../composables/useFeedback';
import {
  masterDataApi,
  type VendorBankAccount,
  type VendorBankAccountHistoryEntry,
} from '../../api/masterData';
import type { FormSubmitEvent } from '@primevue/forms';

/**
 * A vendor's payee bank accounts.
 *
 * This is the surface the server's separate `VENDOR_BANK_MANAGE` permission exists to protect:
 * redirecting a payee account needs no approval, leaves no document, and pays out on the next run.
 * Every mutation therefore gates on that code alone — never on `MASTER_MANAGE`, which is only the
 * right to fix a typo in a vendor's name.
 */
const props = defineProps<{ vendorId: string; vendorName: string }>();
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const auth = useAuthStore();
const currency = useCurrencyStore();
const fb = useFeedback();

const accounts = ref<VendorBankAccount[]>([]);
const loading = ref(false);
const busy = ref(false);

/** Gates every mutation. NOT MASTER_MANAGE — that is the whole point of the separate code. */
const canManageBank = computed(() => auth.can('VENDOR_BANK_MANAGE'));

const dialog = ref<{ open: boolean; id?: string; initial: Record<string, unknown> }>({
  open: false,
  initial: {},
});
/**
 * The bank is picked, never typed: `(vendor_id, bank_code, account_no)` is unique, so a spelling
 * variant defeats the duplicate check, and `payment_batch_line.bank_code` snapshots this string for
 * the bank to read. Rebuilt when the dialog opens so an account stored before this catalog existed
 * keeps its own value as an option — otherwise a <Select> shows it blank and saving would silently
 * change the bank of an account opened to fix a digit.
 */
const bankChoices = ref(bankOptions('code'));
const confirming = ref<VendorBankAccount | null>(null);
const history = ref<{ open: boolean; account?: VendorBankAccount; entries: VendorBankAccountHistoryEntry[] }>({
  open: false,
  entries: [],
});

// Mirrors CreateVendorBankAccountDto so the client refuses exactly what the server would.
const schema = computed(() =>
  z.object({
    bankCode: z.string().min(1, t('validation.required')).max(255),
    // A string, always: as a number `000123` becomes `123`, a different account.
    accountNo: z.string().min(1, t('validation.required')).max(255),
    accountName: z.string().min(1, t('validation.required')).max(255),
    currency: z.string().max(3).optional().or(z.literal('')),
  }),
);
const resolver = computed(() => zodResolver(schema.value));

async function load() {
  loading.value = true;
  try {
    accounts.value = await masterDataApi.vendorBankAccounts.list(props.vendorId);
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    loading.value = false;
  }
}
watch(() => props.vendorId, load, { immediate: true });

// The currency is picked from the active list, like every other currency field in the app. The
// read is authorized for VENDOR_BANK_MANAGE precisely so this picker is not empty for the role
// that manages these accounts; no-op once loaded.
if (!currency.selectableCurrencies.length) void currency.loadSelectableCurrencies();

function newAccount() {
  // No `current` — an unrecognised value is never offered where a bank could be chosen fresh.
  bankChoices.value = bankOptions('code');
  dialog.value = { open: true, id: undefined, initial: { bankCode: '', accountNo: '', accountName: '', currency: '' } };
}
function editAccount(a: VendorBankAccount) {
  bankChoices.value = bankOptions('code', a.bankCode);
  dialog.value = {
    open: true,
    id: a.id,
    initial: { bankCode: a.bankCode, accountNo: a.accountNo, accountName: a.accountName, currency: a.currency ?? '' },
  };
}

async function submit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const v = e.values as { bankCode: string; accountNo: string; accountName: string; currency?: string };
  const dto = { ...v, currency: v.currency || undefined };
  busy.value = true;
  try {
    if (dialog.value.id) await masterDataApi.vendorBankAccounts.update(props.vendorId, dialog.value.id, dto);
    else await masterDataApi.vendorBankAccounts.create(props.vendorId, dto);
    dialog.value.open = false;
    await load();
    emit('changed');
    fb.success(t('feedback.done'));
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // 409 = this vendor already has that number at that bank. Naming the clash is the difference
    // between "fix it" and "try again and hope".
    fb.error(
      status === 409
        ? t('master.vendor.bank.duplicate', { accountNo: v.accountNo, bankCode: v.bankCode })
        : t('feedback.error'),
    );
  } finally {
    busy.value = false;
  }
}

async function makePrimary(a: VendorBankAccount) {
  busy.value = true;
  try {
    // Its own action, not a form field: the server demotes the previous primary in the same
    // transaction, and a checkbox would imply two could be primary between saves.
    await masterDataApi.vendorBankAccounts.setPrimary(props.vendorId, a.id);
    await load();
    emit('changed');
    fb.success(t('feedback.done'));
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

async function deactivate(a: VendorBankAccount) {
  busy.value = true;
  try {
    await masterDataApi.vendorBankAccounts.deactivate(props.vendorId, a.id);
    confirming.value = null;
    await load();
    emit('changed');
    fb.success(t('feedback.done'));
  } catch {
    fb.error(t('feedback.error'));
  } finally {
    busy.value = false;
  }
}

async function openHistory(a: VendorBankAccount) {
  history.value = { open: true, account: a, entries: [] };
  try {
    history.value.entries = await masterDataApi.vendorBankAccounts.history(props.vendorId, a.id);
  } catch {
    fb.error(t('feedback.error'));
  }
}

/** Render one side of a change compactly — the account number is what matters. */
function side(s: VendorBankAccountHistoryEntry['before']): string {
  return s ? `${s.bankCode} · ${s.accountNo} — ${s.accountName}` : '—';
}

function formatWhen(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <div class="text-sm font-medium">{{ $t('master.vendor.bank.title', { vendor: vendorName }) }}</div>
      <div class="flex-1" />
      <Button
        v-if="canManageBank"
        :label="$t('master.vendor.bank.new')"
        icon="pi pi-plus"
        size="small"
        :disabled="busy"
        data-testid="add-account"
        @click="newAccount"
      />
    </div>

    <!-- Accounts are shared across the group, like the vendor's own name — not per company. -->
    <Message severity="secondary" :closable="false" class="text-xs">
      {{ $t('master.vendor.bank.groupWide') }}
    </Message>

    <AppDataTable :value="accounts" :total="accounts.length" :loading="loading" dataKey="id" data-testid="account-table">
      <Column :header="$t('master.vendor.bank.account')">
        <template #body="{ data }">
          <!-- Logo for recognition, text for the identifier: the number is what is checked, so it
               and the account name stack beside the logo rather than under it. The number is text,
               never a number and never right-aligned — a leading zero is part of the identifier. -->
          <BankOption
            :label="data.bankCode"
            :logo="bankLogoFor('code', data.bankCode)"
            :sublabel="data.accountName"
            :class="{ 'opacity-50': !data.isActive }"
          >
            <span class="inline-flex items-center gap-2 text-sm">
              {{ data.bankCode }} · {{ data.accountNo }}
              <Tag v-if="data.isPrimary" :value="$t('master.vendor.bank.primary')" severity="success" data-testid="primary-tag" />
              <Tag v-if="!data.isActive" :value="$t('master.vendor.bank.inactive')" severity="secondary" data-testid="inactive-tag" />
            </span>
          </BankOption>
        </template>
      </Column>
      <Column field="currency" :header="$t('master.vendor.bank.currency')">
        <template #body="{ data }">
          <span class="text-sm">{{ data.currency ?? '—' }}</span>
        </template>
      </Column>
      <Column :header="$t('common.actions')" class="w-64">
        <template #body="{ data }">
          <div v-if="canManageBank" class="flex items-center gap-1">
            <Button icon="pi pi-pencil" text size="small" :disabled="busy" :aria-label="$t('common.edit')" data-testid="edit-account" @click="editAccount(data)" />
            <!-- The server refuses to promote an inactive account, so the UI must not offer it. -->
            <Button
              v-if="!data.isPrimary && data.isActive"
              icon="pi pi-star"
              text
              size="small"
              :disabled="busy"
              v-tooltip.top="$t('master.vendor.bank.makePrimary')"
              :aria-label="$t('master.vendor.bank.makePrimary')"
              data-testid="make-primary"
              @click="makePrimary(data)"
            />
            <!-- Deactivate, never delete: a document or exported batch naming it must stay legible. -->
            <Button
              v-if="data.isActive"
              icon="pi pi-ban"
              text
              size="small"
              severity="danger"
              :disabled="busy"
              v-tooltip.top="$t('master.vendor.bank.deactivate')"
              :aria-label="$t('master.vendor.bank.deactivate')"
              data-testid="deactivate-account"
              @click="confirming = data"
            />
            <Button icon="pi pi-history" text size="small" :disabled="busy" v-tooltip.top="$t('master.vendor.bank.history')" :aria-label="$t('master.vendor.bank.history')" data-testid="open-history" @click="openHistory(data)" />
          </div>
        </template>
      </Column>
      <template #empty>
        <!-- Not a decorative empty state: DISB is requires_payee, so this vendor's disbursements
             cannot be submitted at all until an account exists. -->
        <EmptyState icon="pi pi-credit-card" :title="$t('master.vendor.bank.empty')" :message="$t('master.vendor.bank.emptyHint')" />
      </template>
    </AppDataTable>

    <!-- Deactivate confirmation -->
    <Dialog :visible="!!confirming" @update:visible="(v: boolean) => { if (!v) confirming = null; }" :header="$t('master.vendor.bank.deactivate')" modal class="w-96" data-testid="deactivate-dialog">
      <div v-if="confirming" class="flex flex-col gap-3">
        <span class="text-sm">{{ $t('master.vendor.bank.deactivateBody', { accountNo: confirming.accountNo }) }}</span>
        <!-- The person deactivating is not the person who discovers the payee picker is empty. -->
        <Message v-if="confirming.isPrimary" severity="warn" :closable="false" data-testid="primary-warning">
          {{ $t('master.vendor.bank.deactivatePrimaryWarning') }}
        </Message>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text :disabled="busy" @click="confirming = null" />
          <Button :label="$t('common.confirm')" severity="danger" :disabled="busy" data-testid="deactivate-confirm" @click="deactivate(confirming)" />
        </div>
      </div>
    </Dialog>

    <!-- Add / edit -->
    <Dialog v-model:visible="dialog.open" :header="dialog.id ? $t('master.vendor.bank.edit') : $t('master.vendor.bank.new')" modal class="w-96" data-testid="account-dialog">
      <Form v-slot="$form" :resolver="resolver" :initialValues="dialog.initial" class="flex flex-col gap-3" @submit="submit">
        <FormField name="bankCode" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.vendor.bank.bankCode') }}</label>
          <Select
            :options="bankChoices"
            optionLabel="label"
            optionValue="value"
            :placeholder="$t('master.vendor.bank.pickBank')"
            data-testid="bank-select"
          >
            <template #value="{ value, placeholder }">
              <BankOption v-if="value" v-bind="bankChoices.find((o) => o.value === value) ?? { label: value }" />
              <span v-else class="text-muted-color">{{ placeholder }}</span>
            </template>
            <template #option="{ option }"><BankOption v-bind="option" /></template>
          </Select>
          <Message v-if="$form.bankCode?.invalid" severity="error" size="small" variant="simple">{{ $form.bankCode.error.message }}</Message>
        </FormField>
        <FormField name="accountNo" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.vendor.bank.accountNo') }}</label>
          <!-- InputText, never InputNumber: 000123 must stay 000123. -->
          <InputText data-testid="account-no-input" />
          <Message v-if="$form.accountNo?.invalid" severity="error" size="small" variant="simple">{{ $form.accountNo.error.message }}</Message>
        </FormField>
        <FormField name="accountName" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.vendor.bank.accountName') }}</label>
          <InputText />
          <Message v-if="$form.accountName?.invalid" severity="error" size="small" variant="simple">{{ $form.accountName.error.message }}</Message>
        </FormField>
        <FormField name="currency" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('master.vendor.bank.currency') }}</label>
          <!-- Optional, so it must be clearable: an account with no currency is a valid account. -->
          <Select
            :options="currency.selectableCurrencies"
            optionLabel="code"
            optionValue="code"
            showClear
            :placeholder="$t('master.vendor.bank.pickCurrency')"
            data-testid="currency-select"
          />
        </FormField>
        <!-- No primary field here on purpose — promoting is its own action. -->
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text :disabled="busy" @click="dialog.open = false" />
          <Button type="submit" :label="$t('common.save')" :disabled="busy" />
        </div>
      </Form>
    </Dialog>

    <!-- History -->
    <Dialog v-model:visible="history.open" :header="$t('master.vendor.bank.history')" modal class="w-[36rem]" data-testid="history-dialog">
      <div class="flex flex-col gap-2">
        <!-- Beside the account, not in an admin console: an edit-pay-revert is found here while it
             is still reversible, and being visible is itself the deterrent. -->
        <div v-if="!history.entries.length" class="text-sm text-muted-color">{{ $t('master.vendor.bank.historyEmpty') }}</div>
        <div v-for="e in history.entries" :key="e.id" class="flex flex-col gap-0.5 border-b border-surface-200 pb-2 dark:border-surface-700" data-testid="history-entry">
          <div class="flex items-center gap-2 text-sm">
            <Tag :value="$t(`master.vendor.bank.actions.${e.action}`)" severity="secondary" />
            <span class="text-color">{{ e.actor.username }}</span>
            <span class="text-xs text-muted-color">{{ formatWhen(e.actedAt) }}</span>
          </div>
          <div v-if="e.before || e.after" class="text-xs text-muted-color">
            {{ side(e.before) }} → {{ side(e.after) }}
          </div>
        </div>
      </div>
    </Dialog>
  </div>
</template>
