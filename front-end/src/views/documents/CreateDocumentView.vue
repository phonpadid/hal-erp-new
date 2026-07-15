<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import FormStepper from '@/components/FormStepper.vue';
import AttachmentUploader from '@/components/AttachmentUploader.vue';
import DocumentTypePicker from './DocumentTypePicker.vue';
import LineItemsEditor from './LineItemsEditor.vue';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { isFieldVisible } from '@erp/shared';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { Decimal } from 'decimal.js';
import { documentsApi, uploadAttachment } from '../../api/documents';
import { masterDataApi } from '../../api/masterData';
import { budgetsApi } from '../../api/budgets';
import { taxCodesApi } from '../../api/taxCodes';
import type { Item, Vendor } from '../../api/masterData';
import { currencyApi } from '../../api/currency';
import { lineAmount, lineInvalid, lineMissingBudget, lineMissingItem } from '../../utils/form';
import { fieldComponent } from '../../utils/formFields';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { useAuthStore } from '../../stores/auth';
import { useDocumentsStore } from '../../stores/documents';
import { useCurrencyStore } from '../../stores/currency';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import type { CreatableType, FormDef } from '../../api/documents';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const docs = useDocumentsStore();
const fb = useFeedback();

// Edit mode when the route carries a document id (documents/:id/edit). The type is fixed
// then; otherwise the user picks a creatable type.
const editId = computed(() => (route.name === 'document-edit' ? (route.params.id as string) : ''));
const isEdit = computed(() => !!editId.value);

const types = ref<CreatableType[]>([]);
const selectedTypeId = ref<string>('');
const form = ref<FormDef | null>(null);
const values = ref<Record<string, string>>({});
const lines = ref<Array<{ description: string; qty: string; unitPrice: string; budgetId?: string; itemId?: string; taxCodeId?: string }>>([]);
const budgets = ref<Array<{ id: string; budgetName?: string; glAccount: string }>>([]);
const error = ref('');
const busy = ref(false);
// Files chosen on a brand-new draft before it has an id; uploaded right after createDraft.
const stagedFiles = ref<File[]>([]);

// Central master data, restricted to records enabled for the active company (mirrors the
// server's submit-time enablement guard). Gated on MASTER_VIEW — a creator without it simply
// sees no vendor/item affordance.
const canMaster = computed(() => auth.can('MASTER_VIEW'));
// The per-line budget picker is gated on DOC_CREATE (the create permission), not BUDGET_VIEW:
// a requester must pick a budget for a budget-controlled document without being granted the
// finance-officer read. The options come from the balance-free /budgets/selectable read.
const canBudget = computed(() => auth.can('DOC_CREATE'));
const vendorId = ref<string>('');
const vendors = ref<Vendor[]>([]);
const items = ref<Item[]>([]);
// Active VAT codes for the per-line tax selector (empty when the user lacks TAX_VIEW).
const canTax = computed(() => auth.can('TAX_VIEW'));
const vatCodes = ref<Array<{ id: string; code: string; name: string; rate: string }>>([]);
const selectedVendor = computed(() => vendors.value.find((v) => v.id === vendorId.value));

// First-load affordances: show skeletons instead of empty controls until reference data lands.
const loadingTypes = ref(true);
const loadingData = ref(true);
// Steps the user has tried to advance from — drives inline (not just banner) error display.
const attempted = ref<Record<string, boolean>>({});

const cur = useCurrencyStore();
const { fmt, fmtBase, baseCode } = useCurrencyFormat();
const currency = ref('');
const previewRate = ref<string | null>(null);

const selectedType = () => types.value.find((t) => t.id === selectedTypeId.value);

// Currency (and the FX preview) only matter for money documents. Procurement/finance carry
// amounts; HR/admin/IT generally don't, so the picker is hidden there and the document just
// stays in the company base currency. Category is config (document_type.category).
const MONEY_CATEGORIES = ['PROCUREMENT', 'FINANCE'];
const showCurrency = computed(() => MONEY_CATEGORIES.includes(selectedType()?.category ?? ''));

