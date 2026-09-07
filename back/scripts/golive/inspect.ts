import { EntityManager } from '@mikro-orm/postgresql';
import { MOVEMENT_POST_ACTIONS, POST_JOURNAL } from '@erp/shared';
import { PLAN_POST_ACTION } from '../../src/modules/budget/budget-plan.service';
import { ExchangeRateService } from '../../src/modules/currency/exchange-rate.service';
import { DeptDocType, Document, DocumentType } from '../../src/modules/document/document.entities';
import { Workflow, WorkflowStep } from '../../src/modules/approval/approval.entities';
import { Company } from '../../src/modules/multi-company/multi-company.entities';
import {
  ACCOUNT_ROLE_PURPOSE,
  requiredAccountRoles,
} from '../../src/modules/gl/account-role-requirements';
import { AccountRole } from '../../src/modules/gl/gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The kinds of decision a migrated, loginable database can still be missing.
 *
 * Each is a state in which some user cannot do something, and each is a decision the customer has
 * not recorded — never a defect. They are named here so the report, the template generator and the
 * spec all use one vocabulary.
 */
export type FindingKind =
  | 'UNMAPPED_TYPE'
  | 'UNPUBLISHED_TEMPLATE'
  | 'PERSON_TARGETED_WORKFLOW'
  | 'UNRESOLVABLE_CURRENCY'
  | 'MISSING_AUTHORING_ROUTE'
  | 'UNMAPPED_ACCOUNT_ROLE';

export interface Finding {
  kind: FindingKind;
  /** The company this finding belongs to, by code — the file and the report are both per company. */
  company: string;
  /** What the finding is about, in the customer's own identifiers: a type code, a workflow name. */
  subject: string;
  /** One line, stating what nobody can do. Never a stack trace, never an id on its own. */
  detail: string;
}

export interface CompanyReport {
  company: string;
  companyId: string;
  findings: Finding[];
}

/**
 * Post-actions whose content lives OUTSIDE `document_line` and `doc_field_value` — on
 * `budget_movement` or `journal_voucher` — where the generic create form cannot write it. Kept in
 * step with `boot-check.ts`, which fails a deploy on exactly this set.
 */
const CONTENT_LIVES_ELSEWHERE = [
  ...MOVEMENT_POST_ACTIONS,
  PLAN_POST_ACTION,
  POST_JOURNAL,
] as const;

/**
 * Read what an environment still lacks, per company, and change nothing.
 *
 * Read-only is a property this pass is tested for, not merely intended to have: the spec runs it
 * against a seeded database and compares row counts for every table it touches. It matters because
 * the output of this pass is the question list to take to the customer, and asking a question must
 * not be a step towards answering it.
 *
 * Nothing here is inferred. A type mapped to no department is reported, not mapped to a guess —
 * eleven wrong routes reach production faster than one right one, and a wrong route is not visibly
 * wrong downstream, because every downstream rule is *about* the route.
 */
export async function inspect(
  em: EntityManager,
  rates: ExchangeRateService,
  companyCode?: string,
): Promise<CompanyReport[]> {
  const companies = await em.find(
    Company,
    companyCode ? { code: companyCode, isActive: true } : { isActive: true },
    { ...FILTER_OFF, orderBy: { code: 'ASC' } },
  );

  const reports: CompanyReport[] = [];
  for (const company of companies) {
    const findings = [
      ...(await unmappedTypes(em, company)),
      ...(await unpublishedTemplates(em, company)),
      ...(await personTargetedWorkflows(em, company)),
      ...(await unresolvableCurrencies(em, rates, company)),
      ...(await missingAuthoringRoutes(em, company)),
      ...(await unmappedAccountRoles(em, company)),
    ];
    reports.push({ company: company.code, companyId: company.id, findings });
  }
  return reports;
}

/**
 * A system account role this company's configuration will resolve, that nothing maps.
 *
 * Belongs here by this report's own definition: a decision nobody has recorded, which leaves
 * somebody unable to do something. Until it is recorded, every posting that resolves the role fails,
 * retries to its bound and parks — and the only place that says so is a screen nobody visits until
 * the ledger has been empty for months. That is not hypothetical; it is how this check came to be
 * written.
 *
 * Only the roles the company actually needs, from the same derivation the mapping screen uses. A
 * report that asks for fourteen accounts nobody needs is one people learn to skim, and skimming is
 * the failure this is trying to prevent.
 */
