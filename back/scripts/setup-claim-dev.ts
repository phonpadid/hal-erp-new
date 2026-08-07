import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { RequestContext } from '../src/common/context/request-context';
import { ControlPolicy, DocCategory, Scope } from '../src/common/enums';
import { AccountRoleType } from '../src/common/enums';
import { Account } from '../src/modules/accounting/accounting.entities';
import { Workflow, WorkflowStep } from '../src/modules/approval/approval.entities';
import { Budget } from '../src/modules/budget/budget.entities';
import { AccountRole } from '../src/modules/gl/gl.entities';
import {
  DeptDocType, DocumentCategory, DocumentType, FormField, FormTemplate,
} from '../src/modules/document/document.entities';
import { Company, Department, FiscalYear } from '../src/modules/multi-company/multi-company.entities';
import { ApiKey } from '../src/modules/external-api/external-api.entities';
import { ApiKeyService } from '../src/modules/external-api/api-key.service';
import { PermissionResolverService } from '../src/modules/rbac/permission-resolver.service';
import {
  AppUser, Permission, Role, RolePermission, UserCompanyRole,
} from '../src/modules/rbac/rbac.entities';

/**
 * Configure the CLAIM document type on the dev database so the claim system can call it locally.
 *
 * Everything here is CONFIGURATION, not schema — the same rows an administrator would create
 * through the admin screens. It is written as a script only because doing it by hand across nine
 * tables invites a typo, and because the API key's secret has to be generated and hashed by the
 * application rather than typed into SQL.
 *
 * Idempotent: every row is looked up before it is created, so re-running changes nothing. It never
 * deletes, and it never touches a row it did not create.
 *
 * PLACEHOLDER NUMBERS. The approval thresholds and the budget amount are guesses standing in for
 * figures the business has not produced yet. They are marked below and are meant to be changed in
 * the admin UI, not here.
 */

// --- placeholders, change in the admin UI once the business decides -------------------------
const BUDGET_AMOUNT = '100000000'; // LAK, one fiscal year of damage compensation
const TIER_1_MAX = '1000000'; // ≤ this: team lead alone
const TIER_2_MAX = '10000000'; // ≤ this: + manager. Above: + president
// -------------------------------------------------------------------------------------------

const EXPENSE_CODE = '5300';
const PAYABLE_CODE = '2200';