// Document total in the document currency (sum of line amounts).
const docTotal = computed(() =>
  lines.value.reduce((s, l) => s.plus(lineAmount(l.qty, l.unitPrice) || '0'), new Decimal(0)).toString(),
);
const isForeign = computed(() => !!currency.value && !!baseCode() && currency.value !== baseCode());
// Advisory converted base preview (the server locks the authoritative rate at submit).
const basePreview = computed(() =>
  previewRate.value ? fmtBase(new Decimal(docTotal.value).times(previewRate.value).toString()) : null,
);

async function refreshRate() {
  const base = baseCode();
  if (!currency.value || !base || currency.value === base) {
    previewRate.value = null;
    return;
  }
  try {
    const asOf = new Date().toISOString().slice(0, 10);
    previewRate.value = (await currencyApi.rates.resolve(currency.value, base, asOf)).rate;
  } catch {
    previewRate.value = null; // no rate → omit preview, never block the form
  }
}
watch(currency, refreshRate);

// Values keyed by field NAME (the condition_json references siblings by name).
const valuesByName = computed<Record<string, string | undefined>>(() => {
  const out: Record<string, string | undefined> = {};
  for (const f of form.value?.fields ?? []) out[f.fieldName] = values.value[f.id];
  return out;
});

// Each VISIBLE dynamic field paired with its control. `file`/`line_items` resolve to a null
// control (rendered specially); conditional fields are filtered by the shared evaluator.
const fieldControls = computed(() =>
  (form.value?.fields ?? [])
    .filter((f) => isFieldVisible(f.conditionJson, valuesByName.value))
    .map((f) => ({ f, ctrl: fieldComponent(f.fieldType, f.optionsJson) })),
);

// Whether a required field's content is present. Most fields carry a plain string in
// `values`, but `file` and `line_items` store their content OUTSIDE `values` — a file lives
// in the staged uploads (create) / saved attachments (edit), and lines live in the Lines
// step. Checking `values[id]` for those would report them missing forever, even after the
// user attaches a file or adds a line — the bug that blocked the details step from advancing.
function isFieldFilled(f: { id: string; fieldType: string }): boolean {
  if (f.fieldType === 'file') return isEdit.value ? docs.attachments.length > 0 : stagedFiles.value.length > 0;
  if (f.fieldType === 'line_items') return lines.value.length > 0;
  return !!values.value[f.id];
}

// Required validation only counts fields that are currently visible.
function missingRequired(): string[] {
  return (form.value?.fields ?? [])
    .filter((f) => f.isRequired && isFieldVisible(f.conditionJson, valuesByName.value))
    .filter((f) => !isFieldFilled(f))
    .map((f) => f.fieldLabel);
}

// The first visible required field still empty, by id — used to focus on a blocked advance.
function firstMissingRequiredId(): string | null {
  const f = (form.value?.fields ?? [])
    .filter((f) => f.isRequired && isFieldVisible(f.conditionJson, valuesByName.value))
    .find((f) => !isFieldFilled(f));
  return f?.id ?? null;
}

// On a blocked step advance, mark the step attempted (so inline errors show) and move focus
// to the first offending input so the user is taken straight to the problem.
function onStepError(message: string, key: string) {
  error.value = message;
  attempted.value[key] = true;
  nextTick(() => {
    let id: string | null = null;
    if (key === 'type' && canMaster.value && selectedType()?.requiresVendor && !vendorId.value) id = 'vendor';
    else if (key === 'details') id = firstMissingRequiredId();
    else if (key === 'lines') {
      const i = firstBadLineIndex();
      id = i >= 0 ? `qty-${i}` : null;
    }
    if (id) document.getElementById(id)?.focus();
  });
}

// Whether a given required field should show its inline error (details step attempted, still empty).
function fieldError(f: { id: string; isRequired: boolean; fieldType: string }): boolean {
  return !!attempted.value.details && f.isRequired && !isFieldFilled(f);
}

// Visible standard fields (label + value) for the read-only Review summary. file/line_items
// fields are excluded — files attach after save and lines have their own section. Derived from
// the same fieldControls the editor binds, so the summary can't drift from what is submitted.
const reviewFields = computed(() =>
  fieldControls.value
    .filter(({ ctrl }) => ctrl.component)
    .map(({ f, ctrl }) => ({ id: f.id, label: f.fieldLabel, value: values.value[f.id] || '', html: !!ctrl.html })),
);

