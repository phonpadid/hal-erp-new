<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import FormStepper from '@/components/FormStepper.vue';
import AttachmentUploader from '@/components/AttachmentUploader.vue';
import DocumentTypePicker from './DocumentTypePicker.vue';
import LineItemsEditor from './LineItemsEditor.vue';
import QuotaReservationsEditor, { type ReservationRow } from './QuotaReservationsEditor.vue';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Divider from 'primevue/divider';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { hasFieldValue, isFieldVisible, STOCK_POST_ACTIONS } from '@erp/shared';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { Decimal } from 'decimal.js';
import { documentsApi, uploadAttachment } from '../../api/documents';
import { masterDataApi } from '../../api/masterData';
import { inventoryApi } from '../../api/inventory';
import { employeesApi } from '../../api/employees';
import { usePayeeAccounts } from '../../composables/usePayeeAccounts';
import { budgetsApi, type SelectableBudget } from '../../api/budgets';
import { taxCodesApi } from '../../api/taxCodes';
import { quotasApi, type SelectableQuota } from '../../api/quotas';
import type { Item, Vendor } from '../../api/masterData';
import { currencyApi } from '../../api/currency';
import { lineAmount, lineInvalid, lineMissingBudget, lineMissingItem, lineVat, unavailableValue } from '../../utils/form';
import { fieldComponent } from '../../utils/formFields';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { useAuthStore } from '../../stores/auth';
import { useDocumentsStore } from '../../stores/documents';
import { useCurrencyStore } from '../../stores/currency';
import { useCurrencyFormat } from '../../composables/useCurrencyFormat';
import { useFeedback } from '../../composables/useFeedback';
import type { CreatableType, CreateDocumentDto, FormDef } from '../../api/documents';

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

/**
 * Whether the selections the TYPE asks for are still the requester's to change.
 *
 * These four used to be `:disabled="isEdit"` outright, because nothing could persist a change: the
 * draft save writes fields and lines, and the four were write-once at create. A draft missing one
 * its type requires was then blank, disabled and required at the same time, and the step gate would
 * not let it past — unfinishable and unfixable at once, which is reachable without anybody making a
 * mistake, since a type can gain `requires_warehouse` or `requires_employee` after its drafts exist.
 *
 * Now `PATCH /documents/:id/selections` carries the change while the document is a DRAFT, so the
 * lock follows the server's rule instead of the mere fact of editing. Locked while `current` is
 * still loading, so the controls never invite an edit the server would refuse.
 */
const selectionsLocked = computed(
  () => isEdit.value && (docs.current as { status?: string } | null)?.status !== 'DRAFT',
);

/**
 * A relation the detail read may return either populated or as a bare id.
 *
 * Which of the two a given relation arrives as is the server's choice and it has changed before:
 * `documentType`, `vendor`, `vendorBankAccount` and `currency` come populated, `warehouse`,
 * `destWarehouse` and `relatedEmployee` come as bare ids, and a line's budget comes populated with
 * no `budgetId` beside it. Reading `?.id` on a bare id is undefined and reading `.budgetId` on a
 * populated one is undefined, and both look like a fix while restoring nothing. Read every relation
 * through here and neither shape is the wrong guess.
 */
const idOf = (v: unknown): string =>
  typeof v === 'string' ? v : ((v as { id?: string } | null | undefined)?.id ?? '');

const types = ref<CreatableType[]>([]);
const selectedTypeId = ref<string>('');
const form = ref<FormDef | null>(null);
const values = ref<Record<string, string>>({});
const lines = ref<Array<{ description: string; qty: string; unitPrice: string; budgetId?: string; itemId?: string; taxCodeId?: string }>>([]);
/**
 * The supplier's tax invoice. Asked for on the documents that actually CLAIM the input VAT — those
 * whose type accrues the expense at approval, which are the ones whose accrual posts VAT_INPUT and
 * is dated by the invoice. A requisition may carry a tax code to estimate a purchase's cost, and
 * nobody has the supplier's invoice when raising one. Mirrors the server's rule exactly.
 */
const vendorInvoiceNo = ref('');
const vendorInvoiceDate = ref('');
const needsInvoice = computed(
  () => !!selectedType()?.accruesOnApproval && lines.value.some((l) => !!l.taxCodeId),
);
// Quota reservations for a requires_quota type (config-driven step). The beneficiary is not
// collected — the server resolves a personal quota's beneficiary to the requester (self-only).
const quotaReservations = ref<ReservationRow[]>([]);
const selectableQuotas = ref<SelectableQuota[]>([]);
// The read's own shape, rather than a narrower hand-written one: the editor groups by the category
// fields and prefills from `glAccount`, none of which a three-field annotation admits — they only
// ever arrived because the values were passed through untyped.
const budgets = ref<SelectableBudget[]>([]);
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
// Active VAT codes for the per-line VAT affordance. Gated on DOC_CREATE, mirroring the server's
// guard on /tax-codes/selectable-vat: whether a purchase carries VAT is the requester's own
// knowledge, and TAX_VIEW is a finance read they do not have. Empty list = VAT field hidden.
const canTax = computed(() => auth.can('DOC_CREATE'));
const vatCodes = ref<Array<{ id: string; code: string; name: string; rate: string }>>([]);
const selectedVendor = computed(() => vendors.value.find((v) => v.id === vendorId.value));

// Payee bank account — where the money actually lands. Chosen here rather than at payment time so
// the destination travels the same approval steps as the amount: the approvers who approve the
// spend also approve where it goes, and finance cannot redirect it afterwards.
const needsPayee = computed(() => !!selectedType()?.requiresPayee && canMaster.value);
const {
  selectedId: vendorBankAccountId,
  options: payeeOptions,
  load: loadPayeeAccounts,
} = usePayeeAccounts(vendorId, canMaster);

// First-load affordances: show skeletons instead of empty controls until reference data lands.
const loadingTypes = ref(true);
const loadingData = ref(true);
// Steps the user has tried to advance from — drives inline (not just banner) error display.
const attempted = ref<Record<string, boolean>>({});

