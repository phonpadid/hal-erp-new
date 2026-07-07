<script setup lang="ts">
import { budgetTransferSchema } from '@erp/shared';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBudgetsStore } from '../../stores/budgets';
import type { BudgetSummary } from '../../api/budgets';
import { useFeedback } from '../../composables/useFeedback';
import { formatAmount } from '../../utils/money';

// Raise a budget transfer as an approvable document (BUDGET_MANAGE). The client never
// moves money — it only creates the document; the paired TRANSFER_OUT/IN is written by
// the backend on full approval. Source and destination must be in the same company and
// fiscal year (server re-validates). Amount stays a string (money rule). Validation is
// backed by the shared budgetTransferSchema so it can't drift from the server.
const props = defineProps<{ visible: boolean; source: BudgetSummary & { available?: string } }>();
const emit = defineEmits<{ 'update:visible': [v: boolean]; submitted: [documentId: string] }>();

const { t } = useI18n();
const fb = useFeedback();
const budgets = useBudgetsStore();

const model = ref<{ toBudgetId: string | null; amount: string; reason: string }>({ toBudgetId: null, amount: '', reason: '' });
const errors = ref<Record<string, string>>({});
const busy = ref(false);

const decimals = computed(() => props.source.fiscalYear?.company?.baseCurrency?.decimalPlaces ?? 2);

// Destinations: same fiscal year (year is unique per company), excluding the source.
const candidates = computed(() =>
  budgets.list
    .filter((b) => b.id !== props.source.id && b.fiscalYear?.year === props.source.fiscalYear?.year)
    .map((b) => ({
      id: b.id,
      label: `${b.budgetName ?? b.glAccount} — ${t('budgets.transfer.available')} ${formatAmount(b.available, decimals.value)}`,
    })),
);

watch(
  () => props.visible,
  async (open) => {
    if (open) {
      model.value = { toBudgetId: null, amount: '', reason: '' };
      errors.value = {};
      if (!budgets.list.length) await budgets.loadList();
    }
  },
);

function close() {
  emit('update:visible', false);
}

async function submit() {
  const parsed = budgetTransferSchema.safeParse({
    fromBudgetId: props.source.id,
    toBudgetId: model.value.toBudgetId ?? '',
    amount: model.value.amount,
    reason: model.value.reason.trim(),
  });
  if (!parsed.success) {
    const errs: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0] ?? '');
      // Map field-level messages to friendlier i18n copy where we have it.
      if (path === 'amount') errs.amount = t('budgets.transfer.amountError');
      else if (path === 'reason') errs.reason = t('budgets.transfer.reasonError');
      else errs.toBudgetId = t('budgets.transfer.toError');
    }
    errors.value = errs;
    return;
  }
  busy.value = true;
  try {
    const { documentId } = await budgets.createTransfer(parsed.data);
    fb.success(t('feedback.created'));
    emit('submitted', documentId);
    close();
  } catch (e) {
    fb.error(e, t('budgets.transfer.failed'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :visible="visible" :header="$t('budgets.transfer.title')" modal class="w-96" @update:visible="emit('update:visible', $event)">
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('budgets.transfer.from') }}</label>
        <div class="text-sm">
          {{ source.budgetName ?? source.glAccount }}
          <span class="text-muted-color">· {{ $t('budgets.transfer.available') }} {{ formatAmount(source.available, decimals) }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('budgets.transfer.to') }}</label>
        <Select v-model="model.toBudgetId" :options="candidates" optionLabel="label" optionValue="id" :placeholder="$t('common.select')" fluid />
        <Message v-if="errors.toBudgetId" severity="error" size="small" variant="simple">{{ errors.toBudgetId }}</Message>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('budgets.transfer.amount') }}</label>
        <!-- A decimal STRING (money rule); InputText keeps it a string end-to-end. -->
        <InputText v-model="model.amount" type="text" inputmode="decimal" fluid />
        <Message v-if="errors.amount" severity="error" size="small" variant="simple">{{ errors.amount }}</Message>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm text-muted-color">{{ $t('budgets.transfer.reason') }}</label>
        <Textarea v-model="model.reason" rows="3" autoResize />
        <Message v-if="errors.reason" severity="error" size="small" variant="simple">{{ errors.reason }}</Message>
      </div>
      <div class="flex justify-end gap-2">
        <Button :label="$t('common.cancel')" text @click="close()" />
        <Button :label="$t('budgets.transfer.submit')" :loading="busy" @click="submit()" />
      </div>
    </div>
  </Dialog>
</template>
