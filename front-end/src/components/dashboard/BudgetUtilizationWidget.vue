<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Decimal } from 'decimal.js';
import ProgressBar from 'primevue/progressbar';
import Skeleton from 'primevue/skeleton';
import Message from 'primevue/message';
import { RouterLink } from 'vue-router';
import { useBudgetsStore } from '@/stores/budgets';
import { formatAmount } from '@/utils/money';

// Used vs. total per active budget. Money stays a decimal string (formatAmount);
// only the progress percentage is a plain number (a ratio, not money).
const { t } = useI18n();
const budgets = useBudgetsStore();
onMounted(() => budgets.loadList());

interface Row {
  id: string;
  name: string;
  total: string;
  used: string;
  available: string;
  percent: number;
}

const rows = computed<Row[]>(() =>
  budgets.list
    .filter((b) => b.status === 'ACTIVE')
    .slice(0, 5)
    .map((b) => {
      const total = new Decimal(b.amountTotal || '0');
      const available = new Decimal(b.available ?? '0');
      const used = total.minus(available);
      const percent = total.isZero() ? 0 : used.dividedBy(total).times(100).toNumber();
      return {
        id: b.id,
        name: b.budgetName ?? '—',
        total: total.toString(),
        used: used.toString(),
        available: available.toString(),
        percent: Math.max(0, Math.min(100, Math.round(percent))),
      };
    }),
);
</script>

<template>
  <div class="card h-full flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <div>
        <div class="text-color font-semibold">{{ t('dashboard.budgetUtilization') }}</div>
        <small class="text-muted-color">{{ t('dashboard.budgetUtilizationHint') }}</small>
      </div>
      <RouterLink to="/budgets" class="text-primary text-sm font-medium shrink-0">
        {{ t('dashboard.viewAll') }} <i class="pi pi-arrow-right text-xs" />
      </RouterLink>
    </div>

    <Message v-if="budgets.error" severity="error" :closable="false">{{ budgets.error }}</Message>
    <div v-else-if="budgets.loading" class="flex flex-col gap-3">
      <Skeleton v-for="i in 3" :key="i" height="2rem" />
    </div>
    <p v-else-if="!rows.length" class="text-muted-color m-0">{{ $t('common.empty') }}</p>
    <div v-else class="flex flex-col gap-4">
      <div v-for="row in rows" :key="row.id" class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2 text-sm">
          <span class="text-color truncate">{{ row.name }}</span>
          <span class="text-muted-color shrink-0">
            {{ t('dashboard.used') }} {{ formatAmount(row.used) }} / {{ formatAmount(row.total) }}
          </span>
        </div>
        <ProgressBar :value="row.percent" :showValue="true" style="height: 0.75rem" />
      </div>
    </div>
  </div>
</template>