async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();
  const OFF = { filters: { company: false } } as const;
  const made: string[] = [];
  const found = <T>(what: string, row: T | null): T | null => {
    if (row) made.push(`= ${what} (already there)`);
    return row;
  };

  try {
    const company = await em.findOneOrFail(Company, { code: 'HAL' }, OFF);
    const fiscalYear = await em.findOneOrFail(FiscalYear, { company, year: 2026 }, OFF);

    // 1. The window the claims arrive through. Its department decides the form, the workflow and
    //    the budget, which is why the claim system needs no notion of our departments at all.
    let dept = found('department CLAIM', await em.findOne(Department, { company, deptCode: 'CLAIM' }, OFF));
    if (!dept) {
      dept = em.create(Department, { company, deptCode: 'CLAIM', name: 'ศูนย์รับเคลม', isActive: true } as never);
      made.push('+ department CLAIM');
    }

    // 2. Accounts. The expense the budget charges, and the liability that stands between an
    //    approved claim and the money leaving.
    let expense = found(`account ${EXPENSE_CODE}`, await em.findOne(Account, { company, code: EXPENSE_CODE }, OFF));
    if (!expense) {
      expense = em.create(Account, {
        company, code: EXPENSE_CODE, name: 'ค่าชดเชยความเสียหาย', accountType: 'EXPENSE',
        isPostable: true, isActive: true,
      } as never);
      made.push(`+ account ${EXPENSE_CODE} ค่าชดเชยความเสียหาย`);
    }
    let payable = found(`account ${PAYABLE_CODE}`, await em.findOne(Account, { company, code: PAYABLE_CODE }, OFF));
    if (!payable) {
      payable = em.create(Account, {
        company, code: PAYABLE_CODE, name: 'เจ้าหนี้ค่าชดเชย', accountType: 'LIABILITY',
        isPostable: true, isActive: true,
      } as never);
      made.push(`+ account ${PAYABLE_CODE} เจ้าหนี้ค่าชดเชย`);
    }
    await em.flush();

    // CLAIM_PAYABLE is what the accrual credits at approval and the settlement debits when the
    // money leaves. Without it the accrual fails after the approval has committed — logged, not
    // visible on screen — so it is configured here rather than discovered later.
    if (!(await em.findOne(AccountRole, { company, role: AccountRoleType.CLAIM_PAYABLE }, OFF))) {
      em.create(AccountRole, { company, role: AccountRoleType.CLAIM_PAYABLE, account: payable } as never);
      made.push('+ account_role CLAIM_PAYABLE → 2200');
    } else made.push('= account_role CLAIM_PAYABLE');

    // 3. The bot, its role and its grants. Four codes: create, submit, view, cancel — cancel
    //    because a customer withdrawing a claim after submit is normal and the claim system is the
    //    document's creator, which is who may cancel it.
    let botRole = found('role CLAIM_BOT', await em.findOne(Role, { company, code: 'CLAIM_BOT' }, OFF));
    if (!botRole) {
      botRole = em.create(Role, {
        company, code: 'CLAIM_BOT', name: 'ระบบเคลม (API)', isActive: true,
      } as never);
      await em.flush();
      for (const code of ['DOC_CREATE', 'DOC_SUBMIT', 'DOC_VIEW', 'DOC_CANCEL']) {
        const permission = await em.findOneOrFail(Permission, { code }, OFF);
        em.create(RolePermission, { role: botRole, permission, scope: Scope.DEPARTMENT } as never);
      }
      made.push('+ role CLAIM_BOT + 4 grants (DEPARTMENT scope)');
    }

    // Deliberately NOT routed through RoleAdminService.createServiceAccount: that method creates
    // the account and its membership atomically, whereas this script guards the two separately so
    // a re-run can repair a bot whose membership is missing. Swapping it in would trade that
    // finer-grained idempotency for a Conflict. The shape it produces is identical — a marked,
    // passwordless, pre-verified account — and `isServiceAccount` is what keeps the two in step.
    let bot = found('user claim-bot', await em.findOne(AppUser, { username: 'claim-bot' }, OFF));
    if (!bot) {
      bot = em.create(AppUser, {
        username: 'claim-bot', email: 'claim-bot@hal.local', status: 'ACTIVE',
        isServiceAccount: true,
        emailVerifiedAt: new Date(), createdAt: new Date(),
      } as never);
      made.push('+ user claim-bot (no password — it authenticates by API key only)');
    }
    await em.flush();
    if (!(await em.findOne(UserCompanyRole, { user: bot, company, role: botRole }, OFF))) {
      em.create(UserCompanyRole, {
        user: bot, company, department: dept, role: botRole, isDefault: true,
      } as never);
      made.push('+ membership claim-bot → ศูนย์รับเคลม / CLAIM_BOT');
    }
    await em.flush();

    // 4. The document type. Its flags are the whole behaviour: charge a budget, recognise the
    //    expense at approval, and want no payee because the claim system carries the account
    //    details as field values rather than as vendor master data.
    let docType = found('document_type CLAIM', await em.findOne(DocumentType, { company, code: 'CLAIM' }, OFF));
    if (!docType) {
      if (!(await em.findOne(DocumentCategory, { company, code: DocCategory.FINANCE }, OFF))) {
        throw new Error('document_category FINANCE is missing on HAL');
      }
      docType = em.create(DocumentType, {
        company, code: 'CLAIM', name: 'เคลมพัสดุเสียหาย', category: DocCategory.FINANCE,
        requiresBudget: true, requiresQuota: false, requiresVendor: false, requiresItem: false,
        requiresPayee: false, requiresWarehouse: false,
        accruesOnApproval: true, defaultGlAccount: EXPENSE_CODE, postAction: 'CUT_BUDGET',
        isActive: true,
      } as never);
      made.push('+ document_type CLAIM (requires_budget, accrues_on_approval, CUT_BUDGET)');
    }
    await em.flush();

    // 5. The form. Everything the claim system knows and we do not: the parcel, the assessment,
    //    who to pay and how. `claimRef` is theirs and doubles as the human trail back to their case.
    //
    //    `claimKind` answers a question that was open for a while: is a lost parcel the same kind
    //    of expense as a damaged one? It is, for now — one document type, one expense account —
    //    because nobody has said accounting needs them apart. Recording WHICH it was is what makes
    //    that reversible: the claims are separable in reporting today, and if accounting later
    //    wants two accounts, this becomes a second document type carrying the other one, with the
    //    history already labelled. Guessing that they must be split would have been the expensive
    //    mistake; leaving no way to tell them apart would have been the other one.
    const FIELDS: Array<[string, string, string, boolean]> = [
      ['claimRef', 'เลขอ้างอิงเคลม (ระบบ B)', 'text', true],
      ['trackingNo', 'เลขพัสดุ', 'text', true],
      ['claimKind', 'พัสดุหายหรือเสียหาย', 'dropdown', true],
      ['isCod', 'เป็น COD หรือไม่', 'dropdown', true],
      ['cause', 'สาเหตุความเสียหาย', 'text', true],
      ['orgUnit', 'รหัสศูนย์/สาขา', 'text', false],
      ['payeeName', 'ชื่อผู้รับเงิน', 'text', true],
      ['payeeBank', 'ธนาคาร', 'text', true],
      ['payeeAccountNo', 'เลขบัญชี', 'text', true],
      ['settlementKind', 'ประเภทการชดเชย', 'dropdown', false],
    ];
    // `settlementKind` offers CASH alone. GOODS — replacing the parcel instead of paying for it —
    // is wanted eventually, and offering it before it works was worse than not offering it: a
    // claim marked GOODS approved, raised a payable, and then could not be settled, because
    // settlement can only post a cash clearing. The payable had no way to clear and the document
    // no way to finish. A choice the system cannot honour is not a choice.
    //
    // Adding GOODS back is three things, in this order: an account role for whatever the credit
    // side becomes, a branch in the settlement posting, and then this line.
    const OPTIONS: Record<string, string[]> = {
      claimKind: ['LOST', 'DAMAGED'],
      isCod: ['COD', 'NON_COD'],
      settlementKind: ['CASH'],
    };

    // A published template is frozen — the only way to change the form is to publish the next
    // version, which is exactly what the integration guide promises callers ("a field id never
    // changes without the version changing"). So: find the newest template; if it already carries
    // every field named above, leave it alone. If it does not, build the next version from the
    // full list and repoint the department mapping at it. Documents already created keep the
    // template they were created against — they carry their own FK — so nothing in flight moves.
    //
    // "Already carries" means the names AND the offered values: a field whose options changed is
    // as much a different form as a field that was not there at all. Now that a value is checked
    // against its options on write, a stale option list is not cosmetic — it decides what callers
    // are allowed to send.
    const templates = await em.find(FormTemplate, { documentType: docType }, { ...OFF, orderBy: { version: 'DESC' } });
    let template = templates[0] ?? null;
    const existing = template ? await em.find(FormField, { formTemplate: template }, OFF) : [];
    const existingOptions = new Map(existing.map((f) => [f.fieldName, f.optionsJson ?? null]));
    const stale = FIELDS.map(([name]) => name).filter((name) => {
      if (!existingOptions.has(name)) return true;
      const want = OPTIONS[name] ? JSON.stringify(OPTIONS[name]) : null;
      return existingOptions.get(name) !== want;
    });
    if (template && stale.length === 0) {
      found(`form_template v${template.version}`, template);
    } else {
      const version = template ? template.version + 1 : 1;
      const previous = template;
      template = em.create(FormTemplate, { documentType: docType, version, status: 'DRAFT', createdAt: new Date() } as never);
      await em.flush();
      FIELDS.forEach(([fieldName, fieldLabel, fieldType, isRequired], i) => {
        em.create(FormField, {
          formTemplate: template, fieldName, fieldLabel, fieldType, isRequired, sortOrder: i + 1,
          optionsJson: OPTIONS[fieldName] ? JSON.stringify(OPTIONS[fieldName]) : undefined,
        } as never);
      });
      template.status = 'PUBLISHED';
      made.push(
        previous
          ? `+ form_template v${version} PUBLISHED (v${previous.version} differed on: ${stale.join(', ')})`
          : `+ form_template v1 PUBLISHED + ${FIELDS.length} fields`,
      );
    }
    await em.flush();

    // 6. The chain. Bands rather than one step, because a 200,000 kip claim and a 20,000,000 kip
    //    claim should not cost the same number of signatures. THE NUMBERS ARE PLACEHOLDERS.
    //    Band 1 starts at zero deliberately: a claim below the lowest band would submit, reserve
    //    the budget, and then find no applicable step — the router logs it and leaves the document
    //    SUBMITTED forever, with the budget held and nobody notified.
    let workflow = found('workflow', await em.findOne(Workflow, { company, name: 'สายอนุมัติเคลม' }, OFF));
    if (!workflow) {
      workflow = em.create(Workflow, { company, name: 'สายอนุมัติเคลม', isActive: true } as never);
      await em.flush();
      const approver = await em.findOneOrFail(Role, { company, code: 'DEPT_HEAD' }, OFF);
      const manager = await em.findOneOrFail(Role, { company, code: 'BUDGET_OFFICER' }, OFF);
      const president = await em.findOneOrFail(Role, { company, code: 'PRESIDENT' }, OFF);
      const steps: Array<[number, string, Role, string, string | undefined]> = [
        [1, 'หัวหน้าศูนย์รับเคลม', approver, '0', undefined],
        [2, 'ผู้จัดการงบประมาณ', manager, TIER_1_MAX, undefined],
        [3, 'ประธาน', president, TIER_2_MAX, undefined],
      ];
      for (const [stepNo, stepName, role, amountMin, amountMax] of steps) {
        em.create(WorkflowStep, {
          workflow, stepNo, stepName, approverRole: role, amountMin, amountMax,
          approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
        } as never);
      }
      made.push(`+ workflow 3 steps — band 1 from 0, band 2 from ${TIER_1_MAX}, band 3 from ${TIER_2_MAX}`);
    }
    await em.flush();

    // The mapping is what a new document is created against, so a newly published template only
    // takes effect once this points at it. Repointing an existing mapping is the one place this
    // script updates rather than only inserts — and it is the whole purpose of publishing v2.
    const mapping = await em.findOne(DeptDocType, { department: dept, documentType: docType }, OFF);
    if (!mapping) {
      em.create(DeptDocType, {
        department: dept, documentType: docType, formTemplate: template, workflow, isActive: true,
      } as never);
      made.push(`+ dept_doc_type ศูนย์รับเคลม × CLAIM → form v${template.version} + สายอนุมัติเคลม`);
    } else if (mapping.formTemplate.id !== template.id) {
      mapping.formTemplate = template;
      made.push(`~ dept_doc_type now points at form v${template.version}`);
    } else {
      found('dept_doc_type ศูนย์รับเคลม × CLAIM', mapping);
    }

    // 7. The budget the claims charge. PLACEHOLDER AMOUNT. HARD_STOP so an exhausted budget
    //    refuses the submit rather than quietly overspending — the claim system is told to expect
    //    BUDGET_EXCEEDED and hold the case.
    if (!(await em.findOne(Budget, { fiscalYear, department: dept, glAccount: EXPENSE_CODE }, OFF))) {
      em.create(Budget, {
        fiscalYear, department: dept, glAccount: EXPENSE_CODE, account: expense,
        budgetName: 'งบชดเชยความเสียหาย 2026', amountTotal: BUDGET_AMOUNT,
        controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
      } as never);
      made.push(`+ budget ${BUDGET_AMOUNT} LAK HARD_STOP`);
    }
    await em.flush();

    // 8. The key. Issued through the service so the secret is generated and hashed the way every
    //    other key is; it is printed once here because that is the only time it exists in clear.
    const existingKey = await em.findOne(ApiKey, { company, name: 'claim-system' }, OFF);
    let secret: string | undefined;
    if (!existingKey) {
      const keys = new ApiKeyService(orm.em, new PermissionResolverService(orm.em));
      const issued = await RequestContext.run(
        { userId: bot.id, companyId: company.id, departmentId: dept.id, grants: [] },
        () => keys.issue('claim-system', bot!.id, undefined),
      );
      secret = issued.secret;
      made.push(`+ api_key claim-system (prefix ${issued.prefix})`);
    } else {
      made.push('= api_key claim-system (secret cannot be shown again — revoke and re-issue if lost)');
    }

    // eslint-disable-next-line no-console
    console.log('\n' + made.join('\n'));
    // eslint-disable-next-line no-console
    console.log(`\ncompany      HAL  ${company.id}`);
    // eslint-disable-next-line no-console
    console.log(`department   ศูนย์รับเคลม  ${dept.id}`);
    // eslint-disable-next-line no-console
    console.log(`documentType CLAIM  ${docType.id}`);
    if (secret) {
      // eslint-disable-next-line no-console
      console.log(`\nAPI KEY (shown once):\n  ${secret}\n`);
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('setup-claim-dev FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
