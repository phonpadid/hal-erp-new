<script setup lang="ts">
import { CONDITION_OPS, FIELD_TYPES, formFieldSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { computed, ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '../../../composables/useFeedback';
import PageHeader from '@/components/PageHeader.vue';
import PageToolbar from '@/components/PageToolbar.vue';
import SectionCard from '@/components/SectionCard.vue';
import EmptyState from '@/components/EmptyState.vue';
import ErrorState from '@/components/ErrorState.vue';
import FormPreview from '@/components/doc-config/FormPreview.vue';
import { useDocConfigStore } from '../../../stores/docConfig';
import type { FormFieldRow } from '../../../api/docConfig';
import type { FormSubmitEvent } from '@primevue/forms';

const { t } = useI18n();
const fb = useFeedback();
const cfg = useDocConfigStore();

const opt = (v: readonly string[]) => v.map((x) => ({ label: x, value: x }));
const fieldTypes = opt(FIELD_TYPES);
const conditionOps = computed(() => CONDITION_OPS.map((x) => ({ label: t(`admin.docConfig.conditionOps.${x}`), value: x })));
// Operators that take no value (presence checks) — hide the value input for these.
const VALUELESS_OPS = ['empty', 'notEmpty'];

// Section selection
const formsTypeId = ref<string>('');
const formsTemplateId = ref<string>('');
watch(formsTypeId, (id) => { formsTemplateId.value = ''; if (id) cfg.loadTemplates(id); });
watch(formsTemplateId, (id) => { if (id) cfg.loadFields(id); });

const templates = computed(() => cfg.templatesByType[formsTypeId.value] ?? []);
const fields = computed(() => cfg.fieldsByTemplate[formsTemplateId.value] ?? []);

// A template's fields can only be changed while it is DRAFT (server enforces; UX mirrors).
const selectedTemplate = computed(() =>
  templates.value.find((tpl) => tpl.id === formsTemplateId.value),
);
const templateEditable = computed(() => selectedTemplate.value?.status === 'DRAFT');

// DRAFT/PUBLISHED/RETIRED → a Tag severity, so status reads at a glance.
function statusSeverity(status: string): 'info' | 'success' | 'secondary' {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'DRAFT') return 'info';
  return 'secondary';
}

// Localised status label; unknown enum values fall back to the raw string from the API.
function statusLabel(status: string): string {
  const key = `admin.docConfig.templateStatus.${status}`;
  const label = t(key);
  return label === key ? status : label;
}

// ── Field builder dialog (add + edit) ────────────────────────────────────────
const fieldDialog = ref(false);
const dialogMode = ref<'add' | 'edit'>('add');
const editingFieldId = ref<string>('');
// Bumped each time the dialog opens so <Form> re-initialises from initialValues.
const formKey = ref(0);
// Field-builder extras (kept outside @primevue/forms so the dialog can react to the type):
// `options` is the dropdown's choices (one per row in the editor); the condition trio
// builds condition_json.
const builder = ref<{ fieldType: string; options: string[]; condField: string; condOp: string; condValue: string }>({
  fieldType: 'text',
  options: [],
  condField: '',
  condOp: '',
  condValue: '',
});
// Seeds @primevue/forms; in edit mode this carries the field's current values.
const initialValues = ref<Record<string, unknown>>({});

function resetBuilder() {
  builder.value = { fieldType: 'text', options: [], condField: '', condOp: '', condValue: '' };
}

// Dropdown option-list editor. Add inserts after the given row (or at the end); switching
// the field type to dropdown seeds one empty row so the editor is never a bare button.
function addOption(afterIndex?: number) {
  const at = afterIndex === undefined ? builder.value.options.length : afterIndex + 1;
  builder.value.options.splice(at, 0, '');
}
function removeOption(i: number) {
  builder.value.options.splice(i, 1);
}
function onFieldTypeChange(v: string) {
  builder.value.fieldType = v;
  if (v === 'dropdown' && builder.value.options.length === 0) builder.value.options = [''];
}

// Next sort order = one past the current max, so adds append (no manual entry).
function nextSortOrder(): number {
  return fields.value.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1;
}

function openAddDialog() {
  dialogMode.value = 'add';
  editingFieldId.value = '';
  resetBuilder();
  initialValues.value = {
    formTemplateId: formsTemplateId.value,
    fieldName: '', fieldLabel: '', fieldType: 'text', isRequired: false, sortOrder: nextSortOrder(),
  };
  formKey.value++;
  fieldDialog.value = true;
}

function openEditDialog(f: FormFieldRow) {
  dialogMode.value = 'edit';
  editingFieldId.value = f.id;
  // Seed the type-dependent extras from the stored options/condition JSON.
  builder.value = {
    fieldType: f.fieldType,
    options: parseOptions(f.optionsJson),
    ...parseCondition(f.conditionJson),
  };
  initialValues.value = {
    formTemplateId: formsTemplateId.value,
    fieldName: f.fieldName, fieldLabel: f.fieldLabel, fieldType: f.fieldType,
    isRequired: f.isRequired, sortOrder: f.sortOrder,
  };
  formKey.value++;
  fieldDialog.value = true;
}

function parseOptions(json?: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((o) => String(o)) : [];
  } catch {
    return [];
  }
}
function parseCondition(json?: string): { condField: string; condOp: string; condValue: string } {
  const empty = { condField: '', condOp: '', condValue: '' };
  if (!json) return empty;
  try {
    const c = JSON.parse(json);
    if (!c || typeof c !== 'object') return empty;
    const value = Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? '');
    return { condField: c.field ?? '', condOp: c.op ?? '', condValue: String(value) };
  } catch {
    return empty;
  }
}

