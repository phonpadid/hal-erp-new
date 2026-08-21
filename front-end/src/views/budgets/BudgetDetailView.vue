<script setup lang="ts">
import { budgetTxnDirection } from '@erp/shared';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import SelectButton from 'primevue/selectbutton';
import Textarea from 'primevue/textarea';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import { budgetsApi } from '../../api/budgets';
import type { MovementDocTypes } from '../../api/budgets';
import { useBudgetsStore } from '../../stores/budgets';
import { useAuthStore } from '../../stores/auth';
import { useFeedback } from '../../composables/useFeedback';
import { useBreadcrumb } from '../../composables/useBreadcrumb';
import { formatAmount } from '../../utils/money';
import { formatDate } from '../../utils/date';
import BudgetTransferDialog from './BudgetTransferDialog.vue';
import BudgetWaterfallChart from './BudgetWaterfallChart.vue';

const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const budgets = useBudgetsStore();
const auth = useAuthStore();
const id = route.params.id as string;

const b = computed(() => budgets.breakdown);

// Governing control points, tightest first. The one with the least available is the ceiling a
// submit hits first, so it is the number a user needs to see before the budget's own available.
// Compared as decimal strings via Number() only for ORDERING — no amount is ever displayed from
// a JS number; formatAmount always receives the original string.
const sortedControlPoints = computed(() =>
  [...budgets.controlPoints].sort((x, y) => Number(x.available) - Number(y.available)),
);
const bindingControlPointId = computed(() => sortedControlPoints.value[0]?.id ?? null);

// Breadcrumb leaf: Budgets (route meta) → this budget's name.
useBreadcrumb(() => (budgets.current?.budgetName ? [{ label: budgets.current.budgetName }] : []));

// Ledger direction: `amount` is always a positive magnitude and the txn type carries the sign.
// THREE directions, not two — read from the shared classification the balance computation uses, so
// the ledger and the summary above it cannot tell different stories. A two-way split lived here
// once and gave ACTUAL its direction by default, drawing a settlement as a withdrawal: the column
// summed to 270,000 beside a budget that had fallen by 185,000, double-counting every settled
// document.
const ledgerDirection = (txnType: string) => budgetTxnDirection(txnType);

/** Presentation per direction. CONVERTS is its own treatment, not the absence of the other two:
 *  a blank where every other row shows a sign reads as missing data, and the settlement is not
 *  missing — it moved committed money to spent without touching the balance. */
const LEDGER_STYLE = {
  ADDS: { sign: '+', icon: 'pi-arrow-down-left', cls: 'text-green-600 dark:text-green-400' },
  SUBTRACTS: { sign: '−', icon: 'pi-arrow-up-right', cls: 'text-red-600 dark:text-red-400' },
  CONVERTS: { sign: '', icon: 'pi-arrow-right-arrow-left', cls: 'text-muted-color' },
} as const;
const ledgerStyle = (txnType: string) => LEDGER_STYLE[ledgerDirection(txnType)];

// Budget adjustment — creates an approvable document; the balance changes only on
// full approval. Validation mirrors the backend CreateAdjustmentDto (positive amount,
// non-empty reason); amount stays a string (never a JS number) end to end.
const adjustOpen = ref(false);
const adjustBusy = ref(false);
// InputNumber binds a JS number for the editor only; the wire value is stringified on
// submit so money never crosses the wire as a number (invariant).
const adjustModel = ref<{ direction: 'INCREASE' | 'DECREASE'; amount: number | null; reason: string; documentTypeId: string | null }>({
  direction: 'INCREASE',
  amount: null,
  reason: '',
  documentTypeId: null,
});
const adjustErr = ref<Record<string, string>>({});
const directionOptions = computed(() => [
  { label: t('budgets.adjust.increase'), value: 'INCREASE' },
  { label: t('budgets.adjust.decrease'), value: 'DECREASE' },
]);

// Movement document types (grouped by operation) for the active company. Used to decide whether
// a dialog must prompt for a type (more than one configured) or proceed silently (zero or one).
const movementTypes = ref<MovementDocTypes>({ adjustIncrease: [], adjustDecrease: [], transfer: [] });
// Types matching the currently chosen adjustment direction.
const adjustTypeOptions = computed(() =>
  adjustModel.value.direction === 'INCREASE' ? movementTypes.value.adjustIncrease : movementTypes.value.adjustDecrease,
);
// Configured currency of this budget (company base currency), for the amount field.
const currency = computed(() => budgets.current?.fiscalYear?.company?.baseCurrency ?? null);
const currencyDecimals = computed<number>(() => currency.value?.decimalPlaces ?? 2);
const amountSuffix = computed(() => (currency.value?.code ? ` ${currency.value.code}` : undefined));

