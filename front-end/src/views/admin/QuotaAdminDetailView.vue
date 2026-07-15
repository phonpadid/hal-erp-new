<script setup lang="ts">
import {
  adjustEntitlementSchema,
  carryForwardSchema,
  entitlementSchema,
} from "@erp/shared";
import { Form, FormField } from "@primevue/forms";
import { zodResolver } from "@primevue/forms/resolvers/zod";
import Button from "primevue/button";
import Column from "primevue/column";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useFeedback } from "../../composables/useFeedback";
import DetailHeader from "@/components/DetailHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import StatTiles, { type StatTile } from "@/components/reports/StatTiles.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import AppDataTable from "@/components/AppDataTable.vue";
import { useAuthStore } from "../../stores/auth";
import { useBreadcrumb } from "../../composables/useBreadcrumb";
import { useQuotaAdminStore } from "../../stores/quotaAdmin";
import type { FormSubmitEvent } from "@primevue/forms";
import type { EntitlementRow } from "../../api/quotas";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const fb = useFeedback();
const auth = useAuthStore();
const store = useQuotaAdminStore();
const canManage = computed(() => auth.can("QUOTA_MANAGE"));

const quotaId = route.params.id as string;
const currentYear = new Date().getUTCFullYear();
const entYear = ref(currentYear);
// DatePicker binds a Date; keep `entYear` numeric (what loadEntitlements and the
// dialogs expect) by mapping to/from Jan 1 of the picked year.
const entYearDate = computed({
  get: () => new Date(entYear.value, 0, 1),
  set: (d: Date | null) => {
    if (d) entYear.value = d.getFullYear();
  },
});

const entDialog = ref(false);
const adjustDialog = ref<{ open: boolean; row?: EntitlementRow }>({
  open: false,
});
const carryDialog = ref(false);

const ctx = computed(() => store.quotaContext);
// Breadcrumb leaf: Quota admin (route meta) → this quota's type.
useBreadcrumb(() => (ctx.value?.quotaType ? [{ label: ctx.value.quotaType }] : []));
const levelLabel = computed(
  () => ctx.value?.levelName || t("admin.quotaAdmin.companyWide"),
);
const subtitle = computed(() =>
  ctx.value
    ? `${levelLabel.value} · ${ctx.value.resetCycle} · ${ctx.value.unit}`
    : "",
);

const tiles = computed<StatTile[]>(() => {
  const c = ctx.value;
  if (!c) return [];
  return [
    { label: t("admin.quotaAdmin.columns.limit"), value: `${c.limitValue} ${c.unit}`, icon: "pi-sliders-h", tone: "primary" },
    { label: t("admin.quotaAdmin.columns.reset"), value: c.resetCycle, icon: "pi-refresh", tone: "info" },
    { label: t("admin.quotaAdmin.columns.carry"), value: c.carryForward ? t("common.yes") : t("common.no"), icon: "pi-forward", tone: c.carryForward ? "success" : "warn" },
    { label: t("admin.quotaAdmin.columns.poolRemaining"), value: `${c.poolRemaining} ${c.unit}`, icon: "pi-wallet", tone: Number(c.poolRemaining) < 0 ? "danger" : "success" },
  ];
});

function reload() {
  store.loadEntitlements(quotaId, entYear.value);
}

// Reload as soon as a new year is picked — no explicit Filter button needed.
watch(entYear, () => reload());

async function submitEntitlement(e: FormSubmitEvent) {
  if (!e.valid) return;
  // quotaId is context (the routed quota), not a rendered FormField, so it isn't in
  // e.values — merge it. (@primevue/forms only emits registered fields.)
  if (await store.upsertEntitlement({ ...e.values, quotaId })) {
    entDialog.value = false;
    fb.success(t("feedback.updated"));
  } else fb.error(store.error);
}

