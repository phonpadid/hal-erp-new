<script setup lang="ts">
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useChartTheme } from '../../composables/useChartTheme';

// Reusable bar chart over PrimeVue Chart. Colors come from theme tokens (light/dark safe);
// `formatValue` formats axis + tooltip amounts (pass a currency formatter — never a JS number
// coercion of money for display). Supports grouped or stacked datasets, vertical or horizontal.
const props = defineProps<{
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
  stacked?: boolean;
  horizontal?: boolean;
  formatValue?: (v: number) => string;
  // Optional per-dataset colors (theme-token strings), aligned to `datasets`. When omitted the
  // shared categorical palette is used. Pass this to make each series match a meaningful color
  // (e.g. status Tag severities) so the chart reads the same as the table.
  colors?: string[];
}>();

const { themeTick, palette, textColor, gridColor } = useChartTheme();

const chartData = computed(() => {
  void themeTick.value;
  const colors = props.colors?.length ? props.colors : palette();
  return {
    labels: props.labels,
    datasets: props.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: colors[i % colors.length],
      borderColor: colors[i % colors.length],
      borderWidth: 1,
    })),
  };
});

const fmt = (v: number | string) => (props.formatValue ? props.formatValue(Number(v)) : String(v));

const chartOptions = computed(() => {
  void themeTick.value;
  const text = textColor();
  const grid = gridColor();
  const valueAxis = {
    stacked: props.stacked ?? false,
    ticks: { color: text, callback: (v: number | string) => fmt(v) },
    grid: { color: grid },
    beginAtZero: true,
  };
  const catAxis = { stacked: props.stacked ?? false, ticks: { color: text }, grid: { display: false } };
  return {
    maintainAspectRatio: false,
    indexAxis: props.horizontal ? ('y' as const) : ('x' as const),
    plugins: {
      legend: { display: props.datasets.length > 1, labels: { color: text } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { x: number; y: number } }) => {
            const val = props.horizontal ? ctx.parsed.x : ctx.parsed.y;
            return `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmt(val)}`;
          },
        },
      },
    },
    scales: props.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
});
</script>

<template>
  <Chart type="bar" :data="chartData" :options="chartOptions" class="h-72" />
</template>
