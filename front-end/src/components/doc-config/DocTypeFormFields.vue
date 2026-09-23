<script lang="ts">
/**
 * Fields living on step 1, per mode — exported so the parent validates exactly the fields this
 * component puts on that step, and the two can't fall out of sync.
 */
export const STEP1_FIELDS: Record<'create' | 'edit', string[]> = {
  create: ['code', 'name', 'shortName', 'category'],
  edit: ['name', 'shortName'],
};
</script>

<script setup lang="ts">
/**
 * The document_type field set, shared by the create and edit pages so the two can't drift.
 * Create mode adds code + category (both immutable after creation, hence edit-mode absence).
 *
 * Split across the parent's two wizard steps (1 = identity, 2 = behaviour) via `step`. Both
 * blocks are toggled with v-show and NEVER unmounted — an unmounted FormField drops its value,
 * so hiding step 1 with v-if would submit an empty code (same reason CompanyFormView does this).
 *
 * Every control is bound to its label via input-id/for, so clicking a flag's text toggles it
 * and a screen reader announces the control by name. Every field renders its own error, so a
 * blocked submit always says which field blocked it.
 */
import { FormField } from '@primevue/forms';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';

// `value` is nullable because the post-action Select's no-action option carries `null`, not a
// sentinel string: a sentinel would have to pass the same shared schema the server validates
// against, so it would either be a value the column refuses or a form that cannot submit.
type Option = { label: string; value: string | null };

withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    /** Which wizard step to show. Both are always mounted; this only toggles visibility. */
    step?: 1 | 2;
    categories?: Option[];
    postActions: Option[];
    matchModes: Option[];
    printTemplates: Option[];
    accountOptions: Option[];
    /** Catalog permission codes for the read gate; `{ label: 'CODE — name', value: 'CODE' }`. */
    permissionCodes?: Option[];
  }>(),
  { step: 1, permissionCodes: () => [] },
);

