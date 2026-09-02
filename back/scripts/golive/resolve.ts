import { EntityManager } from '@mikro-orm/postgresql';
import { Company, Department } from '../../src/modules/multi-company/multi-company.entities';
import { Role } from '../../src/modules/rbac/rbac.entities';
import { Workflow } from '../../src/modules/approval/approval.entities';
import { Currency } from '../../src/modules/currency/currency.entities';
import { DeptDocType, DocumentType, FormTemplate } from '../../src/modules/document/document.entities';
import type { GoliveConfig } from './config';

const FILTER_OFF = { filters: { company: false } } as const;

/** Every name in the file, turned into the row it names. */
export interface Resolved {
  company: Company;
  /** Keyed by the code the file used, so an error can quote what the customer wrote. */
  departments: Map<string, Department>;
  documentTypes: Map<string, DocumentType>;
  workflows: Map<string, Workflow>;
  roles: Map<string, Role>;
  currencies: Map<string, Currency>;
  /** Keyed `TYPECODE/version`. */
  formTemplates: Map<string, FormTemplate>;
  /** Existing mappings, keyed `TYPECODE/DEPTCODE`, so apply can tell create from update. */
  mappings: Map<string, DeptDocType>;
}

/** Thrown with every unknown reference at once, never just the first. */
export class UnresolvedReferences extends Error {
  constructor(readonly problems: string[]) {
    super(`the config names ${problems.length} thing(s) that do not exist:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'UnresolvedReferences';
  }
}

/**
 * Resolve every name the file uses — company, department, type, template version, workflow, role,
 * currency — before anything is written.
 *
 * Collects ALL failures and raises them together. One run naming every problem is the difference
 * between a person fixing a file once and fixing it five times, and this file is filled in by
 * somebody who does not have the database in front of them.
 *
 * Everything is scoped to the file's own company (invariant 1). A department in another company is
 * not "found in the wrong company" — it is not found, the same as a typo, because a cross-company
 * mapping is something the configuration screen refuses outright.
 */
export async function resolve(em: EntityManager, config: GoliveConfig): Promise<Resolved> {
  const problems: string[] = [];

  const company = await em.findOne(Company, { code: config.company }, FILTER_OFF);
  if (!company) {
    // Nothing else can be looked up without it, so this one failure is terminal on its own.
    throw new UnresolvedReferences([`company "${config.company}"`]);
  }

  const wantedDepts = new Set<string>();
  const wantedTypes = new Set(Object.keys(config.documentTypes));
  const wantedWorkflows = new Set(Object.keys(config.workflows));
  const wantedRoles = new Set<string>();
  const wantedTemplates: Array<{ type: string; version: number }> = [];

  for (const [code, spec] of Object.entries(config.documentTypes)) {
    for (const m of spec.mappings) {
      wantedDepts.add(m.department);
      wantedWorkflows.add(m.workflow);
      wantedTemplates.push({ type: code, version: m.formTemplate });
    }
  }
  for (const spec of Object.values(config.workflows)) {
    for (const step of spec.steps) wantedRoles.add(step.approverRole);
  }
  for (const pair of config.publishTemplates) {
    const [type, dept] = pair.split('/');
    wantedTypes.add(type);
    wantedDepts.add(dept);
  }

  const departments = await byCode(
    em, Department, { company: company.id }, [...wantedDepts], (d) => d.deptCode,
    (code) => problems.push(`department "${code}" in company ${company.code}`),
  );
  const documentTypes = await byCode(
    em, DocumentType, { company: company.id }, [...wantedTypes], (t) => t.code,
    (code) => problems.push(`document type "${code}" in company ${company.code}`),
  );
  const workflows = await byCode(
    em, Workflow, { company: company.id }, [...wantedWorkflows], (w) => w.name,
    (name) => problems.push(`workflow "${name}" in company ${company.code}`),
  );
  const roles = await byCode(
    em, Role, { company: company.id }, [...wantedRoles], (r) => r.code,
    (code) => problems.push(`role "${code}" in company ${company.code} — a role-targeted chain may need a role creating first`),
  );
  const currencies = await byCode(
    em, Currency, {}, [...new Set(config.exchangeRates.flatMap((r) => [r.from, r.to]))],
    (c) => c.code, (code) => problems.push(`currency "${code}"`),
  );

  // Templates are found by (type, version), so they are resolved after the types they hang off.
  const formTemplates = new Map<string, FormTemplate>();
  for (const { type, version } of wantedTemplates) {
    const docType = documentTypes.get(type);
    if (!docType) continue; // already reported as an unknown type; do not report it twice
    const template = await em.findOne(FormTemplate, { documentType: docType.id, version }, FILTER_OFF);
    if (!template) problems.push(`form template v${version} of document type "${type}"`);
    else formTemplates.set(`${type}/${version}`, template);
  }

  if (problems.length) throw new UnresolvedReferences(problems);

  // Existing mappings for every type the file mentions, so apply can tell a create from an update
  // and stay idempotent. Read after validation because it is not itself a source of failure.
  const mappings = new Map<string, DeptDocType>();
  const typeIds = [...documentTypes.values()].map((t) => t.id);
  if (typeIds.length) {
    const rows = await em.find(
      DeptDocType,
      { documentType: { $in: typeIds } },
      // `formTemplate` too: apply reads its `status` to decide whether a publish is needed. Left
      // as a bare reference it reads `undefined`, so a second apply tries to publish an already
      // PUBLISHED template and the service refuses — idempotence lost. A unit spec can miss this
      // entirely, because the identity map hydrates the reference from an earlier read in the
      // same process; a fresh CLI run has no such luck.
      { ...FILTER_OFF, populate: ['documentType', 'department', 'formTemplate'] },
    );
    for (const row of rows) mappings.set(`${row.documentType.code}/${row.department.deptCode}`, row);
  }

  return { company, departments, documentTypes, workflows, roles, currencies, formTemplates, mappings };
}

/** Find each wanted name in one query, reporting the ones that are not there. */
async function byCode<T extends object>(
  em: EntityManager,
  entity: { new (...args: never[]): T },
  scope: object,
  wanted: string[],
  keyOf: (row: T) => string,
  miss: (code: string) => void,
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  if (!wanted.length) return found;
  const rows = await em.find(entity as never, scope as never, FILTER_OFF);
  for (const row of rows as T[]) found.set(keyOf(row), row);
  const present = new Map<string, T>();
  for (const code of wanted) {
    const row = found.get(code);
    if (row) present.set(code, row);
    else miss(code);
  }
  return present;
}