async function unmappedAccountRoles(em: EntityManager, company: Company): Promise<Finding[]> {
  const required = await requiredAccountRoles(em, company);
  if (!required.size) return [];
  const mapped = await em.find(
    AccountRole,
    { company: company.id },
    { ...FILTER_OFF, populate: ['account'] },
  );
  const usable = new Set(mapped.filter((m) => m.account.isActive).map((m) => m.role));

  return [...required]
    .filter((role) => !usable.has(role))
    .sort()
    .map((role) => ({
      kind: 'UNMAPPED_ACCOUNT_ROLE' as const,
      company: company.code,
      subject: role,
      detail: `no account is mapped to the '${role}' role, so every posting that needs it fails. ${ACCOUNT_ROLE_PURPOSE[role]}`,
    }));
}

/** An active type no department may raise. The reason nobody can start a disbursement. */
async function unmappedTypes(em: EntityManager, company: Company): Promise<Finding[]> {
  const types = await em.find(
    DocumentType,
    { company: company.id, isActive: true },
    { ...FILTER_OFF, orderBy: { code: 'ASC' } },
  );
  const mapped = new Set(
    (
      await em.find(
        DeptDocType,
        { documentType: { company: company.id }, isActive: true },
        { ...FILTER_OFF, fields: ['documentType'] },
      )
    ).map((m) => m.documentType.id),
  );
  return types
    .filter((t) => !mapped.has(t.id))
    .map((t) => ({
      kind: 'UNMAPPED_TYPE' as const,
      company: company.code,
      subject: t.code,
      detail: `${t.code} (${t.name}) is active but no department maps it, so nobody can raise one.`,
    }));
}

/**
 * A mapping whose form template is not `PUBLISHED`.
 *
 * The mapping exists, so the type looks raisable; the form behind it is a draft. Reported
 * separately from an unmapped type because the fix is different — publish, rather than decide.
 */
async function unpublishedTemplates(em: EntityManager, company: Company): Promise<Finding[]> {
  const mappings = await em.find(
    DeptDocType,
    { documentType: { company: company.id }, isActive: true },
    { ...FILTER_OFF, populate: ['documentType', 'formTemplate', 'department'] },
  );
  return mappings
    .filter((m) => m.formTemplate.status !== 'PUBLISHED')
    .map((m) => ({
      kind: 'UNPUBLISHED_TEMPLATE' as const,
      company: company.code,
      subject: `${m.documentType.code}/${m.department.deptCode}`,
      detail:
        `${m.documentType.code} is mapped to ${m.department.deptCode}, but its form template ` +
        `v${m.formTemplate.version} is ${m.formTemplate.status}, not PUBLISHED.`,
    }));
}

/**
 * A workflow reachable from a mapping whose every step names an individual person.
 *
 * Not wrong, but a single point of failure: the named approver going on leave stops every document
 * routed through it, and there is no delegation to fall back on when the chain has no role to
 * resolve. Reported so the customer decides; this change never rewrites a chain.
 */
async function personTargetedWorkflows(em: EntityManager, company: Company): Promise<Finding[]> {
  const mappings = await em.find(
    DeptDocType,
    { documentType: { company: company.id }, isActive: true },
    { ...FILTER_OFF, fields: ['workflow'] },
  );
  const workflowIds = [...new Set(mappings.map((m) => m.workflow.id))];
  if (!workflowIds.length) return [];

  const workflows = await em.find(
    Workflow,
    { id: { $in: workflowIds } },
    { ...FILTER_OFF, orderBy: { name: 'ASC' } },
  );
  const steps = await em.find(
    WorkflowStep,
    { workflow: { $in: workflowIds } },
    { ...FILTER_OFF, populate: ['approverRole', 'approverUser'] },
  );

  const findings: Finding[] = [];
  for (const workflow of workflows) {
    const own = steps.filter((s) => s.workflow.id === workflow.id);
    // A workflow with no steps at all is a different problem and belongs to whoever configures it;
    // this finding is specifically about a chain that routes only through named individuals.
    if (!own.length || own.some((s) => s.approverRole)) continue;
    const people = [...new Set(own.map((s) => s.approverUser?.username ?? '(unset)'))];
    findings.push({
      kind: 'PERSON_TARGETED_WORKFLOW',
      company: company.code,
      subject: workflow.name,
      detail:
        `every step of "${workflow.name}" names an individual (${people.join(', ')}) rather than a ` +
        `role, so nobody else can approve when they cannot.`,
    });
  }
  return findings;
}