const steps = computed(() => [
  { key: 'type', label: t('documents.create.steps.type') },
  { key: 'details', label: t('documents.create.steps.details') },
  { key: 'lines', label: t('documents.create.steps.lines') },
  { key: 'review', label: t('documents.create.steps.review') },
]);
// Deep-link target step (e.g. the Detail "complete required fields" affordance opens the
// wizard on `details`). Only honored in edit mode — a fresh create always starts at type.
// The stepper falls back to the first step when this is absent or matches no step.
const initialStep = computed(() => (isEdit.value ? (route.query.step as string | undefined) : undefined) || undefined);
const canSubmit = computed(() => auth.can('DOC_SUBMIT'));

function validateStep(key: string): true | string {
  if (key === 'type') {
    if (!selectedTypeId.value) return t('documents.create.selectTypeFirst');
    // Config-driven: a requires_vendor type can't advance without a vendor (server re-checks
    // at submit). Only enforced when the creator can pick one (MASTER_VIEW); otherwise the
    // server stays authoritative.
    if (selectedType()?.requiresVendor && canMaster.value && !vendorId.value) {
      return t('documents.create.vendorRequired');
    }
    return true;
  }
  if (key === 'details') {
    const missing = missingRequired();
    return missing.length ? t('documents.create.fillRequired', { fields: missing.join(', ') }) : true;
  }
  if (key === 'lines') {
    return linesError() ?? true;
  }
  return true;
}

// Line-step validation, mirroring the server's type-driven rules (UX-only; server re-checks).
// Item/budget requirements are enforced only when the creator can act on them (MASTER_VIEW /
// DOC_CREATE), matching the requires_vendor pattern; otherwise the server stays authoritative.
// True when the type's default GL resolves a budget among the loaded selectable budgets — then
// item-less lines auto-charge it and need no manual pick (mirrors the server resolution).
function typeDefaultResolves(): boolean {
  const gl = selectedType()?.defaultGlAccount;
  return !!gl && (selectedType()?.requiresBudget ?? false) && budgets.value.some((b) => b.glAccount === gl);
}
function linesError(): string | null {
  if (lines.value.some(lineInvalid)) return t('documents.create.invalidLine');
  const ri = (selectedType()?.requiresItem ?? false) && canMaster.value;
  const rb = (selectedType()?.requiresBudget ?? false) && canBudget.value;
  if (lines.value.some((l) => lineMissingItem(l, ri))) return t('documents.create.itemRequiredLine');
  if (!typeDefaultResolves() && lines.value.some((l) => lineMissingBudget(l, rb))) {
    return t('documents.create.budgetRequiredLine');
  }
  return null;
}
// Index of the first line failing any line-step rule (for focus on a blocked advance).
function firstBadLineIndex(): number {
  const ri = (selectedType()?.requiresItem ?? false) && canMaster.value;
  const rb = (selectedType()?.requiresBudget ?? false) && canBudget.value;
  const skipBudget = typeDefaultResolves();
  return lines.value.findIndex(
    (l) => lineInvalid(l) || lineMissingItem(l, ri) || (!skipBudget && lineMissingBudget(l, rb)),
  );
}

async function loadForm(typeId: string) {
  form.value = typeId ? await documentsApi.formForType(typeId) : null;
}