// Field names already on the template — choices for a condition's "when field" reference.
// Exclude the field being edited so a rule can't reference itself.
const templateFieldNames = computed(() =>
  fields.value
    .filter((f) => f.id !== editingFieldId.value)
    .map((f) => ({ label: f.fieldName, value: f.fieldName })),
);

function buildFieldExtras(): { optionsJson?: string; conditionJson?: string } {
  const b = builder.value;
  const opts = b.options.map((s) => s.trim()).filter(Boolean);
  const optionsJson = b.fieldType === 'dropdown' && opts.length ? JSON.stringify(opts) : undefined;
  const conditionJson =
    b.condField && b.condOp
      ? JSON.stringify({
          field: b.condField,
          op: b.condOp,
          ...(VALUELESS_OPS.includes(b.condOp) ? {} : { value: b.condValue }),
        })
      : undefined;
  return { optionsJson, conditionJson };
}

async function submitField(e: FormSubmitEvent) {
  if (!e.valid) return;
  // Read field values from `states` (always present); `e.values` can be undefined
  // depending on which validation path the resolver takes, so don't rely on it.
  const states = (e.states ?? {}) as Record<string, { value?: unknown }>;
  const v: Record<string, unknown> = { ...(e.values ?? {}) };
  for (const [k, s] of Object.entries(states)) {
    if (v[k] === undefined) v[k] = s?.value;
  }
  const extras = buildFieldExtras();
  if (dialogMode.value === 'edit') {
    // fieldName is immutable server-side (UpdateFormFieldDto omits it); send only the
    // editable fields, using '' to clear a removed dropdown/condition rule.
    const { fieldName: _fieldName, formTemplateId: _tpl, ...editable } = v;
    const ok = await cfg.updateField(
      editingFieldId.value,
      { ...editable, optionsJson: extras.optionsJson ?? '', conditionJson: extras.conditionJson ?? '' },
      formsTemplateId.value,
    );
    if (ok) { fieldDialog.value = false; fb.success(t('feedback.done')); } else fb.error(cfg.error);
    return;
  }
  if (await cfg.addField({ ...v, ...extras, formTemplateId: formsTemplateId.value } as any)) {
    fieldDialog.value = false;
    fb.success(t('feedback.created'));
  } else fb.error(cfg.error);
}

// Reorder a field by swapping its sort order with its neighbour (DRAFT templates only).
async function moveField(index: number, dir: -1 | 1) {
  const rows = fields.value;
  const a = rows[index];
  const b = rows[index + dir];
  if (!a || !b) return;
  const ok =
    (await cfg.updateField(a.id, { sortOrder: b.sortOrder }, formsTemplateId.value)) &&
    (await cfg.updateField(b.id, { sortOrder: a.sortOrder }, formsTemplateId.value));
  if (!ok) fb.error(cfg.error);
}

async function createTemplate(documentTypeId: string) {
  if (await cfg.createTemplate(documentTypeId)) fb.success(t('feedback.created'));
  else fb.error(cfg.error);
}
async function publishTemplate(id: string, documentTypeId: string) {
  if (await cfg.publishTemplate(id, documentTypeId)) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}
async function retireTemplate(id: string, documentTypeId: string) {
  if (await cfg.retireTemplate(id, documentTypeId)) fb.success(t('feedback.done'));
  else fb.error(cfg.error);
}

