<script setup lang="ts">
import { APPROVE_MODES, workflowStepSchema, serializeStepCondition, parseStepCondition } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Fluid from 'primevue/fluid';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_steps_s8km.svg?raw';
import { useDocConfigStore } from '../../../stores/docConfig';
import { useFeedback } from '../../../composables/useFeedback';
import { useBreadcrumb } from '../../../composables/useBreadcrumb';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const cfg = useDocConfigStore();

const workflowId = String(route.params.workflowId);
// With a :stepId param the page edits that step; without it, it creates a new one.
const stepId = route.params.stepId ? String(route.params.stepId) : undefined;
const isEdit = computed(() => !!stepId);
const workflowName = computed(() => cfg.workflowById(workflowId)?.name ?? '');

// Breadcrumb leaf: Workflows (route meta) → this workflow (links back to its detail)
// → the Add/Edit step page.
useBreadcrumb(() => [
  ...(workflowName.value
    ? [{ label: workflowName.value, to: { name: 'doc-config-workflow-detail', params: { workflowId } } }]
    : []),
  { label: t(isEdit.value ? 'admin.docConfig.editStep' : 'admin.docConfig.addStep') },
]);
const existingStep = computed(() =>
  stepId ? cfg.workflowById(workflowId)?.steps.find((s) => s.id === stepId) : undefined,
);
// The form can only initialize once the (deep-linked) data is present; gate on this.
const ready = computed(() => !isEdit.value || !!existingStep.value);

const approveModes = computed(() => APPROVE_MODES.map((x) => ({ label: t(`admin.docConfig.approveModes.${x}`), value: x })));
// "Engage for levels" options come from the active company's active job_level master (never a
// hardcoded set), so the step condition and the requester's level share one value set.
const jobLevels = computed(() => cfg.jobLevels.map((l) => ({ label: l.name, value: l.code })));
// Roles read better by their per-company name than by the code the server authorizes on; fall
// back to the code when a role carries no name so the option is never blank.
const roleOptions = computed(() => cfg.roles.map((r) => ({ id: r.id, label: r.name || r.code })));
// Step-level engagement condition, edited outside the Form (serialized into condition_json). The
// two modes are mutually exclusive: an explicit level list, or a minimum-rank threshold.
const conditionMode = ref<'none' | 'levels' | 'minRank'>('none');
const stepJobLevels = ref<string[]>([]);
const stepMinRank = ref<number | null>(null);
const conditionModes = computed(() => (['none', 'levels', 'minRank'] as const).map((m) => ({
  label: t(`admin.docConfig.conditionModes.${m}`), value: m,
})));
/**
 * Why an escalation target on this step could never fire — or null if it can.
 *
 * Escalation is driven by a step going overdue: the sweep looks only at steps past their SLA, and
 * a step with no SLA is never one of them (the server tests `!step.slaHours`, so zero hours is no
 * SLA there too — matched here). A PARALLEL_ALL step declines escalation outright, because one
 * stand-in cannot answer for a committee.
 *
 * Neither costs anybody anything — the target is simply stored and never read — so the form still
 * accepts it. This says so while it is being set, which is the only moment anyone would notice.
 */
function escalationInert($form: Record<string, { value?: unknown } | undefined>): 'noSla' | 'mode' | null {
  if (!$form?.slaHours?.value) return 'noSla';
  if ($form?.approveMode?.value === 'PARALLEL_ALL') return 'mode';
  return null;
}

const saving = ref(false);

/** Set once Add has been pressed, so the approver rule is not shouted at a form nobody submitted. */
const attempted = ref(false);

/**
 * Whether the step still names nobody. Read from the LIVE field values rather than from the form's
 * per-field error state: PrimeVue hands a FormField the state object captured when the field
 * registered, and editing any other field re-registers this one against a fresh object — so the
 * first submit after such an edit renders the stale, still-valid copy and shows nothing at all. The
 * step number is nearly always typed first, which put the ordinary path squarely in that case.
 *
 * The values are never stale, and the rule is small enough to state twice; the schema stays the
 * authority that actually refuses the submit (and the server behind it).
 */
