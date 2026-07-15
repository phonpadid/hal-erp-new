import { z } from 'zod';

/**
 * Single source of truth for validation rules shared by the Vue forms
 * (zodResolver) and the NestJS DTOs (ZodValidationPipe). Change a rule here and
 * both client and server pick it up — they cannot drift.
 */

// Sample form: create a company. Mirrors columns on the `company` DBML table.
export const companyCreateSchema = z.object({
  code: z.string().min(1).max(50),
  nameTh: z.string().min(1),
  nameEn: z.string().optional(),
  // Optional; when provided it must be exactly 13 digits. An empty field submits '' → treat as unset.
  taxId: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().length(13, 'Tax ID must be 13 digits').optional(),
  ),
  branchCode: z
    .string()
    .length(5)
    .default('00000'),
  baseCurrency: z.string().length(3).default('THB'),
  // Letterhead contact block (printed on the document PDF footer). All optional; an empty
  // field submits '' → treated as unset so a blank input never fails validation.
  address: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(255).optional()),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(50).optional()),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email('Invalid email').max(255).optional()),
  website: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(255).optional()),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;

// Approval delegation — mirrors CreateDelegationDto. Shared by the Vue form and the NestJS
// DTO so validation can't drift. amountLimit is a decimal STRING (money rule).
export const delegationSchema = z.object({
  delegatorId: z.string().uuid(),
  delegateId: z.string().uuid(),
  documentTypeId: z.string().uuid().nullish(), // nullish: Select showClear emits null
  amountLimit: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().max(255).optional(),
});
export type DelegationInput = z.infer<typeof delegationSchema>;

// Budget management — mirrors the budget CreateBudgetDto / UpdateBudgetDto and the
// transfer intake (CreateTransferDto). `amountTotal` / `amount` are decimal STRINGS
// (money rule — never a JS number). Shared by the Vue forms and the NestJS DTOs so
// validation can't drift.
export const CONTROL_POLICIES = ['HARD_STOP', 'SOFT_WARNING'] as const;
const POSITIVE_DECIMAL_STRING = /^\d+(\.\d+)?$/;
const isPositive = (v: string) => POSITIVE_DECIMAL_STRING.test(v) && Number(v) > 0;

export const budgetCreateSchema = z.object({
  fiscalYearId: z.string().uuid(),
  departmentId: z.string().uuid(),
  glAccount: z.string().min(1).max(255),
  budgetName: z.string().max(255).optional(),
  // Set at creation; never overwritten by usage (invariant 3). A positive decimal string.
  amountTotal: z.string().refine(isPositive, 'A positive amount'),
  controlPolicy: z.enum(CONTROL_POLICIES).optional(),
});
export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;

// Edit: amountTotal is intentionally NOT here — corrections are ledger adjustments,
// never an overwrite (invariant 3).
export const budgetUpdateSchema = z.object({
  budgetName: z.string().max(255).optional(),
  controlPolicy: z.enum(CONTROL_POLICIES).optional(),
  status: z.string().max(50).optional(),
});
export type BudgetUpdateInput = z.infer<typeof budgetUpdateSchema>;

// Transfer intake — the paired TRANSFER_OUT/IN is written by the post-action on full
// approval; this only creates the approvable document. Source and destination must differ.
export const budgetTransferSchema = z
  .object({
    fromBudgetId: z.string().uuid(),
    toBudgetId: z.string().uuid(),
    amount: z.string().refine(isPositive, 'A positive amount'),
    reason: z.string().min(1).max(255),
  })
  .refine((d) => d.fromBudgetId !== d.toBudgetId, {
    message: 'Source and destination budgets must differ',
    path: ['toBudgetId'],
  });
export type BudgetTransferInput = z.infer<typeof budgetTransferSchema>;

// Currency admin — mirrors the multi-currency DTOs (currency / exchange rate). Rate is a
// decimal STRING (never a JS number), validated with a regex. Shared by the Vue forms and
// the NestJS DTOs so validation can't drift.
// Rate types per the data model: daily, monthly average, and the fixed annual budgeting rate.
export const RATE_TYPES = ['DAILY', 'MONTHLY_AVG', 'BUDGET_RATE'] as const;
// Provenance of a rate, for audit (central bank / a bank / hand-entered).
export const RATE_SOURCES = ['BOT', 'BANK', 'MANUAL'] as const;
const DECIMAL_STRING = /^\d+(\.\d+)?$/;

