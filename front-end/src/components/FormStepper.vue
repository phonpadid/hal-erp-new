<script setup lang="ts">
/**
 * Wizard wrapper over PrimeVue Stepper for long, multi-section forms. Navigation is
 * controlled here (Back / Next / submit buttons) so each step is validated before
 * the user may advance: `validateStep(key)` returns `true` to allow advancing, or an
 * error message string to block it (emitted as `step-error`). The step indicator is
 * also clickable: jumping back is free, jumping forward re-runs validation for every
 * step in between and stops at the first that fails — so the validation gate stays the
 * single source of truth either way. Each step's body is provided via a `#step-<key>` slot.
 */
import Stepper from 'primevue/stepper';
import StepList from 'primevue/steplist';
import Step from 'primevue/step';
import Button from 'primevue/button';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

interface StepDef {
  key: string;
  label: string;
}

const props = defineProps<{
  steps: StepDef[];
  /** Return true to allow leaving the step, or an error message to block it. */
  validateStep?: (key: string) => true | string;
  submitLabel?: string;
  loading?: boolean;
  /** Hide the built-in submit button so the parent can supply its own final actions. */
  hideSubmit?: boolean;
  /** Step key to open on (deep-link). Falls back to the first step when absent or unmatched. */
  initialStep?: string;
}>();

const emit = defineEmits<{
  submit: [];
  'step-error': [message: string, key: string];
  /**
   * A step was actually left. The parent renders the `step-error` message itself, so it needs
   * this to know when to drop it — without it the banner outlives the problem it describes and
   * follows the user across the rest of the wizard, still naming a field they have since filled.
   */
  'step-change': [key: string];
}>();
const { t } = useI18n();

// Seed the active step from `initialStep` (matched by key); default to the first step. `index`
// stays the single source of truth afterwards — the prop only chooses where navigation starts.
const startIndex = props.steps.findIndex((s) => s.key === props.initialStep);
const index = ref(startIndex >= 0 ? startIndex : 0);
// Index of the step that last failed validation, so it can be flagged in the indicator.
// Cleared once the step validates or the user navigates away.
const erroredIndex = ref<number | null>(null);
const activeKey = computed(() => props.steps[index.value]?.key ?? '');
const isLast = computed(() => index.value === props.steps.length - 1);
const stepValue = computed(() => String(index.value + 1));

function valid(): boolean {
  const r = props.validateStep?.(activeKey.value);
  if (r !== undefined && r !== true) {
    erroredIndex.value = index.value;
    emit('step-error', r, activeKey.value);
    return false;
  }
  erroredIndex.value = null;
  return true;
}
// Every successful move goes through here, so the error state — this component's `erroredIndex`
// and whatever the parent rendered from `step-error` — is dropped exactly when the step changes.
function moveTo(target: number) {
  erroredIndex.value = null;
  index.value = target;
  emit('step-change', props.steps[target]?.key ?? '');
}
function next() {
  if (valid() && !isLast.value) moveTo(index.value + 1);
}
function back() {
  if (index.value > 0) moveTo(index.value - 1);
}
function finish() {
  if (valid()) emit('submit');
}

// Click a step in the indicator. Backward navigation is unconditional; forward navigation
// validates each step from the current one up to (but not including) the target, landing on
// the first that fails so the user is taken straight to the problem.
function goTo(target: number) {
  if (target === index.value) return;
  if (target < index.value) {
    moveTo(target);
    return;
  }
  for (let i = index.value; i < target; i++) {
    const key = props.steps[i]?.key ?? '';
    const r = props.validateStep?.(key);
    if (r !== undefined && r !== true) {
      index.value = i;
      erroredIndex.value = i;
      emit('step-error', r, key);
      return;
    }
  }
  moveTo(target);
}

defineExpose({ index, next, back });
</script>

<template>
  <div class="flex flex-col gap-4">
    <Stepper :value="stepValue">
      <StepList>
        <Step v-for="(s, i) in steps" :key="s.key" :value="String(i + 1)" class="cursor-pointer" @click="goTo(i)">
          <span :class="{ 'text-red-500 font-medium': erroredIndex === i }">{{ s.label }}</span>
          <i v-if="erroredIndex === i" class="pi pi-exclamation-circle text-red-500 ml-1 text-xs" />
        </Step>
      </StepList>
    </Stepper>

    <div class="py-2">
      <slot :name="`step-${activeKey}`" :active="activeKey" />
    </div>

    <div
      class="sticky bottom-0 flex items-center justify-between gap-2 border-t border-surface-200 bg-surface-0 py-3 dark:border-surface-700 dark:bg-surface-900"
      :style="{ zIndex: 'var(--z-page-actions)' }"
    >
      <Button
        :label="t('common.back')"
        icon="pi pi-arrow-left"
        severity="secondary"
        text
        :disabled="index === 0"
        @click="back"
      />
      <div class="flex items-center gap-2">
        <slot name="actions" :active="activeKey" :isLast="isLast" />
        <Button
          v-if="!isLast"
          :label="t('components.stepper.next')"
          icon="pi pi-arrow-right"
          iconPos="right"
          @click="next"
        />
        <Button
          v-else-if="!hideSubmit"
          :label="submitLabel ?? t('common.submit')"
          icon="pi pi-check"
          :loading="loading"
          @click="finish"
        />
      </div>
    </div>
  </div>
</template>
