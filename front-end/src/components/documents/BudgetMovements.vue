<script setup lang="ts">
/**
 * What a document does to the budget — its `budget_movement` rows, rendered.
 *
 * A `BUDGET_PLAN`, `BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC` or a transfer holds its content here rather
 * than on `document_line`. Nothing read it, so `BUDGET_PLAN-HAL-2026-0001` rendered as a
 * 12,000,000 document reading "no line items" and was approved by somebody whose screen never named
 * budget 1.106.
 *
 * ONE component for the detail page and the approve dialog, fed from the same detail payload both
 * already fetch. Two summaries of one document are two chances to disagree, and the one an approver
 * signs against must be the one the document actually holds.
 *
 * The budget is named by CODE AND NAME, not either alone: `1.106` is a string an approver cannot
 * check, and `ອຸປະຖຳ ສະໜັບສະໜຸນ ອື່ນໆ (ພາກລັດ)` does not match the plan they hold on paper. The link
 * to the budget's own page — where the balance this is about to change is readable — is gated on
 * `BUDGET_VIEW`, which a document reader need not hold; without it the same text renders unlinked
 * rather than the row disappearing. What the document says about itself is every reader's business;
 * what the pot is worth is not.
 */
import Button from 'primevue/button';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { BudgetMovementRow, BudgetRef } from '../../api/documents';
import { useAuthStore } from '../../stores/auth';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';

defineProps<{ movements: BudgetMovementRow[] }>();

const { t, te } = useI18n();
const router = useRouter();
const auth = useAuthStore();
// Base currency: a budget is an appropriation in the company's own money, never in a document's
// foreign currency. `fmtBase` applies that currency's `decimal_places` — money is never a JS number.
const { fmtBase } = useCurrencyFormat();

/**
 * The movement type in words, from the same catalogue the document-type admin screen names post
 * actions with — one vocabulary, so a plan is not "Activate budget plan" in one place and something
 * else here. An unrecognised type falls back to its raw code rather than to a blank cell: a movement
 * nobody has a label for is still a movement the approver must see.
 */
const typeLabel = (movementType: string) => {
  const key = `admin.docConfig.postActions.${movementType}`;
  return te(key) ? t(key) : movementType;
};

/** `1.106 — Support and subsidies`, or the code alone when the budget carries no name. */
const budgetLabel = (b: BudgetRef) => (b.name ? `${b.code} — ${b.name}` : b.code);
const canOpenBudget = () => auth.can('BUDGET_VIEW');
const openBudget = (b: BudgetRef) => router.push({ name: 'budget-detail', params: { id: b.id } });
</script>

<template>
  <ul class="m-0 flex list-none flex-col gap-3 p-0" data-testid="budget-movements">
    <li
      v-for="m in movements"
      :key="m.id"
      class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 rounded-lg border border-surface-200 p-3 dark:border-surface-700"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-xs font-semibold uppercase tracking-wide text-muted-color">
          {{ typeLabel(m.movementType) }}
        </span>
        <!-- A transfer names both sides; every other movement names only the destination, so the
             "from" half renders only when there is one rather than as an empty dash. -->
        <span v-if="m.fromBudget" class="flex flex-wrap items-baseline gap-1 text-sm">
          <span class="text-muted-color">{{ $t('documents.detail.movementFrom') }}</span>
          <Button
            v-if="canOpenBudget()"
            :label="budgetLabel(m.fromBudget)"
            link
            class="p-0!"
            @click="openBudget(m.fromBudget!)"
          />
          <span v-else class="text-color">{{ budgetLabel(m.fromBudget) }}</span>
        </span>
        <span v-if="m.toBudget" class="flex flex-wrap items-baseline gap-1 text-sm">
          <span class="text-muted-color">
            {{ m.fromBudget ? $t('documents.detail.movementTo') : $t('documents.detail.movementBudget') }}
          </span>
          <Button
            v-if="canOpenBudget()"
            :label="budgetLabel(m.toBudget)"
            link
            class="p-0!"
            @click="openBudget(m.toBudget!)"
          />
          <span v-else class="text-color">{{ budgetLabel(m.toBudget) }}</span>
          <!-- One node legitimately holds several departments' money, so the code alone does not
               say whose budget this is. -->
          <span v-if="m.toBudget.department" class="text-xs text-muted-color">
            · {{ m.toBudget.department.deptCode }}
          </span>
        </span>
        <span v-if="m.reason" class="text-sm text-muted-color wrap-break-word">{{ m.reason }}</span>
      </div>
      <span class="text-lg font-semibold tabular-nums text-color">{{ fmtBase(m.amount) }}</span>
    </li>
  </ul>
</template>