/**
 * A currency an existing document is already denominated in, for which no rate resolves.
 *
 * A new document in that currency is refused at submit, because the rate is stamped there
 * (invariant 6) and there is nothing to stamp. Existing documents are unaffected — theirs is
 * already locked — which is why this is a configuration gap rather than a data defect.
 */
async function unresolvableCurrencies(
  em: EntityManager,
  rates: ExchangeRateService,
  company: Company,
): Promise<Finding[]> {
  const base = company.baseCurrency?.code;
  if (!base) return [];

  const documents = await em.find(
    Document,
    { company: company.id, currency: { $ne: null } } as never,
    { ...FILTER_OFF, fields: ['currency'] },
  );
  const codes = [...new Set(documents.map((d) => d.currency?.code).filter((c): c is string => !!c))]
    .filter((code) => code !== base)
    .sort();

  const today = new Date().toISOString().slice(0, 10);
  const findings: Finding[] = [];
  for (const code of codes) {
    try {
      await rates.resolveRate({ from: code, to: base, asOf: today, companyId: company.id });
    } catch {
      // The resolver throws for exactly one reason here — no rate on any of its four paths — and
      // its message is the finding, restated in the terms the customer will act on.
      findings.push({
        kind: 'UNRESOLVABLE_CURRENCY',
        company: company.code,
        subject: `${code}->${base}`,
        detail:
          `documents exist in ${code} but no ${code}->${base} rate resolves as of ${today}, so a ` +
          `new ${code} document is refused at submit.`,
      });
    }
  }
  return findings;
}

/**
 * An active type whose content is written on another table and which names no screen.
 *
 * `boot-check` already FAILS a deploy on this, so it should never survive to here. It is inspected
 * anyway because this pass is also run against databases a deploy has not touched — the customer's
 * copy, a restored backup — and a question list that omitted it would be incomplete.
 */
async function missingAuthoringRoutes(em: EntityManager, company: Company): Promise<Finding[]> {
  const stranded = await em.find(
    DocumentType,
    {
      company: company.id,
      isActive: true,
      postAction: { $in: [...CONTENT_LIVES_ELSEWHERE] },
      $or: [{ authoringRoute: null }, { authoringRoute: '' }],
    },
    { ...FILTER_OFF, orderBy: { code: 'ASC' } },
  );
  return stranded.map((t) => ({
    kind: 'MISSING_AUTHORING_ROUTE' as const,
    company: company.code,
    subject: t.code,
    detail:
      `${t.code} writes its content on another table (post_action ${t.postAction}) and names no ` +
      `authoring_route, so the create wizard spends a document number on a draft that cannot be ` +
      `submitted.`,
  }));
}

/**
 * How many active document types no department maps, per company code.
 *
 * The same question `UNMAPPED_TYPE` answers, asked across every company at once and reduced to a
 * count. `boot-check` prints it at every deploy without failing on it: a company mid-rollout
 * legitimately has unmapped types, and failing there would make the check something operators
 * route around. It lives beside the finding so the two cannot drift.
 */
export async function countUnraisableTypes(em: EntityManager): Promise<Array<[string, number]>> {
  const types = await em.find(
    DocumentType,
    { isActive: true },
    { ...FILTER_OFF, populate: ['company'] },
  );
  const mapped = new Set(
    (await em.find(DeptDocType, { isActive: true }, { ...FILTER_OFF, fields: ['documentType'] }))
      .map((m) => m.documentType.id),
  );
  const byCompany = new Map<string, number>();
  for (const type of types) {
    if (mapped.has(type.id)) continue;
    byCompany.set(type.company.code, (byCompany.get(type.company.code) ?? 0) + 1);
  }
  return [...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b));
}
