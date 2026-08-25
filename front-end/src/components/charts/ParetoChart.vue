<script setup lang="ts">
import Chart from 'primevue/chart';
import Message from 'primevue/message';
import { computed, onErrorCaptured, ref } from 'vue';
import { useChartTheme } from '../../composables/useChartTheme';

// Pareto chart: bars (descending magnitude) + a cumulative-% line on a secondary 0–100 axis.
// Colors from theme tokens. `formatValue` formats the bar axis/tooltip (e.g. currency).
const props = defineProps<{
  labels: string[];
  bars: number[];
  cumulative: number[];
  barLabel: string;
  lineLabel: string;
  formatValue?: (v: number) => string;
}>();

const { themeTick, primary, palette, textColor, gridColor } = useChartTheme();

/**
 * A chart that cannot initialise renders an error where it stands, not an empty card. The
 * failure this catches — `can't acquire context` — reached the console and nothing else, so a
 * reader saw a blank panel and read it as "no data".
 */
const renderFailed = ref(false);
onErrorCaptured(() => {
  renderFailed.value = true;
  return false;
});

const fmt = (v: number | string) => (props.formatValue ? props.formatValue(Number(v)) : String(v));

const chartData = computed(() => {
  void themeTick.value;
  const colors = palette();
  return {
    labels: props.labels,
    datasets: [
      { type: 'bar' as const, label: props.barLabel, data: props.bars, backgroundColor: primary(), borderColor: primary(), yAxisID: 'y', order: 2 },
      { type: 'line' as const, label: props.lineLabel, data: props.cumulative, borderColor: colors[2] ?? primary(), backgroundColor: colors[2] ?? primary(), yAxisID: 'y1', tension: 0.3, order: 1 },
    ],
  };
});

const chartOptions = computed(() => {
  void themeTick.value;
  const text = textColor();
  const grid = gridColor();
  return {
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: text } },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label?: string; yAxisID?: string }; parsed: { y: number } }) =>
            ctx.dataset.yAxisID === 'y1'
              ? `${ctx.dataset.label}: ${Math.round(ctx.parsed.y * 10) / 10}%`
              : `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: text }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: text, callback: (v: number | string) => fmt(v) }, grid: { color: grid } },
      y1: {
        position: 'right' as const,
        beginAtZero: true,
        max: 100,
        ticks: { color: text, callback: (v: number | string) => `${v}%` },
        grid: { display: false },
      },
    },
  };
});
</script>

<template>
  <Message
    v-if="renderFailed"
    severity="warn"
    variant="simple"
    class="h-72 flex items-center justify-center"
    data-testid="chart-failed"
  >
    {{ $t('reports.chartFailed') }}
  </Message>
  <Chart v-else type="bar" :data="chartData" :options="chartOptions" class="h-72" />
</template>
