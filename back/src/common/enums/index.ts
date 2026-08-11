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

// Outcome of one GL posting source. A work record, not a ledger — rows move status in place.
//
// POSTED and SKIPPED are TERMINAL: the undelivered-postings read asks only "no journal_entry and
// no terminal row", so it never has to re-derive which sources legitimately post nothing. Those
// rules live once, in the posting service, and the row remembers the answer.
//
// SKIPPED means the posting correctly produced no entry — a settlement with no budget_txn ACTUAL,
// an accruing document that cut no budget, a RESERVE/RELEASE stock row, an intra-company transfer.
// It is not a failure, and conflating the two is what made those cases read as problems in the log.
//
// FAILED is terminal for RETRYING, not for OWING: the sweep stops, but the row stays on the
// undelivered read, because a posting nobody will retry automatically is the one most in need of
// being seen. Only an explicit GL_POST_RETRY re-queue moves it back to PENDING.
export enum GlPostingStatus {
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  SKIPPED = 'SKIPPED',
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

/**
 * Stock movement types. The same shape as BudgetTxnType, for the same reason: a scarce,
 * company-scoped, concurrently-contended quantity tracked by an append-only ledger.
 *
 * RESERVE/RELEASE move only what is AVAILABLE; ISSUE is the conversion that moves what is
 * ON HAND and discharges the matching reservation — exactly as budget ACTUAL converts a RESERVE
 * rather than charging a second time.
 */
export enum StockTxnType {
  RESERVE = 'RESERVE', // จองของตอนส่งอนุมัติ
  RELEASE = 'RELEASE', // คืนของที่จองไว้ (ตีกลับ/ยกเลิก)
  ISSUE = 'ISSUE', // เบิกออกจริง
  RECEIVE = 'RECEIVE', // รับของเข้าคลัง
  ADJUST_INCREASE = 'ADJUST_INCREASE', // ปรับเพิ่ม (ยอดยกมา/ของคืน)
  ADJUST_DECREASE = 'ADJUST_DECREASE', // ปรับลด (ของเสีย/สูญหาย)
  TRANSFER_OUT = 'TRANSFER_OUT', // โอนออกจากคลังต้นทาง
  TRANSFER_IN = 'TRANSFER_IN', // โอนเข้าคลังปลายทาง
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

/**
 * Whether an attendance period is still moving.
 *
 * `CLOSED` is the only state that means anything to the rest of the module: a shift date inside a
 * closed period is not recomputed, which is what makes a figure someone was paid against stay put.
 */
export enum AttendancePeriodStatus {
  DRAFT = 'DRAFT',
  CLOSED = 'CLOSED',
}

/** What an entry in the append-only period log records. A REOPEN always carries a reason. */
export enum PeriodAction {
  CLOSE = 'CLOSE',
  REOPEN = 'REOPEN',
}

/**
 * What a time correction asks for. A removal is expressed as a supersession rather than a delete,
 * because the ledger cannot delete — so `REMOVE` produces a corrective row naming its target, and
 * both are then skipped when a day is computed.
 */
export enum CorrectionKind {
  ADD = 'ADD', // supply a punch that was never recorded — no target
  CHANGE = 'CHANGE', // replace a punch's time — names its target
  REMOVE = 'REMOVE', // void a punch that should not exist — names its target, supplies no time
}

export enum AttendanceDirection {
  IN = 'IN',
  OUT = 'OUT',
}

/**
 * Where a punch came from. DEVICE and IMPORT are declared before anything produces them, so the
 * column's domain does not have to widen when the biometric/file path lands.
 */
export enum AttendanceSource {
  WEB = 'WEB', // กดผ่านเว็บ
  MOBILE = 'MOBILE', // กดผ่านมือถือ (มีพิกัด)
  DEVICE = 'DEVICE', // เครื่องสแกนยิงเข้ามา — ยังไม่มีตัวผลิต
  IMPORT = 'IMPORT', // นำเข้าจากไฟล์ — ยังไม่มีตัวผลิต
  MANUAL = 'MANUAL', // คนกรอกแทน — ต้องมี recorded_by เสมอ
}

/**
 * The outcome of measuring a punch against the company's geofences. UNKNOWN is a first-class
 * result, not a failure: a phone indoors may never get a fix, and a company that has configured
 * no locations has expressed no opinion about where work happens. Refusing either would punish
 * someone for their building.
 */
export enum GeofenceStatus {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Which half of a day a leave request covers at each end of its range.
 *
 * Two-valued on purpose. A quarter day or hourly leave has no representation here, because hourly
 * leave is a different product with a different quota unit and guessing at it would shape the
 * table around a requirement nobody has stated.
 */
export enum LeaveHalf {
  FULL = 'FULL',
  AM = 'AM', // morning taken — the afternoon is still expected
  PM = 'PM', // afternoon taken — the morning is still expected
}

/**
 * What a day WAS, not what happened in it. Lateness, early departure and overtime are quantities
 * on the row rather than statuses: a `PRESENT` day with `lateMinutes` 12 says strictly more than a
 * `LATE` status would, and the enum stops multiplying every time a dimension is added
 * (LATE / LATE_AND_EARLY / HOLIDAY_WORKED / ...).
 *
 * Resolution order is fixed: NO_SHIFT, HOLIDAY, DAY_OFF, EXEMPT, LEAVE, ABSENT, INCOMPLETE,
 * PRESENT. `LEAVE` sits above ABSENT because approved leave is the REASON there are no punches,
 * and below HOLIDAY/DAY_OFF because leave taken on a day nobody works is not leave at all.
 */
export enum AttendanceDayStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  INCOMPLETE = 'INCOMPLETE', // punched in, never out
  LEAVE = 'LEAVE', // a full day covered by approved leave
  HOLIDAY = 'HOLIDAY',
  DAY_OFF = 'DAY_OFF',
  EXEMPT = 'EXEMPT', // attendance_required = false
  NO_SHIFT = 'NO_SHIFT', // a valid state, not an error
}

/**
 * An employee's pay basis. Recorded at the source rather than inferred at export time because
 * work on a company holiday is compensated at a different multiple for monthly-paid than for
 * daily-paid staff — a distinction that cannot be reconstructed from attendance data alone.
 */
export enum EmploymentType {
  MONTHLY = 'MONTHLY', // ลูกจ้างรายเดือน
  DAILY = 'DAILY', // ลูกจ้างรายวัน
  HOURLY = 'HOURLY', // ลูกจ้างรายชั่วโมง
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
  INVENTORY = 'INVENTORY', // inventory asset — debited on receipt, credited on issue
  // Goods received not invoiced: the liability that stands between capitalizing goods at receipt
  // and paying for them. Without it, receipt has no counter-account and the entry cannot balance.
  GRNI = 'GRNI',
  INVENTORY_ADJUSTMENT = 'INVENTORY_ADJUSTMENT', // gain/loss absorbed by a stock adjustment
  INVENTORY_IN_TRANSIT = 'INVENTORY_IN_TRANSIT', // reserved for multi-step transfers; unused here
  // The liability standing between an approved compensation and the money leaving. Same shape as
  // GRNI, for an obligation that arises at approval rather than at receipt: without it, an accrual
  // posted when a claim is approved has no credit side and cannot balance.
  CLAIM_PAYABLE = 'CLAIM_PAYABLE',
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
