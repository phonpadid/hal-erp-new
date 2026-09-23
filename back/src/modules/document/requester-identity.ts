import type { EntityManager } from '@mikro-orm/postgresql';
import { Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import type { Document } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Who raised a document, as a reader should see them named. */
export interface RequesterIdentity {
  /** `employee.full_name` in the DOCUMENT's company, else `app_user.username`. Never blank. */
  name: string;
  /** That employee's department. Null exactly when the name fell back to a username. */
  department: string | null;
}

/**
 * Name the raisers of a page of documents, in a bounded number of queries.
 *
 * The employee lookup is scoped to the DOCUMENT's company, not just to the user (invariant 1).
 * Reading the employee by user alone prints a name — and a department — from a company the reader
 * may not even be in, and makes the list disagree with the detail screen about who a person is.
 *
 * The department is absent exactly when the name fell back to a username: an employee always has
 * one, so a row carrying a name and no department would mean the two had drifted apart.
 *
 * Shared by the list read and the pending-approvals summary so the two cannot name the same person
 * differently. Three queries for any page size — the documents are already in hand, the accounts
 * are one `$in`, the employee records another.
 */
export async function requesterIdentities(
  em: EntityManager,
  documents: Array<Pick<Document, 'id' | 'createdBy' | 'company'>>,
): Promise<Map<string, RequesterIdentity>> {
  const out = new Map<string, RequesterIdentity>();
  if (!documents.length) return out;

  const userIds = [...new Set(documents.map((d) => d.createdBy.id))];
  const companyIds = [...new Set(documents.map((d) => d.company.id))];

  // Not populated on the documents: populating the relation would serialize the whole account —
  // password hash and all — onto rows that only need a name.
  const users = await em.find(AppUser, { id: { $in: userIds } }, FILTER_OFF);
  const usernameOf = new Map(users.map((u) => [u.id, u.username]));

  const employees = await em.find(
    Employee,
    { user: { $in: userIds }, company: { $in: companyIds } },
    FILTER_OFF,
  );
  // Keyed on the PAIR: the same person may be an employee of two companies in the group, and only
  // the record belonging to the document's company may name them on it.
  const employeeOf = new Map<string, Employee>();
  for (const e of employees) if (e.user) employeeOf.set(`${e.user.id}|${e.company.id}`, e);

  // The departments by id rather than `populate`, so the read is one explicit query whose scope is
  // visible here. Departments are company-scoped, and these belong to the documents' own companies
  // by construction — an employee's department is in the company the employee record is in.
  const deptIds = [...new Set(employees.map((e) => e.department.id))];
  const departments = deptIds.length ? await em.find(Department, { id: { $in: deptIds } }, FILTER_OFF) : [];
  const deptNameOf = new Map(departments.map((d) => [d.id, d.name]));

  for (const d of documents) {
    const employee = employeeOf.get(`${d.createdBy.id}|${d.company.id}`);
    out.set(d.id, {
      name: employee?.fullName || usernameOf.get(d.createdBy.id) || '',
      department: employee ? deptNameOf.get(employee.department.id) ?? null : null,
    });
  }
  return out;
}