function openAdjust() {
  adjustErr.value = {};
  adjustModel.value = { direction: 'INCREASE', amount: null, reason: '', documentTypeId: null };
  adjustOpen.value = true;
}
async function submitAdjust() {
  const errs: Record<string, string> = {};
  if (!(typeof adjustModel.value.amount === 'number' && adjustModel.value.amount > 0)) {
    errs.amount = t('budgets.adjust.amountError');
  }
  if (!adjustModel.value.reason.trim()) errs.reason = t('budgets.adjust.reasonError');
  // A type must be chosen only when the direction has more than one configured type.
  if (adjustTypeOptions.value.length > 1 && !adjustModel.value.documentTypeId) {
    errs.documentTypeId = t('budgets.adjust.typeError');
  }
  adjustErr.value = errs;
  if (Object.keys(errs).length) return;
  adjustBusy.value = true;
  try {
    const { documentId } = await budgetsApi.createAdjustment(id, {
      direction: adjustModel.value.direction,
      amount: String(adjustModel.value.amount),
      reason: adjustModel.value.reason.trim(),
      // Send the chosen type only when a choice was required; a single type resolves server-side.
      ...(adjustModel.value.documentTypeId ? { documentTypeId: adjustModel.value.documentTypeId } : {}),
    });
    adjustOpen.value = false;
    fb.success(t('feedback.created'));
    await router.push({ name: 'document-detail', params: { id: documentId } });
  } catch (e: any) {
    fb.error(e, t('budgets.adjust.failed'));
  } finally {
    adjustBusy.value = false;
  }
}

// Budget transfer — opens a dialog to raise an approvable transfer document. The client
// never moves money; balances change only on full approval.
const transferOpen = ref(false);
// Source passed to the dialog: the current budget plus its derived available balance.
const transferSource = computed(() => ({
  id,
  glAccount: budgets.current?.glAccount,
  budgetName: budgets.current?.budgetName,
  amountTotal: budgets.current?.amountTotal,
  status: budgets.current?.status,
  fiscalYear: budgets.current?.fiscalYear,
  available: b.value?.available,
}));
function onTransferred(documentId: string) {
  router.push({ name: 'document-detail', params: { id: documentId } });
}

// total → +adjust → ±transfer → −reserved + released = available.
// `actual` is deliberately absent from this chain: it converts money the RESERVE already took
// out of the budget into money actually spent, so charging it again would double-count the
// document. It is shown below the total as an informational "of which actually spent".
const rows = computed(() =>
  b.value
    ? [
        { key: 'amountTotal', value: b.value.amountTotal, sign: '' },
        { key: 'adjustIncrease', value: b.value.adjustIncrease, sign: '+' },
        { key: 'adjustDecrease', value: b.value.adjustDecrease, sign: '−' },
        { key: 'transferIn', value: b.value.transferIn, sign: '+' },
        { key: 'transferOut', value: b.value.transferOut, sign: '−' },
        { key: 'reserved', value: b.value.reserved, sign: '−' },
        { key: 'released', value: b.value.released, sign: '+' },
      ]
    : [],
);

// Server-side ledger paging: DataTable emits 0-based page + rows; the store fetches
// that window (newest-first ordering is fixed on the server).
function onLedgerPage(e: { page: number; rows: number }) {
  budgets.loadLedger(id, e.page + 1, e.rows);
}

/**
 * In force, so money can move against it. Adjust and Transfer both act through `budget_txn`, and a
 * budget that has not been approved yet has nothing to move — offering either would present an
 * action that can only fail.
 */
const inForce = computed(() => budgets.current?.status === 'ACTIVE');

onMounted(async () => {
  await budgets.loadOne(id);
  // Only a budget that is not in force has a plan worth naming; for an ACTIVE one the plan is
  // history, and the ledger below already says where its money went.
  if (!inForce.value) await budgets.loadPlanForBudget(id);
  // Best-effort: the movement-type picker only appears when a user holds BUDGET_MANAGE and the
  // company has multiple types, so a failure here (e.g. no access) simply hides the picker.
  movementTypes.value = await budgetsApi.movementDocTypes().catch(() => movementTypes.value);
});
</script>