onMounted(async () => {
  types.value = await documentsApi.creatableTypes().catch(() => []);
  loadingTypes.value = false;
  // /budgets/selectable returns a plain array of {id, budgetName, glAccount} (no amounts),
  // authorized by DOC_CREATE — exactly what the per-line budget <Select> needs.
  if (canBudget.value) {
    budgets.value = await budgetsApi.selectable().catch(() => []);
  }
  if (canMaster.value) {
    [vendors.value, items.value] = await Promise.all([
      masterDataApi.vendors.enabled().catch(() => []),
      masterDataApi.items.enabled().catch(() => []),
    ]);
  }
  if (canTax.value) {
    vatCodes.value = await taxCodesApi.selectableVat().catch(() => []);
  }
  if (!cur.selectableCurrencies.length) await cur.loadSelectableCurrencies();
  loadingData.value = false;
  currency.value = baseCode() ?? '';
  if (isEdit.value) {
    // Load the existing draft into the editor (store holds attachments for the uploader).
    await docs.loadDetail(editId.value);
    selectedTypeId.value = (docs.current as any)?.documentType?.id ?? '';
    currency.value = (docs.current as any)?.currency?.code ?? baseCode() ?? '';
    vendorId.value = (docs.current as any)?.vendor?.id ?? '';
    await loadForm(selectedTypeId.value);
    values.value = Object.fromEntries(docs.fieldValues.map((v) => [v.formFieldId, v.value ?? '']));
    lines.value = docs.lines.map((l: any) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, budgetId: l.budgetId, itemId: l.item?.id ?? l.itemId, taxCodeId: l.taxCode?.id ?? l.taxCodeId }));
    // Deep-linked to the Details step to complete missing required fields → focus the first one.
    // A field may render as a plain input or as a rich-text editor (contenteditable), so focus a
    // focusable descendant when the id'd element isn't itself focusable. Best-effort — no-op if
    // nothing matches.
    if (initialStep.value === 'details') {
      const id = firstMissingRequiredId();
      // Small delay so an async rich-text editor (Quill) has mounted its editable area before we
      // reach for it; a plain input is already present, so this only ever helps.
      window.setTimeout(() => {
        const el = id ? document.getElementById(id) : null;
        if (!el) return;
        const focusable = el.matches('input,textarea,[contenteditable="true"]')
          ? el
          : el.querySelector<HTMLElement>('input,textarea,[contenteditable="true"],.ql-editor');
        (focusable ?? el).focus();
      }, 150);
    }
  }
  await refreshRate();
});

// In create mode, changing the type reloads its form and resets entry.
watch(selectedTypeId, async (id) => {
  if (isEdit.value) return;
  await loadForm(id);
  values.value = {};
  lines.value = [];
  // Drop a vendor carried over from a previous type that no longer applies, so a hidden
  // picker can't leak a stale vendor into the payload.
  if (!selectedType()?.requiresVendor) vendorId.value = '';
  // Non-money type: force back to base so a foreign currency picked for a previous type
  // can't linger behind the hidden picker.
  if (!showCurrency.value) currency.value = baseCode() ?? '';
});

function collectPayload() {
  // Only persist values for currently-visible fields; the server also drops hidden ones.
  const visibleIds = new Set(fieldControls.value.map(({ f }) => f.id));
  const fieldValues = (form.value?.fields ?? [])
    .filter((f) => visibleIds.has(f.id))
    .map((f) => ({ formFieldId: f.id, value: values.value[f.id] ?? '' }));
  const linePayload = lines.value.map((l, i) => ({
    lineNo: i + 1,
    itemId: l.itemId || undefined,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    lineAmount: lineAmount(l.qty, l.unitPrice),
    budgetId: l.budgetId,
    taxCodeId: l.taxCodeId || undefined,
    // GL account is intentionally not sent — the server derives it from the item's default,
    // keeping the read-only display and the persisted value from drifting.
  }));
  return { fieldValues, lines: linePayload };
}

