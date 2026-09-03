<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BankOption from '@/components/BankOption.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import PageHeader from '@/components/PageHeader.vue';
import { useFeedback } from '../../composables/useFeedback';
import { useAccountsStore } from '../../stores/accounts';
import { useAuthStore } from '../../stores/auth';
import { useBankAccountsStore } from '../../stores/bankAccounts';
import { useCurrencyStore } from '../../stores/currency';
import { bankDisplay, bankOptions } from '../../shared/banks';
import type { BankAccountRow } from '../../api/bankAccounts';

/**
 * The company's OWN accounts at a bank — not the vendors' payee accounts.
 *
 * Each NAMES the GL account whose balance represents it: the chart of accounts is configuration the
 * company already owns, and a bank account is a fact about the outside world. Getting that mapping
 * wrong misstates cash, which is why creating one is a separate permission from reading them.
 */
const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const store = useBankAccountsStore();
const accounts = useAccountsStore();
const currency = useCurrencyStore();

const canManage = computed(() => auth.can('BANK_ACCOUNT_MANAGE'));
const dialog = ref(false);
const form = ref({ name: '', bankName: '', accountNo: '', currencyCode: '', glAccountId: '' });

// The bank is picked, never typed: this value is shown as the bank on this screen and on
// reconciliation, and typed text makes one bank read as several. `form.bankName` is passed so a
// value stored before this catalog existed stays selectable instead of rendering blank.
const bankChoices = computed(() => bankOptions('name', form.value.bankName));
const accountOptions = computed(() =>
  accounts.selectable.map((a) => ({ label: `${a.code} — ${a.name}`, value: a.id })),
);
const currencyOptions = computed(() =>
  currency.selectableCurrencies.map((c) => ({ label: c.code, value: c.code })),
);
const ready = computed(
  () =>
    !!form.value.name.trim() &&
    !!form.value.bankName.trim() &&
    !!form.value.accountNo.trim() &&
    !!form.value.currencyCode &&
    !!form.value.glAccountId,
);

async function submit() {
  if (!ready.value) return;
  const ok = await store.create({ ...form.value });
  if (ok) {
    dialog.value = false;
    fb.success(t('gl.bankAccounts.created'));
  } else fb.error(store.error);
}

async function deactivate(row: BankAccountRow) {
  const ok = await store.deactivate(row.id);
  if (ok) fb.success(t('gl.bankAccounts.deactivated'));
  else fb.error(store.error);
}

onMounted(() => {
  store.load();
  if (canManage.value) accounts.loadSelectable();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.bankAccounts.title')" :subtitle="$t('gl.bankAccounts.subtitle')">
      <template #actions>
        <Button
          v-if="canManage"
          :label="$t('gl.bankAccounts.create')"
          icon="pi pi-plus"
          data-testid="create-bank-account"
          @click="form = { name: '', bankName: '', accountNo: '', currencyCode: '', glAccountId: '' }; dialog = true"
        />
      </template>
    </PageHeader>

    <ErrorState v-if="store.error && !store.accounts.length" :message="store.error" @retry="store.load()" />

    <div v-else class="card">
      <DataTable :value="store.accounts" dataKey="id" class="text-sm" :loading="store.loading">
        <Column field="name" :header="$t('common.name')" />
        <Column :header="$t('gl.bankAccounts.columns.bank')">
          <!-- The logo is how a bank is recognised at a glance; the name alone is a lookup. -->
          <template #body="{ data }"><BankOption v-bind="bankDisplay('name', data.bankName)" /></template>
        </Column>
        <Column field="accountNo" :header="$t('gl.bankAccounts.columns.accountNo')" />
        <Column :header="$t('gl.bankAccounts.columns.currency')">
          <template #body="{ data }">{{ data.currency.code }}</template>
        </Column>
        <Column :header="$t('gl.bankAccounts.columns.glAccount')">
          <template #body="{ data }">
            <span class="font-medium">{{ data.glAccount.code }}</span>
            <span class="text-muted-color"> — {{ data.glAccount.name }}</span>
          </template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex justify-end gap-2">
              <Tag v-if="!data.isActive" :value="$t('gl.bankAccounts.inactive')" severity="secondary" />
              <!-- Deactivate, never delete: payments point at these rows. -->
              <Button
                v-if="canManage && data.isActive"
                :label="$t('gl.bankAccounts.deactivate')"
                size="small"
                severity="danger"
                text
                data-testid="deactivate-bank-account"
                @click="deactivate(data)"
              />
            </div>
          </template>
        </Column>
        <template #empty>
          <EmptyState icon="pi pi-building-columns" :title="$t('gl.bankAccounts.empty')" />
        </template>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" modal :header="$t('gl.bankAccounts.create')" class="w-full max-w-md">
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('common.name') }}
          <InputText v-model="form.name" data-testid="ba-name" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bankAccounts.columns.bank') }}
          <Select
            v-model="form.bankName"
            :options="bankChoices"
            optionLabel="label"
            optionValue="value"
            :placeholder="$t('gl.bankAccounts.pickBank')"
            data-testid="ba-bank"
          >
            <template #value="{ value, placeholder }">
              <BankOption v-if="value" v-bind="bankChoices.find((o) => o.value === value) ?? { label: value }" />
              <span v-else class="text-muted-color">{{ placeholder }}</span>
            </template>
            <template #option="{ option }"><BankOption v-bind="option" /></template>
          </Select>
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bankAccounts.columns.accountNo') }}
          <InputText v-model="form.accountNo" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bankAccounts.columns.currency') }}
          <Select v-model="form.currencyCode" :options="currencyOptions" optionLabel="label" optionValue="value" />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.bankAccounts.columns.glAccount') }}
          <Select v-model="form.glAccountId" :options="accountOptions" optionLabel="label" optionValue="value" filter />
        </label>
      </div>
      <template #footer>
        <Button :label="$t('common.cancel')" text @click="dialog = false" />
        <Button
          :label="$t('common.save')"
          :disabled="!ready"
          :loading="store.working"
          data-testid="save-bank-account"
          @click="submit"
        />
      </template>
    </Dialog>
  </div>
</template>
