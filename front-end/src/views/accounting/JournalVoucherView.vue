<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import DatePicker from 'primevue/datepicker';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import { useAccountsStore } from '../../stores/accounts';
import { useAuthStore } from '../../stores/auth';
import { useJournalStore } from '../../stores/journal';
import { sumAmounts } from '../../utils/money';

/**
 * The entry no event produces: depreciation, an accrual, prepaid amortisation, payroll, opening
 * balances, the correction of a wrong automatic posting.
 *
 * `GL_JV_POST` is, in the backend's own words, the largest privilege in the system — the only way a
 * person writes the ledger directly, guarded by a permission rather than by an approval route. Two
 * properties follow, and they are the reason this is a route rather than a dialog:
 *
 *  - the operator sees the two totals converge WHILE typing, instead of learning about a 0.02
 *    discrepancy from a toast after submitting; and
 *  - the same voucher submitted twice is one voucher, because the form carries its own id.
 *
 * It SUBMITS for approval; it does not post. A second person approves, and only then does anything
 * reach the ledger — the control `GL_JV_POST` documented as missing.
 */
const { t } = useI18n();
const { fmtBase } = useCurrencyFormat();
const fb = useFeedback();
const router = useRouter();
const auth = useAuthStore();
const store = useJournalStore();
const accounts = useAccountsStore();

/** Listing accounts needs COA_VIEW, which GL_JV_POST does not imply. The picker is the upgrade. */
const canPickAccounts = computed(() => auth.can('COA_VIEW'));

interface LineDraft {
  key: number;
  accountCode: string;
  debit: string;
  credit: string;
  memo: string;
}

let nextKey = 0;
const emptyLine = (): LineDraft => ({ key: nextKey++, accountCode: '', debit: '0', credit: '0', memo: '' });

const entryDate = ref<Date | null>(new Date());
const memo = ref('');
const lines = ref<LineDraft[]>([emptyLine(), emptyLine()]);

/**
 * The voucher's identity, sent with every submit so a double-click or a retry over a slow
 * connection resolves to ONE entry. Re-minted only after a successful post: keeping it through a
 * failure means correcting a typo and resubmitting still cannot produce two entries.
 */
const voucherId = ref(crypto.randomUUID());

onMounted(() => {
  if (canPickAccounts.value) accounts.loadSelectable();
});

const accountOptions = computed(() =>
  accounts.selectable.map((a) => ({ label: `${a.code} — ${a.name}`, value: a.code })),
);

// Decimal strings throughout. `0.1 + 0.2` in binary floating point is exactly the class of
// difference this screen exists to catch, so the totals never touch a JS number.
const debitTotal = computed(() => sumAmounts(lines.value.map((l) => l.debit)));
const creditTotal = computed(() => sumAmounts(lines.value.map((l) => l.credit)));

const isPositive = (v: string) => sumAmounts([v]) !== '0';
/** The server's rule — a line carries exactly one non-zero side — shown while typing. */
const lineIsTwoSided = (l: LineDraft) => isPositive(l.debit) && isPositive(l.credit);

const balanced = computed(() => debitTotal.value === creditTotal.value);
/** Equal is not enough: a form of zeroes balances perfectly and says nothing. */
const nonZero = computed(() => debitTotal.value !== '0');
const twoSidedLines = computed(() => lines.value.filter(lineIsTwoSided));
const hasAccounts = computed(() => lines.value.every((l) => l.accountCode.trim()));

const canSubmit = computed(
  () =>
    balanced.value &&
    nonZero.value &&
    !twoSidedLines.value.length &&
    hasAccounts.value &&
    !!entryDate.value &&
    !!memo.value.trim(),
);

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addLine() {
  lines.value.push(emptyLine());
}

/** Two is the DTO's minimum: one line is a mistake caught before the ledger sees it. */
function removeLine(key: number) {
  if (lines.value.length <= 2) return;
  lines.value = lines.value.filter((l) => l.key !== key);
}