<template>
  <div v-if="budgets.current">
    <DetailHeader
      :title="budgets.current.budgetName ?? budgets.current.glAccount"
      :subtitle="$t('budgets.detail.glLabel', { account: budgets.current.glAccount })"
      :status="budgets.current.status ? $t('budgets.status.' + budgets.current.status) : undefined"
      :status-severity="budgets.current.status === 'ACTIVE' ? 'success' : 'secondary'"
    >
      <template #actions>
        <Button v-can="'BUDGET_MANAGE'" :label="$t('common.edit')" icon="pi pi-pencil" size="small" outlined @click="router.push({ name: 'budget-edit', params: { id } })" />
        <Button v-if="inForce" v-can="'BUDGET_MANAGE'" :label="$t('budgets.transfer.button')" icon="pi pi-arrow-right-arrow-left" size="small" outlined @click="transferOpen = true" />
        <Button v-if="inForce" v-can="'BUDGET_MANAGE'" :label="$t('budgets.adjust.button')" icon="pi pi-sliders-h" size="small" @click="openAdjust()" />
      </template>
    </DetailHeader>

    <ErrorState v-if="budgets.error" :message="budgets.error" @retry="budgets.loadOne(id)" />

    <!-- Why nothing can be spent against this budget, on the screen rather than inferred from an
         empty balance and a missing control point. -->
    <Message v-if="!inForce" severity="secondary" :closable="false" class="mb-4">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{{ $t('budgets.plan.notInForce') }}</span>
        <template v-if="budgets.currentPlan">
          <span class="text-muted-color">{{ $t('budgets.plan.heading') }}</span>
          <a
            class="text-primary cursor-pointer"
            @click="router.push({ name: 'document-detail', params: { id: budgets.currentPlan.id } })"
          >{{ budgets.currentPlan.docNo }}</a>
          <span class="text-muted-color">· {{ $t('documents.status.' + budgets.currentPlan.status) }}</span>
        </template>
      </div>
    </Message>

    <!-- Balance breakdown and waterfall chart share one row on large screens; the grid
         stacks them on narrow viewports. items-stretch so both cards share the same
         height (the taller one sets it), keeping the row visually even. -->
    <div v-if="b" class="grid grid-cols-1 lg:grid-cols-2 gap-x-4 items-stretch">
      <SectionCard :title="$t('budgets.balance.available')">
        <div>
          <div v-for="r in rows" :key="r.key" class="flex justify-between text-sm py-1">
            <span class="text-muted-color">{{ r.sign }} {{ $t('budgets.balance.' + r.key) }}</span>
            <span>{{ formatAmount(r.value, currencyDecimals) }}</span>
          </div>
          <div class="flex justify-between font-semibold border-t border-surface mt-2 pt-2">
            <span>{{ $t('budgets.balance.available') }}</span>
            <span>{{ formatAmount(b.available, currencyDecimals) }}</span>
          </div>
          <!-- Informational, not part of the sum above: how much of the reserved money is
               already spent (ACTUAL). The reserve is what reduced the balance. -->
          <div class="flex justify-between text-xs text-muted-color mt-2 pt-2 border-t border-surface">
            <span>{{ $t('budgets.balance.actualHint') }}</span>
            <span>{{ formatAmount(b.actual, currencyDecimals) }}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard v-if="auth.can('BUDGET_VIEW')" :title="$t('budgets.waterfall.title')">
        <BudgetWaterfallChart :breakdown="b" :currency-decimals="currencyDecimals" />
      </SectionCard>
    </div>

    <!-- The ceilings that actually gate a submit. The budget's own available above does NOT
         decide whether a document charging it can be submitted — a governing node can refuse a
         line that still shows room, and a refusal nobody can explain is what drives spend onto
         the wrong line. -->
    <SectionCard
      v-if="auth.can('BUDGET_VIEW')"
      :title="$t('budgets.controlPoints.title')"
      :subtitle="$t('budgets.controlPoints.subtitle')"
    >
      <EmptyState
        v-if="!budgets.controlPoints.length"
        :title="$t('budgets.controlPoints.empty')"
        :message="$t('budgets.controlPoints.emptyHint')"
      />
      <div v-else>
        <div
          v-for="cp in sortedControlPoints"
          :key="cp.id"
          class="flex items-center justify-between gap-3 py-2 border-b border-surface last:border-b-0"
        >
          <div class="min-w-0">
            <div class="text-sm truncate">
              {{ cp.budgetNodeCode }} · {{ cp.budgetNodeName }}
            </div>
            <div class="text-xs text-muted-color truncate">
              {{ cp.departmentNodeCode }} · {{ cp.departmentNodeName }}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Tag
              v-if="cp.id === bindingControlPointId"
              severity="warn"
              :value="$t('budgets.controlPoints.binding')"
            />
            <span class="text-sm">{{ formatAmount(cp.available, currencyDecimals) }}</span>
          </div>
        </div>
      </div>
    </SectionCard>

    <SectionCard :title="$t('budgets.detail.ledgerTitle')">
      <DataTable
        :value="budgets.ledger"
        dataKey="id"
        class="text-sm"
        lazy
        paginator
        :rows="budgets.ledgerLimit"
        :totalRecords="budgets.ledgerTotal"
        :first="(budgets.ledgerPage - 1) * budgets.ledgerLimit"
        :loading="budgets.ledgerLoading"
        @page="onLedgerPage"
      >
        <Column header="#" headerStyle="width:3rem">
          <template #body="{ index }">{{ (budgets.ledgerPage - 1) * budgets.ledgerLimit + index + 1 }}</template>
        </Column>
        <Column :header="$t('common.type')">
          <template #body="{ data }">{{ $t(`budgets.detail.txnTypes.${data.txnType}`) }}</template>
        </Column>
        <Column :header="$t('common.amount')">
          <template #body="{ data }">
            <span
              class="inline-flex items-center gap-1 font-medium tabular-nums"
              :class="ledgerStyle(data.txnType).cls"
              :data-direction="ledgerDirection(data.txnType)"
              :title="ledgerDirection(data.txnType) === 'CONVERTS' ? $t('budgets.detail.ledgerConverts') : undefined"
            >
              <i class="pi text-xs" :class="ledgerStyle(data.txnType).icon" />
              {{ ledgerStyle(data.txnType).sign }}{{ formatAmount(data.amount, currencyDecimals) }}
            </span>
          </template>
        </Column>
        <Column :header="$t('budgets.detail.ledgerDocument')">
          <template #body="{ data }">
            <a v-if="data.documentNo && data.documentId" class="text-primary cursor-pointer" @click="router.push({ name: 'document-detail', params: { id: data.documentId } })">{{ data.documentNo }}</a>
            <span v-else>{{ $t('common.none') }}</span>
          </template>
        </Column>
        <Column field="remark" :header="$t('budgets.detail.ledgerRemark')" />
        <Column :header="$t('budgets.detail.ledgerAt')"><template #body="{ data }">{{ formatDate(data.createdAt) }}</template></Column>
        <template #empty>
          <EmptyState icon="pi pi-book" :title="$t('budgets.detail.ledgerEmpty')" />
        </template>
      </DataTable>
    </SectionCard>

    <Dialog v-model:visible="adjustOpen" :header="$t('budgets.adjust.title')" modal class="w-96">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.direction') }}</label>
          <SelectButton v-model="adjustModel.direction" :options="directionOptions" optionLabel="label" optionValue="value" :allowEmpty="false" />
        </div>
        <!-- Type picker: only when the chosen direction has more than one configured type. -->
        <div v-if="adjustTypeOptions.length > 1" class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.type') }}</label>
          <Select v-model="adjustModel.documentTypeId" :options="adjustTypeOptions" optionValue="id" :placeholder="$t('common.select')" fluid>
            <template #option="{ option }">{{ option.code }} — {{ option.name }}</template>
            <template #value="{ value }">
              <span v-if="value">{{ adjustTypeOptions.find((o) => o.id === value)?.code }} — {{ adjustTypeOptions.find((o) => o.id === value)?.name }}</span>
              <span v-else class="text-muted-color">{{ $t('common.select') }}</span>
            </template>
          </Select>
          <Message v-if="adjustErr.documentTypeId" severity="error" size="small" variant="simple">{{ adjustErr.documentTypeId }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.amount') }}</label>
          <InputNumber v-model="adjustModel.amount" :suffix="amountSuffix" :min="0" :minFractionDigits="0" :maxFractionDigits="currencyDecimals" fluid />
          <Message v-if="adjustErr.amount" severity="error" size="small" variant="simple">{{ adjustErr.amount }}</Message>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{ $t('budgets.adjust.reason') }}</label>
          <Textarea v-model="adjustModel.reason" rows="3" autoResize />
          <Message v-if="adjustErr.reason" severity="error" size="small" variant="simple">{{ adjustErr.reason }}</Message>
        </div>
        <div class="flex justify-end gap-2">
          <Button :label="$t('common.cancel')" text @click="adjustOpen = false" />
          <Button :label="$t('budgets.adjust.submit')" :loading="adjustBusy" @click="submitAdjust()" />
        </div>
      </div>
    </Dialog>

    <BudgetTransferDialog v-model:visible="transferOpen" :source="transferSource as any" :docTypes="movementTypes.transfer" @submitted="onTransferred" />
  </div>
</template>
