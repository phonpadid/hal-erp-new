import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { DocCategory } from '../src/common/enums';
import { Workflow } from '../src/modules/approval/approval.entities';
import {
  DeptDocType, DocumentCategory, DocumentType, DocumentTypeRef, FormField, FormTemplate,
} from '../src/modules/document/document.entities';
import { Company, Department } from '../src/modules/multi-company/multi-company.entities';

/**
 * The SECOND claim document type, and the recovery it raises.
 *
 * The company pays every claimant. Who was liable decides which document is raised here, not
 * whether we pay:
 *
 *   liable party = the company or a sorting centre  → CLAIM          (already configured)
 *   liable party = a branch or a vehicle line       → CLAIM_ADVANCE  → CLAIM_RECOVERY
 *
 * `CLAIM_ADVANCE` is the claim we pay on somebody else's behalf. Its `post_action` is
 * `CREATE_SUCCESSOR`, so approving it records an obligation and the sweeper raises a
 * `CLAIM_RECOVERY` DRAFT naming the party — the note that says we fronted this and from whom it is
 * to be collected. The recovery is then worked by people, in this system. The claim system is never
 * told what became of it.
 *
 * Configuration only, like `setup-claim-dev.ts` beside it, and idempotent in the same way: every
 * row is looked up before it is created, nothing is deleted, and re-running changes nothing.
 * Run `setup-claim-dev.ts` FIRST — this needs the department, the workflow and the budget it made.
 *
 * The advance carries `CUT_BUDGET`, exactly like the ordinary claim: it settles the reservation its
 * submit made, and settling is what puts a document in the ready-to-pay queue. It still owes its
 * recovery — that is the `document_type_ref` pairing below, and `PostActionService` records the
 * obligation from the pairing rather than from `post_action`, so a type can both settle its money
 * and owe a successor. (It could not before: `post_action` holds one value, and an advance carrying
 * `CREATE_SUCCESSOR` wrote no ACTUAL, so its accrual was skipped, nothing was owed to anybody, and
 * the claimant could not be paid at all. Option A of the open question in
 * `recover-what-we-paid-on-behalf`, verified end to end.)
 */

/** Only a fallback: the expense account is read from the CLAIM type this database already has. */
const EXPENSE_CODE = '5300';