const cur = useCurrencyStore();
const { fmt, fmtBase, baseCode, decimalPlacesOf } = useCurrencyFormat();
const currency = ref('');
const previewRate = ref<string | null>(null);

const selectedType = () => types.value.find((t) => t.id === selectedTypeId.value);

// Config-driven like the vendor and payee pickers (invariant 7): the flags come from the type,
// never from its code. Until `requiresWarehouse` and `requiresEmployee` reached the client these
// controls could not exist, which is why a goods issue could be drafted and never submitted, and
// why a promotion could be approved having named nobody.
const warehouses = ref<{ id: string; code: string; name: string }[]>([]);
const warehouseId = ref<string>('');
const destWarehouseId = ref<string>('');
const employees = ref<{ id: string; fullName: string; empCode: string }[]>([]);
const relatedEmployeeId = ref<string>('');

const needsWarehouse = computed(() => !!selectedType()?.requiresWarehouse);
const needsDestWarehouse = computed(() => selectedType()?.postAction === 'TRANSFER_STOCK');
const needsEmployee = computed(() => !!selectedType()?.requiresEmployee);

// The day this document's money actually moved. Offered only by a type configured to record
// something that already happened; every other type is dated by the clock and shows no field.
//
// A Date, not a string: `DatePicker` is what the other 26 date fields in this app use, and it
// renders the day in the user's locale rather than the browser's — a native `<input type="date">`
// showed a Lao user `03/14/2026`. Converted to `YYYY-MM-DD` on the way out.
const moneyMovedOn = ref<Date | null>(null);
const toYmd = (d: Date | null): string | undefined =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined;
// Local midnight, not `new Date('2026-03-14')`: a bare date parses as UTC, so anywhere east of
// Greenwich the picker would show the day before the one the document states.
const fromYmd = (s?: string | null): Date | null => (s ? new Date(`${s}T00:00:00`) : null);
const recordsPastEvents = computed(() => !!selectedType()?.recordsPastEvents);
// A guard for the reader, not for the server: without DOC_BACKDATE the picker will not go earlier
// than today, and the server refuses a past day from the same user anyway.
const canBackdate = computed(() => auth.can('DOC_BACKDATE'));
const today = new Date();

/**
 * The document-level values the wizard owns: everything that travels on the CREATE body and is
 * neither a field value, a line, nor a quota reservation.
 *
 * ONE list, deliberately. Create and edit used to enumerate these separately, and the two drifted
 * every time either grew. `vendorBankAccountId` was missing from create, and every disbursement was
 * unsubmittable. `warehouseId`, `destWarehouseId` and `relatedEmployeeId` were missing from edit,
 * and a draft came back with a required field blank, disabled and unfixable. `moneyMovedOn`,
 * `vendorInvoiceNo` and `vendorInvoiceDate` were missing from edit, so reopening a draft to correct
 * a line blanked the day its money moved and the invoice it claims against — silently, because an
 * empty control reads as one nobody filled. Each was fixed by adding one name to one side, which
 * left the trap armed for the next field. A field added here arrives in both directions or neither.
 *
 * `restore` reads the DETAIL shape, `send` writes the CREATE shape; they are not the same shape,
 * which is why this is a list of pairs and not a list of names. `prepare` is awaited first, for a
 * value whose options depend on another value having been restored already.
 *
 * The document type is deliberately absent: it is chosen before the form exists rather than
 * collected by it, and in edit mode it cannot change at all.
 */
const headerFields: Array<{
  key: keyof CreateDocumentDto;
  prepare?: () => Promise<void>;
  restore: (d: Record<string, any>) => void;
  send: () => string | undefined;
}> = [
  {
    key: 'currency',
    restore: (d) => {
      currency.value = (d.currency as { code?: string } | undefined)?.code ?? baseCode() ?? '';
    },
    send: () => currency.value || undefined,
  },
  {
    key: 'vendorId',
    restore: (d) => { vendorId.value = idOf(d.vendor); },
    send: () => vendorId.value || undefined,
  },
  {
    key: 'vendorBankAccountId',
    // The vendor's accounts must be loaded before one of them can be selected, and loading them
    // clears the selection and preselects the primary — so the saved account is put back after,
    // never before, and only when the document actually names one.
    prepare: () => loadPayeeAccounts(),
    restore: (d) => {
      vendorBankAccountId.value = idOf(d.vendorBankAccount) || vendorBankAccountId.value;
    },
    send: () => vendorBankAccountId.value || undefined,
  },
  {
    key: 'vendorInvoiceNo',
    restore: (d) => { vendorInvoiceNo.value = (d.vendorInvoiceNo as string | null) ?? ''; },
    send: () => vendorInvoiceNo.value || undefined,
  },
  {
    key: 'vendorInvoiceDate',
    restore: (d) => { vendorInvoiceDate.value = (d.vendorInvoiceDate as string | null) ?? ''; },
    send: () => vendorInvoiceDate.value || undefined,
  },
  {
    key: 'moneyMovedOn',
    restore: (d) => { moneyMovedOn.value = fromYmd(d.moneyMovedOn as string | null); },
    send: () => toYmd(moneyMovedOn.value),
  },
  {
    key: 'warehouseId',
    restore: (d) => { warehouseId.value = idOf(d.warehouse); },
    send: () => warehouseId.value || undefined,
  },
  {
    key: 'destWarehouseId',
    restore: (d) => { destWarehouseId.value = idOf(d.destWarehouse); },
    send: () => destWarehouseId.value || undefined,
  },
  {
    key: 'relatedEmployeeId',
    restore: (d) => { relatedEmployeeId.value = idOf(d.relatedEmployee); },
    send: () => relatedEmployeeId.value || undefined,
  },
];

/** Put a loaded draft's own values back into the form, in list order. */
async function restoreHeader(d: Record<string, any>) {
  for (const f of headerFields) {
    if (f.prepare) await f.prepare();
    f.restore(d);
  }
}

