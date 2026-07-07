<script setup lang="ts">
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../../api/client';
import AuthShell from './AuthShell.vue';
import type { FormSubmitEvent } from '@primevue/forms';
import { forgotPasswordSchema } from '@erp/shared';

const router = useRouter();
const resolver = zodResolver(forgotPasswordSchema);
const initialValues = ref({ identifier: '' });
const busy = ref(false);

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  busy.value = true;
  try {
    await api.post('/auth/password/forgot', { identifier: e.values.identifier });
  } catch {
    // Anti-enumeration: never surface success/failure of the lookup. Any error
    // (including "not found") resolves to the same neutral confirmation.
  } finally {
    busy.value = false;
    await router.push({ name: 'forgot-password-sent' });
  }
}
</script>

<template>
  <AuthShell
    :title="$t('auth.forgotPassword.title')"
    :subtitle="$t('auth.forgotPassword.subtitle')"
    icon="pi-key"
  >
    <Form
      :resolver="resolver"
      :initialValues="initialValues"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <FormField v-slot="$field" name="identifier" class="flex flex-col gap-2">
        <label for="identifier" class="text-sm font-medium text-color">
          {{ $t('auth.forgotPassword.identifier') }}
        </label>
        <IconField>
          <InputIcon class="pi pi-user" />
          <InputText id="identifier" type="text" autocomplete="username" fluid />
        </IconField>
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
          {{ $field.error?.message }}
        </Message>
      </FormField>

      <Button
        type="submit"
        :label="$t('auth.forgotPassword.submit')"
        :loading="busy"
        class="mt-1"
        fluid
      />
    </Form>

    <template #footer>
      <RouterLink :to="{ name: 'login' }" class="text-primary hover:underline">
        {{ $t('auth.forgotPassword.backToLogin') }}
      </RouterLink>
    </template>
  </AuthShell>
</template>