async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();
  const OFF = { filters: { company: false } } as const;
  const made: string[] = [];

  try {
    const company = await em.findOneOrFail(Company, { code: 'HAL' }, OFF);
    if (!(await em.findOne(DocumentCategory, { company, code: DocCategory.FINANCE }, OFF))) {
      throw new Error('document_category FINANCE is missing on HAL — run setup-claim-dev.ts first');
    }

    /**
     * Everything is resolved FROM the existing CLAIM type, not from names typed here.
     *
     * The department, the approval chain and the expense account are whatever that type already
     * uses on this database — which is not the same everywhere: the sibling script names its own
     * department, and a database seeded another way (this one is 'E2E Sandbox') carries different
     * ones. Two claim types that answer to different departments or different approvers would be
     * two policies, and which one a claimant got would depend on who was liable.
     */
    const claimType = await em.findOne(DocumentType, { company, code: 'CLAIM' }, OFF);
    if (!claimType) {
      throw new Error('document_type CLAIM is missing on HAL — run setup-claim-dev.ts first');
    }
    const claimMapping = await em.findOne(
      DeptDocType, { documentType: claimType }, { ...OFF, populate: ['department', 'workflow'] },
    );
    if (!claimMapping?.workflow) {
      throw new Error('CLAIM has no dept_doc_type with a workflow — run setup-claim-dev.ts first');
    }
    const dept: Department = claimMapping.department;
    const workflow: Workflow = claimMapping.workflow;
    const expenseAccount = claimType.defaultGlAccount ?? EXPENSE_CODE;
    made.push(`= following CLAIM: department ${dept.name}, workflow ${workflow.name}, GL ${expenseAccount}`);

    /**
     * The two types.
     *
     * The advance keeps the claim's own flags — it charges the same budget and recognises the same
     * expense, because it IS a claim; the only difference is that somebody else was liable for it.
     *
     * The recovery charges nothing. It is a note that money is owed TO us, so it reserves no
     * budget and accrues no payable: booking it as an expense would count the same loss twice.
     */
    const wanted: Array<[string, string, Partial<DocumentType>]> = [
      ['CLAIM_ADVANCE', 'จ่ายแทนผู้รับผิดชอบ (เคลม)', {
        requiresBudget: true, accruesOnApproval: claimType.accruesOnApproval,
        defaultGlAccount: expenseAccount, postAction: 'CUT_BUDGET',
      } as Partial<DocumentType>],
      ['CLAIM_RECOVERY', 'ทวงคืนจากผู้รับผิดชอบ (เคลม)', {
        requiresBudget: false, accruesOnApproval: false,
      } as Partial<DocumentType>],
    ];

    const types = new Map<string, DocumentType>();
    for (const [code, name, flags] of wanted) {
      let type = await em.findOne(DocumentType, { company, code }, OFF);
      if (type) {
        // The ONE field this script corrects on an existing row. It decides whether the document can
        // be paid at all, and a database configured before that was understood carries the wrong
        // one — leaving it would mean a claim nobody can settle, which is worse than a surprise.
        if ((flags.postAction ?? null) !== (type.postAction ?? null)) {
          made.push(`~ document_type ${code} post_action ${type.postAction ?? 'none'} → ${flags.postAction ?? 'none'}`);
          type.postAction = flags.postAction;
        } else {
          made.push(`= document_type ${code} (already there)`);
        }
      } else {
        type = em.create(DocumentType, {
          company, code, name, category: DocCategory.FINANCE,
          requiresQuota: false, requiresVendor: false, requiresItem: false,
          requiresPayee: false, requiresWarehouse: false, isActive: true,
          ...flags,
        } as never);
        made.push(`+ document_type ${code}${flags.postAction ? ` (${flags.postAction})` : ''}`);
      }
      types.set(code, type);
    }
    await em.flush();

    /**
     * The forms.
     *
     * The advance asks everything the ordinary claim asks PLUS who carries the cost — those extra
     * fields are the whole reason it is a separate type. The recovery asks the same party questions
     * and nothing about the payee: it is not a payment.
     *
     * The field NAMES are shared on purpose. A successor inherits its predecessor's answers by
     * field name, so naming them the same is what makes the recovery arrive already saying which
     * branch it is against — with no one to type it in.
     *
     * `liableUnitCode`/`liableUnitName` and `liableRoute`/`liableTripNo` are all optional: a branch
     * has no route and a vehicle line has no unit, and a form cannot say "one pair or the other".
     * The claim system sends only the pair its party has, and refuses to submit an incomplete one
     * on its own side.
     */
    const PARTY_FIELDS: Array<[string, string, string, boolean]> = [
      ['liablePartyKind', 'ผู้รับผิดชอบ', 'dropdown', true],
      ['liableUnitCode', 'รหัสสาขา/หน่วยงาน', 'text', false],
      ['liableUnitName', 'ชื่อสาขา/หน่วยงาน', 'text', false],
      ['liableRoute', 'สายรถ', 'text', false],
      ['liableTripNo', 'เลขเที่ยว', 'text', false],
    ];
    const CLAIM_FIELDS: Array<[string, string, string, boolean]> = [
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
    // `liablePartyKind` offers only the two parties this type exists for. The company and its own
    // sorting centres are not recoverable and never reach the advance type at all — offering them
    // here would let a claim be raised as an advance against ourselves.
    const OPTIONS: Record<string, string[]> = {
      claimKind: ['LOST', 'DAMAGED'],
      isCod: ['COD', 'NON_COD'],
      settlementKind: ['CASH'],
      liablePartyKind: ['BRANCH', 'VEHICLE_LINE'],
    };

    const forms: Array<[string, Array<[string, string, string, boolean]>]> = [
      ['CLAIM_ADVANCE', [...CLAIM_FIELDS, ...PARTY_FIELDS]],
      ['CLAIM_RECOVERY', [
        ['claimRef', 'เลขอ้างอิงเคลม (ระบบ B)', 'text', false],
        ['trackingNo', 'เลขพัสดุ', 'text', false],
        ...PARTY_FIELDS,
      ]],
    ];

    const templates = new Map<string, FormTemplate>();
    for (const [code, fields] of forms) {
      const docType = types.get(code)!;
      // Same rule as the sibling script: a published template is frozen, so a form that differs by
      // one field or one option list becomes the next VERSION rather than an edit.
      const existingTemplates = await em.find(
        FormTemplate, { documentType: docType }, { ...OFF, orderBy: { version: 'DESC' } },
      );
      let template = existingTemplates[0] ?? null;
      const existing = template ? await em.find(FormField, { formTemplate: template }, OFF) : [];
      const existingOptions = new Map(existing.map((f) => [f.fieldName, f.optionsJson ?? null]));
      const stale = fields.map(([name]) => name).filter((name) => {
        if (!existingOptions.has(name)) return true;
        const want = OPTIONS[name] ? JSON.stringify(OPTIONS[name]) : null;
        return existingOptions.get(name) !== want;
      });
      if (template && stale.length === 0) {
        made.push(`= form_template ${code} v${template.version} (already there)`);
      } else {
        const version = template ? template.version + 1 : 1;
        const previous = template;
        template = em.create(FormTemplate, {
          documentType: docType, version, status: 'DRAFT', createdAt: new Date(),
        } as never);
        await em.flush();
        fields.forEach(([fieldName, fieldLabel, fieldType, isRequired], i) => {
          em.create(FormField, {
            formTemplate: template, fieldName, fieldLabel, fieldType, isRequired, sortOrder: i + 1,
            optionsJson: OPTIONS[fieldName] ? JSON.stringify(OPTIONS[fieldName]) : undefined,
          } as never);
        });
        template.status = 'PUBLISHED';
        made.push(previous
          ? `+ form_template ${code} v${version} PUBLISHED (v${previous.version} differed on: ${stale.join(', ')})`
          : `+ form_template ${code} v1 PUBLISHED + ${fields.length} fields`);
      }
      await em.flush();
      templates.set(code, template);
    }

    /**
     * What the department may raise, and against which form.
     *
     * The recovery is mapped too. It is created by the sweeper rather than by a person, but
     * `createFrom` resolves the form and the workflow through this mapping exactly as an
     * interactive create does — without it the obligation is recorded and can never be fulfilled.
     */
    for (const code of ['CLAIM_ADVANCE', 'CLAIM_RECOVERY']) {
      const docType = types.get(code)!;
      const template = templates.get(code)!;
      const mapping = await em.findOne(DeptDocType, { department: dept, documentType: docType }, OFF);
      if (!mapping) {
        em.create(DeptDocType, {
          department: dept, documentType: docType, formTemplate: template, workflow, isActive: true,
        } as never);
        made.push(`+ dept_doc_type ${dept.name} × ${code} → form v${template.version}`);
      } else if (mapping.formTemplate.id !== template.id) {
        mapping.formTemplate = template;
        made.push(`~ dept_doc_type ${code} now points at form v${template.version}`);
      } else {
        made.push(`= dept_doc_type ${code} (already there)`);
      }
    }
    await em.flush();

    /**
     * The pairing. `autoCreate` is the whole point: approving an advance owes a recovery, and the
     * sweeper raises it without anybody asking. `successorDepartment` stays unset — the recovery
     * belongs to the department that fronted the money, which is the one that must collect it.
     */
    const predecessor = types.get('CLAIM_ADVANCE')!;
    const successor = types.get('CLAIM_RECOVERY')!;
    const ref = await em.findOne(
      DocumentTypeRef, { company, predecessorType: predecessor, successorType: successor }, OFF,
    );
    if (!ref) {
      em.create(DocumentTypeRef, {
        company, predecessorType: predecessor, successorType: successor, autoCreate: true,
      } as never);
      made.push('+ document_type_ref CLAIM_ADVANCE → CLAIM_RECOVERY (auto_create)');
    } else if (!ref.autoCreate) {
      ref.autoCreate = true;
      made.push('~ document_type_ref CLAIM_ADVANCE → CLAIM_RECOVERY now auto_create');
    } else {
      made.push('= document_type_ref CLAIM_ADVANCE → CLAIM_RECOVERY (already there)');
    }
    await em.flush();

    // eslint-disable-next-line no-console
    console.log('\n' + made.join('\n'));
    // eslint-disable-next-line no-console
    console.log(`\ndocumentType CLAIM_ADVANCE   ${predecessor.id}`);
    // eslint-disable-next-line no-console
    console.log(`documentType CLAIM_RECOVERY  ${successor.id}`);
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('setup-claim-advance-dev FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
