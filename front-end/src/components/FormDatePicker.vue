<script setup lang="ts">
import { computed, provide } from 'vue';
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

// PrimeVue inputs self-register with an enclosing `<Form>`/`<FormField>` through the
// `$pcForm`/`$pcFormField` injections, which cross component boundaries. Left alone, the
// inner DatePicker would claim the FormField's name itself and write a raw `Date` into the
// form state — bypassing this wrapper entirely and failing a `z.string()` field with
// "Expected string, received date". Cutting the injections keeps the wrapper the only thing
// the form sees, so the value stays the ISO string. Bind it via the FormField slot props:
//   <FormField v-slot="$f" name="d">
//     <FormDatePicker :modelValue="$f.value" @update:modelValue="$f.onChange?.({ value: $event })" />
provide('$pcForm', undefined);
provide('$pcFormField', undefined);

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
