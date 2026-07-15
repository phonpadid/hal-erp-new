<script setup lang="ts">
import { companyCreateSchema } from '@erp/shared';
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import Fluid from 'primevue/fluid';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/PageHeader.vue';
import ProfileImagePanel from '@/components/ProfileImagePanel.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import rawIllustration from '@/assets/illustrations/undraw_filing-system_e3yo.svg?raw';
import { orgApi, uploadCompanyProfileImage } from '../../../api/org';
import { useAuthStore } from '../../../stores/auth';
import { useOrgStore } from '../../../stores/org';
import { useFeedback } from '../../../composables/useFeedback';
import type { FormSubmitEvent } from '@primevue/forms';

// Create/edit a company (COMPANY_MANAGE). One Zod schema shared with the backend DTO
// (@erp/shared) so client and server validation can't drift. `code` is immutable once set,
// so it is disabled — and stripped from the payload — in edit mode.
//
// Create is a 2-step wizard: (1) company identity → (2) letterhead contact. Both steps live
// inside a SINGLE <Form> and are toggled with v-show (never unmounted), so every field's value
// survives to one final submit. Edit is a single scrolling page — admins editing one field
// shouldn't have to walk a wizard.
const { t } = useI18n();
const fb = useFeedback();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const org = useOrgStore();

const id = computed(() => (route.params.id as string | undefined) || undefined);
const isEdit = computed(() => !!id.value);
const ready = ref(false);
const saving = ref(false);

// Wizard position (create only). 1 = identity, 2 = contact.
const step = ref<1 | 2>(1);
// Step 1 gates advancing: its fields must validate before step 2 shows.
const STEP1_FIELDS = ['code', 'nameTh', 'nameEn', 'taxId', 'branchCode', 'baseCurrency'];

const resolver = zodResolver(companyCreateSchema);
const initialValues = ref<Record<string, unknown>>({});

// The edited company's current logo (fetched on open; presign needs an existing id).
const companyImageUrl = ref<string | null>(null);

// Template ref to the <Form> — exposes validate()/states for step-1 gating (same pattern as
// BudgetFormView calling setFieldValue on the ref).
const companyForm = ref<{
  validate: (fields?: string[]) => Promise<unknown>;
  states: Record<string, { invalid?: boolean }>;
} | null>(null);

onMounted(async () => {
  if (!org.currencies.length) await org.loadCurrencies();
  if (isEdit.value) {
    const c = await orgApi.companies.get(id.value!);
    initialValues.value = {
      code: c.code,
      nameTh: c.nameTh,
      nameEn: c.nameEn ?? '',
      taxId: c.taxId ?? '',
      branchCode: c.branchCode ?? '00000',
      baseCurrency: c.baseCurrency?.code ?? 'THB',
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      website: c.website ?? '',
    };
    companyImageUrl.value = (await orgApi.companies.profileImage(id.value!)).profileImageUrl;
  } else {
    initialValues.value = {
      code: '',
      nameTh: '',
      nameEn: '',
      taxId: '',
      branchCode: '00000',
      baseCurrency: 'THB',
      address: '',
      phone: '',
      email: '',
      website: '',
    };
  }
  ready.value = true;
});

function uploadCompanyImage(file: File): Promise<string> {
  return uploadCompanyProfileImage(id.value!, file);
}

// Advance to step 2 only when the identity fields are valid.
async function goNext() {
  await companyForm.value?.validate(STEP1_FIELDS);
  const st = companyForm.value?.states ?? {};
  const blocked = STEP1_FIELDS.some((f) => st[f]?.invalid);
  if (!blocked) step.value = 2;
}

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) {
    // A remaining error can only be an identity field — send the user back to fix it.
    if (!isEdit.value && STEP1_FIELDS.some((f) => (e.errors as unknown as Record<string, unknown>)?.[f])) {
      step.value = 1;
    }
    return;
  }
  saving.value = true;
  try {
    if (isEdit.value) {
      // `code` is immutable: the field is disabled but @primevue/forms still submits its
      // initial value, and the update DTO (whitelist) rejects it. Omit it from the payload.
      const payload = { ...e.values };
      delete payload.code;
      const ok = await org.updateCompany(id.value!, payload);
      if (!ok) { fb.error(org.error); return; }
      fb.success(t('feedback.updated'));
      await router.push({ name: 'org-companies' });
    } else {
      const created = await orgApi.companies.create(e.values);
      await org.loadCompanies();
      fb.success(t('feedback.created'));
      // Land on the edit page of the new company so the admin can add its logo next.
      await router.push({ name: 'company-edit', params: { id: created.id } });
    }
  } catch (err) {
    fb.error(err, t('admin.org.form.failed'));
  } finally {
    saving.value = false;
  }
}