async function save(submitAfter: boolean) {
  error.value = '';
  if (!form.value) return;
  const missing = missingRequired();
  if (missing.length) {
    error.value = t('documents.create.fillRequired', { fields: missing.join(', ') });
    return;
  }
  // Mirror the server's type-driven line rules before save/submit (server stays authoritative).
  const lineIssue = linesError();
  if (lineIssue) {
    error.value = lineIssue;
    attempted.value.lines = true;
    return;
  }
  busy.value = true;
  try {
    const { fieldValues, lines: linePayload } = collectPayload();
    let id = editId.value;
    if (isEdit.value) {
      if (!(await docs.saveDraft(id, fieldValues, linePayload))) {
        fb.error(docs.error);
        return;
      }
    } else {
      id = await docs.createDraft({ documentTypeId: selectedTypeId.value, currency: currency.value || undefined, vendorId: vendorId.value || undefined, fieldValues, lines: linePayload });
      // Now that the draft exists, upload any files staged on the new-document form.
      if (stagedFiles.value.length) {
        try {
          await Promise.all(stagedFiles.value.map((file) => uploadAttachment(id, file)));
          stagedFiles.value = [];
        } catch (e) {
          fb.error(e, t('documents.create.attachmentsFailed'));
        }
      }
    }
    if (submitAfter) {
      const ok = await docs.submit(id);
      if (!ok) {
        fb.error(docs.error); // draft is saved, but submit failed
        await router.push({ name: 'document-detail', params: { id } });
        return;
      }
      fb.success(t('feedback.submitted'));
    } else {
      fb.success(isEdit.value ? t('feedback.updated') : t('feedback.created'));
    }
    await router.push({ name: 'document-detail', params: { id } });
  } catch (e: any) {
    fb.error(e, t('documents.create.saveFailed'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="isEdit ? $t('documents.create.editTitle') : $t('documents.create.title')" />
    <Message v-if="error" severity="error" class="mb-3">{{ error }}</Message>

    <div class="card">
      <FormStepper :steps="steps" :initial-step="initialStep" :validate-step="validateStep" hide-submit :loading="busy" @step-error="onStepError">
        <!-- Step: document type -->
        <template #step-type>
          <div class="flex flex-col gap-5">
            <DocumentTypePicker v-model="selectedTypeId" :types="types" :disabled="isEdit" :loading="loadingTypes" />

            <div v-if="showCurrency || (canMaster && selectedType()?.requiresVendor)" class="flex flex-wrap gap-4">
              <!-- Reference data still loading: skeletons rather than empty pickers. -->
              <Skeleton v-if="loadingData" width="12rem" height="2.5rem" class="rounded-md" />
              <template v-else>
                <!-- Currency: shown only for money documents (PROCUREMENT/FINANCE); others stay base. -->
                <div v-if="showCurrency" class="flex flex-col gap-1">
                  <label for="currency" class="text-sm text-muted-color">{{ $t('documents.create.currency') }}</label>
                  <Select input-id="currency" v-model="currency" :options="cur.selectableCurrencies" optionLabel="code" optionValue="code" class="w-40" :placeholder="$t('documents.create.currency')" />
                </div>
                <!-- Vendor: shown only for types configured requires_vendor (config-driven, invariant 7).
                     Only vendors enabled for the active company; fixed after creation (set at create). -->
                <div v-if="canMaster && selectedType()?.requiresVendor" class="flex flex-col gap-1">
                  <label for="vendor" class="text-sm text-muted-color">{{ $t('documents.create.vendor') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                  <Select input-id="vendor" v-model="vendorId" :options="vendors" optionLabel="name" optionValue="id" class="w-72" :placeholder="$t('documents.create.vendorPlaceholder')" :disabled="isEdit" :invalid="!!attempted.type && !vendorId" :aria-required="true" :aria-invalid="(!!attempted.type && !vendorId) || undefined" showClear filter />
                  <small v-if="selectedVendor?.paymentTermDays != null" class="text-muted-color">{{ $t('documents.create.creditTerms', { days: selectedVendor.paymentTermDays }) }}</small>
                  <Message v-if="attempted.type && !vendorId" severity="error" size="small" variant="simple">{{ $t('documents.create.vendorRequired') }}</Message>
                </div>
              </template>
            </div>
          </div>
        </template>

        <!-- Step: dynamic fields -->
        <template #step-details>
          <div v-if="form" class="w-full">
            <h2 class="mb-3 font-semibold text-color">{{ $t('documents.create.steps.details') }}</h2>
            <div class="flex flex-col gap-3">
              <p class="text-xs text-muted-color">{{ $t('documents.create.requiredHint') }}</p>
              <div v-for="{ f, ctrl } in fieldControls" :key="f.id" class="flex flex-col gap-1">
                <label :for="f.id" class="text-sm text-muted-color">{{ f.fieldLabel }}<span v-if="f.isRequired" class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                <!-- Standard inline controls (text/number/date/dropdown/textarea/editor). -->
                <component
                  :is="ctrl.component"
                  v-if="ctrl.component"
                  :id="f.id"
                  v-model="values[f.id]"
                  v-bind="ctrl.props"
                  :aria-required="f.isRequired || undefined"
                  :invalid="fieldError(f) || undefined"
                  :aria-invalid="fieldError(f) || undefined"
                  :aria-describedby="fieldError(f) ? `f-err-${f.id}` : undefined"
                />
                <!-- File field: upload immediately when the draft has an id, otherwise
                     stage the files and upload them right after the draft is created. -->
                <template v-else-if="f.fieldType === 'file'">
                  <AttachmentUploader v-if="isEdit" :document-id="editId" :attachments="docs.attachments" @uploaded="docs.reloadAttachments(editId)" />
                  <template v-else>
                    <AttachmentUploader v-model:staged="stagedFiles" />
                    <p v-if="stagedFiles.length" class="text-muted-color text-xs">{{ $t('documents.create.fileUploadAfterSave') }}</p>
                  </template>
                </template>
                <!-- Line-items field: captured in the Lines step. -->
                <p v-else-if="f.fieldType === 'line_items'" class="text-sm text-muted-color">{{ $t('documents.create.lineItemsInStep') }}</p>
                <!-- Inline required-field error, associated to the input via aria-describedby. -->
                <Message v-if="fieldError(f)" :id="`f-err-${f.id}`" severity="error" size="small" variant="simple">{{ $t('documents.create.requiredField') }}</Message>
              </div>
            </div>
          </div>
        </template>

        <!-- Step: line items -->
        <template #step-lines>
          <LineItemsEditor v-model="lines" :currency="currency" :items="items" :budgets="budgets" :vat-codes="vatCodes" :can-master="canMaster" :can-budget="canBudget" :requires-budget="selectedType()?.requiresBudget ?? false" :requires-item="selectedType()?.requiresItem ?? false" :default-gl-account="selectedType()?.defaultGlAccount" />

          <p v-if="selectedType()?.requiresBudget && canBudget && !budgets.length" class="mt-3 text-sm text-muted-color">
            {{ $t('documents.create.budgetNotice') }}
          </p>
          <!-- Advisory converted base amount (the server locks the authoritative rate at submit). -->
          <div v-if="isForeign && basePreview" class="mt-2 text-right text-sm text-muted-color">
            {{ $t('documents.create.basePreview', { amount: basePreview, currency: baseCode() }) }}
          </div>
        </template>

        <!-- Step: review — read-only summary derived from the same state the steps bind, so it
             cannot drift from what is submitted. -->
        <template #step-review>
          <div class="w-full">
            <p class="mb-4 text-sm text-muted-color">{{ $t('documents.create.reviewHint') }}</p>

            <!-- Header facts as info tiles: the at-a-glance identity of the document. -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div class="rounded-lg border border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-800/40">
                <div class="flex items-center gap-2 text-xs text-muted-color"><i class="pi pi-file" /> {{ $t('documents.create.documentType') }}</div>
                <div class="mt-1 font-medium text-color">{{ selectedType()?.name ?? $t('documents.create.none') }}</div>
              </div>
              <div v-if="showCurrency" class="rounded-lg border border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-800/40">
                <div class="flex items-center gap-2 text-xs text-muted-color"><i class="pi pi-dollar" /> {{ $t('documents.create.currency') }}</div>
                <div class="mt-1 font-medium text-color">{{ currency }}</div>
              </div>
              <div v-if="canMaster && selectedType()?.requiresVendor" class="rounded-lg border border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-800/40">
                <div class="flex items-center gap-2 text-xs text-muted-color"><i class="pi pi-building" /> {{ $t('documents.create.vendor') }}</div>
                <div class="mt-1 font-medium text-color">{{ selectedVendor?.name ?? $t('documents.create.none') }}</div>
              </div>
            </div>

            <!-- Visible fields (hidden conditional fields are excluded by reviewFields). -->
            <Divider align="left" class="mt-6! mb-4!">
              <span class="flex items-center gap-2 text-sm font-medium text-muted-color"><i class="pi pi-list-check" /> {{ $t('documents.create.steps.details') }}</span>
            </Divider>
            <dl v-if="reviewFields.length" class="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div v-for="f in reviewFields" :key="f.id" class="flex flex-col border-l-2 border-surface-200 pl-3 dark:border-surface-700">
                <dt class="text-xs text-muted-color">{{ f.label }}</dt>
                <!-- Rich-text fields render their (sanitized) HTML; plain fields show literal text. -->
                <dd v-if="f.html && f.value" class="prose-review wrap-break-word text-color" v-html="sanitizeHtml(f.value)" />
                <dd v-else class="wrap-break-word text-color">{{ f.value || $t('documents.create.none') }}</dd>
              </div>
            </dl>
            <p v-else class="text-sm text-muted-color">{{ $t('documents.create.noVisibleFields') }}</p>

            <!-- Lines with per-line amount and grand total. -->
            <Divider align="left" class="mt-6! mb-4!">
              <span class="flex items-center gap-2 text-sm font-medium text-muted-color"><i class="pi pi-table" /> {{ $t('documents.create.lineItems') }}</span>
            </Divider>
            <div v-if="lines.length" class="w-full overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
              <div class="hidden items-center gap-2 bg-surface-100 px-3 py-2 text-xs font-medium text-muted-color sm:flex dark:bg-surface-800">
                <span class="flex-1">{{ $t('documents.create.line.description') }}</span>
                <span class="w-16 text-right">{{ $t('documents.create.line.qty') }}</span>
                <span class="w-32 text-right">{{ $t('documents.create.line.unitPrice') }}</span>
                <span class="w-32 text-right">{{ $t('documents.create.line.amount') }}</span>
              </div>
              <div
                v-for="(l, i) in lines"
                :key="i"
                class="flex flex-col gap-1 border-t border-surface-100 px-3 py-2 text-sm odd:bg-surface-50/40 sm:flex-row sm:items-center sm:gap-2 dark:border-surface-800 dark:odd:bg-surface-800/20"
              >
                <span class="flex-1 text-color">{{ l.description || $t('documents.create.none') }}</span>
                <span class="text-muted-color sm:w-16 sm:text-right">{{ l.qty }}</span>
                <span class="text-muted-color sm:w-32 sm:text-right">{{ fmt(l.unitPrice, currency) }}</span>
                <span class="font-medium text-color sm:w-32 sm:text-right">{{ fmt(lineAmount(l.qty, l.unitPrice), currency) }}</span>
              </div>
              <div class="flex items-center justify-end gap-3 border-t border-surface-200 bg-surface-50 px-3 py-3 text-sm dark:border-surface-700 dark:bg-surface-800/60">
                <span class="text-muted-color">{{ $t('documents.create.total') }}</span>
                <span class="text-base font-semibold text-color">{{ fmt(docTotal, currency) }} <span v-if="showCurrency">{{ currency }}</span></span>
              </div>
            </div>
            <p v-else class="text-sm text-muted-color">{{ $t('documents.create.emptyLines') }}</p>
            <!-- Advisory base conversion + locked-rate note for a foreign-currency document. -->
            <div v-if="isForeign && basePreview" class="mt-2 text-right text-sm text-muted-color">
              {{ $t('documents.create.basePreview', { amount: basePreview, currency: baseCode() }) }}
            </div>
          </div>
        </template>

        <!-- Final actions on the review step -->
        <template #actions="{ isLast }">
          <template v-if="isLast">
            <Button :label="$t('documents.create.saveDraft')" severity="secondary" outlined :loading="busy" :disabled="busy" @click="save(false)" />
            <Button v-if="canSubmit" :label="$t('documents.create.saveAndSubmit')" icon="pi pi-send" :loading="busy" :disabled="busy" @click="save(true)" />
          </template>
        </template>
      </FormStepper>

      <!-- Persistent summary: the running document total stays visible while scrolling a long
           form, so the user always sees what they are about to submit. -->
      <div
        v-if="lines.length"
        class="sticky bottom-0 z-10 mt-4 flex items-center justify-end gap-3 border-t border-surface-200 bg-surface-0/90 py-3 backdrop-blur dark:border-surface-700 dark:bg-surface-900/90"
      >
        <span class="text-sm text-muted-color">{{ $t('documents.create.documentTotal') }}</span>
        <span class="text-base font-semibold text-color">{{ fmt(docTotal, currency) }} <span v-if="showCurrency">{{ currency }}</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* PrimeVue's Editor root (.p-editor) sets no width, so it doesn't stretch on its own.
   Force the editor and its toolbar/content to fill the field column. */
:deep(.p-editor) {
  width: 100%;
}
:deep(.p-editor-toolbar),
:deep(.p-editor-content) {
  width: 100%;
}

/* Restore basic block formatting for sanitized rich-text rendered via v-html in the review
   summary (Tailwind's preflight strips list/heading defaults). */
.prose-review :deep(h1),
.prose-review :deep(h2),
.prose-review :deep(h3) {
  font-weight: 600;
  margin: 0.25rem 0;
}
.prose-review :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}
.prose-review :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}
.prose-review :deep(a) {
  color: var(--p-primary-color);
  text-decoration: underline;
}
.prose-review :deep(p) {
  margin: 0.15rem 0;
}
</style>
