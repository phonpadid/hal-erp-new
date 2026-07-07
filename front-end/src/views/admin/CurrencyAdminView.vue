<script setup lang="ts">
import {
  currencyCreateSchema,
  exchangeRateSchema,
  RATE_TYPES,
  RATE_SOURCES,
} from "@erp/shared";
import { Form, FormField } from "@primevue/forms";
import { zodResolver } from "@primevue/forms/resolvers/zod";
import Button from "primevue/button";
import Column from "primevue/column";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Tag from "primevue/tag";
import { FilterMatchMode } from "@primevue/core/api";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useFeedback } from "../../composables/useFeedback";
import PageHeader from "@/components/PageHeader.vue";
import PageToolbar from "@/components/PageToolbar.vue";
import EmptyState from "@/components/EmptyState.vue";
import ErrorState from "@/components/ErrorState.vue";
import AppDataTable from "@/components/AppDataTable.vue";
import { useAuthStore } from "../../stores/auth";
import { useCurrencyStore } from "../../stores/currency";
import { formatDate } from "@/utils/date";
import type { FormSubmitEvent } from "@primevue/forms";
import type { Currency } from "../../api/currency";

const { t } = useI18n();
const fb = useFeedback();
const auth = useAuthStore();
const cur = useCurrencyStore();
const can = (c: string) => auth.can(c);
const rateTypeOptions = RATE_TYPES.map((t) => ({ label: t, value: t }));
const rateSourceOptions = RATE_SOURCES.map((s) => ({ label: s, value: s }));

const currencyDialog = ref<{ open: boolean; edit?: Currency }>({ open: false });
const rateDialog = ref(false);
// Rate scope is edited outside the Form, then merged into the payload (companyId).
const rateScope = ref<"GROUP" | "COMPANY">("GROUP");
const rateScopeOptions = [
  { label: t("admin.currency.scopeGroup"), value: "GROUP" },
  { label: t("admin.currency.scopeCompany"), value: "COMPANY" },
];
function openRate() {
  rateScope.value = "GROUP";
  rateDialog.value = true;
}
const filterFrom = ref<string | null>(null);
const filterTo = ref<string | null>(null);
const currencyFilters = ref({
  global: { value: null as string | null, matchMode: FilterMatchMode.CONTAINS },
});

function reload() {
  cur.loadCurrencies();
  cur.loadCurrencyOptions();
  cur.loadRates();
}

async function submitCurrency(e: FormSubmitEvent) {
  if (!e.valid) return;
  const editing = !!currencyDialog.value.edit;
  // `code` is immutable: disabled in the form on edit but still submitted, and the update DTO
  // (whitelist) rejects it. Omit it from the update payload.
  const updatable = { ...e.values };
  delete updatable.code;
  const ok = editing
    ? await cur.updateCurrency(currencyDialog.value.edit!.code, updatable)
    : await cur.createCurrency(e.values);
  if (ok) {
    currencyDialog.value.open = false;
    fb.success(t(editing ? "feedback.updated" : "feedback.created"));
  } else fb.error(cur.error);
}
async function submitRate(e: FormSubmitEvent) {
  if (!e.valid) return;
  // Group scope → no companyId; company scope → override for the active company.
  const companyId =
    rateScope.value === "COMPANY"
      ? (auth.activeCompanyId ?? undefined)
      : undefined;
  if (await cur.addRate({ ...e.values, companyId })) {
    rateDialog.value = false;
    fb.success(t("feedback.created"));
  } else fb.error(cur.error);
}
function applyFilter() {
  cur.loadRates({
    from: filterFrom.value ?? undefined,
    to: filterTo.value ?? undefined,
  });
}

onMounted(() => {
  cur.loadCurrencies();
  cur.loadCurrencyOptions();
  cur.loadRates();
});
</script>

