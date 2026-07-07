<script setup lang="ts">
import { Form, FormField } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers/zod';
import axios from 'axios';
import Avatar from 'primevue/avatar';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import PageHeader from '@/components/PageHeader.vue';
import ErrorState from '@/components/ErrorState.vue';
import EmptyState from '@/components/EmptyState.vue';
import ThemedIllustration from '@/components/ThemedIllustration.vue';
import { profileApi, type OwnProfile } from '../api/profile';
import type { FormSubmitEvent } from '@primevue/forms';
import { changePasswordFormSchema } from '@erp/shared';
// Decorative illustrations (accent #F50057 re-tints to the theme primary via ThemedIllustration).
import headerArt from '@/assets/illustrations/undraw_online-profile_v9c1.svg?raw';
import employeeEmptyArt from '@/assets/illustrations/undraw_user-account_fvqa.svg?raw';
import accessEmptyArt from '@/assets/illustrations/undraw_checking-boxes_j0im.svg?raw';
import passwordArt from '@/assets/illustrations/undraw_all-checked_d3u6.svg?raw';

const { t, te } = useI18n();

const profile = ref<OwnProfile | null>(null);
const loading = ref(true);
const loadError = ref(false);

// --- Presentation helpers (no upload; identity derives entirely from the profile response) ---

/** Display name: the linked employee's full name when present, else the username. */
const displayName = computed(
  () => profile.value?.employee?.fullName || profile.value?.username || '',
);

/** 1–2 initials from the first/second whitespace tokens; safe fallback so it never crashes. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? (parts[1][0] ?? '') : '';
  return (first + second).toUpperCase() || '?';
}

// Deterministic avatar tone from the username so it is stable per user; PrimeUI palette tokens
// keep it legible in light and dark.
const AVATAR_TONES = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-cyan-500',
  'bg-pink-500',
];
function avatarClass(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${AVATAR_TONES[h % AVATAR_TONES.length]} text-white`;
}

/** Permissions grouped by scope in a fixed order, unknown scopes appended, for read-only display. */
const SCOPE_ORDER = ['OWN', 'DEPARTMENT', 'COMPANY', 'GROUP'];
const permsByScope = computed(() => {
  const map = new Map<string, string[]>();
  for (const p of profile.value?.permissions ?? []) {
    const codes = map.get(p.scope) ?? [];
    codes.push(p.code);
    map.set(p.scope, codes);
  }
  const ordered = [
    ...SCOPE_ORDER.filter((s) => map.has(s)),
    ...[...map.keys()].filter((s) => !SCOPE_ORDER.includes(s)),
  ];
  return ordered.map((scope) => ({ scope, codes: map.get(scope)! }));
});
const scopeLabel = (scope: string) =>
  te(`profile.access.scope.${scope}`) ? t(`profile.access.scope.${scope}`) : scope;