// The requester-facing flags, rendered as one labelled group rather than a flat wall of
// switches. Each carries a hint — a `requires_*` flag changes what the requester is forced
// to supply, which the label alone doesn't convey.
const FLAGS = [
  'requiresBudget',
  'requiresQuota',
  'requiresVendor',
  'requiresItem',
  // Independent of postAction on purpose: a PR settles budget (CUT_BUDGET) without anyone
  // yet knowing which account will be paid.
  'requiresPayee',
] as const;
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- STEP 1 — Identity: what the type is called. -->
    <div v-show="step === 1" class="flex flex-col gap-3">
      <template v-if="mode === 'create'">
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1">
          <label for="dt-code" class="text-sm text-muted-color">
            {{ $t('common.code') }}<span class="text-red-500" :title="$t('admin.docConfig.fields.required')"> *</span>
          </label>
          <InputText id="dt-code" type="text" :invalid="$f?.invalid" :aria-required="true" :aria-invalid="$f?.invalid || undefined" :aria-describedby="$f?.invalid ? 'dt-code-err' : undefined" />
          <Message v-if="$f?.invalid" id="dt-code-err" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
        </FormField>
      </template>

      <FormField v-slot="$f" name="name" class="flex flex-col gap-1">
        <label for="dt-name" class="text-sm text-muted-color">
          {{ $t('common.name') }}<span class="text-red-500" :title="$t('admin.docConfig.fields.required')"> *</span>
        </label>
        <InputText id="dt-name" type="text" :invalid="$f?.invalid" :aria-required="true" :aria-invalid="$f?.invalid || undefined" :aria-describedby="$f?.invalid ? 'dt-name-err' : undefined" />
        <Message v-if="$f?.invalid" id="dt-name-err" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- The abbreviation stamped in the type position of a paper document number (1034/ຈຊຈ/ບຫ).
           Configuration, so no company's convention is hardcoded; blank means the code is used. -->
      <FormField v-slot="$f" name="shortName" class="flex flex-col gap-1">
        <label for="dt-short-name" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.shortName') }}</label>
        <InputText id="dt-short-name" type="text" maxlength="20" :invalid="$f?.invalid" :aria-invalid="$f?.invalid || undefined" :aria-describedby="$f?.invalid ? 'dt-short-name-err' : 'dt-short-name-hint'" />
        <span id="dt-short-name-hint" class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.shortNameHint') }}</span>
        <Message v-if="$f?.invalid" id="dt-short-name-err" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- Category is set once at creation: it drives the requester-facing icon/description,
           so it is absent in edit mode. -->
      <FormField v-if="mode === 'create'" v-slot="$f" name="category" class="flex flex-col gap-1">
        <label for="dt-category" class="text-sm text-muted-color">
          {{ $t('admin.docConfig.fields.category') }}<span class="text-red-500" :title="$t('admin.docConfig.fields.required')"> *</span>
        </label>
        <Select input-id="dt-category" :options="categories" optionLabel="label" optionValue="value" :invalid="$f?.invalid" :aria-required="true" :aria-invalid="$f?.invalid || undefined" />
        <!-- No active category means `category` can never be filled — say so on the field that
             blocks the submit, instead of failing silently. -->
        <Message v-if="!categories?.length" severity="warn" size="small" variant="simple" data-testid="no-categories">
          {{ $t('admin.docConfig.fields.noCategories') }}
        </Message>
        <Message v-else-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>
    </div>

    <!-- STEP 2 — Requester-facing flags, grouped and each explained. -->
    <fieldset v-show="step === 2" class="flex flex-col gap-3 rounded-lg border border-surface-200 p-3 dark:border-surface-700">
      <legend class="px-1 text-xs font-medium text-muted-color">{{ $t('admin.docConfig.fields.requirements') }}</legend>
      <FormField v-for="flag in FLAGS" :key="flag" :name="flag" class="flex items-start gap-2">
        <ToggleSwitch :input-id="`dt-${flag}`" class="mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-col">
          <label :for="`dt-${flag}`" class="text-sm text-color">{{ $t(`admin.docConfig.fields.${flag}`) }}</label>
          <span class="text-xs text-muted-color">{{ $t(`admin.docConfig.fields.${flag}Hint`) }}</span>
        </div>
      </FormField>
    </fieldset>

    <!-- STEP 2 — What the document does once approved, and where it charges by default. -->
    <div v-show="step === 2" class="flex flex-col gap-3">
      <FormField v-slot="$f" name="postAction" class="flex flex-col gap-1">
        <label for="dt-post-action" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.postAction') }}</label>
        <Select input-id="dt-post-action" :options="postActions" optionLabel="label" optionValue="value" :invalid="$f?.invalid" :aria-invalid="$f?.invalid || undefined" />
        <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- How a document of this type is checked against its predecessor at submit. Its own
           setting, not read off the post-action: a PO that closes its chain (PR → PO, the PO pays)
           must not be held against a requisition that bought nothing yet. -->
      <FormField v-slot="$f" name="matchMode" class="flex flex-col gap-1">
        <label for="dt-match-mode" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.matchMode') }}</label>
        <Select input-id="dt-match-mode" :options="matchModes" optionLabel="label" optionValue="value" :invalid="$f?.invalid" :aria-invalid="$f?.invalid || undefined" data-testid="dt-match-mode" />
        <span class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.matchModeHint') }}</span>
        <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- Which types take receipts. Off by default: a receipt recorded on a requisition or a
           claim is one the matching never reads. -->
      <FormField name="receivesGoods" class="flex items-start gap-2">
        <ToggleSwitch input-id="dt-receivesGoods" class="mt-0.5 shrink-0" data-testid="dt-receives-goods" />
        <div class="flex min-w-0 flex-col">
          <label for="dt-receivesGoods" class="text-sm text-color">{{ $t('admin.docConfig.fields.receivesGoods') }}</label>
          <span class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.receivesGoodsHint') }}</span>
        </div>
      </FormField>

      <!-- Printing only: which sheets a document of this type comes out as. Several are allowed —
           a request filed as the official letter AND as the purchase-request form is two sheets of
           one document. Changes nothing about routing or approval, which the hint says out loud. -->
      <FormField v-slot="$f" name="printTemplates" class="flex flex-col gap-1">
        <label for="dt-print-template" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.printTemplate') }}</label>
        <MultiSelect
          input-id="dt-print-template"
          :options="printTemplates"
          optionLabel="label"
          optionValue="value"
          display="chip"
          :showToggleAll="false"
          :invalid="$f?.invalid"
          :aria-invalid="$f?.invalid || undefined"
          data-testid="dt-print-template"
        />
        <span class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.printTemplateHint') }}</span>
        <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <FormField v-slot="$f" name="defaultGlAccount" class="flex flex-col gap-1">
        <label for="dt-gl" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.defaultGlAccount') }}</label>
        <Select
          input-id="dt-gl"
          :options="accountOptions"
          optionLabel="label"
          optionValue="value"
          filter
          showClear
          :invalid="$f?.invalid"
          :aria-invalid="$f?.invalid || undefined"
          :placeholder="$t('admin.docConfig.fields.defaultGlAccountPlaceholder')"
        />
        <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- Who may READ this type. A read filter, never an action rule: the hint says out loud that
           the creator and anyone the workflow asks to act keep the document whatever they hold, so
           gating a type cannot strand an approval. Cleared = null = whoever DOC_VIEW's scope admits. -->
      <FormField v-slot="$f" name="viewPermissionCode" class="flex flex-col gap-1">
        <label for="dt-view-permission" class="text-sm text-muted-color">{{ $t('admin.docConfig.fields.viewPermissionCode') }}</label>
        <Select
          input-id="dt-view-permission"
          :options="permissionCodes"
          optionLabel="label"
          optionValue="value"
          filter
          showClear
          :invalid="$f?.invalid"
          :aria-invalid="$f?.invalid || undefined"
          :placeholder="$t('admin.docConfig.fields.viewPermissionCodePlaceholder')"
          data-testid="dt-view-permission"
        />
        <span class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.viewPermissionCodeHint') }}</span>
        <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
      </FormField>

      <!-- Not in FLAGS: a `requires_*` flag decides what the REQUESTER must supply, and this one
           decides whether the document may say when its money moved. Different question, so it is
           not rendered in that group where it would read as a sixth thing to fill in. -->
      <FormField name="recordsPastEvents" class="flex items-start gap-2">
        <ToggleSwitch input-id="dt-records-past" class="mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-col">
          <label for="dt-records-past" class="text-sm text-color">{{ $t('admin.docConfig.fields.recordsPastEvents') }}</label>
          <span class="text-xs text-muted-color">{{ $t('admin.docConfig.fields.recordsPastEventsHint') }}</span>
        </div>
      </FormField>
    </div>
  </div>
</template>
