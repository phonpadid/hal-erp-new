<script setup lang="ts">
import { computed } from 'vue';
import DatePicker from 'primevue/datepicker';

/**
 * String-valued wrapper around PrimeVue's DatePicker for use in the configuration-driven
 * document form. DatePicker binds a `Date`, but every dynamic field value is carried as a
 * string end-to-end (edit-load, review summary, submit payload). This adapter keeps that
 * contract: it accepts/emits an ISO `yyyy-mm-dd` string and only deals in `Date` internally.
 *
 * Parse/format go through the local calendar (not `new Date('yyyy-mm-dd')`, which is UTC and
 * shifts the day in negative-offset timezones), so the picked day round-trips unchanged.
 */
const props = defineProps<{ modelValue?: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIso(d: Date | null): string {
  if (!d) return '';
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const dateValue = computed<Date | null>({
  get: () => toDate(props.modelValue),
  set: (d) => emit('update:modelValue', toIso(d)),
});
</script>

<template>
  <DatePicker v-model="dateValue" dateFormat="yy-mm-dd" showIcon showButtonBar class="w-full" />
</template>