/** The same values on their way out, named as the create body names them. */
const headerPayload = (): Partial<CreateDocumentDto> =>
  Object.fromEntries(headerFields.map((f) => [f.key, f.send()])) as Partial<CreateDocumentDto>;
const warehouseOptions = computed(() =>
  warehouses.value.map((w) => ({ label: `${w.code} — ${w.name}`, value: w.id })),
);
const employeeOptions = computed(() =>
  employees.value.map((e) => ({ label: `${e.empCode} — ${e.fullName}`, value: e.id })),
);

/**
 * A saved selection this screen cannot offer back — a vendor since disabled for the company, an
 * account deactivated, a warehouse closed, an employee who has left.
 *
 * Each of these pickers renders its placeholder for a value that is not in its option list, which
 * is indistinguishable from one nobody ever chose. That is precisely the state a user answers by
 * re-picking and saving, taking everything else the load could not restore with it. Marked invalid
 * on sight — not only after a blocked advance, because nothing the user did caused it.
 */
const optionsReady = computed(() => !loadingData.value);
const lostVendor = computed(() =>
  unavailableValue(vendorId.value, vendors.value.map((v) => v.id), optionsReady.value),
);
const lostPayee = computed(() =>
  unavailableValue(vendorBankAccountId.value, payeeOptions.value.map((o) => o.value), optionsReady.value),
);
const lostWarehouse = computed(() =>
  unavailableValue(warehouseId.value, warehouses.value.map((w) => w.id), optionsReady.value),
);
const lostDestWarehouse = computed(() =>
  unavailableValue(destWarehouseId.value, warehouses.value.map((w) => w.id), optionsReady.value),
);
const lostEmployee = computed(() =>
  unavailableValue(relatedEmployeeId.value, employees.value.map((e) => e.id), optionsReady.value),
);
/** Any of the above, restricted to the pickers this type actually shows. */
const lostSelection = computed(
  () =>
    (canMaster.value && !!selectedType()?.requiresVendor && lostVendor.value) ||
    (needsPayee.value && lostPayee.value) ||
    (needsWarehouse.value && lostWarehouse.value) ||
    (needsWarehouse.value && needsDestWarehouse.value && lostDestWarehouse.value) ||
    (needsEmployee.value && lostEmployee.value),
);
/**
 * Per routed type, the permission its authoring screen requires and this user lacks. Read from the
 * destination route's own `meta.permission` — the same value the navigation guard reads — so the
 * card cannot drift from the guard that enforces it. A route that does not resolve is reachable:
 * the wizard keeps such a type in its own steps, and treating it as blocked would turn a
 * misconfiguration into a lockout.
 */
const unreachable = computed(() => {
  const out: Record<string, string> = {};
  for (const ty of types.value) {
    const name = ty.authoringRoute;
    if (!name || !router.hasRoute(name)) continue;
    const needed = router.resolve({ name }).meta?.permission as string | undefined;
    if (needed && !auth.can(needed)) out[ty.id] = needed;
  }
  return out;
});

/**
 * The items the line editor may offer. A stock-moving type can only carry stock-tracked items —
 * `web-inventory` requires the editor to offer only those — so filter rather than let the user
 * pick one and be refused at submit. Which types those are comes from `post_action`, never from a
 * list of document-type codes (invariant 7).
 */
const movesStock = computed(() =>
  STOCK_POST_ACTIONS.includes(selectedType()?.postAction as never),
);
const offerableItems = computed(() =>
  movesStock.value ? items.value.filter((i) => i.isStockTracked) : items.value,
);

/**
 * What a line is, in words, for the review step. The description is free text and stays blank
 * on every line raised by picking an item — which left the last screen before submit showing a
 * row of numbers against a dash, with the one fact identifying what was being ordered dropped
 * between the line step and the review. The item is that fact; the description refines it.
 */
function lineLabel(line: { description?: string; itemId?: string }): string {
  const described = line.description?.trim();
  if (described) return described;
  return items.value.find((i) => i.id === line.itemId)?.name ?? '';
}

/**
 * The document-level values the wizard collected, for the review step. Derived from the same
 * `needs*` flags that decided whether to render each input, so a value the wizard asks for is a
 * value the review shows. The review used to render three tiles as literal markup, which is how
 * the warehouse and the employee came to be missing from it: they were added to the form by a
 * change that had no reason to touch this list.
 */
const reviewChoices = computed(() => {
  const label = (opts: { label: string; value: string }[], id: string) =>
    opts.find((o) => o.value === id)?.label ?? '';
  const rows: { key: string; icon: string; label: string; value: string }[] = [];
  if (needsWarehouse.value) {
    rows.push({
      key: 'warehouse',
      icon: 'pi pi-warehouse',
      label: t(needsDestWarehouse.value ? 'documents.create.sourceWarehouse' : 'documents.create.warehouse'),
      value: label(warehouseOptions.value, warehouseId.value),
    });
  }
  if (needsDestWarehouse.value) {
    rows.push({
      key: 'destWarehouse',
      icon: 'pi pi-arrow-right',
      label: t('documents.create.destWarehouse'),
      value: label(warehouseOptions.value, destWarehouseId.value),
    });
  }
  if (needsEmployee.value) {
    rows.push({
      key: 'employee',
      icon: 'pi pi-user',
      label: t('documents.create.employee'),
      value: label(employeeOptions.value, relatedEmployeeId.value),
    });
  }
  if (needsPayee.value) {
    rows.push({
      key: 'payee',
      icon: 'pi pi-credit-card',
      label: t('documents.create.payee'),
      value: label(payeeOptions.value, vendorBankAccountId.value),
    });
  }
  return rows;
});

/** A transfer to itself writes a paired OUT/IN that nets to nothing while looking like a movement. */
const sameWarehouse = computed(
  () => needsDestWarehouse.value && !!warehouseId.value && warehouseId.value === destWarehouseId.value,
);