async function submit() {
  if (!canSubmit.value || !entryDate.value) return;
  const ok = await store.submitVoucher({
    id: voucherId.value,
    entryDate: toIsoDate(entryDate.value),
    memo: memo.value.trim(),
    lines: lines.value.map((l) => ({
      accountCode: l.accountCode.trim(),
      debit: l.debit || '0',
      credit: l.credit || '0',
      memo: l.memo.trim() || undefined,
    })),
  });
  if (ok) {
    // A submitted voucher is finished with as far as this form is concerned; the next one is a
    // different voucher and gets its own id.
    voucherId.value = crypto.randomUUID();
    fb.success(t('gl.voucher.submitted'));
    router.push({ name: 'journal' });
  } else {
    // The resolver's refusal names the account and the reason. Shown as returned.
    fb.error(store.error);
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('gl.voucher.title')" :subtitle="$t('gl.voucher.subtitle')" />

    <div class="card flex flex-col gap-4">
      <div class="flex flex-wrap gap-3">
        <label class="flex flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.voucher.fields.entryDate') }}
          <DatePicker v-model="entryDate" dateFormat="yy-mm-dd" showIcon />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-sm text-muted-color">
          {{ $t('gl.voucher.fields.memo') }}
          <InputText v-model="memo" data-testid="voucher-memo" />
        </label>
      </div>

      <DataTable :value="lines" dataKey="key" class="text-sm">
        <Column :header="$t('gl.voucher.fields.account')">
          <template #body="{ data }">
            <div class="flex flex-col gap-1">
              <!--
                The code is a free string the server resolves, so it is always typeable. The picker
                is offered only when COA_VIEW is held — nobody is blocked, and nobody is shown a
                selector that cannot be filled.
              -->
              <InputText v-model="data.accountCode" class="w-full" :placeholder="$t('gl.voucher.fields.accountCode')" />
              <Select
                v-if="canPickAccounts"
                :modelValue="data.accountCode"
                :options="accountOptions"
                optionLabel="label"
                optionValue="value"
                filter
                :placeholder="$t('gl.voucher.fields.pickAccount')"
                @update:modelValue="(v: string) => (data.accountCode = v)"
              />
            </div>
          </template>
        </Column>
        <Column :header="$t('gl.journal.columns.debit')">
          <template #body="{ data }"><InputText v-model="data.debit" class="w-28 text-right" /></template>
        </Column>
        <Column :header="$t('gl.journal.columns.credit')">
          <template #body="{ data }"><InputText v-model="data.credit" class="w-28 text-right" /></template>
        </Column>
        <Column :header="$t('gl.journal.columns.memo')">
          <template #body="{ data }"><InputText v-model="data.memo" class="w-full" /></template>
        </Column>
        <Column>
          <template #body="{ data }">
            <div class="flex items-center justify-end gap-2">
              <i
                v-if="lineIsTwoSided(data)"
                class="pi pi-exclamation-triangle text-orange-500"
                :title="$t('gl.voucher.oneSidedOnly')"
                data-testid="line-two-sided"
              />
              <Button
                icon="pi pi-trash"
                text
                severity="danger"
                :disabled="lines.length <= 2"
                :aria-label="$t('common.delete')"
                data-testid="remove-line"
                @click="removeLine(data.key)"
              />
            </div>
          </template>
        </Column>
      </DataTable>

      <div>
        <Button
          :label="$t('gl.voucher.addLine')"
          icon="pi pi-plus"
          text
          size="small"
          data-testid="add-line"
          @click="addLine"
        />
      </div>

      <!-- The two totals, and the difference while there is one. -->
      <div class="flex flex-col items-end gap-1 text-sm">
        <div class="flex gap-6 tabular-nums">
          <!-- Compared as bare decimals above; shown at the base currency's decimal_places. -->
          <span>{{ $t('gl.journal.columns.debit') }}: <b data-testid="debit-total">{{ fmtBase(debitTotal) }}</b></span>
          <span>{{ $t('gl.journal.columns.credit') }}: <b data-testid="credit-total">{{ fmtBase(creditTotal) }}</b></span>
        </div>
      </div>

      <Message v-if="!balanced" severity="warn" size="small" data-testid="not-balanced">
        {{ $t('gl.voucher.notBalanced') }}
      </Message>
      <Message v-else-if="!nonZero" severity="warn" size="small" data-testid="all-zero">
        {{ $t('gl.voucher.allZero') }}
      </Message>
      <Message v-if="twoSidedLines.length" severity="warn" size="small" data-testid="two-sided-warning">
        {{ $t('gl.voucher.oneSidedOnly') }}
      </Message>

      <div class="flex justify-end gap-2">
        <Button :label="$t('common.cancel')" text @click="router.push({ name: 'journal' })" />
        <Button
          :label="$t('gl.voucher.submit')"
          :disabled="!canSubmit"
          :loading="store.working"
          data-testid="post-voucher"
          @click="submit"
        />
      </div>
    </div>
  </div>
</template>
