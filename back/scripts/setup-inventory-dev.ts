import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { AccountRoleType, DocCategory, Scope } from '../src/common/enums';
import { Account } from '../src/modules/accounting/accounting.entities';
import { Workflow, WorkflowStep } from '../src/modules/approval/approval.entities';
import { AccountRole } from '../src/modules/gl/gl.entities';
import {
  DeptDocType, DocumentCategory, DocumentType, FormField, FormTemplate,
} from '../src/modules/document/document.entities';
import { Warehouse } from '../src/modules/inventory/inventory.entities';
import { Item, ItemCompany } from '../src/modules/master-data/master-data.entities';
import { Company, Department } from '../src/modules/multi-company/multi-company.entities';
import { Permission, Role, RolePermission, UserCompanyRole } from '../src/modules/rbac/rbac.entities';

/**
 * Turn the inventory capability ON for one company on a NON-PRODUCTION database.
 *
 * Nothing here is schema: the inventory tables (`warehouse`, `stock_txn`, `stock_balance`) have
 * shipped since Migration20260726000000 and are already present. Every row below is the same
 * CONFIGURATION an administrator would create through the admin screens — account roles,
 * warehouses, stock items, three document types with their forms and routes, and the grants that
 * make the screens visible. It is a script only because doing it by hand across eleven tables
 * invites a typo, and because getting it wrong on the GL side is silent (see WARNINGS below).
 *
 * Idempotent: every row is looked up before it is created. It never deletes, never updates a row
 * it did not create, and writes no `stock_txn` — no stock exists until somebody raises a document.
 *
 * It deliberately does NOT flip `is_stock_tracked` on any of the company's existing items. That
 * flag changes behaviour RETROACTIVELY in two places — `received-not-invoiced.service.ts` skips a
 * stock-tracked line from the period accrual, and `gl-posting.service.ts` splits GRNI by it — so a
 * purchase received before stock went live would lose its accrual with nothing posted in its
 * place. New items carry no such history, which is why the stock catalogue starts empty here.
 *
 * PLACEHOLDERS. The GL codes and the one-step approval route are standing in for decisions finance
 * and the business have not made yet. They are marked below and are meant to be changed in the
 * admin UI, not here.
 */

// --- placeholders: confirm with finance, then change in the admin UI -----------------------
// Where stock on hand sits. 137.01 ເຄື່ອງໃນສາງບໍລິຫານ — the admin/ops stock of the Lao chart.
const INVENTORY_CODE = '137.01';
// Where a count difference is absorbed. 658.02 ລາຍຈ່າຍອື່ນໆບໍລິຫານ. See the note on the
// OPENING COUNT below: the first count into an empty warehouse also lands here and finance
// reclassifies it once with a journal voucher.
const INVENTORY_ADJUSTMENT_CODE = '658.02';
// What an issue costs out to — the item's own GL, per company. 602 ວັດຖຸຮັບໃຊ້ການຜະລິດ.
const ISSUE_EXPENSE_CODE = '602';
// ------------------------------------------------------------------------------------------

const COMPANY_CODE = process.env.ERP_COMPANY ?? 'HAL';
// The department that raises stock documents. Its mapping decides the form and the route, which is
// why the inventory module itself knows nothing about departments.
const DEPT_CODE = process.env.ERP_INV_DEPT ?? 'ADM';
// The role whose holders approve a stock document. PLACEHOLDER — one step, named here so the
// route exists at all: a document with no applicable step submits, holds its reservation, and sits
// SUBMITTED forever with nobody notified.
//
// A role step resolves to EVERY holder of the role in the company, so a role nobody holds is the
// same failure by another route: the step exists, resolves to an empty set, and the document waits
// on nobody. Checked below before the workflow is created, because the empty case is silent.
const APPROVER_ROLE_CODE = process.env.ERP_INV_APPROVER ?? 'HFAD';
// Who gets to see the stock screens. INV_* is in the permission catalog already but granted to
// nobody, which is why /stock and /warehouses are invisible today with no error to explain it.
const ADMIN_ROLE_CODE = process.env.ERP_INV_ADMIN_ROLE ?? 'ADMIN';