onMounted(() => { if (!cfg.documentTypes.length) cfg.loadAll(); });
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.docConfig.nav.forms')" />

    <PageToolbar>
      <template #filters>
        <div class="flex flex-col gap-1">
          <Select v-model="formsTypeId" :options="cfg.documentTypes" optionLabel="code" optionValue="id" :placeholder="$t('admin.docConfig.fields.chooseType')" class="w-56" />
        </div>
      </template>
      <template #actions>
        <Button v-if="formsTypeId" :label="$t('admin.docConfig.newTemplate')" icon="pi pi-plus" size="small" @click="createTemplate(formsTypeId)" />
      </template>
    </PageToolbar>

    <ErrorState v-if="cfg.error" :message="cfg.error" @retry="cfg.loadAll()" />

    <div v-else-if="!formsTypeId" class="card">
      <EmptyState icon="pi pi-list" :title="$t('admin.docConfig.fields.chooseType')" />
    </div>

    <!-- Master–detail builder: versions (left) · fields (center) · live preview (right).
         Regions stack below xl and lay out in three columns from xl up. -->
    <div v-else class="grid grid-cols-1 xl:grid-cols-[17rem_minmax(0,1fr)_22rem] gap-4 items-start">
      <!-- Versions -->
      <SectionCard :title="$t('admin.docConfig.versionsTitle')" icon="pi pi-clone">
        <div v-if="templates.length" class="flex flex-col gap-2">
          <button
            v-for="tpl in templates" :key="tpl.id" type="button"
            class="w-full text-left rounded-lg border px-3 py-2.5 transition-colors"
            :class="tpl.id === formsTemplateId
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800'"
            @click="formsTemplateId = tpl.id"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-color"><!-- i18n-ignore: version-number prefix -->v{{ tpl.version }}</span>
              <Tag :value="statusLabel(tpl.status)" :severity="statusSeverity(tpl.status)" />
            </div>
            <div class="text-sm text-muted-color mt-1">{{ $t('admin.docConfig.fieldCount', { n: tpl.fieldCount }) }}</div>
            <div v-if="tpl.id === formsTemplateId" class="mt-2 flex gap-2">
              <Button v-if="tpl.status === 'DRAFT'" :label="$t('admin.docConfig.publish')" icon="pi pi-check" size="small" @click.stop="publishTemplate(tpl.id, formsTypeId)" />
              <Button v-if="tpl.status === 'PUBLISHED'" :label="$t('admin.docConfig.retire')" icon="pi pi-ban" text severity="secondary" size="small" @click.stop="retireTemplate(tpl.id, formsTypeId)" />
            </div>
          </button>
        </div>
        <EmptyState v-else icon="pi pi-clone" :title="$t('admin.docConfig.empty.templates')" />
      </SectionCard>

      <!-- Fields -->
      <SectionCard :title="$t('admin.docConfig.fieldsTitle')" icon="pi pi-list-check">
        <template v-if="formsTemplateId" #actions>
          <Button v-if="templateEditable" :label="$t('admin.docConfig.addField')" icon="pi pi-plus" size="small" @click="openAddDialog()" />
          <Tag v-else :value="$t('admin.docConfig.locked')" severity="secondary" icon="pi pi-lock" />
        </template>

        <EmptyState v-if="!formsTemplateId" icon="pi pi-hand-point-left" :title="$t('admin.docConfig.selectVersionHint')" />
        <DataTable v-else :value="fields" dataKey="id" class="text-sm">
          <Column field="sortOrder" header="#" class="w-12" />
          <Column field="fieldName" :header="$t('common.name')" />
          <Column field="fieldLabel" :header="$t('admin.docConfig.columns.label')" />
          <Column field="fieldType" :header="$t('common.type')" />
          <Column :header="$t('common.required')" class="w-20"><template #body="{ data }">{{ data.isRequired ? '✓' : '' }}</template><!-- i18n-ignore: check mark --></Column>
          <Column :header="$t('admin.docConfig.columns.rule')" class="w-16">
            <template #body="{ data }">
              <i v-if="data.conditionJson" class="pi pi-filter text-muted-color" :title="data.conditionJson" />
            </template>
          </Column>
          <Column v-if="templateEditable" header="" class="w-40">
            <template #body="{ data, index }">
              <div class="flex items-center gap-1">
                <Button icon="pi pi-pencil" text size="small" :aria-label="$t('admin.docConfig.editField')" @click="openEditDialog(data)" />
                <Button icon="pi pi-arrow-up" text size="small" :disabled="index === 0" :aria-label="$t('admin.docConfig.moveUp')" @click="moveField(index, -1)" />
                <Button icon="pi pi-arrow-down" text size="small" :disabled="index === fields.length - 1" :aria-label="$t('admin.docConfig.moveDown')" @click="moveField(index, 1)" />
              </div>
            </template>
          </Column>
          <template #empty>
            <EmptyState icon="pi pi-pencil" :title="$t('admin.docConfig.empty.fields')" />
          </template>
        </DataTable>
      </SectionCard>

      <!-- Live preview -->
      <SectionCard :title="$t('admin.docConfig.previewTitle')" :subtitle="$t('admin.docConfig.previewHint')" icon="pi pi-eye">
        <EmptyState v-if="!formsTemplateId" icon="pi pi-eye" :title="$t('admin.docConfig.selectVersionHint')" />
        <EmptyState v-else-if="!fields.length" icon="pi pi-eye" :title="$t('admin.docConfig.empty.fields')" />
        <FormPreview v-else :fields="fields" />
      </SectionCard>
    </div>

    <!-- Add / edit field -->
    <Dialog v-model:visible="fieldDialog" :header="dialogMode === 'edit' ? $t('admin.docConfig.editField') : $t('admin.docConfig.addField')" modal class="w-lg max-w-[95vw]">
      <Form :key="formKey" :resolver="zodResolver(formFieldSchema)" :initialValues="initialValues" class="flex flex-col gap-4" @submit="submitField">
        <!-- Basics -->
        <div class="flex flex-col gap-3">
          <div class="text-xs font-semibold uppercase tracking-wide text-muted-color">{{ $t('admin.docConfig.fields.basics') }}</div>
          <FormField v-slot="$f" name="fieldName" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.name') }}</label><InputText type="text" :disabled="dialogMode === 'edit'" /><small v-if="dialogMode === 'edit'" class="text-muted-color">{{ $t('admin.docConfig.fields.nameLocked') }}</small><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
          <FormField v-slot="$f" name="fieldLabel" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.label') }}</label><InputText type="text" /><Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message></FormField>
          <div class="flex gap-3">
            <FormField name="fieldType" class="flex flex-col gap-1 flex-1"><label class="text-sm text-muted-color">{{ $t('common.type') }}</label><Select :options="fieldTypes" optionLabel="label" optionValue="value" @update:modelValue="onFieldTypeChange($event)" /></FormField>
            <FormField name="isRequired" class="flex flex-col gap-1"><label class="text-sm text-muted-color">{{ $t('common.required') }}</label><div class="h-10 flex items-center"><ToggleSwitch /></div></FormField>
          </div>
        </div>

        <!-- Type options: dropdown choices → options_json. One row per choice; add/remove inline. -->
        <div v-if="builder.fieldType === 'dropdown'" class="flex flex-col gap-2 border-t border-surface-200 dark:border-surface-700 pt-3">
          <label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.options') }}</label>
          <div v-for="(_, i) in builder.options" :key="i" class="flex items-center gap-2">
            <span class="w-5 text-right text-xs text-muted-color">{{ i + 1 }}</span>
            <InputText
              v-model="builder.options[i]"
              class="flex-1"
              :placeholder="$t('admin.docConfig.fields.optionPlaceholder')"
              @keydown.enter.prevent="addOption(i)"
            />
            <Button
              icon="pi pi-times"
              text
              rounded
              severity="secondary"
              size="small"
              :aria-label="$t('common.delete')"
              @click="removeOption(i)"
            />
          </div>
          <Button
            icon="pi pi-plus"
            :label="$t('admin.docConfig.fields.addOption')"
            text
            size="small"
            class="self-start"
            @click="addOption()"
          />
        </div>

        <!-- Conditional show/hide rule → condition_json. -->
        <div class="flex flex-col gap-1 border-t border-surface-200 dark:border-surface-700 pt-3">
          <label class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.showWhen') }}</label>
          <div class="flex gap-2">
            <Select v-model="builder.condField" :options="templateFieldNames" optionLabel="label" optionValue="value" :placeholder="$t('admin.docConfig.fields.field')" class="flex-1" showClear />
            <Select v-model="builder.condOp" :options="conditionOps" optionLabel="label" optionValue="value" :placeholder="$t('admin.docConfig.fields.op')" class="w-32" showClear />
          </div>
          <InputText v-if="builder.condField && builder.condOp && !VALUELESS_OPS.includes(builder.condOp)" v-model="builder.condValue" type="text" :placeholder="$t('admin.docConfig.fields.value')" />
        </div>

        <div class="flex justify-end gap-2"><Button :label="$t('common.cancel')" text @click="fieldDialog = false" /><Button type="submit" :label="dialogMode === 'edit' ? $t('common.save') : $t('common.add')" /></div>
      </Form>
    </Dialog>
  </div>
</template>
