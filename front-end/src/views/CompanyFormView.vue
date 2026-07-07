<script setup lang="ts">
import { companyCreateSchema } from '@erp/shared';
import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { ref } from 'vue';
import PageHeader from '@/components/PageHeader.vue';
import type { FormSubmitEvent } from '@primevue/forms';

// One Zod schema, shared with the backend DTO (@erp/shared) — no client/server drift.
const resolver = zodResolver(companyCreateSchema);

const initialValues = ref({
  code: '',
  nameTh: '',
  nameEn: '',
  taxId: '',
  branchCode: '00000',
  baseCurrency: 'THB',
});

const submitted = ref<Record<string, unknown> | null>(null);

function onFormSubmit(e: FormSubmitEvent) {
  if (e.valid) {
    submitted.value = e.values;
    // A real screen would POST e.values via the typed api client.
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('auth.company.createTitle')" />

    <div class="card max-w-xl">
      <Form
        :resolver="resolver"
        :initialValues="initialValues"
        class="flex flex-col gap-4"
        @submit="onFormSubmit"
      >
        <FormField v-slot="$field" name="code" class="flex flex-col gap-1">
          <label for="code" class="text-sm text-muted-color">{{ $t('auth.company.code') }}</label>
          <InputText id="code" type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
            {{ $field.error?.message }}
          </Message>
        </FormField>

        <FormField v-slot="$field" name="nameTh" class="flex flex-col gap-1">
          <label for="nameTh" class="text-sm text-muted-color">{{ $t('auth.company.nameTh') }}</label>
          <InputText id="nameTh" type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
            {{ $field.error?.message }}
          </Message>
        </FormField>

        <FormField v-slot="$field" name="taxId" class="flex flex-col gap-1">
          <label for="taxId" class="text-sm text-muted-color">{{ $t('auth.company.taxId') }}</label>
          <InputText id="taxId" type="text" />
          <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
            {{ $field.error?.message }}
          </Message>
        </FormField>

        <!-- Affordance gated by permission code; server still enforces. -->
        <Button v-can="'COMPANY_MANAGE'" type="submit" :label="$t('common.create')" />
      </Form>

      <pre v-if="submitted" class="mt-4 p-3 rounded bg-surface-100 dark:bg-surface-800 text-sm">{{ submitted }}</pre>
    </div>
  </div>
</template>