export const currencyCreateSchema = z.object({
  code: z.string().length(3).regex(/^[A-Z]{3}$/, 'ISO 4217 code (3 uppercase letters)'),
  name: z.string().min(1),
  symbol: z.string().optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
});
export type CurrencyCreateInput = z.infer<typeof currencyCreateSchema>;

// Chart of accounts — account classification drives the future GL's normal balance.
export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export const accountSchema = z.object({
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  accountType: z.enum(ACCOUNT_TYPES),
  parentId: z.string().uuid().nullish(), // nullish: Select showClear emits null
  isPostable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type AccountInput = z.infer<typeof accountSchema>;

// Purchase tax codes — VAT this slice; WHT reserved for a follow-up. Rate is a decimal string.
export const TAX_KINDS = ['VAT', 'WHT'] as const;
export const taxCodeSchema = z.object({
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  kind: z.enum(TAX_KINDS),
  rate: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'A decimal fraction, e.g. 0.07')
    .refine((v) => Number(v) >= 0 && Number(v) <= 1, 'Rate must be between 0 and 1'),
  isActive: z.boolean().optional(),
});
export type TaxCodeInput = z.infer<typeof taxCodeSchema>;

export const exchangeRateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.string().regex(DECIMAL_STRING, 'A positive decimal'),
  rateDate: z.string().min(1),
  rateType: z.enum(RATE_TYPES).default('DAILY'),
  source: z.enum(RATE_SOURCES).nullish(), // nullish: Select showClear emits null
  // Present → per-company override; absent → group-wide central rate.
  companyId: z.string().uuid().optional(),
});
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;

