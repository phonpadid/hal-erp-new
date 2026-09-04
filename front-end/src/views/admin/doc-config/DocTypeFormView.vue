<script setup lang="ts">
/**
 * Create / edit a document type on its own page (the dialog it replaced had outgrown a modal:
 * nine fields, five of them explained). Mirrors the WorkflowStepCreateView layout — illustration
 * aside + form card — so the two doc-config create pages read the same.
 *
 * A 2-step wizard (1 = identity → 2 = behaviour) so neither step needs scrolling. Both steps
 * live inside a SINGLE <Form> toggled with v-show (never unmounted), so every field's value
 * survives to one final submit — same pattern as CompanyFormView.
 *
 * Code and category are set once at creation and absent in edit mode, so edit validates the
 * shared schema minus those two fields: one source of truth, no second schema to drift.
 */
import { DEFAULT_PRINT_TEMPLATE, POST_ACTIONS, PRINT_TEMPLATES, documentTypeSchema } from '@erp/shared';
import { Form } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Fluid from 'primevue/fluid';
import Message from 'primevue/message';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import DocTypeFormFields, { STEP1_FIELDS } from '@/components/doc-config/DocTypeFormFields.vue';
import rawIllustration from '@/assets/illustrations/undraw_filing-system_e3yo.svg?raw';
import { useDocConfigStore } from '../../../stores/docConfig';
import { useAccountsStore } from '../../../stores/accounts';
import { useFeedback } from '../../../composables/useFeedback';
import type { FormSubmitEvent } from '@primevue/forms';

const editDocumentTypeSchema = documentTypeSchema.omit({ code: true, category: true });

const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const cfg = useDocConfigStore();
const accounts = useAccountsStore();

const id = computed(() => (route.params.id as string | undefined) || undefined);
const isEdit = computed(() => !!id.value);
const saving = ref(false);

const existing = computed(() => (id.value ? cfg.documentTypes.find((dt) => dt.id === id.value) : undefined));
// The <Form> reads `initialValues` ONCE, when it is created — so it must not be created before
// the categories/accounts it defaults from have loaded, or a cold page load captures an empty
// category and blocks the user on a field that visibly shows a value. (The dialog this replaced
// never hit that: it could only open from an already-loaded list.)
const loaded = ref(false);
const ready = computed(() => loaded.value && (!isEdit.value || !!existing.value));
// Loaded but no such type — a stale link or a type from another company.
const notFound = computed(() => loaded.value && isEdit.value && !existing.value);

const categories = computed(() => cfg.activeCategories.map((c) => ({ label: c.name, value: c.code })));
const baseAccountOptions = computed(() => accounts.selectable.map((a) => ({ label: `${a.code} — ${a.name}`, value: a.code })));

// Built from the shared set, so the Select offers exactly what the engine dispatches. No fallback
// option for an unrecognised stored value: the set is closed at the DTO and by a CHECK constraint,
// so there is no value the fallback could catch.
//
// The no-action option carries `null`, not a sentinel string. A sentinel would have to pass the
// same shared schema the server validates against — so either the schema accepts a value the
// column refuses, or the form cannot submit. Carrying null is what the wire and the column already
// agree on.
const postActions = computed(() => [
  { label: t('admin.docConfig.postActions.NONE'), value: null },
  ...POST_ACTIONS.map((x) => ({ label: t(`admin.docConfig.postActions.${x}`), value: x })),
]);
// The four sheets, from the shared set — the picker offers exactly what the renderer draws and the
// CHECK constraint accepts. No null option and no empty selection: every document prints as
// something, and LETTER is the official letter rather than "nothing chosen". Several may be chosen;
// the server stores them in print order whatever order they were ticked in.
const printTemplates = computed(() =>
  PRINT_TEMPLATES.map((x) => ({ label: t(`admin.docConfig.printTemplates.${x}`), value: x })),
);
const accountOptions = computed(() => {
  const cur = existing.value?.defaultGlAccount;
  if (cur && !baseAccountOptions.value.some((o) => o.value === cur)) {
    return [...baseAccountOptions.value, { label: cur, value: cur }];
  }
  return baseAccountOptions.value;
});

const initialValues = computed<Record<string, unknown>>(() => {
  const dt = existing.value;
  if (dt) {
    return {
      name: dt.name,
      requiresBudget: dt.requiresBudget,
      requiresQuota: dt.requiresQuota,
      requiresVendor: dt.requiresVendor,
      requiresItem: dt.requiresItem,
      requiresPayee: dt.requiresPayee,
      defaultGlAccount: dt.defaultGlAccount ?? null,
      postAction: dt.postAction ?? null,
      printTemplates: dt.printTemplates?.length ? dt.printTemplates : [DEFAULT_PRINT_TEMPLATE],
    };
  }
  return {
    code: '',
    name: '',
    // Default to the first active category — the options are dynamic, so no hardcoded code.
    category: cfg.activeCategories[0]?.code ?? '',
    requiresBudget: false,
    requiresQuota: false,
    requiresVendor: false,
    requiresItem: false,
    requiresPayee: false,
    defaultGlAccount: null,
    postAction: null,
    printTemplates: [DEFAULT_PRINT_TEMPLATE],
  };
});

function backToList() {
  router.push({ name: 'doc-config-types' });
}

// Wizard position. 1 = identity, 2 = behaviour.
const step = ref<1 | 2>(1);
const step1Fields = computed(() => STEP1_FIELDS[isEdit.value ? 'edit' : 'create']);

