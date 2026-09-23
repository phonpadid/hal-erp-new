<script setup lang="ts">
import { workflowSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import type { FormSubmitEvent } from '@primevue/forms';
import Button from 'primevue/button';
import Chip from 'primevue/chip';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import Toolbar from 'primevue/toolbar';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import DetailHeader from '@/components/DetailHeader.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import TableSkeleton from '@/components/TableSkeleton.vue';
import { useAuthStore } from '../../../stores/auth';
import { useDocConfigStore } from '../../../stores/docConfig';
import { useFeedback } from '../../../composables/useFeedback';
import { useBreadcrumb } from '../../../composables/useBreadcrumb';
import type { WorkflowStepRow } from '../../../api/docConfig';
import { amountBand, approverLabel, parseJobLevels, stepMinRank } from '../../../utils/workflowStep';

const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const cfg = useDocConfigStore();
const canWorkflow = () => auth.can('WORKFLOW_MANAGE');

const workflowId = String(route.params.workflowId);
const workflow = computed(() => cfg.workflowById(workflowId));
// Breadcrumb leaf: Workflows (route meta) → this workflow's name.
useBreadcrumb(() => (workflow.value?.name ? [{ label: workflow.value.name }] : []));
// Not-found is only meaningful once loading has settled — a slow load must not flash it.
const notFound = computed(() => !cfg.loading && !cfg.error && !workflow.value);

// --- Edit workflow (name, active state) ---
// A workflow carries no selection condition of its own: it is chosen by its department/document-type
// mapping, and every condition that changes routing is authored on a step. The editor therefore
// offers exactly what decides something.
const editDialog = ref(false);
const editActive = ref(true);
const savingEdit = ref(false);

function openEdit() {
  const w = workflow.value;
  if (!w) return;
  editActive.value = w.isActive;
  editDialog.value = true;
}

async function submitEdit(e: FormSubmitEvent) {
  if (!e.valid) return;
  const name = (e.states?.name?.value ?? e.values?.name) as string;
  savingEdit.value = true;
  const ok = await cfg.updateWorkflow(workflowId, {
    name,
    isActive: editActive.value,
  });
  savingEdit.value = false;
  if (ok) {
    editDialog.value = false;
    fb.success(t('feedback.updated'));
  } else fb.error(cfg.actionError);
}

async function toggleActive() {
  const w = workflow.value;
  if (!w) return;
  const ok = await cfg.updateWorkflow(workflowId, { isActive: !w.isActive });
  if (ok) fb.success(t('feedback.updated'));
  else fb.error(cfg.actionError);
}

async function removeWorkflow() {
  const w = workflow.value;
  if (!w) return;
  const confirmed = await fb.confirm({ message: t('admin.docConfig.confirmDeleteWorkflow', { name: w.name }) });
  if (!confirmed) return;
  const ok = await cfg.deleteWorkflow(workflowId);
  if (ok) {
    fb.success(t('feedback.deleted'));
    backToList();
  } else fb.error(cfg.actionError);
}

function backToList() {
  router.push({ name: 'doc-config-workflows' });
}
function addStep() {
  router.push({ name: 'workflow-step-create', params: { workflowId } });
}
function editStep(s: WorkflowStepRow) {
  router.push({ name: 'workflow-step-edit', params: { workflowId, stepId: s.id } });
}
async function removeStep(s: WorkflowStepRow) {
  const confirmed = await fb.confirm({ message: t('admin.docConfig.confirmDeleteStep', { no: s.stepNo }) });
  if (!confirmed) return;
  const ok = await cfg.deleteStep(s.id);
  if (ok) fb.success(t('feedback.deleted'));
  else fb.error(cfg.actionError);
}
const approver = (s: WorkflowStepRow) => approverLabel(s, cfg.roles, cfg.users);
// Where the step escalates. Empty is meaningful: the step is chased, never skipped.
const escalateLabel = (s: WorkflowStepRow) =>
  approverLabel({ approverRoleId: s.escalateToRoleId, approverUserId: s.escalateToUserId }, cfg.roles, cfg.users);
const stepLevels = (s: WorkflowStepRow) => parseJobLevels(s.conditionJson);
// Resolve a level code to its display name for the summary; falls back to the raw code.
const levelName = (code: string) => cfg.jobLevels.find((l) => l.code === code)?.name ?? code;
// The min-rank threshold's level name (e.g. "Manager and above"), or null when not in minRank mode.
const stepMinRankName = (s: WorkflowStepRow) => {
  const r = stepMinRank(s.conditionJson);
  if (r == null) return null;
  return cfg.jobLevels.find((l) => l.rank === r)?.name ?? `rank ${r}`;
};

/** Inline toggle of a step's "show signature on PDF" flag; reverts on failure. */
async function toggleSignature(s: WorkflowStepRow, value: boolean) {
  const prev = s.showSignatureOnPdf;
  s.showSignatureOnPdf = value; // optimistic — the switch reflects it immediately
  const ok = await cfg.updateStep(s.id, { showSignatureOnPdf: value });
  if (ok) fb.success(t('feedback.updated'));
  else {
    s.showSignatureOnPdf = prev; // revert (e.g. the server refused the edit)
    fb.error(cfg.actionError);
  }
}

onMounted(() => {
  // Deep-link / refresh: the store may be empty, so pull the workflows (with steps).
  if (!cfg.workflows.length) cfg.loadAll();
});
</script>

<template>
  <div>
    <DetailHeader
      :title="workflow?.name ?? $t('admin.docConfig.nav.workflows')"
      :status="workflow ? (workflow.isActive ? $t('admin.docConfig.filters.active') : $t('admin.docConfig.filters.inactive')) : undefined"
      :statusSeverity="workflow?.isActive ? 'success' : 'secondary'"
    />

    <!-- Actions live in a toolbar rather than floating on the header. -->
    <Toolbar class="mb-4 border-surface">
      <template #start>
        <Button :label="$t('common.back')" icon="pi pi-arrow-left" text size="small" @click="backToList" />
      </template>
      <template #end>
        <div v-if="workflow && canWorkflow()" class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-2 mr-1">
            <label for="wf-active-toggle" class="text-sm text-muted-color">
              {{ workflow.isActive ? $t('admin.docConfig.filters.active') : $t('admin.docConfig.filters.inactive') }}
            </label>
            <ToggleSwitch
              inputId="wf-active-toggle"
              :modelValue="workflow.isActive"
              :aria-label="workflow.isActive ? $t('admin.docConfig.deactivate') : $t('admin.docConfig.activate')"
              @update:modelValue="toggleActive"
            />
          </div>
          <Button :label="$t('common.edit')" icon="pi pi-pencil" text size="small" @click="openEdit" />
          <Button :label="$t('common.delete')" icon="pi pi-trash" text size="small" severity="danger" @click="removeWorkflow" />
          <Button :label="$t('admin.docConfig.addStep')" icon="pi pi-plus" size="small" @click="addStep" />
        </div>
      </template>
    </Toolbar>

    <ErrorState v-if="cfg.error && !workflow" :message="cfg.error" @retry="cfg.loadAll()" />

    <TableSkeleton v-else-if="cfg.loading && !workflow" :columns="5" />

    <EmptyState
      v-else-if="notFound"
      icon="pi pi-question-circle"
      :title="$t('admin.docConfig.workflowNotFound')"
    >
      <template #action>
        <Button :label="$t('admin.docConfig.backToWorkflows')" icon="pi pi-arrow-left" size="small" @click="backToList" />
      </template>
    </EmptyState>

    <template v-else-if="workflow">
      <!-- Steps in full: one row per step rather than the list's compact chips. -->
      <SectionCard :title="$t('admin.docConfig.columns.steps')" icon="pi pi-list">
        <DataTable :value="workflow.steps" dataKey="id" class="text-sm">
          <Column field="stepNo" :header="$t('admin.docConfig.fields.stepNo')" />
          <Column :header="$t('common.name')">
            <template #body="{ data }">{{ data.stepName || '—' }}</template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.approverRole')">
            <template #body="{ data }">{{ approver(data) || '—' }}</template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.mode')">
            <template #body="{ data }">{{ $t(`admin.docConfig.approveModes.${data.approveMode}`) }}</template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.amountMin')">
            <template #body="{ data }">{{ amountBand(data.amountMin, data.amountMax) || '—' }}</template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.escalateToRole')">
            <template #body="{ data }">
              {{ escalateLabel(data) || $t('admin.docConfig.fields.escalateNone') }}
            </template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.slaHours')">
            <template #body="{ data }">{{ data.slaHours != null ? `${data.slaHours}h` : '—' }}</template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.jobLevels')">
            <template #body="{ data }">
              <div class="flex flex-wrap gap-1 items-center">
                <Chip v-for="lvl in stepLevels(data)" :key="lvl" :label="levelName(lvl)" />
                <span v-if="stepMinRankName(data)" class="text-sm">
                  {{ $t('admin.docConfig.minRankSummary', { level: stepMinRankName(data) }) }}
                </span>
                <span v-if="!stepLevels(data).length && !stepMinRankName(data)" class="text-muted-color">—</span>
              </div>
            </template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.showSignatureOnPdf')">
            <template #body="{ data }">
              <ToggleSwitch
                :modelValue="data.showSignatureOnPdf"
                :disabled="!canWorkflow()"
                :aria-label="$t('admin.docConfig.fields.showSignatureOnPdf')"
                @update:modelValue="toggleSignature(data, $event as boolean)"
              />
            </template>
          </Column>
          <!-- Read-only here on purpose. This one changes whether a step can be approved at all, so
               it is authored in the step editor beside its explanation, not toggled from a list. -->
          <Column :header="$t('admin.docConfig.fields.requiresPaymentSlip')">
            <template #body="{ data }">
              <Tag
                v-if="data.requiresPaymentSlip"
                severity="warn"
                :value="$t('admin.docConfig.fields.requiresPaymentSlipTag')"
                data-testid="step-requires-slip"
              />
              <span v-else class="text-muted-color">—</span>
            </template>
          </Column>
          <Column :header="$t('admin.docConfig.fields.allowsAccountRecode')">
            <template #body="{ data }">
              <Tag
                v-if="data.allowsAccountRecode"
                severity="info"
                :value="$t('admin.docConfig.fields.allowsAccountRecodeTag')"
                data-testid="step-allows-recode"
              />
              <span v-else class="text-muted-color">—</span>
            </template>
          </Column>
          <Column v-if="canWorkflow()" header="" class="w-1">
            <template #body="{ data }">
              <div class="flex gap-1 justify-end">
                <Button icon="pi pi-pencil" text rounded size="small" :aria-label="$t('common.edit')" @click="editStep(data)" />
                <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('common.delete')" @click="removeStep(data)" />
              </div>
            </template>
          </Column>
          <template #empty>
            <EmptyState icon="pi pi-share-alt" :title="$t('admin.docConfig.noSteps')">
              <template #action>
                <Button
                  v-if="canWorkflow()"
                  :label="$t('admin.docConfig.addStep')"
                  icon="pi pi-plus"
                  size="small"
                  @click="addStep"
                />
              </template>
            </EmptyState>
          </template>
        </DataTable>
      </SectionCard>
    </template>

    <!-- Edit workflow: name and active state. Routing conditions live on the steps. -->
    <Dialog v-model:visible="editDialog" :header="$t('admin.docConfig.editWorkflow')" modal class="w-md">
      <Form :resolver="zodResolver(workflowSchema)" :initialValues="{ name: workflow?.name ?? '' }" class="flex flex-col gap-4" @submit="submitEdit">
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1.5">
          <label class="text-sm font-medium text-color">{{ $t('common.name') }}</label>
          <InputText type="text" />
          <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>

        <div class="flex items-center gap-2">
          <ToggleSwitch v-model="editActive" inputId="wf-active" />
          <label for="wf-active" class="text-sm text-muted-color">{{ $t('admin.docConfig.filters.active') }}</label>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button :label="$t('common.cancel')" text severity="secondary" @click="editDialog = false" />
          <Button type="submit" icon="pi pi-check" :loading="savingEdit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
