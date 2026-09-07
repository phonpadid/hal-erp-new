import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType } from '../../common/enums';
import { Account } from '../accounting/accounting.entities';
import { Company } from '../multi-company/multi-company.entities';
import {
  ACCOUNT_ROLE_PURPOSE,
  ALL_ACCOUNT_ROLES,
  requiredAccountRoles,
} from './account-role-requirements';
import { AccountRole } from './gl.entities';

/** One role as the configuration screen reads it. */
export interface AccountRoleMapping {
  role: AccountRoleType;
  /** What the role is for, in words somebody choosing an account can act on. */
  purpose: string;
  /** Whether this company's own configuration will ask the GL to resolve it. */
  required: boolean;
  account?: { id: string; code: string; name: string; isActive: boolean };
}

const FILTER_OFF = { filters: { company: false } } as const;

/** Thrown when a required system-account role is not mapped/active for a company. */
export class UnmappedAccountRoleError extends Error {
  constructor(companyId: string, role: AccountRoleType) {
    super(`No active account mapped for role '${role}' in company ${companyId}`);
  }
}

/**
 * Which account plays each system role for a company: cash clearing, input VAT, FX gain/loss.
 *
 * `resolve` runs off a post-commit event with no request context, so it scopes by company
 * explicitly; the configuration reads below run inside a request and scope to the active company.
 *
 * The list of roles comes from `AccountRoleType` itself, never from a second table of "roles we
 * offer to map". A role the GL resolves and this surface does not show is a posting that fails with
 * nowhere to fix it — which is the state this class existed in until now, and the reason a live
 * company's every payment posting sat parked with no screen able to say why.
 */
@Injectable()
export class AccountRoleService {
  constructor(private readonly em: EntityManager) {}

  async resolve(companyId: string, role: AccountRoleType, em: EntityManager = this.em): Promise<Account> {
    const mapping = await em.findOne(
      AccountRole,
      { company: companyId, role },
      { ...FILTER_OFF, populate: ['account'] },
    );
    if (!mapping || !mapping.account.isActive) {
      throw new UnmappedAccountRoleError(companyId, role);
    }
    return mapping.account;
  }

  /**
   * Every role, what it is for, whether this company needs it, and what it points at.
   *
   * Reported as a complete list rather than only the mapped ones: the question the reader has is
   * "what is still missing", and a list of what exists cannot answer it.
   */
  async list(): Promise<AccountRoleMapping[]> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const company = await em.findOne(
      Company,
      { id: companyId },
      { ...FILTER_OFF, populate: ['baseCurrency'] },
    );
    if (!company) throw new NotFoundException(`Company ${companyId} not found`);

    const required = await requiredAccountRoles(em, company);
    const mapped = await em.find(
      AccountRole,
      { company: companyId },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const byRole = new Map(mapped.map((m) => [m.role, m.account]));

    return ALL_ACCOUNT_ROLES.map((role) => {
      const account = byRole.get(role);
      return {
        role,
        purpose: ACCOUNT_ROLE_PURPOSE[role],
        required: required.has(role),
        account: account
          ? { id: account.id, code: account.code, name: account.name, isActive: account.isActive }
          : undefined,
      };
    });
  }

  /**
   * Point a role at an account, replacing wherever it pointed before.
   *
   * Replaces rather than adds: two mappings for one role would leave `resolve` picking between them,
   * and which it picked would decide where money posted.
   *
   * Every refusal names its reason, because the screen has to be able to say why. An account of
   * another company would breach company isolation; an inactive one is what `resolve` already
   * refuses; a header account resolves and then fails at the first entry that touches it, which
   * returns the company to the state this method exists to fix, one level deeper.
   *
   * Writes one row and no ledger. Nothing is locked: the mapping is read at posting time, and a
   * posting racing a re-mapping resolves whichever committed first — both are valid answers and no
   * arithmetic depends on which.
   */
  async set(role: AccountRoleType, accountId: string): Promise<AccountRoleMapping> {
    const companyId = RequestContext.companyId()!;
    if (!ALL_ACCOUNT_ROLES.includes(role)) {
      throw new BadRequestException(
        `Account role '${role}' is not one this system resolves — use one of ${ALL_ACCOUNT_ROLES.join(', ')}`,
      );
    }
    const em = this.em.fork();
    const account = await em.findOne(Account, { id: accountId }, FILTER_OFF);
    if (!account || account.company.id !== companyId) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }
    if (!account.isActive) {
      throw new BadRequestException(
        `Account ${account.code} is inactive; a role mapped to it could never post`,
      );
    }
    if (!account.isPostable) {
      throw new BadRequestException(
        `Account ${account.code} is a header account, not a postable one; a role mapped to it would ` +
          'resolve and then fail at the first entry that touched it',
      );
    }

    const existing = await em.findOne(AccountRole, { company: companyId, role }, FILTER_OFF);
    if (existing) {
      existing.account = account;
    } else {
      em.create(AccountRole, {
        company: em.getReference(Company, companyId),
        role,
        account,
      });
    }
    await em.flush();

    const company = await em.findOne(
      Company,
      { id: companyId },
      { ...FILTER_OFF, populate: ['baseCurrency'] },
    );
    const required = company ? await requiredAccountRoles(em, company) : new Set<AccountRoleType>();
    return {
      role,
      purpose: ACCOUNT_ROLE_PURPOSE[role],
      required: required.has(role),
      account: { id: account.id, code: account.code, name: account.name, isActive: account.isActive },
    };
  }
}