const can = (c: string) => auth.can(c);

// Step badge styling — primary once reached/passed, muted surface otherwise.
const badgeClass = (n: number) =>
  step.value >= n
    ? 'bg-primary text-primary-contrast'
    : 'bg-surface-200 text-muted-color dark:bg-surface-700';
const stepLabelClass = (n: number) =>
  step.value >= n ? 'font-medium text-color' : 'text-muted-color';
</script>

<template>
  <div class="w-full">
    <PageHeader
      :title="isEdit ? $t('admin.org.form.editTitle') : $t('admin.org.form.createTitle')"
      :subtitle="isEdit ? $t('admin.org.form.subtitleEdit') : $t('admin.org.form.subtitleCreate')"
    >
      <template #actions>
        <Button :label="$t('common.back')" icon="pi pi-arrow-left" text @click="router.back()" />
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
      <!-- LEFT: decorative illustration; accent follows the theme primary. -->
      <aside class="hidden lg:flex lg:col-span-2 lg:self-center flex-col items-center justify-center gap-6 px-4">
        <ThemedIllustration :svg="rawIllustration" accent="#F50057" class="w-full max-w-sm" />
        <div class="text-center max-w-sm">
          <h2 class="text-lg font-semibold text-color m-0">{{ $t('admin.org.form.section') }}</h2>
          <p class="text-muted-color text-sm mt-2 mb-0">{{ $t('admin.org.form.sectionHint') }}</p>
        </div>
      </aside>

      <!-- RIGHT: the form -->
      <div class="lg:col-span-3">
        <Form
          v-if="ready"
          ref="companyForm"
          :key="isEdit ? 'edit' : 'create'"
          :resolver="resolver"
          :initialValues="initialValues"
          @submit="onSubmit"
        >
          <Fluid>
            <div class="card mb-0!">
              <!-- Wizard step header — create only. -->
              <div v-if="!isEdit" class="flex items-center gap-3 mb-6">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold transition-colors" :class="badgeClass(1)">
                    <i v-if="step > 1" class="pi pi-check text-xs" />
                    <template v-else>1</template>
                  </span>
                  <span class="text-sm truncate" :class="stepLabelClass(1)">{{ $t('admin.org.form.steps.identity') }}</span>
                </div>
                <div class="flex-1 h-px bg-surface-200 dark:bg-surface-700" />
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold transition-colors" :class="badgeClass(2)">2</span>
                  <span class="text-sm truncate" :class="stepLabelClass(2)">{{ $t('admin.org.form.steps.contact') }}</span>
                </div>
              </div>

              <div class="flex flex-col gap-5">
                <!-- Company logo — edit only (presign needs an existing id). -->
                <ProfileImagePanel
                  v-if="isEdit"
                  :url="companyImageUrl"
                  :upload="uploadCompanyImage"
                  :canEdit="can('COMPANY_MANAGE')"
                  :size="140"
                  @uploaded="(u) => (companyImageUrl = u)"
                />

                <!-- STEP 1 — Company identity. -->
                <div v-show="isEdit || step === 1" class="flex flex-col gap-5">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FormField v-slot="$f" name="code" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('common.code') }}</label>
                      <IconField>
                        <InputIcon class="pi pi-hashtag" />
                        <InputText type="text" :disabled="isEdit" :invalid="$f?.invalid" />
                      </IconField>
                      <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                    </FormField>

                    <FormField v-slot="$f" name="branchCode" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.branchCode') }}</label>
                      <InputText type="text" :invalid="$f?.invalid" />
                      <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                    </FormField>
                  </div>

                  <FormField v-slot="$f" name="nameTh" class="flex flex-col gap-1.5">
                    <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.nameTh') }}</label>
                    <IconField>
                      <InputIcon class="pi pi-building" />
                      <InputText type="text" :invalid="$f?.invalid" />
                    </IconField>
                    <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                  </FormField>

                  <FormField name="nameEn" class="flex flex-col gap-1.5">
                    <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.nameEn') }}</label>
                    <InputText type="text" />
                  </FormField>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FormField v-slot="$f" name="taxId" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.taxId') }}</label>
                      <InputText type="text" :invalid="$f?.invalid" />
                      <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                    </FormField>

                    <FormField name="baseCurrency" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.baseCurrency') }}</label>
                      <Select :options="org.currencies" optionLabel="code" optionValue="code" filter editable :placeholder="$t('common.select')">
                        <template #dropdownicon><i class="pi pi-money-bill" /></template>
                      </Select>
                    </FormField>
                  </div>
                </div>

                <!-- Divider between groups — edit only (single page). -->
                <Divider v-if="isEdit" class="my-1!" />

                <!-- STEP 2 — Letterhead contact block (printed on the document PDF footer). -->
                <div v-show="isEdit || step === 2" class="flex flex-col gap-5">
                  <div>
                    <h3 class="text-sm font-semibold text-color m-0">{{ $t('admin.org.form.contactSection') }}</h3>
                    <p class="text-muted-color text-xs mt-1 mb-0">{{ $t('admin.org.form.contactHint') }}</p>
                  </div>

                  <FormField name="address" class="flex flex-col gap-1.5">
                    <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.address') }}</label>
                    <IconField>
                      <InputIcon class="pi pi-map-marker" />
                      <InputText type="text" :placeholder="$t('admin.org.fields.addressPlaceholder')" />
                    </IconField>
                  </FormField>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FormField name="phone" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.phone') }}</label>
                      <IconField>
                        <InputIcon class="pi pi-phone" />
                        <InputText type="text" />
                      </IconField>
                    </FormField>

                    <FormField v-slot="$f" name="email" class="flex flex-col gap-1.5">
                      <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.email') }}</label>
                      <IconField>
                        <InputIcon class="pi pi-envelope" />
                        <InputText type="text" inputmode="email" :invalid="$f?.invalid" />
                      </IconField>
                      <Message v-if="$f?.invalid" severity="error" size="small" variant="simple">{{ $f.error?.message }}</Message>
                    </FormField>
                  </div>

                  <FormField name="website" class="flex flex-col gap-1.5">
                    <label class="text-sm font-medium text-color">{{ $t('admin.org.fields.website') }}</label>
                    <IconField>
                      <InputIcon class="pi pi-globe" />
                      <InputText type="text" :placeholder="$t('admin.org.fields.websitePlaceholder')" />
                    </IconField>
                  </FormField>
                </div>
              </div>
            </div>
          </Fluid>

          <!-- Footer — edit: Cancel/Save; create: wizard nav. -->
          <div v-if="isEdit" class="flex justify-end gap-2 mt-2">
            <Button :label="$t('common.cancel')" severity="secondary" text @click="router.back()" />
            <Button v-can="'COMPANY_MANAGE'" type="submit" :loading="saving" icon="pi pi-check" :label="$t('common.save')" />
          </div>
          <div v-else class="flex justify-between gap-2 mt-2">
            <Button
              :label="step === 1 ? $t('common.cancel') : $t('common.back')"
              :icon="step === 1 ? undefined : 'pi pi-arrow-left'"
              severity="secondary"
              text
              @click="step === 1 ? router.back() : (step = 1)"
            />
            <Button v-if="step === 1" type="button" icon="pi pi-arrow-right" iconPos="right" :label="$t('common.next')" @click="goNext" />
            <Button v-else v-can="'COMPANY_MANAGE'" type="submit" :loading="saving" icon="pi pi-plus" :label="$t('common.create')" />
          </div>
        </Form>
      </div>
    </div>
  </div>
</template>
