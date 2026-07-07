<script setup lang="ts">
import Chart from 'primevue/chart';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BalanceBreakdown } from '../../api/budgets';
import { formatAmount } from '../../utils/money';
import { buildWaterfallSteps, type WaterfallKind } from './waterfall';

// Presentational only — the chart derives from the already-derived breakdown and shows
// the journey from amountTotal to available. No new data, no wire change (invariant 3).
const props = defineProps<{ breakdown: BalanceBreakdown; currencyDecimals: number }>();

const { t } = useI18n();

const steps = computed(() => buildWaterfallSteps(props.breakdown));

// Colors come from PrimeUI theme tokens (no hardcoded hex), resolved at runtime so the
// Aura preset and the `.dark` selector both render correctly. `themeTick` bumps on a
// theme toggle to force re-resolution.
const themeTick = ref(0);
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function colorFor(kind: WaterfallKind): string {
  // referencing themeTick keeps this reactive to the dark-mode toggle
  void themeTick.value;
  switch (kind) {
    case 'increase':
      return cssVar('--p-green-500', cssVar('--p-primary-color', 'transparent'));
    case 'decrease':
      return cssVar('--p-red-500', cssVar('--p-primary-color', 'transparent'));
    default:
      return cssVar('--p-primary-color', cssVar('--p-text-color', 'transparent'));
  }
}

let observer: MutationObserver | null = null;
onMounted(() => {
  observer = new MutationObserver(() => {
    themeTick.value += 1;
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});
onBeforeUnmount(() => observer?.disconnect());

const chartData = computed(() => {
  void themeTick.value;
  const s = steps.value;
  return {
    labels: s.map((step) => t(`budgets.balance.${step.key}`)),
    datasets: [
      {
        // floating bars: each point is a [start, end] running-balance range
        data: s.map((step) => step.range),
        backgroundColor: s.map((step) => colorFor(step.kind)),
        borderColor: s.map((step) => colorFor(step.kind)),
        borderWidth: 1,
        borderSkipped: false,
      },
    ],
  };
});

const chartOptions = computed(() => {
  void themeTick.value;
  const decimals = props.currencyDecimals;
  const s = steps.value;
  const text = cssVar('--p-text-muted-color', cssVar('--p-text-color', ''));
  const grid = cssVar('--p-content-border-color', 'transparent');
  return {
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // Show the signed movement magnitude and the resulting running balance,
          // each formatted to the currency decimal places (never a JS number).
          label(ctx: { dataIndex: number }) {
            const step = s[ctx.dataIndex];
            const sign = step.kind === 'decrease' ? '−' : step.kind === 'increase' ? '+' : '';
            return `${sign}${formatAmount(step.amount, decimals)}`;
          },
          afterLabel(ctx: { dataIndex: number }) {
            const end = String(s[ctx.dataIndex].range[1]);
            return `${t('budgets.waterfall.running')}: ${formatAmount(end, decimals)}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: text }, grid: { display: false } },
      y: {
        ticks: {
          color: text,
          // format axis amounts to the currency decimal places
          callback: (value: number | string) => formatAmount(String(value), decimals),
        },
        grid: { color: grid },
      },
    },
  };
});
</script>

<template>
  <div>
    <div class="flex gap-4 mb-3 text-xs text-muted-color">
      <span class="flex items-center gap-1"><i class="pi pi-circle-fill" :style="{ color: colorFor('increase') }" /> {{ $t('budgets.waterfall.increase') }}</span>
      <span class="flex items-center gap-1"><i class="pi pi-circle-fill" :style="{ color: colorFor('decrease') }" /> {{ $t('budgets.waterfall.decrease') }}</span>
      <span class="flex items-center gap-1"><i class="pi pi-circle-fill" :style="{ color: colorFor('available') }" /> {{ $t('budgets.waterfall.available') }}</span>
    </div>
    <Chart type="bar" :data="chartData" :options="chartOptions" class="h-72" />
  </div>
</template>