function approverMissing($form: Record<string, { value?: unknown } | undefined>): boolean {
  return attempted.value && !$form?.approverRoleId?.value && !$form?.approverUserId?.value;
}

/**
 * Two things the raw resolver never saw, both of which cost this form a rule.
 *
 * `workflowId` is a ROUTE PARAM, not an input — no FormField registers it, so PrimeVue never put it
 * in the values handed to the resolver. Zod then failed the base shape on `workflowId: uuid()`, and
 * a failed base shape means `.superRefine()` NEVER RUNS: both cross-field rules on this form — a
 * step must name an approver, and amountMin <= amountMax — were dead on the client. Worse, the form
 * still called itself VALID, because validity is computed only over REGISTERED fields and this is
 * not one; so every submit went to the server carrying an error nothing could display.
 *
 * `stepNo` arrives from InputNumber as a STRING on the first pass after an edit, which the schema
 * rejects with "Expected number, received string". That error is transient — the next pass carries
 * a real number — but it renders a Message under the field for one frame, and the layout shift that
 * follows moved the Add button out from under the pointer: the press landed, the button jumped, no
 * click was ever delivered, and the form sat there having done nothing. Normalising the value here
 * keeps the flash from happening at all. `Number('')` is 0, so blank must stay blank rather than
 * become a zero that reads as a filled-in step number.
 */
const resolveStep = (() => {
  const resolver = zodResolver(workflowStepSchema);
  return (options: { values: Record<string, unknown>; name?: string }) => {
    const { stepNo, slaHours, ...rest } = options.values ?? {};
    return resolver({
      ...options,
      values: { ...rest, workflowId, stepNo: asNumber(stepNo), slaHours: asNumber(slaHours) },
    });
  };
})();