// Some types keep their content where this form cannot write it — a budget plan on
// `budget_movement`, a voucher on `journal_voucher` — and leave has a screen of its own that
// computes the days. Continuing into these steps for such a type produces a document that is
// well-formed and empty: it submits, sits in an approval queue, and is refused by its post-action
// when somebody finally clicks approve.
//
// The card stays in the grid — the grid is the inventory of what this department may raise, and a
// requester looking for leave looks where documents are made. Choosing it leaves for the screen
// that owns it. An `authoringRoute` the router does not know falls through to the normal steps
// rather than dead-ending, so a misconfigured route degrades to today's behaviour.
watch(selectedTypeId, (id) => {
  if (!id || isEdit.value) return;
  const route = types.value.find((t) => t.id === id)?.authoringRoute;
  if (route && router.hasRoute(route)) router.push({ name: route });
});

// Currency (and the FX preview) only matter for money documents. Procurement/finance carry
// amounts; HR/admin/IT generally don't, so the picker is hidden there and the document just
// stays in the company base currency. Category is config (document_type.category).
const MONEY_CATEGORIES = ['PROCUREMENT', 'FINANCE'];
const showCurrency = computed(() => MONEY_CATEGORIES.includes(selectedType()?.category ?? ''));

// Document sub-total in the document currency (sum of line amounts, before VAT).
const docTotal = computed(() =>
  lines.value.reduce((s, l) => s.plus(lineAmount(l.qty, l.unitPrice) || '0'), new Decimal(0)).toString(),
);

/**
 * VAT preview: Σ round(line net × its code's rate), the same per-line rounding the server applies
 * at submit — summing the lines and rounding once would differ by a unit on some documents, and
 * the number the requester approved must be the number that gets stamped.
 *
 * Advisory: the authoritative `tax_total` is computed server-side from the same `tax_code` rows.
 */
const docTaxTotal = computed(() =>
  lines.value
    .reduce(
      (s, l) =>
        s.plus(
          lineVat(
            lineAmount(l.qty, l.unitPrice),
            vatCodes.value.find((v) => v.id === l.taxCodeId)?.rate,
            decimalPlacesOf(currency.value),
          ),
        ),
      new Decimal(0),
    )
    .toString(),
);
/** sub_total + tax_total — what the document is actually worth. */
const docGrandTotal = computed(() => new Decimal(docTotal.value).plus(docTaxTotal.value).toString());
const hasVat = computed(() => new Decimal(docTaxTotal.value).greaterThan(0));

const isForeign = computed(() => !!currency.value && !!baseCode() && currency.value !== baseCode());
// Advisory converted base preview (the server locks the authoritative rate at submit). Converts
// the GRAND total, matching `document.base_total_amount`, which submit derives from grand_total —
// previewing the pre-VAT figure would quote a base amount the document never carries.
const basePreview = computed(() =>
  previewRate.value ? fmtBase(new Decimal(docGrandTotal.value).times(previewRate.value).toString()) : null,
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
    .map((f) => ({ f, ctrl: fieldComponent(f.fieldType, f.options) })),
);

/**
 * What the shared presence rule reads: `file` and `line_items` store their content OUTSIDE
 * `values` — a file lives in the staged uploads (create) or the saved attachments (edit), and
 * lines live in the Lines step. Checking `values` for those would report them missing forever,
 * even after the user attaches a file or adds a line.
 *
 * The rule itself is shared with the server's submit gate and the detail view's prompt, so a
 * field type added later is handled in one place rather than three.
 */
const presenceContext = computed(() => ({
  values: valuesByName.value,
  attachmentCount: isEdit.value ? docs.attachments.length : stagedFiles.value.length,
  lineCount: lines.value.length,
}));

function isFieldFilled(f: { fieldName: string; fieldType: string }): boolean {
  return hasFieldValue(f, presenceContext.value);
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
    else if (key === 'type' && needsPayee.value && !vendorBankAccountId.value) id = 'payee';
    else if (key === 'details') id = firstMissingRequiredId();
    else if (key === 'lines') {
      const i = firstBadLineIndex();
      id = i >= 0 ? `qty-${i}` : null;
    }
    if (id) document.getElementById(id)?.focus();
  });
}

// The blocking message belongs to the step that raised it. Once the user has satisfied it and
// moved on, it is answering a question nobody is asking any more — it used to ride along to the
// end of the wizard, still demanding a vendor that had been chosen two steps earlier.
function onStepChange() {
  error.value = '';
}

// Whether a given required field should show its inline error (details step attempted, still empty).
function fieldError(f: { fieldName: string; isRequired: boolean; fieldType: string }): boolean {
  return !!attempted.value.details && f.isRequired && !isFieldFilled(f);
}

// Visible standard fields (label + value) for the read-only Review summary. file/line_items
// fields are excluded — files attach after save and lines have their own section. Derived from
// the same fieldControls the editor binds, so the summary can't drift from what is submitted.
const reviewFields = computed(() =>
  fieldControls.value
    .filter(({ ctrl }) => ctrl.component)
    .map(({ f, ctrl }) => ({
      id: f.id,
      label: f.fieldLabel,
      value: values.value[f.id] || '',
      html: !!ctrl.html,
      // The review step is the last screen before a document becomes somebody else's work, and a
      // dash is not a warning: a required date silently dropped by its picker showed exactly the
      // same dash an optional empty field shows.
      missing: !!f.isRequired && !values.value[f.id],
    })),
);

// Quota reservations for the Review summary, resolved to their quota label/unit from the same
// wizard state that is submitted — so the summary can't drift from the payload.
const reviewReservations = computed(() =>
  quotaReservations.value
    .filter((r) => r.quotaId && Number(r.qty) > 0)
    .map((r) => {
      const q = selectableQuotas.value.find((sq) => sq.id === r.quotaId);
      return { label: q ? `${q.quotaType} (${q.unit})` : r.quotaId, qty: r.qty, unit: q?.unit ?? '' };
    }),
);

// Config-driven quota step (invariant 7): shown only for a requires_quota document type.
const requiresQuota = computed(() => selectedType()?.requiresQuota ?? false);