async function submitAdjust(e: FormSubmitEvent) {
  if (!e.valid) return;
  // The adjusted row's quota/employee/year are context, not rendered FormFields — merge them.
  const payload = {
    ...e.values,
    quotaId,
    employeeId: adjustDialog.value.row?.employeeId,
    year: adjustDialog.value.row?.year ?? entYear.value,
  };
  if (await store.adjustEntitlement(payload)) {
    adjustDialog.value.open = false;
    fb.success(t("feedback.updated"));
  } else fb.error(store.error);
}

async function submitCarryForward(e: FormSubmitEvent) {
  if (!e.valid) return;
  const carries = ctx.value?.resetCycle && ctx.value.resetCycle !== "NONE";
  if (await store.carryForward({ ...e.values, quotaId })) {
    carryDialog.value = false;
    fb.success(
      t(carries ? "admin.quotaAdmin.carryDone" : "admin.quotaAdmin.carryNone"),
    );
  } else fb.error(store.error);
}

onMounted(() => {
  store.loadQuotaContext(quotaId);
  store.loadEntitlements(quotaId, currentYear);
  // The Set-entitlement dialog's employee <Select> reads store.employees. On a direct
  // visit/refresh of this detail URL the list view never ran, so options would be empty
  // and no employee could be picked — load them here too (self-guards on read perms).
  if (canManage.value) store.loadOptions();
});
</script>