const WAREHOUSES: Array<[string, string]> = [
  ['MAIN', 'ສາງສຳນັກງານໃຫຍ່'],
  ['SORT', 'ສາງສູນຄັດແຍກ'],
];

// A starter catalogue of things a logistics company actually keeps on a shelf. New codes on
// purpose — see the header. `STK-` prefixed so they are obvious in a picker next to the 51
// service lines the item master is otherwise used for.
const STOCK_ITEMS: Array<[string, string, string]> = [
  ['STK-BOX', 'ກ່ອງພັດສະດຸ', 'ໜ່ວຍ'],
  ['STK-TAPE', 'ສະກ໋ອດໂລໂກ້', 'ແກັດ'],
  ['STK-BAG', 'ຖົງພາດສະຕິກຫໍ່ພັດສະດຸ', 'ແກັດ'],
  ['STK-LABEL', 'ສະຕິກເກີ້ຕິດພັດສະດຸ', 'ມ້ວນ'],
];

type TypeSpec = {
  code: string;
  name: string;
  postAction: 'ISSUE_STOCK' | 'ADJUST_STOCK' | 'TRANSFER_STOCK';
  fields: Array<[string, string, string, boolean]>;
};

// Three types, one per movement. They are ordinary configured documents — the routing, the form
// and the approval log all come from the engine (invariant 7), and none of them touches a budget:
// the purchase already charged it, so an issue moves value between accounts, not against a budget.
const TYPES: TypeSpec[] = [
  {
    code: 'STK_ISSUE',
    name: 'ໃບເບີກເຄື່ອງອອກສາງ',
    postAction: 'ISSUE_STOCK',
    fields: [
      ['purpose', 'ເບີກໄປໃຊ້ເຮັດຫຍັງ', 'text', true],
      ['receiverName', 'ຜູ້ຮັບເຄື່ອງ', 'text', true],
    ],
  },
  {
    code: 'STK_ADJ',
    name: 'ໃບປັບຍອດສາງ',
    postAction: 'ADJUST_STOCK',
    fields: [
      ['countRef', 'ເລກອ້າງອີງການຕວດນັບ', 'text', true],
      ['reason', 'ສາເຫດຜົນຕ່າງ', 'dropdown', true],
    ],
  },
  {
    code: 'STK_XFER',
    name: 'ໃບໂອນເຄື່ອງລະຫວ່າງສາງ',
    postAction: 'TRANSFER_STOCK',
    fields: [['purpose', 'ເຫດຜົນການໂອນ', 'text', true]],
  },
];

const OPTIONS: Record<string, string[]> = {
  // OPENING is what the first count into an empty warehouse is for. It is a label, not a branch:
  // the posting is the same ADJUST_INCREASE either way, which is exactly why the GL note above
  // matters — the opening value credits INVENTORY_ADJUSTMENT and finance moves it out once.
  reason: ['OPENING', 'COUNT_SHORT', 'COUNT_OVER', 'DAMAGED', 'LOST'],
};

// The codes a stock officer needs: see stock, raise each of the three movements, and the generic
// document grants without which none of them can be created or submitted.
const OFFICER_GRANTS = [
  'INV_VIEW', 'INV_ISSUE', 'INV_ADJUST', 'INV_TRANSFER',
  'DOC_CREATE', 'DOC_SUBMIT', 'DOC_VIEW',
];

