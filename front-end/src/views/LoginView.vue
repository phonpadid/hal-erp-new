<script setup lang="ts">

import { Form } from '@primevue/forms';
import { FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Message from 'primevue/message';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AuthShell from './auth/AuthShell.vue';
import type { FormSubmitEvent } from '@primevue/forms';
import { loginSchema } from '@erp/shared';

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();
const resolver = zodResolver(loginSchema);
const initialValues = ref({ username: 'admin', password: 'HAL@1419' });
const serverError = ref('');
const busy = ref(false);

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  serverError.value = '';
  busy.value = true;
  try {
    const next = await auth.login(e.values.username as string, e.values.password as string);
    await router.push({ name: next });
  } catch (err) {
    // Distinct outcome: the account is valid but its email is not yet verified.
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    serverError.value = msg === 'EMAIL_NOT_VERIFIED' ? t('auth.login.notVerified') : t('auth.login.error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthShell :title="$t('auth.login.title')">
    <Form
      :resolver="resolver"
      :initialValues="initialValues"
      class="flex flex-col gap-5"
      @submit="onSubmit"
    >
      <FormField v-slot="$field" name="username" class="flex flex-col gap-2">
        <label for="username" class="text-sm font-medium text-color">
          <span class="text-primary">*</span> {{ $t('auth.login.username') }}
        </label>
        <InputText
          id="username"
          type="text"
          autocomplete="username"
          fluid
          :placeholder="$t('auth.login.username')"
        />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
          {{ $field.error?.message }}
        </Message>
      </FormField>

      <FormField v-slot="$field" name="password" class="flex flex-col gap-2">
        <label for="password" class="text-sm font-medium text-color">
          <span class="text-primary">*</span> {{ $t('auth.login.password') }}
        </label>
        <Password
          input-id="password"
          :feedback="false"
          toggle-mask
          fluid
          autocomplete="current-password"
          :placeholder="$t('auth.login.password')"
        />
        <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
          {{ $field.error?.message }}
        </Message>
        <div class="flex justify-end">
          <RouterLink
            :to="{ name: 'forgot-password' }"
            class="text-sm font-medium text-primary hover:underline"
          >
            {{ $t('auth.login.forgotLink') }}
          </RouterLink>
        </div>
      </FormField>

      <Message v-if="serverError" severity="error" variant="simple">{{ serverError }}</Message>

      <Button type="submit" :label="$t('auth.login.submit')" :loading="busy" class="mt-1" fluid />
    </Form>
  </AuthShell>
</template>