// Organization admin — mirrors the multi-company DTOs (department / fiscal year /
// holiday). Shared by the Vue forms and the NestJS DTOs so validation can't drift.
export const departmentSchema = z.object({
  deptCode: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  parentDeptId: z.string().uuid().nullish(), // nullish: TreeSelect showClear emits null
  costCenter: z.string().max(255).optional(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const fiscalYearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
export type FiscalYearInput = z.infer<typeof fiscalYearSchema>;

export const holidaySchema = z.object({
  holidayDate: z.string().min(1),
  name: z.string().min(1).max(255),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

// Sample login payload (used by the auth seam).
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Password reset — mirrors ForgotPasswordDto / ResetPasswordDto. Shared by the Vue
// forms (zodResolver) and the NestJS DTOs so client/server validation can't drift.

// Request a reset by username OR email (a single opaque identifier; anti-enumeration).
export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// New-password policy: at least 8 chars, containing a letter and a number.
// Keep this rule identical to ResetPasswordDto (@MinLength(8) + @Matches).
export const passwordPolicy = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/(?=.*[A-Za-z])(?=.*\d)/, 'Password must contain at least one letter and one number');

// Payload schema — mirrors ResetPasswordDto { token, newPassword } exactly.
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordPolicy,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Email verification — mirrors VerifyEmailDto. The raw token comes from the emailed link.
export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// Client-only form schema for the set-new-password form. The token comes from the
// emailed URL (not a form field), and the confirmation is a client concern stripped
// before the request — so the form validates only these two fields + the match.
export const resetPasswordFormSchema = z
  .object({
    newPassword: passwordPolicy,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordFormInput = z.infer<typeof resetPasswordFormSchema>;

// Change-password (authenticated) — the signed-in user rotates a password they still
// know. Distinct from reset (no token, no email): ownership is proven with the CURRENT
// password. Mirrors ChangePasswordDto exactly and is enforced server-side via the
// ZodValidationPipe, so client and server can't drift. The new password must satisfy the
// same policy as reset and must differ from the current one.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicy,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Client-only form schema for the change-password form: adds the confirmation field
// (a client concern stripped before the request) and its match check on top of the
// wire schema's rules.
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicy,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordFormInput = z.infer<typeof changePasswordFormSchema>;

// Master data — mirrors the master-data DTOs (vendor / item). Shared by the Vue
// forms (zodResolver) and the NestJS DTOs so client/server validation can't drift.
export const vendorSchema = z.object({
  vendorCode: z.string().min(1).max(50),
  name: z.string().min(1),
  taxId: z.string().max(13).optional(),
  address: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  paymentTermDays: z.number().int().min(0).optional(),
});

export type VendorInput = z.infer<typeof vendorSchema>;

export const itemSchema = z.object({
  itemCode: z.string().min(1).max(50),
  name: z.string().min(1),
  category: z.string().optional(),
  defaultUnit: z.string().optional(),
  // GL is not a group attribute — it is set per company on the enablement row (item_company).
  isActive: z.boolean().optional(),
});

export type ItemInput = z.infer<typeof itemSchema>;

// RBAC admin — mirrors the rbac admin DTOs. Shared by the Vue forms and the NestJS
// DTOs so create-role / grant / assign validation can't drift.
export const SCOPES = ['OWN', 'DEPARTMENT', 'COMPANY', 'GROUP'] as const;

export const createRoleSchema = z.object({
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().max(255).optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const attachPermissionSchema = z.object({
  roleId: z.string().uuid(),
  permissionCode: z.string().min(1),
  scope: z.enum(SCOPES),
});
export type AttachPermissionInput = z.infer<typeof attachPermissionSchema>;

// Reusable: a validity window must not end before it starts. Empty/absent dates
// mean an open-ended (standing) window. Shared by the assign and employee forms.
const validWindow = (data: { validFrom?: string; validTo?: string }): boolean =>
  !data.validFrom || !data.validTo || data.validTo >= data.validFrom;
const validWindowMessage = {
  message: 'validTo must be on or after validFrom',
  path: ['validTo'] as (string | number)[],
};

// Base object (no window refine) so callers can `.omit()` context fields for a form
// resolver — `.refine()` returns a ZodEffects, which has no `.omit()`.
export const assignRoleBaseSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid(),
  isDefault: z.boolean().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export const assignRoleSchema = assignRoleBaseSchema.refine(validWindow, validWindowMessage);
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

// Employee registry — mirrors the employee DTOs. A registry record is independent of
// a login account; `salary` is a sensitive field gated by EMP_SALARY_VIEW on reads.
export const EMPLOYEE_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED'] as const;

export const employeeCreateSchema = z.object({
  empCode: z.string().min(1).max(255),
  fullName: z.string().min(1).max(255),
  departmentId: z.string().uuid(),
  position: z.string().max(255).optional(),
  jobLevel: z.string().max(255).optional(),
  hireDate: z.string().optional(),
  salary: z.string().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

// Update: same shape, every field optional (empCode immutable once set).
export const employeeUpdateSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  departmentId: z.string().uuid().nullish(), // nullish: Select showClear emits null
  position: z.string().max(255).optional(),
  jobLevel: z.string().max(255).optional(),
  hireDate: z.string().optional(),
  salary: z.string().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
});
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeLinkSchema = z.object({
  userId: z.string().uuid(),
});
export type EmployeeLinkInput = z.infer<typeof employeeLinkSchema>;

// Create-and-link a login account: the admin supplies only username + email. The initial
// password is set server-side from USER_PASSWORD and never entered in the UI.
export const createUserAccountSchema = z.object({
  username: z.string().min(1).max(255),
  email: z.string().email().max(255),
});
export type CreateUserAccountInput = z.infer<typeof createUserAccountSchema>;

// A login account not yet linked to any employee, offered in the "link existing account" picker.
// Identity only — no password, status, or per-company assignments.
export interface LinkableAccount {
  id: string;
  username: string;
  email: string;
}

// Onboard an employee in one step: create the login account (username + email; password set
// server-side from USER_PASSWORD) AND grant a first company-role assignment in the active company.
// The membership is created as the user's default company so they can log in immediately.
export const onboardEmployeeSchema = z.object({
  username: z.string().min(1).max(255),
  email: z.string().email().max(255),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export type OnboardEmployeeInput = z.infer<typeof onboardEmployeeSchema>;

// Document configuration — mirrors the doc-config / workflow DTOs. Shared by the Vue
// forms and the NestJS DTOs so configuration validation can't drift.
export const DOC_CATEGORIES = ['PROCUREMENT', 'FINANCE', 'HR', 'ADMIN', 'IT'] as const;
// Full field-type set (DBML form_field.field_type). `string` is a single-line plain input;
// `text` is the rich (HTML) editor for longer, formatted bodies; `dropdown` carries
// options_json; `line_items` denotes document_line capture; `file` denotes
// document_attachment capture.
export const FIELD_TYPES = ['string', 'text', 'number', 'date', 'dropdown', 'file', 'line_items'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const APPROVE_MODES = ['SEQUENTIAL', 'PARALLEL_ALL', 'PARALLEL_ANY'] as const;
// The post-approval actions the engine actually dispatches on full approval
// (back/src/modules/approval/post-action.service.ts). Keep this list in lockstep with
// that switch — anything not handled there is a silent no-op. NONE = no post-action.
export const POST_ACTIONS = [
  'NONE',
  'CUT_BUDGET',
  'TRANSFER',
  'ADJUST_INCREASE',
  'ADJUST_DECREASE',
  'CREATE_PO',
  'UPDATE_EMPLOYEE',
  'TERMINATE_EMPLOYEE',
] as const;

// Conditional field visibility (DBML form_field.condition_json). A field is shown unless its
// rule says otherwise. The rule references ANOTHER field on the same template by `field` (its
// field_name) with a finite operator set. One evaluator (isFieldVisible, below) is used by both
// the Vue renderer and the NestJS submit check, so display and enforcement cannot drift.
export const CONDITION_OPS = ['eq', 'ne', 'in', 'nin', 'empty', 'notEmpty'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const fieldConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(CONDITION_OPS),
  // Scalar for eq/ne, array for in/nin, absent for empty/notEmpty.
  value: z.union([z.string(), z.array(z.string())]).optional(),
});
export type FieldCondition = z.infer<typeof fieldConditionSchema>;

/** Evaluate one parsed condition against a value lookup keyed by field_name. */
export function evaluateCondition(
  condition: FieldCondition,
  get: (fieldName: string) => string | undefined,
): boolean {
  const other = get(condition.field);
  const isEmpty = other === undefined || other === null || other === '';
  switch (condition.op) {
    case 'empty':
      return isEmpty;
    case 'notEmpty':
      return !isEmpty;
    case 'eq':
      return other === asScalar(condition.value);
    case 'ne':
      return other !== asScalar(condition.value);
    case 'in':
      return asArray(condition.value).includes(other ?? '');
    case 'nin':
      return !asArray(condition.value).includes(other ?? '');
    default:
      return true;
  }
}

/**
 * Whether a field with the given `condition_json` is visible for the current values.
 * Absent/blank/malformed condition → visible (fail-open for display); a condition that
 * references an unknown field is treated as visible too. `values` is keyed by field_name.
 */
export function isFieldVisible(
  conditionJson: string | null | undefined,
  values: Record<string, string | undefined>,
): boolean {
  if (!conditionJson) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(conditionJson);
  } catch {
    return true;
  }
  const result = fieldConditionSchema.safeParse(parsed);
  if (!result.success) return true;
  return evaluateCondition(result.data, (name) => values[name]);
}

function asScalar(value: FieldCondition['value']): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function asArray(value: FieldCondition['value']): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

// Create-document-from-predecessor (PR→PO, advance→clear-advance). The successor's type is
// chosen client-side; the server validates the predecessor's status and the type pairing.
export const createFromSchema = z.object({
  documentTypeId: z.string().uuid(),
});
export type CreateFromInput = z.infer<typeof createFromSchema>;

export const documentTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  category: z.enum(DOC_CATEGORIES),
  requiresBudget: z.boolean().optional(),
  requiresQuota: z.boolean().optional(),
  requiresVendor: z.boolean().optional(),
  requiresItem: z.boolean().optional(),
  // Picked from the chart of accounts (a Select), so clearing it yields null — mirror the
  // backend's @IsOptional(), which accepts null/undefined and treats null as "clear".
  defaultGlAccount: z.string().max(255).nullish(),
  postAction: z.string().optional(),
});
export type DocumentTypeInput = z.infer<typeof documentTypeSchema>;

export const formFieldSchema = z.object({
  formTemplateId: z.string().uuid(),
  fieldName: z.string().min(1),
  fieldLabel: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  optionsJson: z.string().optional(),
  conditionJson: z.string().optional(),
});
export type FormFieldInput = z.infer<typeof formFieldSchema>;

export const deptDocTypeSchema = z.object({
  departmentId: z.string().uuid(),
  documentTypeId: z.string().uuid(),
  formTemplateId: z.string().uuid(),
  workflowId: z.string().uuid(),
});
export type DeptDocTypeInput = z.infer<typeof deptDocTypeSchema>;

// A reference-chain pairing (document_type_ref): a predecessor type may be created-from into
// a successor type, per company. Both must be document types of the active company, and must
// differ — the server enforces both, plus the (company, predecessor, successor) uniqueness.
export const refPairingSchema = z
  .object({
    predecessorTypeId: z.string().uuid(),
    successorTypeId: z.string().uuid(),
  })
  .refine((v) => v.predecessorTypeId !== v.successorTypeId, {
    message: 'A document type cannot chain to itself',
    path: ['successorTypeId'],
  });
export type RefPairingInput = z.infer<typeof refPairingSchema>;

// Editing a mapping changes only its workflow / form template / active state; the
// (department, document type) identity is fixed. All fields optional — send what changes.
export const deptDocTypeUpdateSchema = z.object({
  workflowId: z.string().uuid().optional(),
  formTemplateId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});
export type DeptDocTypeUpdateInput = z.infer<typeof deptDocTypeUpdateSchema>;

export const workflowSchema = z.object({
  name: z.string().min(1),
  conditionJson: z.string().optional(),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

// Compare two decimal strings without a JS float (money rule): scale to integer cents.
function decimalToCents(s: string): bigint {
  const trimmed = s.trim();
  const neg = trimmed.startsWith('-');
  const [intPart, fracPart = ''] = trimmed.replace('-', '').split('.');
  const cents = BigInt(intPart || '0') * 100n + BigInt(((fracPart + '00').slice(0, 2)) || '0');
  return neg ? -cents : cents;
}

export const workflowStepSchema = z
  .object({
    workflowId: z.string().uuid(),
    stepNo: z.number().int().min(1),
    stepName: z.string().optional(),
    // nullish (not just optional): the PrimeVue Select `showClear` emits null when the approver is
    // cleared, and `.optional()` alone would reject null. Both approver fields stay genuinely
    // optional (a step may pick a role OR a specific person). Backend @IsOptional accepts null too.
    approverRoleId: z.string().uuid().nullish(),
    approverUserId: z.string().uuid().nullish(),
    amountMin: z.string().optional(),
    amountMax: z.string().optional(),
    approveMode: z.enum(APPROVE_MODES),
    slaHours: z.number().int().min(0).optional(),
    // Position-level engagement condition, e.g. {"jobLevels":["MANAGER"]} (mirrors
    // workflow_step.condition_json; empty = applies to every requester).
    conditionJson: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.amountMin && val.amountMax) {
      try {
        if (decimalToCents(val.amountMin) > decimalToCents(val.amountMax)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amountMax'],
            message: 'amountMax must be greater than or equal to amountMin',
          });
        }
      } catch {
        // Malformed numbers are caught by the field-level string rules / server.
      }
    }
  });
export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;

// Job-level master-data form — mirrors the backend Create/UpdateJobLevelDto. `code`/`name` are
// non-empty strings; `rank` is a seniority integer (higher = more senior). Shared by the Vue admin
// form and the NestJS DTO so client and server validation cannot drift.
export const jobLevelSchema = z.object({
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  rank: z.number().int(),
  isActive: z.boolean().optional(),
});
export type JobLevelInput = z.infer<typeof jobLevelSchema>;

/**
 * Structured position-level condition authored in the workflow-step editor, before it is serialized
 * into workflow_step.condition_json. The two modes are mutually exclusive: `mode: 'levels'` carries
 * an explicit `jobLevels` code list; `mode: 'minRank'` carries a numeric threshold; `mode: 'none'`
 * carries neither. Mirrors the router's matching contract (stepEngagesFor).
 */
export const stepLevelConditionSchema = z
  .object({
    mode: z.enum(['none', 'levels', 'minRank']),
    jobLevels: z.array(z.string().min(1)).optional(),
    minRank: z.number().int().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'levels' && !(val.jobLevels && val.jobLevels.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['jobLevels'], message: 'Select at least one level' });
    }
    if (val.mode === 'minRank' && val.minRank == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minRank'], message: 'Choose a minimum level' });
    }
  });
export type StepLevelConditionInput = z.infer<typeof stepLevelConditionSchema>;

/**
 * Serialize a structured step level-condition into the workflow_step.condition_json string (or
 * undefined for 'none'). The two modes are mutually exclusive by construction, so the serialized
 * JSON carries only one of `jobLevels` / `minRank` — no ambiguous both-present object is produced.
 */
export function serializeStepCondition(cond: StepLevelConditionInput): string | undefined {
  if (cond.mode === 'levels' && cond.jobLevels && cond.jobLevels.length > 0) {
    return JSON.stringify({ jobLevels: cond.jobLevels });
  }
  if (cond.mode === 'minRank' && cond.minRank != null) {
    return JSON.stringify({ minRank: cond.minRank });
  }
  return undefined;
}

/** Parse a condition_json string back into the structured editor shape (explicit-wins precedence). */
export function parseStepCondition(conditionJson: string | null | undefined): StepLevelConditionInput {
  switch (stepConditionMode(conditionJson)) {
    case 'levels':
      return { mode: 'levels', jobLevels: parseStepJobLevels(conditionJson) };
    case 'minRank':
      return { mode: 'minRank', minRank: parseStepMinRank(conditionJson)! };
    default:
      return { mode: 'none' };
  }
}

/**
 * The position-level restriction of a workflow_step.condition_json, e.g. {"jobLevels":["MANAGER"]}.
 * Absent/blank/malformed → no restriction (empty array). One parser is shared by the approval
 * router (step engagement) and the submit guard (is-the-workflow-level-gated) so they cannot drift.
 */
export function parseStepJobLevels(conditionJson: string | null | undefined): string[] {
  if (!conditionJson) return [];
  try {
    const parsed = JSON.parse(conditionJson) as { jobLevels?: unknown };
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.jobLevels)) {
      return parsed.jobLevels.filter((l): l is string => typeof l === 'string');
    }
  } catch {
    // tolerate legacy/garbage — treat as unrestricted
  }
  return [];
}

/**
 * The rank-threshold form of a workflow_step.condition_json, e.g. {"minRank":30} — the step engages
 * when the requester's job-level `rank` is >= this value. Returns null when absent/blank/malformed
 * or not a finite number. Precedence: when a condition carries BOTH `jobLevels` (non-empty) and
 * `minRank`, the explicit list wins and `minRank` is ignored (see stepConditionMode). Shared by the
 * router and submit guard so they cannot drift.
 */
export function parseStepMinRank(conditionJson: string | null | undefined): number | null {
  if (!conditionJson) return null;
  try {
    const parsed = JSON.parse(conditionJson) as { minRank?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.minRank === 'number' && Number.isFinite(parsed.minRank)) {
      return parsed.minRank;
    }
  } catch {
    // tolerate legacy/garbage — treat as unrestricted
  }
  return null;
}

/**
 * The engagement mode a step's condition_json expresses, resolving the explicit-wins precedence in
 * one place: 'levels' when it carries a non-empty jobLevels list, else 'minRank' when it carries a
 * numeric minRank, else 'none' (applies to everyone).
 */
export function stepConditionMode(
  conditionJson: string | null | undefined,
): 'levels' | 'minRank' | 'none' {
  if (parseStepJobLevels(conditionJson).length > 0) return 'levels';
  if (parseStepMinRank(conditionJson) != null) return 'minRank';
  return 'none';
}

/**
 * Does a step engage for a requester at `jobLevel` (code) with seniority `rank`? Encodes the
 * matching contract used by the approval router: explicit list → exact-code membership; minRank →
 * rank threshold; none → always. A requester with no resolved level (undefined) matches only the
 * unrestricted case. Kept here so router and submit guard share one definition.
 */
export function stepEngagesFor(
  conditionJson: string | null | undefined,
  requester: { jobLevel?: string; rank?: number } | undefined,
): boolean {
  switch (stepConditionMode(conditionJson)) {
    case 'levels': {
      const levels = parseStepJobLevels(conditionJson);
      return requester?.jobLevel != null && levels.includes(requester.jobLevel);
    }
    case 'minRank': {
      const minRank = parseStepMinRank(conditionJson)!;
      return requester?.rank != null && requester.rank >= minRank;
    }
    default:
      return true;
  }
}

/**
 * True when any step carries a position-level condition — a non-empty jobLevels list OR a minRank
 * threshold — i.e. the workflow gates at least one step by requester position level. A requester
 * with no job level would have such steps silently skipped, so submit into a level-gated workflow
 * requires the requester to have a level.
 */
export function isLevelGated(steps: Array<{ conditionJson?: string | null }>): boolean {
  return steps.some((s) => stepConditionMode(s.conditionJson) !== 'none');
}

// Goods receipt — mirrors the backend ReceiveDto. Quantities are decimal STRINGS (never a
// JS number); a receipt must touch at least one line and each qty must be positive.
export const receiveLineSchema = z.object({
  lineId: z.string().uuid(),
  qty: z.string().regex(/^\d+(\.\d+)?$/, 'Quantity must be a positive number').refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
});
export const receiveSchema = z.object({
  lines: z.array(receiveLineSchema).min(1, 'Record at least one received line'),
});
export type ReceiveInput = z.infer<typeof receiveSchema>;

// Record an actual payment — mirrors the backend RecordPaymentDto. The actual rate is a
// positive decimal STRING (never a JS number); the server computes the FX gain/loss from it.
export const recordPaymentSchema = z.object({
  actualRate: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'A positive decimal rate')
    .refine((v) => Number(v) > 0, 'Rate must be greater than zero'),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// Quota administration — mirrors the quota CreateQuotaDto / UpdateQuotaDto and the
// entitlement DTOs (upsert / adjust / carry-forward). `limitValue` / `entitledValue` /
// `delta` are decimal STRINGS (money rule — never a JS number). Shared by the Vue forms
// and the NestJS DTOs so client and server validation can't drift.
export const RESET_CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'NONE'] as const;
const SIGNED_DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export const quotaCreateSchema = z.object({
  quotaType: z.string().min(1).max(255),
  unit: z.string().min(1).max(255),
  limitValue: z.string().regex(DECIMAL_STRING, 'A non-negative decimal'),
  resetCycle: z.enum(RESET_CYCLES).default('YEARLY'),
  carryForward: z.boolean().default(true),
  departmentId: z.string().uuid().nullish(), // nullish: Select showClear emits null
});
export type QuotaCreateInput = z.infer<typeof quotaCreateSchema>;

export const quotaUpdateSchema = z.object({
  quotaType: z.string().min(1).max(255).optional(),
  unit: z.string().min(1).max(255).optional(),
  limitValue: z.string().regex(DECIMAL_STRING, 'A non-negative decimal').optional(),
  resetCycle: z.enum(RESET_CYCLES).optional(),
  carryForward: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type QuotaUpdateInput = z.infer<typeof quotaUpdateSchema>;

export const entitlementSchema = z.object({
  // quotaId is the routed context, merged into the payload in the submit handler rather
  // than rendered as a field — optional so the Form resolver (which only sees rendered
  // fields) doesn't fail on its absence. Same convention as exchangeRateSchema.companyId.
  quotaId: z.string().uuid().optional(),
  employeeId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  entitledValue: z.string().regex(DECIMAL_STRING, 'A non-negative decimal'),
  carriedOver: z.string().regex(DECIMAL_STRING).optional(),
  adjusted: z.string().regex(SIGNED_DECIMAL_STRING).optional(),
});
export type EntitlementInput = z.infer<typeof entitlementSchema>;

export const adjustEntitlementSchema = z.object({
  // quotaId/employeeId/year identify the row being adjusted and are merged from context
  // in the submit handler, not rendered as fields — optional so the resolver (which sees
  // only the rendered delta/reason) doesn't fail on their absence.
  quotaId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  delta: z.string().regex(SIGNED_DECIMAL_STRING, 'A signed decimal (may be negative)'),
  reason: z.string().max(255).optional(),
});
export type AdjustEntitlementInput = z.infer<typeof adjustEntitlementSchema>;

export const carryForwardSchema = z
  .object({
    // quotaId is the routed context, merged in the submit handler, not a rendered field.
    quotaId: z.string().uuid().optional(),
    fromYear: z.number().int().min(2000).max(2100),
    toYear: z.number().int().min(2000).max(2100),
  })
  .refine((v) => v.toYear !== v.fromYear, { message: 'toYear must differ from fromYear', path: ['toYear'] });
export type CarryForwardInput = z.infer<typeof carryForwardSchema>;

// Issue an API key — mirrors IssueApiKeyDto. Shared by the Vue form and the NestJS DTO so
// client and server validation cannot drift. `expiresAt` is optional (empty → unset).
export const issueApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  targetUserId: z.string().uuid(),
  expiresAt: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
});
export type IssueApiKeyInput = z.infer<typeof issueApiKeySchema>;