/** A numeric input's value, as a number — leaving blank blank and nonsense untouched for Zod. */
function asNumber(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return v;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

const initialValues = computed(() => {
  const s = existingStep.value;
  if (s) {
    return {
      workflowId,
      stepNo: s.stepNo,
      stepName: s.stepName,
      approverRoleId: s.approverRoleId,
      approverUserId: s.approverUserId,
      amountMin: s.amountMin,
      amountMax: s.amountMax,
      approveMode: s.approveMode,
      slaHours: s.slaHours,
      escalateToRoleId: s.escalateToRoleId,
      escalateToUserId: s.escalateToUserId,
      showSignatureOnPdf: s.showSignatureOnPdf ?? true,
    };
  }
  return { workflowId, stepNo: 1, approveMode: 'SEQUENTIAL', showSignatureOnPdf: true };
});

function backToDetail() {
  router.push({ name: 'doc-config-workflow-detail', params: { workflowId } });
}

async function submitStep(e: FormSubmitEvent) {
  // Every submit lands here, refused ones included — that is the moment the approver rule becomes
  // worth showing, and the only signal the user gets that Add did anything at all.
  attempted.value = true;
  if (!e.valid) return;
  // Read field values from `states` (always present on the submit event). `e.values` can be
  // undefined depending on which validation path the resolver takes, so don't rely on it.
  const states = (e.states ?? {}) as Record<string, { value?: unknown }>;
  const v: Record<string, unknown> = e.values ?? {};
  for (const [k, s] of Object.entries(states)) {
    if (v[k] === undefined) v[k] = s?.value;
  }
  // Empty amount inputs must be omitted (backend expects decimal strings or nothing).
  const amountMin = (v.amountMin as string) || undefined;
  const amountMax = (v.amountMax as string) || undefined;
  // Serialize the mutually-exclusive engagement condition (explicit list OR minRank OR none) via
  // the shared serializer, so the router and the editor stay in lockstep.
  const conditionJson = serializeStepCondition({
    mode: conditionMode.value,
    jobLevels: stepJobLevels.value,
    minRank: stepMinRank.value ?? undefined,
  });
  saving.value = true;
  let ok: boolean;
  if (isEdit.value && stepId) {
    // The update endpoint forbids non-whitelisted fields, so `workflowId` is dropped here.
    const { workflowId: _drop, ...fields } = v;
    ok = await cfg.updateStep(stepId, { ...fields, amountMin, amountMax, conditionJson });
  } else {
    ok = await cfg.addStep({ ...v, amountMin, amountMax, conditionJson, workflowId });
  }
  saving.value = false;
  if (ok) {
    fb.success(t(isEdit.value ? 'feedback.updated' : 'feedback.created'));
    backToDetail();
  } else fb.error(cfg.error);
}

onMounted(async () => {
  if (!cfg.workflows.length) await cfg.loadAll();
  // Seed the engagement-condition editor from the step being edited (explicit-wins precedence is
  // resolved by the shared parser).
  if (existingStep.value) {
    const cond = parseStepCondition(existingStep.value.conditionJson);
    conditionMode.value = cond.mode;
    stepJobLevels.value = cond.jobLevels ?? [];
    stepMinRank.value = cond.minRank ?? null;
  }
});
</script>

<template>
  <div>
    <PageHeader :title="$t(isEdit ? 'admin.docConfig.editStep' : 'admin.docConfig.addStep')" :subtitle="workflowName">
      <template #actions>
        <Button :label="$t('common.cancel')" icon="pi pi-arrow-left" text size="small" @click="backToDetail" />
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
      <!-- LEFT: decorative illustration; accent follows the theme primary. -->
      <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
        <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-sm" />
        <div class="text-center max-w-sm">
          <h2 class="text-lg font-semibold text-color m-0">{{ $t(isEdit ? 'admin.docConfig.editStep' : 'admin.docConfig.addStep') }}</h2>
          <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.docConfig.addStepHelp') }}</p>
        </div>
      </aside>

      <!-- RIGHT: the step form -->
      <div class="lg:col-span-3">
        <div class="card mb-0!">
          <Form
            v-if="ready"
            v-slot="$form"
            :key="stepId ?? workflowId"
            :resolver="resolveStep"
            :initialValues="initialValues"
            @submit="submitStep"
          >
            <Fluid class="flex flex-col gap-5">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <FormField v-slot="$f" name="stepNo" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.stepNo') }}</label>
                  <InputNumber :useGrouping="false" />
                  <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                </FormField>
                <FormField name="approveMode" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.mode') }}</label>
                  <Select :options="approveModes" optionLabel="label" optionValue="value" />
                </FormField>
              </div>

              <!-- The "must name an approver" rule refused the submit and said NOTHING: Add did
                   nothing, no field was marked, and there was no way to find out why. The error
                   belongs to the PAIR — either Select satisfies it — so it is shown once, under the
                   first of the two. See `approverMissing` for why it is computed from the values
                   rather than read off the field's error state. -->
              <FormField name="approverRoleId" class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.approverRole') }}</label>
                <Select data-testid="approver-role" :options="roleOptions" optionLabel="label" optionValue="id" :placeholder="$t('admin.docConfig.fields.selectRole')" :invalid="approverMissing($form)" showClear />
                <Message v-if="approverMissing($form)" severity="error" size="small" variant="simple" data-testid="approver-required">{{ $t('admin.docConfig.fields.approverRequired') }}</Message>
              </FormField>

              <FormField name="approverUserId" class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.approverUser') }}</label>
                <Select :options="cfg.users" optionLabel="username" optionValue="id" :placeholder="$t('admin.docConfig.fields.selectUser')" filter showClear />
              </FormField>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <FormField v-slot="$f" name="amountMin" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.amountMin') }}</label>
                  <InputText inputmode="decimal" />
                  <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                </FormField>
                <FormField v-slot="$f" name="amountMax" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.amountMax') }}</label>
                  <InputText inputmode="decimal" />
                  <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                </FormField>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.jobLevels') }}</label>
                <!-- Mode toggle keeps the two conditions mutually exclusive: an explicit level list
                     OR a minimum-rank threshold (or none = engage for everyone). -->
                <Select v-model="conditionMode" :options="conditionModes" optionLabel="label" optionValue="value" />
                <MultiSelect
                  v-if="conditionMode === 'levels'"
                  v-model="stepJobLevels"
                  :options="jobLevels"
                  optionLabel="label"
                  optionValue="value"
                  :placeholder="$t('admin.docConfig.fields.jobLevelsAll')"
                  showClear
                  display="chip"
                />
                <Select
                  v-if="conditionMode === 'minRank'"
                  v-model="stepMinRank"
                  :options="jobLevels.map((l) => ({ label: l.label, value: cfg.jobLevels.find((j) => j.code === l.value)?.rank ?? 0 }))"
                  optionLabel="label"
                  optionValue="value"
                  :placeholder="$t('admin.docConfig.fields.minRankPlaceholder')"
                />
              </div>

              <FormField name="slaHours" class="flex flex-col gap-1.5 sm:max-w-[50%]">
                <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.slaHours') }}</label>
                <InputNumber :useGrouping="false" />
              </FormField>

              <!-- Who may act once the SLA has elapsed. Empty is a valid choice and the hint says
                   what it means: a missed deadline chases the approver, it never removes them. -->
              <div class="grid gap-3 sm:grid-cols-2">
                <FormField name="escalateToRoleId" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.escalateToRole') }}</label>
                  <Select data-testid="escalate-role" :options="roleOptions" optionLabel="label" optionValue="id" :placeholder="$t('admin.docConfig.fields.selectRole')" showClear />
                </FormField>
                <FormField name="escalateToUserId" class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium text-color">{{ $t('admin.docConfig.fields.escalateToUser') }}</label>
                  <Select :options="cfg.users" optionLabel="username" optionValue="id" :placeholder="$t('admin.docConfig.fields.selectUser')" filter showClear />
                </FormField>
              </div>
              <small class="text-muted-color -mt-2">{{ $t('admin.docConfig.fields.escalateHint') }}</small>
              <!-- Stated, not refused, and the fields stay enabled: naming the stand-in and then
                   setting the deadline is a reasonable order, and disabling them would impose the
                   opposite one. -->
              <div
                v-if="escalationInert($form)"
                class="-mt-2 flex items-start gap-2 rounded-md border border-dashed border-surface-300 px-3 py-2 text-xs text-muted-color dark:border-surface-700"
                data-testid="escalation-inert"
                :data-reason="escalationInert($form)"
              >
                <i class="pi pi-info-circle mt-0.5 shrink-0" />
                <span>{{ $t(`admin.docConfig.fields.escalateInert.${escalationInert($form)}`) }}</span>
              </div>

              <FormField
                v-can="'WORKFLOW_MANAGE'"
                name="showSignatureOnPdf"
                class="flex items-start gap-3"
                data-testid="show-signature-field"
              >
                <ToggleSwitch inputId="showSignatureOnPdf" />
                <div class="flex flex-col gap-0.5">
                  <label for="showSignatureOnPdf" class="text-sm font-medium text-color">
                    {{ $t('admin.docConfig.fields.showSignatureOnPdf') }}
                  </label>
                  <span class="text-muted-color text-xs">{{ $t('admin.docConfig.fields.showSignatureOnPdfHelp') }}</span>
                </div>
              </FormField>

              <div class="flex justify-end gap-2 border-t border-surface-200 dark:border-surface-700 pt-5">
                <Button :label="$t('common.cancel')" severity="secondary" text @click="backToDetail" />
                <Button v-can="'WORKFLOW_MANAGE'" type="submit" icon="pi pi-check" :loading="saving" :label="$t(isEdit ? 'common.save' : 'common.add')" />
              </div>
            </Fluid>
          </Form>
        </div>
      </div>
    </div>
  </div>
</template>
