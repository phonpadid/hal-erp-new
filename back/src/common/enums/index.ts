// String enums mirroring the DBML enum definitions in erp_approval_system.dbml.
// Values are persisted verbatim, so the string literals must match the DBML.

export enum DocStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  IN_APPROVAL = 'IN_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

// Outbox row states for CREATE_SUCCESSOR. A work queue, not a ledger: rows move PENDING → DONE
// or PENDING → FAILED in place. FAILED means the system promised a successor and could not
// deliver it — a deactivated successor type never gets here, because no obligation is recorded
// for one in the first place (that is compliance with an admin's decision, not a fault).
export enum PendingSuccessorStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export enum BudgetTxnType {
  RESERVE = 'RESERVE', // จองงบตอนส่งอนุมัติ
  ACTUAL = 'ACTUAL', // ตัดงบจริง
  RELEASE = 'RELEASE', // คืนงบ (ตีกลับ/ยกเลิก/ส่วนต่าง)
  TRANSFER_IN = 'TRANSFER_IN', // รับโอนงบเข้าจากงบก้อนอื่น
  TRANSFER_OUT = 'TRANSFER_OUT', // โอนงบออกไปงบก้อนอื่น
  ADJUST_INCREASE = 'ADJUST_INCREASE', // ปรับเพิ่มงบ
  ADJUST_DECREASE = 'ADJUST_DECREASE', // ปรับลดงบ
}

// Canonical document-category codes seeded for every company. Categories are now company-scoped
// config (the `document_category` table), so this is NOT a validation constraint — it only
// provides the default seed set (and stable literals for fixtures). A company may add/rename its
// own categories at runtime; write-time validation checks the `document_category` table, not this.
export enum DocCategory {
  PROCUREMENT = 'PROCUREMENT',
  FINANCE = 'FINANCE',
  HR = 'HR',
  ADMIN = 'ADMIN',
  IT = 'IT',
}

export enum ApproveAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  RETURN = 'RETURN', // ตีกลับให้แก้ไข
  DELEGATE = 'DELEGATE', // โอนให้คนอื่นอนุมัติแทน
  ESCALATE = 'ESCALATE', // ส่งต่ออัตโนมัติเมื่อเกิน SLA
}

export enum ControlPolicy {
  HARD_STOP = 'HARD_STOP', // งบไม่พอ = บล็อก
  SOFT_WARNING = 'SOFT_WARNING', // งบไม่พอ = เตือนแต่ผ่านได้
}

// Chart-of-accounts account classification; drives the future GL's normal balance.
export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

// System-account roles the GL posting engine resolves per company (config over code).
export enum AccountRoleType {
  CASH_CLEARING = 'CASH_CLEARING',
  FX_GAIN = 'FX_GAIN',
  FX_LOSS = 'FX_LOSS',
  VAT_INPUT = 'VAT_INPUT',
  WHT_PAYABLE = 'WHT_PAYABLE', // reserved for the WHT follow-up slice
}

// Purchase tax classification. VAT is used this slice; WHT is reserved for a follow-up.
export enum TaxKind {
  VAT = 'VAT',
  WHT = 'WHT',
}

// Data-visibility scope carried on role_permission.scope (invariant: company isolation).
export enum Scope {
  OWN = 'OWN',
  DEPARTMENT = 'DEPARTMENT',
  COMPANY = 'COMPANY',
  GROUP = 'GROUP',
}
