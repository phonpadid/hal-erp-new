import type { EntityManager } from '@mikro-orm/postgresql';
import { Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, UserSignature } from '../rbac/rbac.entities';
import type { Document } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Who raised a document, as a reader should see them named. */
export interface RequesterIdentity {
  /** `employee.full_name` in the DOCUMENT's company, else `app_user.username`. Never blank. */
  name: string;
  /** That employee's department. Null exactly when the name fell back to a username. */
  department: string | null;
  /**
   * The raiser's login, read here rather than off `document.createdBy`: a search that matched on
   * the populated relation answered 500 in production the day a requester reached the inbox whose
   * `createdBy` had not been hydrated. Blank only when the account itself could not be read.
   */
  username: string;
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
  documents: Array<Pick<Document, 'id' | 'createdBy' | 'company' | 'submittedSignatureId'>>,
): Promise<Map<string, RequesterIdentity>> {
  const out = new Map<string, RequesterIdentity>();
  if (!documents.length) return out;

  const raiserOf = await raiserIdsOf(em, documents);
  const userIds = [...new Set(documents.map((d) => raiserOf.get(d.id)!))];
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
    const raiser = raiserOf.get(d.id)!;
    const employee = employeeOf.get(`${raiser}|${d.company.id}`);
    const username = usernameOf.get(raiser) ?? '';
    out.set(d.id, {
      name: employee?.fullName || username,
      department: employee ? deptNameOf.get(employee.department.id) ?? null : null,
      username,
    });
  }
  return out;
}

/**
 * Who raised each document: the person who SUBMITTED it, else its creator.
 *
 * The two are the same person for a document someone filled in and sent. They part for a successor
 * the system raises itself (PR → PO): `successor-sweeper` attributes the draft to the predecessor's
 * requester so the approver who completed the PR is not barred from the PO under invariant 8, and a
 * procurement officer then fills it in and submits it. Naming the creator there printed the PR's
 * requester — from another department — over procurement's signature on every PO (2026-10-14), and
 * the list disagreed with the signature the same way.
 *
 * The submitter is read from the signature stamped at submit (`document.submitted_signature_id`,
 * invariant 6), which is the record of who sent it. A document with no stamp — a draft, an API-key
 * submit, one submitted before the stamp existed — is still its creator's. One query for any page.
 */
export async function raiserIdsOf(
  em: EntityManager,
  documents: Array<Pick<Document, 'id' | 'createdBy' | 'submittedSignatureId'>>,
): Promise<Map<string, string>> {
  const stampIds = [...new Set(documents.map((d) => d.submittedSignatureId).filter((v): v is string => !!v))];
  const stamps = stampIds.length ? await em.find(UserSignature, { id: { $in: stampIds } }, FILTER_OFF) : [];
  const ownerOfStamp = new Map(stamps.map((s) => [s.id, s.user.id]));
  const out = new Map<string, string>();
  for (const d of documents) {
    const stamped = d.submittedSignatureId ? ownerOfStamp.get(d.submittedSignatureId) : undefined;
    out.set(d.id, stamped ?? d.createdBy.id);
  }
  return out;
}