async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();
  const OFF = { filters: { company: false } } as const;
  const made: string[] = [];
  const warn: string[] = [];

  try {
    const company = await em.findOneOrFail(Company, { code: COMPANY_CODE }, OFF);
    const dept = await em.findOneOrFail(Department, { company, deptCode: DEPT_CODE }, OFF);

    // 1. Account roles. These are the whole reason this is a script and not a click-through: stock
    //    posts its journal POST-COMMIT, so a missing role does not refuse the movement — the goods
    //    go on the shelf correctly and the entry lands in `gl_posting_attempt` as FAILED, where
    //    nobody is looking. `account-role-requirements.ts` starts demanding INVENTORY,
    //    INVENTORY_ADJUSTMENT and GRNI the moment one of the types below goes active.
    const roleFor = async (role: AccountRoleType, code: string): Promise<void> => {
      const existing = await em.findOne(AccountRole, { company, role }, { ...OFF, populate: ['account'] });
      if (existing) {
        made.push(`= account_role ${role} → ${existing.account.code} ${existing.account.name}`);
        return;
      }
      const account = await em.findOne(Account, { company, code }, OFF);
      if (!account) throw new Error(`account ${code} not found on ${COMPANY_CODE} — pick another for ${role}`);
      if (!account.isPostable) throw new Error(`account ${code} is a heading, not postable — pick a child for ${role}`);
      em.create(AccountRole, { company, role, account } as never);
      made.push(`+ account_role ${role} → ${code} ${account.name}`);
    };
    await roleFor(AccountRoleType.INVENTORY, INVENTORY_CODE);
    await roleFor(AccountRoleType.INVENTORY_ADJUSTMENT, INVENTORY_ADJUSTMENT_CODE);
    await roleFor(AccountRoleType.GRNI, '4031'); // only if absent; a receipt credits this

    // A receipt credits GRNI, so GRNI must be the liability that stands between taking goods in
    // and paying for them. Pointed at an asset it still posts — and quietly states the opposite of
    // what happened. Reported, never rewritten: an existing mapping is somebody's decision.
    const grni = await em.findOne(AccountRole, { company, role: AccountRoleType.GRNI }, { ...OFF, populate: ['account'] });
    if (grni && grni.account.accountType !== 'LIABILITY') {
      warn.push(
        `GRNI points at ${grni.account.code} ${grni.account.name} (${grni.account.accountType}). ` +
        `A goods receipt credits this account, so it should be a LIABILITY — 401 or 4031. ` +
        `Left as found; change it in the account-role screen.`,
      );
    }
    await em.flush();

    // 2. The warehouses. Two, not one, so an inter-warehouse transfer has somewhere to go.
    const warehouses = new Map<string, Warehouse>();
    for (const [code, name] of WAREHOUSES) {
      let wh = await em.findOne(Warehouse, { company, code }, OFF);
      if (!wh) {
        wh = em.create(Warehouse, { company, code, name, isActive: true } as never);
        made.push(`+ warehouse ${code} ${name}`);
      } else made.push(`= warehouse ${code}`);
      warehouses.set(code, wh);
    }
    await em.flush();

    // 3. The stock catalogue. `is_stock_tracked` is a property of the thing, so it lives on the
    //    group `item`; the GL it costs out to is per company, so that lives on `item_company` —
    //    and `issueExpenseAccount` reads exactly there when an issue is posted.
    const issueGl = await em.findOne(Account, { company, code: ISSUE_EXPENSE_CODE }, OFF);
    if (!issueGl) throw new Error(`issue expense account ${ISSUE_EXPENSE_CODE} not found on ${COMPANY_CODE}`);
    if (!issueGl.isPostable) throw new Error(`issue expense account ${ISSUE_EXPENSE_CODE} is a heading, not postable`);
    for (const [itemCode, name, unit] of STOCK_ITEMS) {
      let item = await em.findOne(Item, { itemCode }, OFF);
      if (!item) {
        item = em.create(Item, {
          itemCode, name, defaultUnit: unit, category: 'STOCK',
          isStockTracked: true, isActive: true,
        } as never);
        made.push(`+ item ${itemCode} ${name} (stock-tracked)`);
      } else made.push(`= item ${itemCode}`);
      await em.flush();
      if (!(await em.findOne(ItemCompany, { item, company }, OFF))) {
        em.create(ItemCompany, {
          item, company, isActive: true, defaultGlAccount: ISSUE_EXPENSE_CODE,
        } as never);
        made.push(`+ item_company ${itemCode} → GL ${ISSUE_EXPENSE_CODE}`);
      }
    }
    await em.flush();

    // 4. One approval route, shared by the three types. ONE STEP IS A PLACEHOLDER.
    const approver = await em.findOneOrFail(Role, { company, code: APPROVER_ROLE_CODE }, OFF);
    const holders = await em.count(UserCompanyRole, { role: approver }, OFF);
    if (holders === 0) {
      const withHolders = await em.find(Role, { company, isActive: true }, OFF);
      const usable: string[] = [];
      for (const r of withHolders) {
        if (await em.count(UserCompanyRole, { role: r }, OFF)) usable.push(r.code);
      }
      throw new Error(
        `role '${APPROVER_ROLE_CODE}' has no holders in ${COMPANY_CODE}, so its step would wait on nobody. ` +
        `Set ERP_INV_APPROVER to one of: ${usable.join(', ')}`,
      );
    }

    const WORKFLOW_NAME = 'ສາຍອະນຸມັດສາງ';
    let workflow = await em.findOne(Workflow, { company, name: WORKFLOW_NAME }, OFF);
    if (!workflow) {
      workflow = em.create(Workflow, { company, name: WORKFLOW_NAME, isActive: true } as never);
      await em.flush();
      // amountMin '0' deliberately: a band that starts above zero leaves a small issue with no
      // applicable step, and the router logs that rather than showing it.
      em.create(WorkflowStep, {
        workflow, stepNo: 1, stepName: APPROVER_ROLE_CODE, approverRole: approver,
        amountMin: '0', approveMode: 'SEQUENTIAL', showSignatureOnPdf: true,
      } as never);
      made.push(`+ workflow ${WORKFLOW_NAME} — 1 step (${APPROVER_ROLE_CODE}, ${holders} holder(s)), PLACEHOLDER`);
    } else {
      // The one row this script updates rather than only inserts: a step pointing at a role that
      // turned out to have no holders is a route to nowhere, and re-running is how it gets fixed.
      const step = await em.findOne(WorkflowStep, { workflow, stepNo: 1 }, { ...OFF, populate: ['approverRole'] });
      if (step && step.approverRole?.id !== approver.id) {
        step.approverRole = approver;
        step.stepName = APPROVER_ROLE_CODE;
        made.push(`~ workflow ${WORKFLOW_NAME} step 1 now ${APPROVER_ROLE_CODE} (${holders} holder(s))`);
      } else made.push(`= workflow ${WORKFLOW_NAME}`);
    }
    await em.flush();

    if (!(await em.findOne(DocumentCategory, { company, code: DocCategory.ADMIN }, OFF))) {
      throw new Error(`document_category ADMIN is missing on ${COMPANY_CODE}`);
    }

    // 5. The three types, their forms, and the department mapping a new document is created
    //    against. `requiresWarehouse` is what makes the submit demand a location; `requiresItem`
    //    is what makes every line name something that can actually move. Both flags, not a branch
    //    on the post action (invariant 7). `matchMode` NONE because a stock movement has no
    //    predecessor to match against — THREE_WAY would hold it against a PO it never had.
    for (const spec of TYPES) {
      let docType = await em.findOne(DocumentType, { company, code: spec.code }, OFF);
      if (!docType) {
        docType = em.create(DocumentType, {
          company, code: spec.code, name: spec.name, category: DocCategory.ADMIN,
          requiresBudget: false, requiresQuota: false, requiresVendor: false,
          requiresItem: true, requiresPayee: false, requiresWarehouse: true,
          requiresEmployee: false, accruesOnApproval: false, receivesGoods: false,
          matchMode: 'NONE', postAction: spec.postAction, isActive: true,
        } as never);
        made.push(`+ document_type ${spec.code} ${spec.name} (${spec.postAction}, requires item + warehouse)`);
      } else made.push(`= document_type ${spec.code}`);
      await em.flush();

      // A published template is frozen; the only way to change a form is the next version. Here
      // the template is only ever created, never re-versioned — this script owns these types from
      // empty, and a form an admin has since edited must not be overwritten by a re-run.
      let template = (await em.find(FormTemplate, { documentType: docType }, { ...OFF, orderBy: { version: 'DESC' } }))[0] ?? null;
      if (!template) {
        template = em.create(FormTemplate, {
          documentType: docType, version: 1, status: 'DRAFT', createdAt: new Date(),
        } as never);
        await em.flush();
        spec.fields.forEach(([fieldName, fieldLabel, fieldType, isRequired], i) => {
          em.create(FormField, {
            formTemplate: template, fieldName, fieldLabel, fieldType, isRequired, sortOrder: i + 1,
            optionsJson: OPTIONS[fieldName] ? JSON.stringify(OPTIONS[fieldName]) : undefined,
          } as never);
        });
        template.status = 'PUBLISHED';
        made.push(`+ form_template ${spec.code} v1 PUBLISHED + ${spec.fields.length} fields`);
      } else made.push(`= form_template ${spec.code} v${template.version}`);
      await em.flush();

      if (!(await em.findOne(DeptDocType, { department: dept, documentType: docType }, OFF))) {
        em.create(DeptDocType, {
          department: dept, documentType: docType, formTemplate: template, workflow, isActive: true,
        } as never);
        made.push(`+ dept_doc_type ${DEPT_CODE} × ${spec.code} → form v${template.version} + ${WORKFLOW_NAME}`);
      } else made.push(`= dept_doc_type ${DEPT_CODE} × ${spec.code}`);
    }
    await em.flush();

    // 6. The grants. Without these the whole capability is invisible and silent: the routes exist,
    //    the sidebar entries exist, and both are gated on INV_VIEW / INV_MANAGE, which nobody
    //    holds. A missing permission code is the one failure mode in this system that produces no
    //    error at all — the menu item simply is not there.
    let officer = await em.findOne(Role, { company, code: 'INV_OFFICER' }, OFF);
    if (!officer) {
      officer = em.create(Role, { company, code: 'INV_OFFICER', name: 'ພະນັກງານສາງ', isActive: true } as never);
      await em.flush();
      for (const code of OFFICER_GRANTS) {
        const permission = await em.findOneOrFail(Permission, { code }, OFF);
        em.create(RolePermission, { role: officer, permission, scope: Scope.DEPARTMENT } as never);
      }
      made.push(`+ role INV_OFFICER + ${OFFICER_GRANTS.length} grants (DEPARTMENT scope)`);
    } else made.push('= role INV_OFFICER');
    await em.flush();

    // The administrator needs the two read/admin codes to reach /stock and /warehouses at all.
    // COMPANY scope: a warehouse belongs to the company, not to a department.
    const adminRole = await em.findOne(Role, { company, code: ADMIN_ROLE_CODE }, OFF);
    if (!adminRole) {
      warn.push(`role ${ADMIN_ROLE_CODE} not found — grant INV_VIEW and INV_MANAGE by hand in the RBAC screen`);
    } else {
      for (const code of ['INV_VIEW', 'INV_MANAGE']) {
        const permission = await em.findOneOrFail(Permission, { code }, OFF);
        if (await em.findOne(RolePermission, { role: adminRole, permission }, OFF)) {
          made.push(`= grant ${ADMIN_ROLE_CODE} ${code}`);
          continue;
        }
        em.create(RolePermission, { role: adminRole, permission, scope: Scope.COMPANY } as never);
        made.push(`+ grant ${ADMIN_ROLE_CODE} ${code} (COMPANY scope)`);
      }
    }
    await em.flush();

    const log = (line: string): void => {
      // eslint-disable-next-line no-console
      console.log(line);
    };
    log('\n' + made.join('\n'));
    if (warn.length) log('\nWARNINGS\n' + warn.map((w) => `! ${w}`).join('\n'));
    log(`\ncompany     ${COMPANY_CODE}  ${company.id}`);
    log(`department  ${DEPT_CODE}  ${dept.id}`);
    log(`warehouses  ${[...warehouses.values()].map((w) => `${w.code}=${w.id}`).join('  ')}`);
    log('\nNEXT: re-login so the new grants are in the token, then open /warehouses and /stock.');
    log('The stock ledger is empty — raise a STK_ADJ with reason OPENING to count the first stock in.');
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('setup-inventory-dev FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