<template>
  <div>
    <PageHeader :title="$t('admin.currency.title')" />

    <ErrorState v-if="cur.error" :message="cur.error" @retry="reload" />

    <div v-else class="card">
      <Tabs value="currencies">
        <TabList>
          <Tab value="currencies">{{
            $t("admin.currency.tabs.currencies")
          }}</Tab>
          <Tab value="rates">{{ $t("admin.currency.tabs.rates") }}</Tab>
        </TabList>
        <TabPanels>
          <!-- Currencies -->
          <TabPanel value="currencies">
            <PageToolbar
              :search="currencyFilters.global.value ?? ''"
              @update:search="currencyFilters.global.value = $event"
            >
              <template #actions>
                <Button
                  v-if="can('CURRENCY_MANAGE')"
                  :label="$t('admin.currency.newCurrency')"
                  icon="pi pi-plus"
                  size="small"
                  @click="currencyDialog = { open: true }"
                />
              </template>
            </PageToolbar>
            <AppDataTable
              :value="cur.currencies"
              :total="cur.currencyTotal"
              :loading="cur.loading"
              :page="cur.currencyPage"
              :rows="cur.currencyLimit"
              dataKey="code"
              :filters="currencyFilters"
              :globalFilterFields="['code', 'name']"
              @page="
                (e: { page: number; limit: number }) =>
                  cur.loadCurrencies(e.page, e.limit)
              "
              @refresh="cur.loadCurrencies()"
            >
              <Column field="code" :header="$t('common.code')" />
              <Column field="name" :header="$t('common.name')" />
              <Column
                field="symbol"
                :header="$t('admin.currency.columns.symbol')"
              />
              <Column
                field="decimalPlaces"
                :header="$t('admin.currency.columns.decimals')"
              />
              <Column :header="$t('admin.currency.columns.active')"
                ><template #body="{ data }"
                  ><Tag
                    :value="data.isActive ? $t('common.yes') : $t('common.no')"
                    :severity="
                      data.isActive ? 'success' : 'secondary'
                    " /></template
              ></Column>
              <Column header=""
                ><template #body="{ data }"
                  ><Button
                    v-if="can('CURRENCY_MANAGE')"
                    icon="pi pi-pencil"
                    text
                    size="small"
                    @click="
                      currencyDialog = { open: true, edit: data }
                    " /></template
              ></Column>
              <template #empty>
                <EmptyState
                  icon="pi pi-dollar"
                  :title="$t('admin.currency.empty.currencies')"
                />
              </template>
            </AppDataTable>
          </TabPanel>

          <!-- Exchange Rates -->
          <TabPanel value="rates">
            <PageToolbar>
              <template #filters>
                <div class="flex flex-col gap-1">
                  <Select
                    v-model="filterFrom"
                    :options="cur.currencyOptions"
                    optionLabel="code"
                    optionValue="code"
                    showClear
                    :placeholder="$t('admin.currency.filter.from')"
                    class="w-32"
                  />
                </div>
                <div class="flex flex-col gap-1">
                  <Select
                    v-model="filterTo"
                    :options="cur.currencyOptions"
                    optionLabel="code"
                    optionValue="code"
                    showClear
                    :placeholder="$t('admin.currency.filter.to')"
                    class="w-32"
                  />
                </div>
                <Button
                  :label="$t('common.filter')"
                  outlined
                  @click="applyFilter"
                />
              </template>
              <template #actions>
                <Button
                  v-if="can('CURRENCY_MANAGE')"
                  :label="$t('admin.currency.addRate')"
                  icon="pi pi-plus"
                  @click="openRate()"
                />
              </template>
            </PageToolbar>
            <AppDataTable
              :value="cur.rates"
              :total="cur.rateTotal"
              :loading="cur.loading"
              :page="cur.ratePage"
              :rows="cur.rateLimit"
              @page="
                (e: { page: number; limit: number }) =>
                  cur.loadRates(cur.rateFilter, e.page, e.limit)
              "
              @refresh="cur.loadRates(cur.rateFilter)"
            >
              <Column :header="$t('admin.currency.columns.from')"
                ><template #body="{ data }">{{
                  data.fromCurrency?.code
                }}</template></Column
              >
              <Column :header="$t('admin.currency.columns.to')"
                ><template #body="{ data }">{{
                  data.toCurrency?.code
                }}</template></Column
              >
              <Column
                field="rate"
                :header="$t('admin.currency.columns.rate')"
              />
              <Column :header="$t('common.date')"
                ><template #body="{ data }">{{
                  formatDate(data.rateDate)
                }}</template></Column
              >
              <Column field="rateType" :header="$t('common.type')" />
              <Column :header="$t('admin.currency.columns.source')"
                ><template #body="{ data }">{{
                  data.source ?? "—"
                }}</template></Column
              >
              <Column :header="$t('admin.currency.columns.scope')"
                ><template #body="{ data }">{{
                  data.company?.code ?? $t("admin.currency.group")
                }}</template></Column
              >
              <template #empty>
                <EmptyState
                  icon="pi pi-chart-line"
                  :title="$t('admin.currency.empty.rates')"
                />
              </template>
            </AppDataTable>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <!-- Currency dialog -->
    <Dialog
      v-model:visible="currencyDialog.open"
      :header="
        currencyDialog.edit
          ? $t('admin.currency.editCurrency')
          : $t('admin.currency.newCurrency')
      "
      modal
      class="w-96"
    >
      <Form
        :key="currencyDialog.edit?.code ?? 'new'"
        :resolver="zodResolver(currencyCreateSchema)"
        :initialValues="
          currencyDialog.edit
            ? {
                code: currencyDialog.edit.code,
                name: currencyDialog.edit.name,
                symbol: currencyDialog.edit.symbol ?? '',
                decimalPlaces: currencyDialog.edit.decimalPlaces,
              }
            : { code: '', name: '', symbol: '', decimalPlaces: 2 }
        "
        class="flex flex-col gap-3"
        @submit="submitCurrency"
      >
        <FormField v-slot="$f" name="code" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.codeIso")
          }}</label
          ><InputText type="text" :disabled="!!currencyDialog.edit" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="name" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("common.name")
          }}</label
          ><InputText type="text" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField name="symbol" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.symbol")
          }}</label
          ><InputText type="text"
        /></FormField>
        <FormField v-slot="$f" name="decimalPlaces" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.decimalPlaces")
          }}</label
          ><InputNumber :useGrouping="false" :min="0" :max="6" /><Message
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
            @click="currencyDialog.open = false"
          /><Button type="submit" :label="$t('common.save')" />
        </div>
      </Form>
    </Dialog>

    <!-- Add rate dialog -->
    <Dialog
      v-model:visible="rateDialog"
      :header="$t('admin.currency.addExchangeRate')"
      modal
      class="w-96"
    >
      <Form
        :resolver="zodResolver(exchangeRateSchema)"
        :initialValues="{
          fromCurrency: '',
          toCurrency: '',
          rate: '',
          rateDate: '',
          rateType: 'DAILY',
        }"
        class="flex flex-col gap-3"
        @submit="submitRate"
      >
        <FormField v-slot="$f" name="fromCurrency" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.from")
          }}</label
          ><Select
            :options="cur.currencyOptions"
            optionLabel="code"
            optionValue="code"
            :placeholder="$t('admin.currency.fields.select')"
          /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="toCurrency" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.to")
          }}</label
          ><Select
            :options="cur.currencyOptions"
            optionLabel="code"
            optionValue="code"
            :placeholder="$t('admin.currency.fields.select')"
          /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="rate" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.rate")
          }}</label
          ><InputText type="text" inputmode="decimal" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField v-slot="$f" name="rateDate" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.effectiveDate")
          }}</label
          ><InputText type="date" /><Message
            v-if="$f?.invalid"
            severity="error"
            size="small"
            variant="simple"
            >{{ $f.error?.message }}</Message
          ></FormField
        >
        <FormField name="rateType" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("common.type")
          }}</label
          ><Select
            :options="rateTypeOptions"
            optionLabel="label"
            optionValue="value"
        /></FormField>
        <FormField name="source" class="flex flex-col gap-1"
          ><label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.source")
          }}</label
          ><Select
            :options="rateSourceOptions"
            optionLabel="label"
            optionValue="value"
            showClear
            :placeholder="$t('admin.currency.fields.select')"
        /></FormField>
        <div class="flex flex-col gap-1">
          <label class="text-sm text-muted-color">{{
            $t("admin.currency.fields.scope")
          }}</label
          ><Select
            v-model="rateScope"
            :options="rateScopeOptions"
            optionLabel="label"
            optionValue="value"
          />
        </div>
        <div class="flex justify-end gap-2">
          <Button
            :label="$t('common.cancel')"
            text
            @click="rateDialog = false"
          /><Button type="submit" :label="$t('common.add')" />
        </div>
      </Form>
    </Dialog>
  </div>
</template>