<template>
  <div>
    <!-- Quota context: standalone stat cards above the header -->
    <StatTiles v-if="ctx" :tiles="tiles" class="mb-4" />

    <DetailHeader
      :title="ctx?.quotaType ?? $t('admin.quotaAdmin.title')"
      :subtitle="subtitle"
    >
      <template #actions>
        <Button
          :label="$t('common.back')"
          icon="pi pi-arrow-left"
          text
          @click="router.push({ name: 'quota-admin' })"
        />
      </template>
    </DetailHeader>

    <PageToolbar>
      <template #filters>
        <DatePicker
          v-model="entYearDate"
          view="year"
          dateFormat="yy"
          showIcon
          iconDisplay="input"
        />

        <!-- <Button :label="$t('common.filter')" outlined @click="reload" /> -->
      </template>
      <template #actions>
        <Button
          v-if="canManage"
          :label="$t('admin.quotaAdmin.setEntitlement')"
          icon="pi pi-plus"
          size="small"
          @click="entDialog = true"
        />
        <Button
          v-if="canManage"
          :label="$t('admin.quotaAdmin.carryForward')"
          icon="pi pi-forward"
          size="small"
          outlined
          @click="carryDialog = true"
        />
      </template>
    </PageToolbar>

    <ErrorState
      v-if="store.error && !store.entitlements.length"
      :message="store.error"
      @retry="reload"
    />

    <div v-else class="card">
      <AppDataTable
        :value="store.entitlements"
        :total="store.entitlements.length"
        :loading="store.loading"
        dataKey="employeeId"
        :paginator="false"
      >
        <Column
          field="employeeName"
          :header="$t('admin.quotaAdmin.columns.employee')"
        />
        <Column field="year" :header="$t('admin.quotaAdmin.columns.year')" />
        <Column
          field="entitledValue"
          :header="$t('admin.quotaAdmin.columns.entitledBase')"
        />
        <Column
          field="carriedOver"
          :header="$t('admin.quotaAdmin.columns.carried')"
        />
        <Column
          field="adjusted"
          :header="$t('admin.quotaAdmin.columns.adjusted')"
        />
        <Column
          field="entitled"
          :header="$t('admin.quotaAdmin.columns.entitledTotal')"
        />
        <Column field="used" :header="$t('admin.quotaAdmin.columns.used')" />
        <Column
          field="remaining"
          :header="$t('admin.quotaAdmin.columns.remaining')"
        />
        <Column header="">
          <template #body="{ data }">
            <Button
              v-if="canManage"
              icon="pi pi-sliders-h"
              text
              size="small"
              :title="$t('admin.quotaAdmin.adjust')"
              @click="adjustDialog = { open: true, row: data }"
            />
          </template>
        </Column>
        <template #empty
          ><EmptyState
            icon="pi pi-users"
            :title="$t('admin.quotaAdmin.empty.entitlements')"
        /></template>
      </AppDataTable>
    </div>

    <!-- Set entitlement dialog -->
    <Dialog
      v-model:visible="entDialog"
      :header="$t('admin.quotaAdmin.setEntitlement')"
      modal
      class="w-96"
    >
      <Form
        :resolver="zodResolver(entitlementSchema)"
        :initialValues="{
          quotaId,
          employeeId: '',
          year: entYear,
          entitledValue: '',
        }"
        class="flex flex-col gap-3"
        @submit="submitEntitlement"
      >
        <FormField v-slot="$f" name="employeeId" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.columns.employee")
          }}</label
          ><Select
            :options="store.employees"
            optionLabel="name"
            optionValue="id"
            filter
            :placeholder="$t('admin.quotaAdmin.fields.selectEmployee')"
          /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="year" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.year")
          }}</label
          ><InputNumber :useGrouping="false" :min="2000" :max="2100" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="entitledValue" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.entitled")
          }}</label
          ><InputText type="text" inputmode="decimal" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <div class="flex justify-end gap-2">
          <Button
            :label="$t('common.cancel')"
            text
            @click="entDialog = false"
          /><Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>

    <!-- Mid-year adjustment dialog -->
    <Dialog
      v-model:visible="adjustDialog.open"
      :header="$t('admin.quotaAdmin.adjust')"
      modal
      class="w-96"
    >
      <Form
        :key="adjustDialog.row?.employeeId"
        :resolver="zodResolver(adjustEntitlementSchema)"
        :initialValues="{
          quotaId,
          employeeId: adjustDialog.row?.employeeId ?? '',
          year: adjustDialog.row?.year ?? entYear,
          delta: '',
          reason: '',
        }"
        class="flex flex-col gap-3"
        @submit="submitAdjust"
      >
        <div class="text-sm text-muted-color">
          {{ adjustDialog.row?.employeeName }} ·
          {{ $t("admin.quotaAdmin.columns.remaining") }}:
          {{ adjustDialog.row?.remaining }}
        </div>
        <FormField v-slot="$f" name="delta" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.delta")
          }}</label
          ><InputText
            type="text"
            inputmode="decimal"
            :placeholder="$t('admin.quotaAdmin.fields.deltaHint')"
          /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField name="reason" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.reason")
          }}</label
          ><InputText type="text"
        /></FormField>
        <div class="flex justify-end gap-2">
          <Button
            :label="$t('common.cancel')"
            text
            @click="adjustDialog.open = false"
          /><Button type="submit" :label="$t('admin.quotaAdmin.adjust')" />
        </div>
      </Form>
    </Dialog>

    <!-- Carry-forward dialog -->
    <Dialog
      v-model:visible="carryDialog"
      :header="$t('admin.quotaAdmin.carryForward')"
      modal
      class="w-96"
    >
      <Form
        :resolver="zodResolver(carryForwardSchema)"
        :initialValues="{ quotaId, fromYear: entYear, toYear: entYear + 1 }"
        class="flex flex-col gap-3"
        @submit="submitCarryForward"
      >
        <p class="text-sm text-muted-color">
          {{ $t("admin.quotaAdmin.carryHelp") }}
        </p>
        <Message
          v-if="ctx && !ctx.carryForward"
          severity="warn"
          size="small"
          variant="simple"
          >{{ $t("admin.quotaAdmin.carryDisabledWarn") }}</Message
        >
        <FormField v-slot="$f" name="fromYear" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.fromYear")
          }}</label
          ><InputNumber :useGrouping="false" :min="2000" :max="2100" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="toYear" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.quotaAdmin.fields.toYear")
          }}</label
          ><InputNumber :useGrouping="false" :min="2000" :max="2100" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <div class="flex justify-end gap-2">
          <Button
            :label="$t('common.cancel')"
            text
            @click="carryDialog = false"
          /><Button
            type="submit"
            :label="$t('admin.quotaAdmin.carryForward')"
          />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
