<script setup lang="ts">
/**
 * Set one control point's tolerance ladder.
 *
 * The ladder is the only setting that decides whether spending past a ceiling is REFUSED or merely
 * RECORDED, and it is the setting a deliberately unfunded line needs changed. The endpoint has
 * accepted a new ladder since control points existed; both control-point screens showed it and
 * offered nothing that writes, so the work went to whoever could issue the request by hand.
 *
 * Shared by the detail screen and the list, because setting a fiscal year's ladders is a task about
 * MANY points, not one.
 */
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToleranceRung } from '../../api/budgets';
import { useBudgetsStore } from '../../stores/budgets';
import { useFeedback } from '../../composables/useFeedback';
import { messageOf } from '../../utils/apiError';

const props = defineProps<{
  visible: boolean;
  controlPointId: string;
  /** The rungs as stored — NOT sorted for display. What is edited is what was saved. */
  tolerance: ToleranceRung[];
  /** The point's current ceiling, so the editor can say when a ladder would refuse everything. */
  ceiling?: string | null;
  /** Shown in the header so a list row's dialog says which point it is editing. */
  label?: string;
}>();
const emit = defineEmits<{ 'update:visible': [boolean]; saved: [] }>();

const { t } = useI18n();
const fb = useFeedback();
const budgets = useBudgetsStore();

/** Editable copy. Never mutate the prop: a cancelled dialog must leave the row as it was. */
const rungs = ref<Array<{ at: number | null; action: 'WARN' | 'BLOCK' }>>([]);
const saving = ref(false);
const serverError = ref('');

watch(
  () => [props.visible, props.controlPointId] as const,
  ([open]) => {
    if (!open) return;
    // Copied in stored order. The detail screen sorts rungs for READING; carrying that sort into
    // the editor would save a ladder in an order nobody chose.
    rungs.value = props.tolerance.map((r) => ({ at: r.at, action: r.action }));
    serverError.value = '';
  },
  { immediate: true },
);

const ACTIONS = computed(() => [
  { value: 'WARN' as const, label: t('budgets.ladder.action.WARN'), hint: t('budgets.ladder.actionHint.WARN') },
  { value: 'BLOCK' as const, label: t('budgets.ladder.action.BLOCK'), hint: t('budgets.ladder.actionHint.BLOCK') },
]);

function addRung() {
  rungs.value.push({ at: 100, action: 'WARN' });
}
function removeRung(i: number) {
  rungs.value.splice(i, 1);
}

/**
 * Exactly what `ToleranceLadder.parse` refuses, and nothing more.
 *
 * No sorting, no deduplication, no cap at 100: every matched rung applies and a matched BLOCK beats
 * a matched WARN, so order carries no meaning and a threshold above 100 is a legitimate allowance.
 * A client that normalised would save a ladder that differs from the one the person reviewed.
 */
const emptyLadder = computed(() => rungs.value.length === 0);
const badThreshold = computed(() =>
  rungs.value.some((r) => r.at === null || !Number.isFinite(r.at) || (r.at as number) < 0),
);
const invalid = computed(() => emptyLadder.value || badThreshold.value);

/** A decimal string that is zero or negative, without turning money into a JS number. */
const ceilingIsZeroOrLess = computed(() => {
  const raw = (props.ceiling ?? '').trim();
  if (!raw) return false;
  return raw.startsWith('-') || /^0+(\.0+)?$/.test(raw);
});

/**
 * Would this ladder refuse every request the point governs?
 *
 * A BLOCK rung against a ceiling of zero or less blocks any positive amount at any threshold — the
 * server compares `(used + requested) * 100` against `ceiling * at`, so a non-positive ceiling puts
 * the right-hand side at or below zero whatever the threshold is. Said out loud, never prevented: a
 * deliberately frozen line is a legitimate configuration, and only the person saving knows whether
 * this is one.
 */
const wouldRefuseEverything = computed(
  () => ceilingIsZeroOrLess.value && rungs.value.some((r) => r.action === 'BLOCK'),
);

async function save() {
  if (invalid.value) return;
  saving.value = true;
  serverError.value = '';
  try {
    await budgets.updateControlPointTolerance(
      props.controlPointId,
      rungs.value.map((r) => ({ at: r.at as number, action: r.action })),
    );
    fb.success(t('feedback.updated'));
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    // The dialog stays open with the rungs as entered: a refusal that clears the work makes the
    // reader retype a ladder to find out whether they were told the same thing twice.
    serverError.value = messageOf(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="label ? `${$t('budgets.ladder.title')} · ${label}` : $t('budgets.ladder.title')"
    :style="{ width: '32rem' }"
    :breakpoints="{ '640px': '95vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="text-sm text-muted-color">{{ $t('budgets.ladder.subtitle') }}</p>

      <div v-if="rungs.length" class="flex flex-col gap-3">
        <div
          v-for="(rung, i) in rungs"
          :key="i"
          class="flex items-end gap-2"
          data-testid="ladder-rung"
        >
          <div class="flex flex-col gap-1.5 w-32">
            <label class="text-xs font-medium text-color">{{ $t('budgets.ladder.at') }}</label>
            <InputGroup>
              <InputNumber
                v-model="rung.at"
                :min="0"
                :max-fraction-digits="2"
                :input-props="{ inputmode: 'decimal' }"
                :invalid="rung.at === null || rung.at < 0"
                fluid
              />
              <InputGroupAddon>%</InputGroupAddon>
            </InputGroup>
          </div>
          <div class="flex flex-col gap-1.5 flex-1">
            <label class="text-xs font-medium text-color">{{ $t('budgets.ladder.action.label') }}</label>
            <Select v-model="rung.action" :options="ACTIONS" option-label="label" option-value="value" fluid>
              <template #option="{ option }">
                <div class="flex flex-col">
                  <span>{{ option.label }}</span>
                  <span class="text-xs text-muted-color">{{ option.hint }}</span>
                </div>
              </template>
            </Select>
          </div>
          <Button
            severity="danger"
            text
            icon="pi pi-trash"
            :aria-label="$t('common.delete')"
            data-testid="remove-rung"
            @click="removeRung(i)"
          />
        </div>
      </div>

      <Message v-if="emptyLadder" severity="error" size="small" variant="simple" data-testid="empty-ladder">
        {{ $t('budgets.ladder.emptyRefused') }}
      </Message>
      <Message v-else-if="badThreshold" severity="error" size="small" variant="simple">
        {{ $t('budgets.ladder.badThreshold') }}
      </Message>

      <Message
        v-if="wouldRefuseEverything"
        severity="warn"
        size="small"
        variant="simple"
        icon="pi pi-exclamation-triangle"
        data-testid="refuses-everything"
      >
        {{ $t('budgets.ladder.refusesEverything') }}
      </Message>

      <Button
        text
        icon="pi pi-plus"
        :label="$t('budgets.ladder.addRung')"
        class="self-start"
        data-testid="add-rung"
        @click="addRung"
      />

      <Message v-if="serverError" severity="error" size="small" variant="simple" data-testid="ladder-server-error">
        {{ serverError }}
      </Message>
    </div>

    <template #footer>
      <Button :label="$t('common.cancel')" text @click="emit('update:visible', false)" />
      <Button
        :label="$t('common.save')"
        icon="pi pi-check"
        :loading="saving"
        :disabled="invalid"
        data-testid="save-ladder"
        @click="save"
      />
    </template>
  </Dialog>
</template>