// --- Change-password form state. The form is remounted (via `formKey`) on success so its
// fields clear. Server errors are inline: a wrong current password reads as a distinct,
// non-disclosing message (401), anything else as a generic failure. ---
const resolver = zodResolver(changePasswordFormSchema);
const initialValues = { currentPassword: '', newPassword: '', confirmPassword: '' };
const formKey = ref(0);
const busy = ref(false);
const success = ref(false);
const wrongCurrent = ref(false);
const serverError = ref(false);

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    profile.value = await profileApi.get();
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onSubmit(e: FormSubmitEvent) {
  if (!e.valid) return;
  success.value = false;
  wrongCurrent.value = false;
  serverError.value = false;
  busy.value = true;
  try {
    await profileApi.changePassword({
      currentPassword: e.values.currentPassword,
      newPassword: e.values.newPassword,
    });
    success.value = true;
    formKey.value += 1; // remount the form → fields cleared
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      wrongCurrent.value = true;
    } else {
      serverError.value = true;
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="$t('profile.title')" :subtitle="$t('profile.subtitle')" />

    <div v-if="loading" class="flex justify-center py-10">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" strokeWidth="4" />
    </div>

    <ErrorState v-else-if="loadError" :message="$t('profile.loadError')" @retry="load" />

    <div v-else-if="profile" class="flex flex-col gap-6">
      <!-- Profile header (hero): avatar + identity, with a decorative illustration on the side. -->
      <div class="card overflow-hidden">
        <div class="flex flex-col sm:flex-row sm:items-center gap-6">
          <Avatar
            :label="initials(displayName)"
            shape="circle"
            size="xlarge"
            :class="[avatarClass(profile.username), 'shrink-0 font-semibold']"
            style="width: 5rem; height: 5rem; font-size: 1.75rem"
          />
          <div class="min-w-0 flex-1">
            <h2 class="text-2xl font-semibold text-color m-0 truncate">{{ displayName }}</h2>
            <p
              v-if="profile.employee"
              class="text-muted-color text-sm mt-1 mb-0 truncate"
            >
              <span v-if="profile.employee.position">{{ profile.employee.position }} · </span>
              {{ profile.employee.departmentName }}
            </p>
            <p class="text-muted-color text-sm mt-1 mb-0 truncate">
              <i class="pi pi-user text-xs mr-1" />{{ profile.username }}
            </p>

            <div class="flex flex-wrap items-center gap-2 mt-3">
              <Tag
                :severity="profile.emailVerifiedAt ? 'success' : 'warn'"
                :icon="profile.emailVerifiedAt ? 'pi pi-verified' : 'pi pi-exclamation-circle'"
                :value="profile.emailVerifiedAt ? $t('profile.identity.verifiedYes') : $t('profile.identity.verifiedNo')"
              />
              <Tag
                v-for="role in profile.roles"
                :key="role"
                :value="role"
                severity="info"
                icon="pi pi-shield"
              />
              <Tag
                v-if="!profile.roles.length"
                :value="$t('profile.header.noRolesBadge')"
                severity="secondary"
              />
            </div>
          </div>

          <!-- Decorative only: hidden on small screens, never load-bearing (aria-hidden inside). -->
          <ThemedIllustration
            :svg="headerArt"
            accent="#F50057"
            class="hidden md:block w-56 shrink-0 opacity-90"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Account (read-only) -->
        <div class="card">
          <h2 class="flex items-center gap-2 text-lg font-semibold text-color mt-0 mb-4">
            <i class="pi pi-user text-primary" />{{ $t('profile.identity.heading') }}
          </h2>
          <dl class="grid grid-cols-3 gap-y-3 text-sm m-0">
            <dt class="text-muted-color col-span-1">{{ $t('profile.identity.username') }}</dt>
            <dd class="text-color col-span-2 m-0">{{ profile.username }}</dd>

            <dt class="text-muted-color col-span-1">{{ $t('profile.identity.email') }}</dt>
            <dd class="text-color col-span-2 m-0 break-all">{{ profile.email }}</dd>

            <dt class="text-muted-color col-span-1">{{ $t('profile.identity.emailVerified') }}</dt>
            <dd class="col-span-2 m-0">
              <Message
                :severity="profile.emailVerifiedAt ? 'success' : 'warn'"
                variant="simple"
                size="small"
              >
                {{ profile.emailVerifiedAt ? $t('profile.identity.verifiedYes') : $t('profile.identity.verifiedNo') }}
              </Message>
            </dd>

            <dt class="text-muted-color col-span-1">{{ $t('profile.identity.status') }}</dt>
            <dd class="text-color col-span-2 m-0">{{ profile.status }}</dd>
          </dl>
        </div>

        <!-- Employee (only when linked in the active company) -->
        <div class="card">
          <h2 class="flex items-center gap-2 text-lg font-semibold text-color mt-0 mb-4">
            <i class="pi pi-id-card text-primary" />{{ $t('profile.employee.heading') }}
          </h2>
          <dl v-if="profile.employee" class="grid grid-cols-3 gap-y-3 text-sm m-0">
            <dt class="text-muted-color col-span-1">{{ $t('profile.employee.fullName') }}</dt>
            <dd class="text-color col-span-2 m-0">{{ profile.employee.fullName }}</dd>

            <dt class="text-muted-color col-span-1">{{ $t('profile.employee.position') }}</dt>
            <dd class="text-color col-span-2 m-0">{{ profile.employee.position ?? '—' }}</dd>

            <dt class="text-muted-color col-span-1">{{ $t('profile.employee.department') }}</dt>
            <dd class="text-color col-span-2 m-0">{{ profile.employee.departmentName }}</dd>
          </dl>
          <EmptyState
            v-else
            :illustration="employeeEmptyArt"
            accent="#F50057"
            :title="$t('profile.employee.none')"
          />
        </div>

        <!-- Roles & Permissions (read-only, active company only) -->
        <div class="card lg:col-span-2">
          <h2 class="flex items-center gap-2 text-lg font-semibold text-color mt-0 mb-4">
            <i class="pi pi-shield text-primary" />{{ $t('profile.access.heading') }}
          </h2>

          <h3 class="text-sm font-medium text-muted-color mt-0 mb-2">{{ $t('profile.access.rolesHeading') }}</h3>
          <div v-if="profile.roles.length" class="flex flex-wrap gap-2 mb-6">
            <Tag v-for="role in profile.roles" :key="role" :value="role" severity="info" icon="pi pi-shield" />
          </div>
          <EmptyState
            v-else
            :illustration="accessEmptyArt"
            accent="#F50057"
            :title="$t('profile.access.noRoles')"
            class="mb-6"
          />

          <h3 class="text-sm font-medium text-muted-color mt-0 mb-3">{{ $t('profile.access.permissionsHeading') }}</h3>
          <div v-if="permsByScope.length" class="flex flex-col gap-5">
            <div v-for="group in permsByScope" :key="group.scope">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-sm font-medium text-color">{{ scopeLabel(group.scope) }}</span>
                <span
                  class="inline-flex items-center justify-center text-xs rounded-full bg-surface-100 dark:bg-surface-800 text-muted-color px-2 py-0.5"
                >{{ group.codes.length }}</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <Tag v-for="code in group.codes" :key="code" :value="code" severity="secondary" />
              </div>
            </div>
          </div>
          <EmptyState
            v-else
            :illustration="accessEmptyArt"
            accent="#F50057"
            :title="$t('profile.access.noPermissions')"
          />
        </div>
      </div>

      <!-- Change password -->
      <div class="card">
        <h2 class="flex items-center gap-2 text-lg font-semibold text-color mt-0 mb-4">
          <i class="pi pi-lock text-primary" />{{ $t('profile.changePassword.heading') }}
        </h2>
        <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:items-center">
          <!-- Decorative supporting illustration; hidden on small screens. -->
          <aside class="hidden lg:flex lg:col-span-2 items-center justify-center px-4">
            <ThemedIllustration :svg="passwordArt" accent="#F50057" class="w-full max-w-xs opacity-90" />
          </aside>

          <div class="lg:col-span-3">
            <Form
              :key="formKey"
              :resolver="resolver"
              :initialValues="initialValues"
              class="flex flex-col gap-5"
              @submit="onSubmit"
            >
              <FormField v-slot="$field" name="currentPassword" class="flex flex-col gap-2">
                <label for="currentPassword" class="text-sm font-medium text-color">
                  {{ $t('profile.changePassword.current') }}
                </label>
                <Password input-id="currentPassword" :feedback="false" toggle-mask fluid autocomplete="current-password" />
                <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
                  {{ $field.error?.message }}
                </Message>
              </FormField>

              <FormField v-slot="$field" name="newPassword" class="flex flex-col gap-2">
                <label for="newPassword" class="text-sm font-medium text-color">
                  {{ $t('profile.changePassword.new') }}
                </label>
                <Password
                  input-id="newPassword"
                  toggle-mask
                  fluid
                  autocomplete="new-password"
                  :prompt-label="$t('profile.changePassword.strength.prompt')"
                  :weak-label="$t('profile.changePassword.strength.weak')"
                  :medium-label="$t('profile.changePassword.strength.medium')"
                  :strong-label="$t('profile.changePassword.strength.strong')"
                />
                <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
                  {{ $field.error?.message }}
                </Message>
              </FormField>

              <FormField v-slot="$field" name="confirmPassword" class="flex flex-col gap-2">
                <label for="confirmPassword" class="text-sm font-medium text-color">
                  {{ $t('profile.changePassword.confirm') }}
                </label>
                <Password
                  input-id="confirmPassword"
                  toggle-mask
                  fluid
                  autocomplete="new-password"
                  :prompt-label="$t('profile.changePassword.strength.prompt')"
                  :weak-label="$t('profile.changePassword.strength.weak')"
                  :medium-label="$t('profile.changePassword.strength.medium')"
                  :strong-label="$t('profile.changePassword.strength.strong')"
                />
                <Message v-if="$field?.invalid" severity="error" size="small" variant="simple">
                  {{ $field.error?.message }}
                </Message>
              </FormField>

              <Message v-if="success" severity="success" variant="simple">
                {{ $t('profile.changePassword.success') }}
              </Message>
              <Message v-if="wrongCurrent" severity="error" variant="simple">
                {{ $t('profile.changePassword.wrongCurrent') }}
              </Message>
              <Message v-if="serverError" severity="error" variant="simple">
                {{ $t('profile.changePassword.error') }}
              </Message>

              <Button
                type="submit"
                :label="$t('profile.changePassword.submit')"
                :loading="busy"
                class="mt-1"
              />
            </Form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