const steps = computed(() => [
  { key: 'type', label: t('documents.create.steps.type') },
  { key: 'details', label: t('documents.create.steps.details') },
  { key: 'lines', label: t('documents.create.steps.lines') },
  ...(requiresQuota.value ? [{ key: 'quota', label: t('documents.create.steps.quota') }] : []),
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
    // A selection restored from the draft that this screen can no longer offer. Stopped here rather
    // than at submit: the stale id is still on the document and would be refused there, with the
    // control showing an empty box and no reason for the refusal.
    if (lostSelection.value) return t('documents.create.selectionUnavailable');
    // Config-driven: a requires_vendor type can't advance without a vendor (server re-checks
    // at submit). Only enforced when the creator can pick one (MASTER_VIEW); otherwise the
    // server stays authoritative.
    if (needsWarehouse.value && !warehouseId.value) return t('documents.create.warehouseRequired');
    if (needsWarehouse.value && needsDestWarehouse.value && !destWarehouseId.value) {
      return t('documents.create.destWarehouseRequired');
    }
    if (sameWarehouse.value) return t('documents.create.warehousesMustDiffer');
    if (needsEmployee.value && !relatedEmployeeId.value) return t('documents.create.employeeRequired');
    if (selectedType()?.requiresVendor && canMaster.value && !vendorId.value) {
      return t('documents.create.vendorRequired');
    }
    // Mirrors the server's requires_payee gate so the client fails the same submit it would.
    if (needsPayee.value && !vendorBankAccountId.value) {
      return t('documents.create.payeeRequired');
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
  if (key === 'quota') {
    return quotaError() ?? true;
  }
  return true;
}

// Quota-step validation, mirroring the server's guard (UX-only; server re-checks under lock).
// A requires_quota document needs at least one reservation with a positive quantity.
function quotaError(): string | null {
  if (!requiresQuota.value) return null;
  const ok = quotaReservations.value.some((r) => r.quotaId && Number(r.qty) > 0 && !Number.isNaN(Number(r.qty)));
  return ok ? null : t('documents.create.quota.required');
}

// Line-step validation, mirroring the server's type-driven rules (UX-only; server re-checks).
// Item/budget requirements are enforced only when the creator can act on them (MASTER_VIEW /
// DOC_CREATE), matching the requires_vendor pattern; otherwise the server stays authoritative.
function linesError(): string | null {
  if (lines.value.some(lineInvalid)) return t('documents.create.invalidLine');
  const ri = (selectedType()?.requiresItem ?? false) && canMaster.value;
  const rb = (selectedType()?.requiresBudget ?? false) && canBudget.value;
  if (lines.value.some((l) => lineMissingItem(l, ri))) return t('documents.create.itemRequiredLine');
  // No type-default escape any more: a default GL still stamps the line's account, but it cannot
  // name a budget, so every positive line needs one chosen.
  if (lines.value.some((l) => lineMissingBudget(l, rb))) {
    return t('documents.create.budgetRequiredLine');
  }
  // A budget or item the line names and the pickers no longer offer. Same reason as the selections
  // above: the id survives the reload, the control does not show it, and only submit would object.
  if (lines.value.some(lineValueLost)) return t('documents.create.lineValueUnavailable');
  return null;
}
/** A line naming a budget or an item that is no longer among the ones offered. */
function lineValueLost(l: { budgetId?: string; itemId?: string }): boolean {
  const rb = (selectedType()?.requiresBudget ?? false) && canBudget.value;
  return (
    (rb && unavailableValue(l.budgetId, budgets.value.map((b) => b.id), optionsReady.value)) ||
    (canMaster.value &&
      unavailableValue(l.itemId, offerableItems.value.map((i) => i.id), optionsReady.value))
  );
}
// Index of the first line failing any line-step rule (for focus on a blocked advance).
function firstBadLineIndex(): number {
  const ri = (selectedType()?.requiresItem ?? false) && canMaster.value;
  const rb = (selectedType()?.requiresBudget ?? false) && canBudget.value;
  return lines.value.findIndex(
    (l) => lineInvalid(l) || lineMissingItem(l, ri) || lineMissingBudget(l, rb) || lineValueLost(l),
  );
}

async function loadForm(typeId: string) {
  form.value = typeId ? await documentsApi.formForType(typeId) : null;
}

onMounted(async () => {
  types.value = await documentsApi.creatableTypes().catch(() => []);
  loadingTypes.value = false;
  // /budgets/selectable returns a plain array of {id, code, budgetName, isShared, parentId}
  // (no amounts), authorized by DOC_CREATE.
  //
  // Asked WITHOUT a department. It used to send `auth.departmentId`, which read as "a document is
  // raised in the requester's department, so every other department's budgets are choices this
  // document cannot carry" — a rule nothing enforces. The server never compares a document's
  // department with its line's budget, control points govern through the BUDGET's department, and
  // much of the plan is money the whole company draws on. What it did enforce was an accident: the
  // budget officer sits in a department that holds no budget, and got an empty picker.
  //
  // Which budgets a caller may charge is the server's answer now, from their granted scope plus
  // the shared nodes. The client asks and renders.
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
  // Both are cheap company-scoped lists and only a few types need them; failing soft keeps a
  // missing permission from blocking the whole wizard, exactly as vendors and items do above.
  [warehouses.value, employees.value] = await Promise.all([
    inventoryApi.selectableWarehouses().catch(() => []),
    employeesApi.selectable().catch(() => []),
  ]);
  loadingData.value = false;
  currency.value = baseCode() ?? '';
  if (isEdit.value) {
    // Load the existing draft into the editor (store holds attachments for the uploader).
    await docs.loadDetail(editId.value);
    selectedTypeId.value = (docs.current as any)?.documentType?.id ?? '';
    // Everything the wizard owns, restored from the one list that also builds the create body, so
    // a value cannot be collected in one direction and forgotten in the other.
    await restoreHeader(((docs.current ?? {}) as unknown) as Record<string, any>);
    await loadForm(selectedTypeId.value);
    values.value = Object.fromEntries(docs.fieldValues.map((v) => [v.formFieldId, v.value ?? '']));
    // `idOf` on every relation, not just the ones that bit us last time. The detail read returns a
    // line's budget POPULATED (`budget`, alongside `glAccount`, `lineAmount`, …) and carries no
    // `budgetId` at all, so reading `l.budgetId` gave undefined and the budget picker reopened
    // empty and marked required. A user who re-picked it and saved also saved over whatever else
    // the load had dropped — which is how a stated `moneyMovedOn` would have gone silently.
    lines.value = docs.lines.map((l: any) => ({
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      budgetId: idOf(l.budget ?? l.budgetId),
      itemId: idOf(l.item ?? l.itemId),
      taxCodeId: idOf(l.taxCode ?? l.taxCodeId),
    }));
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
  // Editing a requires_quota draft: load the quota list so its step is usable.
  await ensureSelectableQuotas();
  await refreshRate();
});

// Load the requester-facing quota list once, lazily, the first time a requires_quota type needs it.
async function ensureSelectableQuotas() {
  if (selectableQuotas.value.length || !requiresQuota.value) return;
  selectableQuotas.value = await quotasApi.selectable().catch(() => []);
}

// In create mode, changing the type reloads its form and resets entry.
watch(selectedTypeId, async (id) => {
  if (isEdit.value) return;
  await loadForm(id);
  values.value = {};
  lines.value = [];
  // Drop reservations carried over from a previous type; load quotas when the new type needs them.
  quotaReservations.value = [];
  await ensureSelectableQuotas();
  // Drop a vendor carried over from a previous type that no longer applies, so a hidden
  // picker can't leak a stale vendor into the payload.
  if (!selectedType()?.requiresVendor) vendorId.value = '';
  // Same reason as the vendor: a payee left behind by a previous type must not reach the payload.
  if (!selectedType()?.requiresPayee) vendorBankAccountId.value = '';
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
  // Mirror the server's quota guard on submit only (a draft may be saved without reservations).
  if (submitAfter) {
    const quotaIssue = quotaError();
    if (quotaIssue) {
      error.value = quotaIssue;
      attempted.value.quota = true;
      return;
    }
  }
  busy.value = true;
  try {
    const { fieldValues, lines: linePayload } = collectPayload();
    let id = editId.value;
    if (isEdit.value) {
      // The type-driven selections go with the save. Sent only while the document is still a draft:
      // the server refuses them otherwise, and a locked control has nothing to say anyway. Nulls
      // rather than omissions for the empty ones, so clearing a selection is expressible — a type
      // that loses `requires_warehouse` must be able to have the warehouse taken back off.
      const selections = selectionsLocked.value
        ? undefined
        : {
            warehouseId: warehouseId.value || null,
            destWarehouseId: destWarehouseId.value || null,
            relatedEmployeeId: relatedEmployeeId.value || null,
            vendorId: vendorId.value || null,
          };
      if (!(await docs.saveDraft(id, fieldValues, linePayload, selections))) {
        fb.error(docs.error);
        return;
      }
    } else {
      // Same list as the restore above, spread rather than re-enumerated.
      id = await docs.createDraft({ documentTypeId: selectedTypeId.value, ...headerPayload(), fieldValues, lines: linePayload });
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
      // Only a requires_quota type carries reservations; other types submit an empty body.
      const body = requiresQuota.value
        ? { quotaReservations: quotaReservations.value.map((r) => ({ quotaId: r.quotaId, qty: r.qty })) }
        : {};
      const ok = await docs.submit(id, body);
      if (!ok) {
        // The draft is saved; only the submit failed. The toast fires here, but the wizard leaves
        // for the detail page immediately and a toast does not survive the trip — so the reason
        // travels with the route and is shown there for as long as it is still true.
        const reason = docs.error;
        fb.error(reason);
        await router.push({ name: 'document-detail', params: { id }, query: { refused: reason } });
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
      <FormStepper :steps="steps" :initial-step="initialStep" :validate-step="validateStep" hide-submit :loading="busy" @step-error="onStepError" @step-change="onStepChange">
        <!-- Step: document type -->
        <template #step-type>
          <div class="flex flex-col gap-5">
            <DocumentTypePicker v-model="selectedTypeId" :types="types" :disabled="isEdit" :loading="loadingTypes" :unreachable="unreachable" />

            <div v-if="showCurrency || (canMaster && selectedType()?.requiresVendor) || needsWarehouse || needsEmployee" class="flex flex-wrap gap-4">
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
                  <Select input-id="vendor" v-model="vendorId" :options="vendors" optionLabel="name" optionValue="id" class="w-72" :placeholder="$t('documents.create.vendorPlaceholder')" :disabled="selectionsLocked" :invalid="lostVendor || (!!attempted.type && !vendorId)" :aria-required="true" :aria-invalid="lostVendor || (!!attempted.type && !vendorId) || undefined" showClear filter />
                  <small v-if="selectedVendor?.paymentTermDays != null" class="text-muted-color">{{ $t('documents.create.creditTerms', { days: selectedVendor.paymentTermDays }) }}</small>
                  <Message v-if="lostVendor" severity="error" size="small" variant="simple">{{ $t('documents.create.selectionUnavailable') }}</Message>
                  <Message v-else-if="attempted.type && !vendorId" severity="error" size="small" variant="simple">{{ $t('documents.create.vendorRequired') }}</Message>
                </div>
                <!-- Payee: shown only for types configured requires_payee (config-driven, invariant 7).
                     Disabled until a vendor is chosen — the accounts belong to that vendor. -->
                <div v-if="needsPayee" class="flex flex-col gap-1" data-testid="payee-field">
                  <label for="payee" class="text-sm text-muted-color">{{ $t('documents.create.payee') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                  <Select input-id="payee" v-model="vendorBankAccountId" :options="payeeOptions" optionLabel="label" optionValue="value" class="w-72" :placeholder="$t('documents.create.payeePlaceholder')" :disabled="selectionsLocked || !vendorId" :invalid="lostPayee || (!!attempted.type && !vendorBankAccountId)" :aria-required="true" :aria-invalid="lostPayee || (!!attempted.type && !vendorBankAccountId) || undefined" showClear filter />
                  <small class="text-muted-color">{{ $t('documents.create.payeeHint') }}</small>
                  <Message v-if="lostPayee" severity="error" size="small" variant="simple">{{ $t('documents.create.selectionUnavailable') }}</Message>
                  <Message v-else-if="attempted.type && !vendorBankAccountId" severity="error" size="small" variant="simple">{{ $t('documents.create.payeeRequired') }}</Message>
                </div>
                <!-- Warehouse: config-driven (requires_warehouse). Submit refuses a document of such
                     a type that names none, and before this there was nowhere to name one. -->
                <div v-if="needsWarehouse" class="flex flex-col gap-1" data-testid="warehouse-field">
                  <label for="warehouse" class="text-sm text-muted-color">{{ $t('documents.create.warehouse') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                  <Select input-id="warehouse" v-model="warehouseId" :options="warehouseOptions" optionLabel="label" optionValue="value" class="w-72" :placeholder="$t('documents.create.warehousePlaceholder')" :disabled="selectionsLocked" :invalid="lostWarehouse || (!!attempted.type && !warehouseId)" :aria-required="true" :aria-invalid="lostWarehouse || undefined" showClear filter />
                  <Message v-if="lostWarehouse" severity="error" size="small" variant="simple">{{ $t('documents.create.selectionUnavailable') }}</Message>
                  <Message v-else-if="attempted.type && !warehouseId" severity="error" size="small" variant="simple">{{ $t('documents.create.warehouseRequired') }}</Message>
                </div>
                <!-- Destination: only a TRANSFER_STOCK has somewhere to move stock to. -->
                <div v-if="needsWarehouse && needsDestWarehouse" class="flex flex-col gap-1" data-testid="dest-warehouse-field">
                  <label for="dest-warehouse" class="text-sm text-muted-color">{{ $t('documents.create.destWarehouse') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                  <Select input-id="dest-warehouse" v-model="destWarehouseId" :options="warehouseOptions" optionLabel="label" optionValue="value" class="w-72" :placeholder="$t('documents.create.warehousePlaceholder')" :disabled="selectionsLocked" :invalid="lostDestWarehouse || (!!attempted.type && !destWarehouseId) || sameWarehouse" :aria-required="true" :aria-invalid="lostDestWarehouse || undefined" showClear filter />
                  <Message v-if="lostDestWarehouse" severity="error" size="small" variant="simple">{{ $t('documents.create.selectionUnavailable') }}</Message>
                  <Message v-else-if="sameWarehouse" severity="error" size="small" variant="simple">{{ $t('documents.create.warehousesMustDiffer') }}</Message>
                  <Message v-else-if="attempted.type && !destWarehouseId" severity="error" size="small" variant="simple">{{ $t('documents.create.destWarehouseRequired') }}</Message>
                </div>
                <!-- Employee: config-driven (requires_employee). Without it the HR post-actions
                     no-op and the document completes having changed nobody. -->
                <div v-if="needsEmployee" class="flex flex-col gap-1" data-testid="employee-field">
                  <label for="employee" class="text-sm text-muted-color">{{ $t('documents.create.employee') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
                  <Select input-id="employee" v-model="relatedEmployeeId" :options="employeeOptions" optionLabel="label" optionValue="value" class="w-72" :placeholder="$t('documents.create.employeePlaceholder')" :disabled="selectionsLocked" :invalid="lostEmployee || (!!attempted.type && !relatedEmployeeId)" :aria-required="true" :aria-invalid="lostEmployee || undefined" showClear filter />
                  <Message v-if="lostEmployee" severity="error" size="small" variant="simple">{{ $t('documents.create.selectionUnavailable') }}</Message>
                  <Message v-else-if="attempted.type && !relatedEmployeeId" severity="error" size="small" variant="simple">{{ $t('documents.create.employeeRequired') }}</Message>
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
          <LineItemsEditor v-model="lines" :currency="currency" :items="offerableItems" :budgets="budgets" :vat-codes="vatCodes" :can-master="canMaster" :can-budget="canBudget" :requires-budget="selectedType()?.requiresBudget ?? false" :requires-item="selectedType()?.requiresItem ?? false" :default-gl-account="selectedType()?.defaultGlAccount" :options-ready="!loadingData" />

          <!-- The supplier's tax invoice, asked for here because this is the step where a line
               gains a tax code and the fact becomes true. The client check mirrors the server's. -->
          <div v-if="needsInvoice" class="mt-4 flex flex-wrap gap-3" data-testid="invoice-fields">
            <div class="flex flex-col gap-1">
              <label for="inv-no" class="text-sm text-muted-color">{{ $t('documents.create.vendorInvoiceNo') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
              <InputText input-id="inv-no" v-model="vendorInvoiceNo" class="w-56" :invalid="!!attempted.lines && !vendorInvoiceNo" data-testid="invoice-no" />
            </div>
            <div class="flex flex-col gap-1">
              <label for="inv-date" class="text-sm text-muted-color">{{ $t('documents.create.vendorInvoiceDate') }}<span class="text-red-500" :title="$t('documents.create.requiredField')"> *</span></label>
              <InputText input-id="inv-date" type="date" v-model="vendorInvoiceDate" class="w-56" :invalid="!!attempted.lines && !vendorInvoiceDate" data-testid="invoice-date" />
            </div>
            <small class="w-full text-muted-color">{{ $t('documents.create.vendorInvoiceHint') }}</small>
          </div>

          <!-- Only for a type that records what already happened. `max` stops a future day for
               everyone, and stops a past day for anyone without DOC_BACKDATE — the server enforces
               both regardless; this is so the picker does not offer what will be refused. -->
          <div v-if="recordsPastEvents" class="mt-3 flex flex-col gap-1" data-testid="money-moved-on-field">
            <label for="money-moved-on" class="text-sm text-muted-color">{{ $t('documents.create.moneyMovedOn') }}</label>
            <DatePicker
              input-id="money-moved-on"
              v-model="moneyMovedOn"
              dateFormat="yy-mm-dd"
              showIcon
              showButtonBar
              class="w-56"
              :minDate="canBackdate ? undefined : today"
              :maxDate="today"
              data-testid="money-moved-on"
            />
            <small class="text-muted-color">
              {{ canBackdate ? $t('documents.create.moneyMovedOnHint') : $t('documents.create.moneyMovedOnNoBackdate') }}
            </small>
          </div>

          <p v-if="selectedType()?.requiresBudget && canBudget && !budgets.length" class="mt-3 text-sm text-muted-color">
            {{ $t('documents.create.budgetNotice') }}
          </p>
          <!-- Advisory converted base amount (the server locks the authoritative rate at submit). -->
          <div v-if="isForeign && basePreview" class="mt-2 text-right text-sm text-muted-color">
            {{ $t('documents.create.basePreview', { amount: basePreview, currency: baseCode() }) }}
          </div>
        </template>

        <!-- Step: quota reservations — shown only for a requires_quota type (config-driven). -->
        <template v-if="requiresQuota" #step-quota>
          <QuotaReservationsEditor v-model="quotaReservations" :quotas="selectableQuotas" :attempted="!!attempted.quota" />
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
              <!-- Every other value the wizard asked for, from the same flags that asked for it. -->
              <div
                v-for="c in reviewChoices"
                :key="c.key"
                :data-testid="`review-${c.key}`"
                class="rounded-lg border border-surface-200 bg-surface-50/60 p-3 dark:border-surface-700 dark:bg-surface-800/40"
              >
                <div class="flex items-center gap-2 text-xs text-muted-color"><i :class="c.icon" /> {{ c.label }}</div>
                <div class="mt-1 font-medium" :class="c.value ? 'text-color' : 'text-red-500'">
                  {{ c.value || $t('documents.create.missingRequired') }}
                </div>
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
                <dd v-else-if="f.missing" class="wrap-break-word text-red-500" data-testid="review-missing">{{ $t('documents.create.missingRequired') }}</dd>
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
                <span class="flex-1 text-color">{{ lineLabel(l) || $t('documents.create.none') }}</span>
                <span class="text-muted-color sm:w-16 sm:text-right">{{ l.qty }}</span>
                <span class="text-muted-color sm:w-32 sm:text-right">{{ fmt(l.unitPrice, currency) }}</span>
                <span class="font-medium text-color sm:w-32 sm:text-right">{{ fmt(lineAmount(l.qty, l.unitPrice), currency) }}</span>
              </div>
              <!-- Sub-total and VAT are broken out only when there is VAT to break out; an
                   untaxed document keeps the single total line it has always shown. -->
              <div class="border-t border-surface-200 bg-surface-50 px-3 py-3 text-sm dark:border-surface-700 dark:bg-surface-800/60">
                <template v-if="hasVat">
                  <div class="flex items-center justify-end gap-3">
                    <span class="text-muted-color">{{ $t('documents.create.subTotal') }}</span>
                    <span class="text-color">{{ fmt(docTotal, currency) }}</span>
                  </div>
                  <div class="mt-1 flex items-center justify-end gap-3">
                    <span class="text-muted-color">{{ $t('documents.create.vatTotal') }}</span>
                    <span class="text-color">{{ fmt(docTaxTotal, currency) }}</span>
                  </div>
                </template>
                <div class="flex items-center justify-end gap-3" :class="{ 'mt-2 border-t border-surface-200 pt-2 dark:border-surface-700': hasVat }">
                  <span class="text-muted-color">{{ $t('documents.create.total') }}</span>
                  <span class="text-base font-semibold text-color">{{ fmt(docGrandTotal, currency) }} <span v-if="showCurrency">{{ currency }}</span></span>
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-muted-color">{{ $t('documents.create.emptyLines') }}</p>
            <!-- Advisory base conversion + locked-rate note for a foreign-currency document. -->
            <div v-if="isForeign && basePreview" class="mt-2 text-right text-sm text-muted-color">
              {{ $t('documents.create.basePreview', { amount: basePreview, currency: baseCode() }) }}
            </div>

            <!-- Quota reservations (requires_quota types) — mirrors what is sent in quotaReservations. -->
            <template v-if="requiresQuota">
              <Divider align="left" class="mt-6! mb-4!">
                <span class="flex items-center gap-2 text-sm font-medium text-muted-color"><i class="pi pi-ticket" /> {{ $t('documents.create.quota.title') }}</span>
              </Divider>
              <div v-if="reviewReservations.length" class="w-full overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
                <div
                  v-for="(r, i) in reviewReservations"
                  :key="i"
                  class="flex items-center justify-between gap-2 border-t border-surface-100 px-3 py-2 text-sm first:border-t-0 odd:bg-surface-50/40 dark:border-surface-800 dark:odd:bg-surface-800/20"
                >
                  <span class="text-color">{{ r.label }}</span>
                  <span class="font-medium text-color">{{ r.qty }} {{ r.unit }}</span>
                </div>
              </div>
              <p v-else class="text-sm text-muted-color">{{ $t('documents.create.quota.empty') }}</p>
            </template>
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
        <!-- With VAT the running figure names its parts: a requester who ticks a box sees the
             total move, and needs to see WHY it moved to trust the number they submit. -->
        <span v-if="hasVat" class="text-sm text-muted-color">
          {{ $t('documents.create.totalBreakdown', { sub: fmt(docTotal, currency), vat: fmt(docTaxTotal, currency) }) }}
        </span>
        <span class="text-sm text-muted-color">{{ $t('documents.create.documentTotal') }}</span>
        <span class="text-base font-semibold text-color">{{ fmt(docGrandTotal, currency) }} <span v-if="showCurrency">{{ currency }}</span></span>
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
