import { z } from 'zod';

/**
 * Single source of truth for validation rules shared by the Vue forms
 * (zodResolver) and the NestJS DTOs (ZodValidationPipe). Change a rule here and
 * both client and server pick it up — they cannot drift.
 */

/**
 * True when `value` is a named time zone the runtime recognises. Checked against the platform's
 * own IANA database rather than a hardcoded list, so it tracks whatever tzdata ships — and works
 * unchanged in Node and the browser.
 *
 * Fixed offsets are rejected even though `Intl` accepts them. "+07:00" names an offset, not a
 * place, so it cannot follow a DST rule or a future tzdata correction. Neither Thailand nor Laos
 * observes DST today, but the platform is multi-company and a zone stored as an offset would be
 * silently wrong the moment one of them adopted it — or the moment a company elsewhere joined.
 */
export function isValidTimeZone(value: string): boolean {
  if (!value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A company's IANA time zone. Not a fixed offset: an offset cannot express DST, and while
 * neither Thailand nor Laos observes it, nothing stops a company elsewhere in the group.
 */
export const timezoneSchema = z
  .string()
  .refine(isValidTimeZone, { message: 'Must be a valid IANA time zone, e.g. Asia/Bangkok' });

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
  // Defines when this company's calendar days begin and end. Defaulted rather than required so
  // existing callers keep working; attendance resolves day boundaries against it.
  timezone: timezoneSchema.default('Asia/Bangkok'),
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
/**
 * The two-value over-limit policy. No longer used by budgets — how strictly a budget is checked is
 * the tolerance ladder on its control point — but the enum it mirrors is still live on the backend
 * for `quota.control_policy` (sick leave must warn, not block) and `work_location.control_policy`
 * (geofence). Kept for the forms those will need; do not read it as evidence the enum is dead.
 */
export const CONTROL_POLICIES = ['HARD_STOP', 'SOFT_WARNING'] as const;
const POSITIVE_DECIMAL_STRING = /^\d+(\.\d+)?$/;
const isPositive = (v: string) => POSITIVE_DECIMAL_STRING.test(v) && Number(v) > 0;
/**
 * Zero or more — the rule for an APPROPRIATION, which `isPositive` is not.
 *
 * A plan line the organisation spends against but never funded is a real line whose figure is
 * nothing, and `0` is what the plan importer already writes for the section the workbook itself
 * marks `ບໍ່ມີງົບ`. Empty and non-numeric still fail (the regex refuses both), and so does a
 * negative: the pattern admits no sign, so `-1` never reaches the comparison.
 *
 * Deliberately separate from `isPositive` rather than a flag on it. A MOVEMENT of nothing moves
 * nothing, so transfers and adjustments must keep refusing zero; a boolean argument shared between
 * the two is how that rule loosens later without anyone deciding to.
 */
const isZeroOrMore = (v: string) => POSITIVE_DECIMAL_STRING.test(v);

export const budgetCreateSchema = z.object({
  fiscalYearId: z.string().uuid(),
  departmentId: z.string().uuid(),
  // Where in the plan the money sits, and the budget's identity. The GL account cannot be that:
  // several budgets legitimately share one account, and one budget posts to several.
  nodeId: z.string().uuid(),
  // Optional, and a hint rather than an identity — it stamps a line that carries no item.
  glAccount: z.string().max(255).optional(),
  budgetName: z.string().max(255).optional(),
  // Set at creation; never overwritten by usage (invariant 3). A decimal string of zero or more —
  // an unfunded plan line is a real budget whose figure is nothing (see `isZeroOrMore`).
  //
  // The message is an i18n KEY, not prose. It used to be the English string `A positive amount`,
  // which the form rendered verbatim: the one field error a Lao budget officer could trigger was
  // the one sentence on the screen they could not read.
  amountTotal: z.string().refine(isZeroOrMore, 'validation.amountZeroOrMore'),
  // No over-limit policy and no tolerance ladder. How strictly spending is checked belongs to the
  // control point governing the budget, and at the moment this form is filled in that control
  // point does not exist yet: creation proposes a DRAFT budget, and coverage is established when
  // the plan carrying it is approved.
});
export type BudgetCreateInput = z.infer<typeof budgetCreateSchema>;

// Edit: amountTotal is intentionally NOT here — corrections are ledger adjustments,
// never an overwrite (invariant 3).
export const budgetUpdateSchema = z.object({
  budgetName: z.string().max(255).optional(),
  // Correctable, and clearable with an empty string. The node is NOT here: it is the identity
  // documents and history refer to the budget by.
  glAccount: z.string().max(255).optional(),
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

/**
 * Create a service account (a non-human identity authenticated only by an API key) together with
 * its first company-role assignment. Mirrors `CreateServiceAccountDto` field for field.
 *
 * There is deliberately no password field: a service account never has one, so the form must not
 * offer one and the server must never receive one.
 */
export const createServiceAccountSchema = z.object({
  username: z.string().min(1).max(255),
  // Required because app_user.email is unique and NOT NULL. Identifies the account
  // (e.g. claim-bot@hal.local); nothing is ever mailed to it.
  email: z.string().email().max(255),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid(),
});
export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;

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

// ---- Bulk RBAC writes ------------------------------------------------------
// A batch is a UI-driven edit over a catalog of known size; cap it so an unbounded
// array can't hold a transaction open. Keep in step with @ArrayMaxSize on the DTOs.
export const RBAC_BULK_MAX = 200;

/**
 * One staged grant in a bulk role-permission edit: a catalog code plus the
 * data-visibility scope it should hold. Re-sending a code the role already holds is
 * not an error — the server reports it applied (scope changed) or skipped (identical).
 */
export const bulkGrantSchema = z.object({
  permissionCode: z.string().min(1),
  scope: z.enum(SCOPES),
});
export type BulkGrantInput = z.infer<typeof bulkGrantSchema>;

// Base object (no roleId omit-blocker) — see the assignRoleBaseSchema note: the manage
// surface holds roleId as dialog context, not a rendered FormField.
export const bulkAttachPermissionsBaseSchema = z.object({
  grants: z.array(bulkGrantSchema).max(RBAC_BULK_MAX),
  detach: z.array(z.string().min(1)).max(RBAC_BULK_MAX),
});
export const bulkAttachPermissionsSchema = bulkAttachPermissionsBaseSchema.extend({
  roleId: z.string().uuid(),
});
export type BulkAttachPermissionsInput = z.infer<typeof bulkAttachPermissionsSchema>;

// Shared assignment context + the roles it applies to. `userId` is dialog context, so the
// base omits it and the window refine lives only on the full schema (ZodEffects has no .omit()).
export const bulkAssignRolesBaseSchema = z.object({
  departmentId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()).min(1).max(RBAC_BULK_MAX),
  isDefault: z.boolean().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export const bulkAssignRolesSchema = bulkAssignRolesBaseSchema
  .extend({ userId: z.string().uuid() })
  .refine(validWindow, validWindowMessage);
export type BulkAssignRolesInput = z.infer<typeof bulkAssignRolesSchema>;

/** What a bulk write did with one item, so the UI can report partial outcomes. */
export type BulkSkipReason =
  | 'ALREADY_HELD'
  | 'ALREADY_HELD_SAME_SCOPE'
  | 'NOT_HELD';
export interface BulkWriteResult {
  applied: string[];
  skipped: Array<{ item: string; reason: BulkSkipReason }>;
}

/**
 * The statuses a `budget` row can hold, in the order a reader meets them.
 *
 * Shared because both sides must agree: the server validates a filter against this list and the
 * budget screen's status filter offers exactly it. Offering only the statuses the data currently
 * holds would make the control's shape depend on the data — CLOSED appearing the day a fiscal year
 * closes, which is precisely when a reader is looking for it and has never seen it before.
 *
 * DRAFT: proposed by a plan, not yet approved, not spendable. ACTIVE: in force. REJECTED: turned
 * down, kept because the record of what was refused is the point of routing budgets through
 * approval. CLOSED: ran its year.
 */
export const BUDGET_STATUSES = ['DRAFT', 'ACTIVE', 'REJECTED', 'CLOSED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

/**
 * The budget statuses that ARE money, for every figure that totals budgets. An ALLOW-list,
 * deliberately.
 *
 * `ACTIVE` is money in force. `CLOSED` is an appropriation that ran its year — it keeps its
 * `amount_total` and every ledger row, and a total over a closed year that excluded it would
 * measure a year of spending against a ceiling of zero and call every line overspent.
 *
 * Everything else is out. `DRAFT` is a proposal awaiting the approval that would put it in force
 * and is not spendable; a department mid-way through entering next year's plan would otherwise
 * watch its ceiling climb with every draft. `REJECTED` was refused and was never money — it is kept
 * only because `budget_movement.to_budget_id` references it and because the record of what was
 * refused is the point of routing budgets through approval at all.
 *
 * Written as what IS counted rather than what is excluded, and that is not stylistic. `INACTIVE`
 * exists in this system and appears in no declared list: `BUDGET_STATUSES` does not contain it, but
 * `UpdateBudgetDto.status` validates as any string and the budget edit form offers it. A deny-list
 * would have admitted it into an annual ceiling today, not hypothetically. Being wrongly absent
 * from a ceiling is visible to whoever reads the figure; being wrongly present is the defect this
 * exists to end.
 *
 * Shared because a report and the tree above it must not state different money. The quarterly
 * budget report totals over this set, and so does the budget list's tree presentation; two copies
 * of two strings are exactly cheap enough to drift silently.
 */
export const COUNTED_BUDGET_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type CountedBudgetStatus = (typeof COUNTED_BUDGET_STATUSES)[number];

/**
 * Does a budget in this status belong in a total?
 *
 * Takes a plain `string` rather than `BudgetStatus`: the whole point of the allow-list is that a
 * value outside every declared list is reachable, and a signature that could not express one would
 * push each caller into its own cast.
 */
export function isCountedBudget(status: string | undefined): boolean {
  return (COUNTED_BUDGET_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * Which status a budget may be moved to, from the one it holds.
 *
 * `budget.status` decides whether money exists, and it was written with no rule at all: the edit
 * form sent a string, `UpdateBudgetDto.status` validated it as any string, and the service assigned
 * it without reading the value it replaced — against a column with no CHECK. Every move below was
 * therefore reachable, including the three this table exists to refuse.
 *
 * An ALLOW-list, and deny by default: a `from` this table does not name permits nothing, so a
 * status that reaches the database by some route nobody predicted cannot be edited onward into one
 * that spends.
 *
 * `INACTIVE` is named here while `BUDGET_STATUSES` omits it, and that is not an oversight — see the
 * note on `COUNTED_BUDGET_STATUSES`. It is reachable and the edit form offers it, so a table that
 * governs what the edit form may do has to answer for it. Suspending money and putting it back is
 * an ordinary act, which is why it is the one pair that moves in both directions.
 *
 * The three refusals, each for its own reason:
 *
 * - Nothing leaves `REJECTED`. Rejection frees the (fiscal year, department, gl_account) slot so
 *   the line can be PROPOSED again and approved on its merits. Reviving the row instead would put
 *   back a figure an approver turned down, with no second approval anywhere in its history.
 * - Nothing enters `DRAFT`. Proposing is what writes DRAFT, through a budget plan. Hand-authoring
 *   it would manufacture a proposal that no plan carries and no approval covers.
 * - Nothing leaves `CLOSED`. A closed appropriation ran its year; reopening it would let this
 *   year's spending charge last year's ceiling.
 *
 * `DRAFT` leaves only through approval — `activate` on the plan's post-action, not this table,
 * which is why DRAFT permits nothing by hand while still becoming ACTIVE every day.
 *
 * A status written onto itself is always allowed. A form that submits every field must not fail
 * because one of them did not change.
 *
 * Shared because the server's refusal and the form's picker must not disagree: a screen offering a
 * move the server rejects reports a rule as a failure.
 */
const BUDGET_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  DRAFT: [],
  ACTIVE: ['INACTIVE', 'CLOSED'],
  INACTIVE: ['ACTIVE', 'CLOSED'],
  REJECTED: [],
  CLOSED: [],
};

/**
 * May a budget move from `from` to `to`?
 *
 * Takes plain strings for the same reason `isCountedBudget` does: a value outside every declared
 * list is reachable, and a signature that could not express one would push each caller into a cast.
 */
export function canTransitionBudget(from: string | undefined, to: string | undefined): boolean {
  if (from === to) return true;
  return (BUDGET_TRANSITIONS[from ?? ''] ?? []).includes(to ?? '');
}

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
// Full field-type set (DBML form_field.field_type). `string` is a single-line plain input;
// `text` is the rich (HTML) editor for longer, formatted bodies; `dropdown` carries
// options_json; `line_items` denotes document_line capture; `file` denotes
// document_attachment capture.
export const FIELD_TYPES = ['string', 'text', 'number', 'date', 'dropdown', 'file', 'line_items'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * The field types whose stored value is HTML, because their control is a rich editor.
 *
 * THE declaration — the Vue renderer picks its editor from it and the server refuses markup in any
 * other type's value, so "which control" and "what shape is the value" cannot disagree again. They
 * did: a salary configured as `text` got the rich editor, was stored as `<p>7500000</p>`, and could
 * never satisfy the decimal guard the promotion post-action runs at approval.
 *
 * The aliases are the spellings the renderer already accepted for the same control.
 */
export const HTML_FIELD_TYPES = ['text', 'richtext', 'rich_text', 'html'] as const;
export const isHtmlFieldType = (t: string | undefined): boolean =>
  HTML_FIELD_TYPES.includes((t ?? '').toLowerCase() as never);

/** Anything a rich editor would leave behind. A plain value carries none of it. */
const MARKUP = /<\/?[a-z][\s\S]*>|&[a-z]+;|&#\d+;/i;
/**
 * True when `value` carries markup that a non-rich field must not store. Used at the write
 * boundary, so a misconfigured field is an error naming the field rather than a post-action
 * rollback discovered at approval.
 */
export const carriesMarkup = (value: string | null | undefined): boolean =>
  !!value && MARKUP.test(value);
export const APPROVE_MODES = ['SEQUENTIAL', 'PARALLEL_ALL', 'PARALLEL_ANY'] as const;
// The post-approval actions the engine dispatches on full approval. THE declaration of the set —
// the Zod schema below, the NestJS DTO, the entity property, the dispatch switch and the admin
// Select all read it, so the list cannot drift from the switch the way it did when each layer
// restated it. `post-action.service.ts` ends in `assertNever`, so adding a member here without a
// branch there is a build error rather than a document that approves and does nothing.
//
// Absence of a post-action is `null`, not a member of this set — one spelling, so "this type
// deliberately does nothing" cannot be confused with a value nobody dispatches. The admin Select
// carries null on its no-action option rather than a sentinel string.
export const POST_ACTIONS = [
  'CUT_BUDGET',
  'TRANSFER',
  'ADJUST_INCREASE',
  'ADJUST_DECREASE',
  'ACTIVATE_BUDGET',
  'CREATE_SUCCESSOR',
  'ISSUE_STOCK',
  'ADJUST_STOCK',
  'TRANSFER_STOCK',
  'POST_JOURNAL',
  'UPDATE_EMPLOYEE',
  'TERMINATE_EMPLOYEE',
] as const;
export type PostAction = (typeof POST_ACTIONS)[number];

/**
 * The sheet a document type prints. Closed set, declared once so the DB CHECK constraint, the
 * backend DTO and the admin Select cannot drift — the same shape `POST_ACTIONS` uses.
 *
 * `LETTER` is the official Lao letter (ໃບສະເໜີ) the exporter has always produced, and the default
 * for every type, so adding this column changes nothing about what existing types print. The other
 * three are the pre-printed business forms: ໃບສະເໜີຈັດຊື້ (PR), ໃບສັ່ງຊື້ (PO), ໃບເບີກຈ່າຍ (RECEIPT).
 *
 * Deliberately its own column rather than something derived from `code`, `category` or
 * `post_action` (invariant 7): one company spells its purchase request `PR` and another `REQ`, a
 * company may run several purchase-request types, and what a document prints is a different
 * question from what approving it does.
 */
export const PRINT_TEMPLATES = ['LETTER', 'PR', 'PO', 'RECEIPT'] as const;
export type PrintTemplate = (typeof PRINT_TEMPLATES)[number];

/** The sheet a type prints when it configures none — every existing type reads as this. */
export const DEFAULT_PRINT_TEMPLATE = 'LETTER' as const satisfies PrintTemplate;

/**
 * The order sheets are printed in when a type declares several.
 *
 * A document can be more than one piece of paper: HAL's purchase request is filed as the official
 * letter AND as the purchase-request form, in that order, because the letter is what the director
 * signs and the form is what the buyer works from. The order is fixed rather than per-company
 * because it follows the documents' own sequence — the letter introduces the request, the request
 * precedes the order, the order precedes the receipt.
 */
export const PRINT_TEMPLATE_ORDER: readonly PrintTemplate[] = ['LETTER', 'PR', 'PO', 'RECEIPT'];

/**
 * Read the stored `print_templates` value as the list of sheets it names.
 *
 * Stored comma-separated in one column: a document type prints between one and four sheets, always
 * from the same closed set, and a join table for a list that short would cost a query on every
 * export to say what a varchar already says. Unknown or empty values read as the default, so a
 * type can never end up printing nothing at all.
 */
export function parsePrintTemplates(value: string | null | undefined): PrintTemplate[] {
  const parsed = (value ?? '')
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter((v): v is PrintTemplate => (PRINT_TEMPLATES as readonly string[]).includes(v));
  const unique = [...new Set(parsed)];
  return unique.length ? sortPrintTemplates(unique) : [DEFAULT_PRINT_TEMPLATE];
}

/** Canonical print order, so the stored order cannot put a receipt before its request. */
export function sortPrintTemplates(templates: readonly PrintTemplate[]): PrintTemplate[] {
  return [...templates].sort(
    (a, b) => PRINT_TEMPLATE_ORDER.indexOf(a) - PRINT_TEMPLATE_ORDER.indexOf(b),
  );
}

/** The column value for a list of sheets — deduplicated and in canonical order. */
export function formatPrintTemplates(templates: readonly PrintTemplate[]): string {
  const unique = [...new Set(templates)];
  return (unique.length ? sortPrintTemplates(unique) : [DEFAULT_PRINT_TEMPLATE]).join(',');
}

/**
 * Which of the company's own accounts a transfer left: the main account or the reserve one.
 *
 * A confirmation by the person recording the payment, not a reference to a configured
 * `bank_account`. Two values rather than a lookup because that is the question being asked — "did
 * this go out of the main account or the reserve one" — and the answer is the same two words
 * whatever the company's account list looks like.
 */
export const TRANSFER_SOURCES = ['PRIMARY', 'RESERVE'] as const;
export type TransferSource = (typeof TRANSFER_SOURCES)[number];

/**
 * What one export covers: the requested document alone, or every document of the reference chain
 * it belongs to (PR + PO + Receipt) in one file.
 *
 * `SELF` is the default everywhere it is optional, so an export that names nothing produces what
 * the endpoint produced before the chain export existed. Declared here because the print dialog
 * and the endpoint's validator must offer exactly the same two words.
 */
export const EXPORT_PARTS = ['SELF', 'CHAIN'] as const;
export type ExportParts = (typeof EXPORT_PARTS)[number];

/**
 * The member the journal-voucher path resolves its document type by. Named here rather than in a
 * module because both `gl` and `approval` compare against it, and a constant per module is how the
 * two POST_JOURNAL declarations this change removed came to exist.
 */
// `as const satisfies` rather than `: PostAction` — annotating it with the union widens the
// constant to the union, and a `case` label of that type narrows nothing, which makes the
// dispatcher's assertNever fail to compile. This keeps the literal type AND checks membership.
export const POST_JOURNAL = 'POST_JOURNAL' as const satisfies PostAction;

/**
 * Actions that convert a budget reservation into spend. `CUT_BUDGET` is the only one: the
 * post-action dispatcher sends it to `cutBudget`, the sole caller of `BudgetLedgerService.settle`,
 * the sole writer of an `ACTUAL` row. Naming it here makes that chain readable in one place instead
 * of across three files, and lets the configuration rules ask "can this reservation ever be
 * settled?" without hardcoding a document-type code (invariant 7).
 *
 * Deliberately NOT merged with `RESERVING_ACTIONS` below: that one means *reserves stock*. Budget
 * and stock are different resources with different lifecycles, and sharing one list because the
 * word "reserve" appears in both is how the two would drift into each other.
 */
export const SETTLING_ACTIONS: readonly PostAction[] = ['CUT_BUDGET'];

/** Whether a type carrying this post-action settles its own budget reservation at approval. */
export const settlesBudget = (action: string | null | undefined): boolean =>
  !!action && SETTLING_ACTIONS.includes(action as PostAction);

/** Actions whose submit reserves stock, so the movement is held before approval settles it. */
export const RESERVING_ACTIONS: readonly PostAction[] = ['ISSUE_STOCK', 'TRANSFER_STOCK'];

/**
 * Actions carried by the document types that move stock. A line on one of these may only name a
 * stock-tracked item, so the line editor filters its item list by this and the server refuses an
 * untracked item at submit. Decided from `post_action` rather than from a list of document-type
 * codes (invariant 7).
 */
export const STOCK_POST_ACTIONS: readonly PostAction[] = [
  'ISSUE_STOCK',
  'ADJUST_STOCK',
  'TRANSFER_STOCK',
];

/** Actions carried by the document types that move an appropriation. */
export const MOVEMENT_POST_ACTIONS: readonly PostAction[] = [
  'ADJUST_INCREASE',
  'ADJUST_DECREASE',
  'TRANSFER',
];

/**
 * How each `budget_txn.txn_type` moves a budget's AVAILABLE balance — the three-way sort the
 * balance formula makes (invariant 3):
 *
 *   available = amount_total + ADJUST_INCREASE − ADJUST_DECREASE
 *                            + TRANSFER_IN     − TRANSFER_OUT
 *                            − RESERVE         + RELEASE
 *
 * `ACTUAL` is absent from that formula, and its absence is the whole point: a settlement converts
 * money an earlier RESERVE already removed from the available balance into money recorded as spent.
 * Counting it again charges the budget twice for one document.
 *
 * Lives here, rather than in either runtime, for the reason `isFieldVisible` does: the balance
 * computation and the ledger screen must agree, and a classification kept in two places is free to
 * disagree with itself. It did — the ledger drew a settlement as a withdrawal and summed to 270,000
 * against a budget that had fallen by 185,000. Convenience is NOT the reason to add something here;
 * two runtimes needing one answer is.
 *
 * Total over the enum on purpose. A two-way split gave `ACTUAL` its direction by default, because
 * it was whatever the fallback bucket was; a type added later must state its own direction rather
 * than inherit one from an omission.
 */
export const BUDGET_TXN_DIRECTION = {
  ADJUST_INCREASE: 'ADDS',
  TRANSFER_IN: 'ADDS',
  RELEASE: 'ADDS',
  ADJUST_DECREASE: 'SUBTRACTS',
  TRANSFER_OUT: 'SUBTRACTS',
  RESERVE: 'SUBTRACTS',
  ACTUAL: 'CONVERTS',
} as const;

export type BudgetTxnDirection = (typeof BUDGET_TXN_DIRECTION)[keyof typeof BUDGET_TXN_DIRECTION];

/**
 * The direction of a transaction type. An unknown type converts rather than moves the balance —
 * the safe default, because a wrong `ADDS`/`SUBTRACTS` silently misstates the money while a wrong
 * `CONVERTS` shows an unsigned row that reconciliation will not balance.
 */
export const budgetTxnDirection = (txnType: string): BudgetTxnDirection =>
  BUDGET_TXN_DIRECTION[txnType as keyof typeof BUDGET_TXN_DIRECTION] ?? 'CONVERTS';

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

/**
 * What a document carries that a field's value could live in. A `file` field's value is an
 * attachment and a `line_items` field's value is a line — neither ever produces a
 * `doc_field_value` row.
 */
export interface FieldPresenceContext {
  /** `doc_field_value` by `field_name`. Absent or empty string both mean "no value". */
  values: Record<string, string | undefined>;
  /** How many `document_attachment` rows the document has. */
  attachmentCount: number;
  /** How many `document_line` rows the document has. */
  lineCount: number;
}

/**
 * Whether a field HAS a value, asked where that field's TYPE actually stores it.
 *
 * THE rule, shared by the server's submit gate and by every screen that predicts its verdict.
 * They were two hand-kept copies and they drifted: the client consulted `doc_field_value` alone,
 * so a required `file` field was reported missing on every draft — including drafts whose file was
 * uploaded — and the standing banner saying so outlived the toast carrying the real reason a
 * submit had been refused.
 *
 * A field type added later is handled here once, rather than in one place and forgotten in the
 * other.
 */
export function hasFieldValue(
  field: { fieldName: string; fieldType?: string },
  ctx: FieldPresenceContext,
): boolean {
  switch (field.fieldType) {
    case 'file':
      return ctx.attachmentCount > 0;
    case 'line_items':
      return ctx.lineCount > 0;
    default: {
      const v = ctx.values[field.fieldName];
      return v !== undefined && v !== null && v !== '';
    }
  }
}

/**
 * The visible required fields a document is still missing, by `field_name`. Composes the two
 * shared rules — visibility, then presence — so a hidden field is never reported missing.
 */
export function missingRequiredFields<T extends { fieldName: string; fieldType?: string; isRequired?: boolean; conditionJson?: string | null }>(
  fields: readonly T[],
  ctx: FieldPresenceContext,
): T[] {
  return fields.filter(
    (f) => f.isRequired && isFieldVisible(f.conditionJson, ctx.values) && !hasFieldValue(f, ctx),
  );
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

// Document category (document_category) — company-scoped config replacing the old fixed enum.
// `code` is immutable after creation (create-only); `name` and active state are editable.
export const documentCategorySchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
});
export type DocumentCategoryInput = z.infer<typeof documentCategorySchema>;

export const documentCategoryUpdateSchema = z.object({
  name: z.string().min(1).max(255),
  isActive: z.boolean().optional(),
});
export type DocumentCategoryUpdateInput = z.infer<typeof documentCategoryUpdateSchema>;

export const documentTypeSchema = z.object({
  code: z.string().min(1, 'A code is required').max(50),
  name: z.string().min(1, 'A name is required'),
  // A document_category code (options are the active company's categories, fetched at runtime);
  // the server rejects a code that isn't an active category of the company.
  category: z.string().min(1, 'Choose a category'),
  requiresBudget: z.boolean().optional(),
  requiresQuota: z.boolean().optional(),
  requiresVendor: z.boolean().optional(),
  requiresItem: z.boolean().optional(),
  requiresPayee: z.boolean().optional(),
  // This type is the form for recording something that ALREADY happened: its documents may state
  // the day their money moved. Not one of the `requires_*` flags — those decide what the REQUESTER
  // must supply — but it is edited on the same form, and z.object strips what it does not declare,
  // so leaving it out silently dropped the toggle on its way to the server.
  recordsPastEvents: z.boolean().optional(),
  // Picked from the chart of accounts (a Select), so clearing it yields null — mirror the
  // backend's @IsOptional(), which accepts null/undefined and treats null as "clear".
  defaultGlAccount: z.string().max(255).nullish(),
  // The closed set, or null for "this type does nothing on approval". Mirrors the backend DTO's
  // @IsIn — client and server refuse the same values, which is the point of declaring the set once.
  postAction: z.enum(POST_ACTIONS).nullish(),
  // Which sheets this type prints, in one to four entries. Optional on the wire — omitted leaves
  // the column at its LETTER default rather than meaning "no sheet", since every document prints
  // as something. An empty array is refused for the same reason.
  printTemplates: z.array(z.enum(PRINT_TEMPLATES)).min(1).optional(),
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
    // When true, the CREATE_SUCCESSOR post-action auto-creates this successor on the predecessor's
    // full approval; omitted/false means the pairing is available for manual create-from only.
    autoCreate: z.boolean().optional(),
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

// A workflow is chosen by its (department, document type) mapping and carries no selection
// condition of its own — every condition routing evaluates is authored on a step.
export const workflowSchema = z.object({
  name: z.string().min(1),
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
    // Who may act once the SLA has elapsed. Nullish for the same reason as the approver fields.
    // Leaving both empty is a valid choice: the step is then chased, not skipped.
    escalateToRoleId: z.string().uuid().nullish(),
    escalateToUserId: z.string().uuid().nullish(),
    // Whether this step may only be APPROVED once the document carries a transfer slip. Default
    // false — every step demanded nothing before this setting existed. Gates APPROVE alone: reject
    // and return stay open, or a document nobody can evidence could never leave approval.
    requiresPaymentSlip: z.boolean().default(false),
    // Position-level engagement condition, e.g. {"jobLevels":["MANAGER"]} (mirrors
    // workflow_step.condition_json; empty = applies to every requester).
    conditionJson: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // A step must name SOMEONE. Both approver fields are individually optional — a step picks a
    // role or a person, not both — but a step naming neither resolves to an empty principal list,
    // opens with zero actors, and leaves the document IN_APPROVAL in nobody's queue holding
    // whatever it reserved. `Approver by Role or Person` has always said "either a company role or
    // a specific user"; nothing enforced it.
    //
    // A role with no HOLDERS is a different thing and stays valid: that is a staffing fact, true
    // only today, and answered by adding somebody to the role rather than by editing the workflow.
    if (!val.approverRoleId && !val.approverUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approverRoleId'],
        message: 'A step must name an approver — choose a role or a person',
      });
    }
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

// Warehouse — a stock location owned by one company. `code` is unique per company, so two
// companies may each run a warehouse called MAIN; the server enforces that and returns a
// conflict the form surfaces on the `code` field.
export const warehouseSchema = z.object({
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
});
export type WarehouseInput = z.infer<typeof warehouseSchema>;

// ---------------------------------------------------------------------------
// Attendance self-service — what an employee sends about their own attendance.
//
// Shared rather than written twice, because CLAUDE.md's rule is that client and server validation
// must not drift, and a second copy of these rules in the Vue forms would be the drift.
// ---------------------------------------------------------------------------

/**
 * A coordinate as a decimal STRING, matching `decimal(9,6)` in the schema. A string for the same
 * reason money is a string: `13.756331` is fine as a JS number today and is a rounding argument
 * waiting to happen.
 */
const COORDINATE_STRING = /^-?\d{1,3}(\.\d{1,6})?$/;
const isLatitude = (v: string) =>
  COORDINATE_STRING.test(v) && Number(v) >= -90 && Number(v) <= 90;
const isLongitude = (v: string) =>
  COORDINATE_STRING.test(v) && Number(v) >= -180 && Number(v) <= 180;

export const PUNCH_SOURCES = ['WEB', 'MOBILE'] as const;

/**
 * Punching as yourself. Carries no employee id and no timestamp on purpose: the server resolves
 * the employee from the caller's account and stamps its own instant, so a self punch cannot be
 * made about somebody else or backdated.
 *
 * Coordinates are both-or-neither. One without the other is not a location, and letting a
 * half-supplied pair through would store a latitude the geofence check could not use.
 */
export const punchSelfSchema = z
  .object({
    source: z.enum(PUNCH_SOURCES).optional(),
    latitude: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().refine(isLatitude, 'A latitude between -90 and 90, to six decimal places').optional(),
    ),
    longitude: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().refine(isLongitude, 'A longitude between -180 and 180, to six decimal places').optional(),
    ),
    deviceId: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(255).optional()),
    remark: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(500).optional()),
  })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: 'Supply both a latitude and a longitude, or neither',
    path: ['longitude'],
  });
export type PunchSelfInput = z.infer<typeof punchSelfSchema>;

export const LEAVE_HALVES = ['FULL', 'AM', 'PM'] as const;

/**
 * A leave request's detail, attached to a draft document. `totalDays` is deliberately absent — the
 * days a range charges are counted from the shift and the holiday calendar, never stated by the
 * requester, which is why the document type carries `derives_quantity`.
 */
const leaveRequestFields = {
  quotaId: z.string().uuid(),
  fromDate: z.string().min(10, 'A start date'),
  fromHalf: z.enum(LEAVE_HALVES).default('FULL'),
  toDate: z.string().min(10, 'An end date'),
  toHalf: z.enum(LEAVE_HALVES).default('FULL'),
};

const notReversed = (v: { fromDate: string; toDate: string }) => v.toDate >= v.fromDate;
const reversedMessage = {
  message: 'The end date must not precede the start date',
  path: ['toDate'],
};

/**
 * What the FORM validates: the detail, without the document it will hang on. Split from the full
 * schema rather than derived with `.omit()`, because `.refine()` returns a wrapper that has no
 * `.omit()` — and a form is the one place that genuinely does not know the document id yet.
 */
export const leaveRequestDetailSchema = z.object(leaveRequestFields).refine(notReversed, reversedMessage);
/**
 * `z.input`, not `z.infer`. The halves carry `.default('FULL')`, so the inferred OUTPUT type has
 * them required — which is true after parsing and false of what a caller sends. A type named
 * `…Input` should describe the payload, and the service keeps its own fallback for the same reason.
 */
export type LeaveRequestDetailInput = z.input<typeof leaveRequestDetailSchema>;

/** What the SERVER validates: the same rules plus the document the detail belongs to. */
export const leaveRequestCreateSchema = z
  .object({ documentId: z.string().uuid(), ...leaveRequestFields })
  .refine(notReversed, reversedMessage);
export type LeaveRequestCreateInput = z.input<typeof leaveRequestCreateSchema>;

export const CORRECTION_KINDS = ['ADD', 'CHANGE', 'REMOVE'] as const;
export const ATTENDANCE_DIRECTIONS = ['IN', 'OUT'] as const;

/**
 * A time correction's detail. Which columns are required is decided by the kind, so the rules are
 * refinements rather than field rules: a CHANGE with no target is not a strict request the system
 * could act on cautiously — it is a request with no meaning.
 */
const timeCorrectionFields = {
    // No employee id, by design. Whose attendance this corrects is resolved from the document —
    // its related employee, or the person who raised it — exactly as leave resolves whose days it
    // charges. A field naming the subject is a field a bug could turn into a route into somebody
    // else's ledger, which is the same reasoning `punchSelfSchema` carries no employee id either.
    shiftDate: z.string().min(10, 'The shift day being corrected'),
    kind: z.enum(CORRECTION_KINDS),
    targetEventId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
    requestedAt: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    requestedDirection: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(ATTENDANCE_DIRECTIONS).optional(),
    ),
    reason: z.string().min(3, 'A reason').max(1000),
};

/** The shape rules, applied identically to the form's detail and the server's full payload. */
type CorrectionShape = {
  kind: (typeof CORRECTION_KINDS)[number];
  targetEventId?: string;
  requestedAt?: string;
  requestedDirection?: (typeof ATTENDANCE_DIRECTIONS)[number];
};
const withCorrectionShapeRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((v: CorrectionShape) => v.kind === 'ADD' || !!v.targetEventId, {
      message: 'Choose the punch this corrects',
      path: ['targetEventId'],
    })
    .refine((v: CorrectionShape) => v.kind !== 'ADD' || !v.targetEventId, {
      message: 'An added punch supersedes nothing, so it names no target',
      path: ['targetEventId'],
    })
    .refine((v: CorrectionShape) => v.kind === 'REMOVE' || !!v.requestedAt, {
      message: 'Supply the corrected time',
      path: ['requestedAt'],
    })
    .refine((v: CorrectionShape) => v.kind === 'REMOVE' || !!v.requestedDirection, {
      message: 'Supply whether this is an entry or an exit',
      path: ['requestedDirection'],
    })
    .refine((v: CorrectionShape) => v.kind !== 'REMOVE' || (!v.requestedAt && !v.requestedDirection), {
      message: 'A removal voids a punch, so it supplies no time of its own',
      path: ['requestedAt'],
    });

/** What the FORM validates: the detail, without the document it will hang on. */
export const timeCorrectionDetailSchema = withCorrectionShapeRules(z.object(timeCorrectionFields));
export type TimeCorrectionDetailInput = z.infer<typeof timeCorrectionDetailSchema>;

/** What the SERVER validates: the same rules plus the document the detail belongs to. */
export const timeCorrectionCreateSchema = withCorrectionShapeRules(
  z.object({ documentId: z.string().uuid(), ...timeCorrectionFields }),
);
export type TimeCorrectionCreateInput = z.infer<typeof timeCorrectionCreateSchema>;