// Template ref to the <Form> — exposes validate()/states for step-1 gating (same pattern as
// CompanyFormView).
const typeForm = ref<{
  validate: (fields?: string[]) => Promise<unknown>;
  states: Record<string, { invalid?: boolean }>;
} | null>(null);

// Step badge styling — primary once reached/passed, muted surface otherwise.
const badgeClass = (n: number) =>
  step.value >= n ? 'bg-primary text-primary-contrast' : 'bg-surface-200 text-muted-color dark:bg-surface-700';
const stepLabelClass = (n: number) => (step.value >= n ? 'font-medium text-color' : 'text-muted-color');

// Advance only once the identity fields are valid, so a bad code can't hide behind step 2.
async function goNext() {
  await typeForm.value?.validate(step1Fields.value);
  const st = typeForm.value?.states ?? {};
  if (!step1Fields.value.some((f) => st[f]?.invalid)) step.value = 2;
}

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) {
    // The offending field may be back on step 1, where the user can't see it — go fix it there.
    const errors = (e.errors ?? {}) as unknown as Record<string, unknown>;
    if (step1Fields.value.some((f) => errors[f])) step.value = 1;
    return;
  }
  saving.value = true;
  const ok = isEdit.value
    ? await cfg.updateDocumentType(id.value!, e.values)
    : await cfg.createDocumentType(e.values);
  saving.value = false;
  if (ok) {
    fb.success(t(isEdit.value ? 'feedback.updated' : 'feedback.created'));
    backToList();
  } else fb.error(cfg.error);
}

onMounted(async () => {
  // Await both before the form exists — see `loaded`. The store reloads itself after every
  // mutation, so only fetch when this is the first section entered.
  await Promise.all([
    cfg.documentTypes.length ? Promise.resolve() : cfg.loadAll(),
    accounts.selectable.length ? Promise.resolve() : accounts.loadSelectable(), // GL picker options
  ]);
  loaded.value = true;
});
</script>

<template>
  <div>
    <PageHeader
      :title="$t(isEdit ? 'admin.docConfig.editType' : 'admin.docConfig.newDocumentType')"
      :subtitle="isEdit ? existing?.code : $t('admin.docConfig.newTypeSubtitle')"
    >
      <template #actions>
        <!-- Named for its destination: step 2's footer also has a "Back", and that one only
             steps the wizard. Two identically-labelled buttons doing different things is a trap. -->
        <Button :label="$t('admin.docConfig.backToTypes')" icon="pi pi-arrow-left" text size="small" @click="backToList" />
      </template>
    </PageHeader>

    <Message v-if="notFound" severity="warn" class="mb-3" data-testid="type-not-found">
      {{ $t('admin.docConfig.typeNotFound') }}
    </Message>

    <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
      <!-- LEFT: decorative illustration; accent follows the theme primary. -->
      <aside class="hidden lg:flex lg:col-span-2 flex-col items-center justify-center gap-6 px-4">
        <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-sm" />
        <div class="text-center max-w-sm">
          <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.docConfig.fields.documentType') }}</h2>
          <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.docConfig.newTypeHelp') }}</p>
        </div>
      </aside>

      <!-- RIGHT: the document-type form -->
      <div class="lg:col-span-3">
        <div class="card mb-0!">
          <Form
            v-if="ready"
            ref="typeForm"
            :key="id ?? 'create'"
            :resolver="zodResolver(isEdit ? editDocumentTypeSchema : documentTypeSchema)"
            :initialValues="initialValues"
            @submit="onSubmit"
          >
            <Fluid class="flex flex-col gap-5">
              <!-- Wizard step header. -->
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold transition-colors" :class="badgeClass(1)">
                    <i v-if="step > 1" class="pi pi-check text-xs" />
                    <template v-else>1</template>
                  </span>
                  <span class="text-sm truncate" :class="stepLabelClass(1)">{{ $t('admin.docConfig.fields.basics') }}</span>
                </div>
                <div class="flex-1 h-px bg-surface-200 dark:bg-surface-700" />
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold transition-colors" :class="badgeClass(2)">2</span>
                  <span class="text-sm truncate" :class="stepLabelClass(2)">{{ $t('admin.docConfig.fields.behaviour') }}</span>
                </div>
              </div>

              <DocTypeFormFields
                :mode="isEdit ? 'edit' : 'create'"
                :step="step"
                :categories="categories"
                :postActions="postActions"
                :printTemplates="printTemplates"
                :accountOptions="accountOptions"
              />

              <div class="flex justify-between gap-2 border-t border-surface-200 dark:border-surface-700 pt-5">
                <Button
                  :label="step === 1 ? $t('common.cancel') : $t('common.back')"
                  :icon="step === 1 ? undefined : 'pi pi-arrow-left'"
                  severity="secondary"
                  text
                  @click="step === 1 ? backToList() : (step = 1)"
                />
                <Button v-if="step === 1" type="button" icon="pi pi-arrow-right" iconPos="right" :label="$t('common.next')" @click="goNext" />
                <Button
                  v-else
                  v-can="'DOC_CONFIG_MANAGE'"
                  type="submit"
                  :icon="isEdit ? 'pi pi-check' : 'pi pi-plus'"
                  :loading="saving"
                  :label="$t(isEdit ? 'common.save' : 'common.create')"
                />
              </div>
            </Fluid>
          </Form>
        </div>
      </div>
    </div>
  </div>
</template>
