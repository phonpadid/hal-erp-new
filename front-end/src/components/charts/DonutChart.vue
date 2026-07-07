<script setup lang="ts">
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useChartTheme } from '../../composables/useChartTheme';

// Reusable donut chart over PrimeVue Chart. Slice colors come from theme tokens (light/dark
// safe). `formatValue` optionally formats the tooltip value (e.g. a currency formatter).
const props = defineProps<{
  labels: string[];
  data: number[];
  formatValue?: (v: number) => string;
  // Optional per-slice colors (theme-token strings), aligned to `data`. When omitted the shared
  // categorical palette is used. Pass this to make slices match a meaningful color (e.g. status
  // Tag severities) so the chart reads the same as the table.
  colors?: string[];
}>();

const { themeTick, palette, textColor } = useChartTheme();

const chartData = computed(() => {
  void themeTick.value;
  const colors = props.colors?.length ? props.colors : palette();
  return {
    labels: props.labels,
    datasets: [
      {
        data: props.data,
        backgroundColor: props.data.map((_, i) => colors[i % colors.length]),
        borderWidth: 0,
      },
    ],
  };
});

const chartOptions = computed(() => {
  void themeTick.value;
  const text = textColor();
  return {
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' as const, labels: { color: text } },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; parsed: number }) => {
            const v = props.formatValue ? props.formatValue(ctx.parsed) : String(ctx.parsed);
            return `${ctx.label}: ${v}`;
          },
        },
      },
    },
  };
});
</script>

<template>
  <Chart type="doughnut" :data="chartData" :options="chartOptions" class="h-72" />
</template>
