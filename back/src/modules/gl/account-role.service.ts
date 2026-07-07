import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AccountRoleType } from '../../common/enums';
import { Account } from '../accounting/accounting.entities';
import { AccountRole } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Thrown when a required system-account role is not mapped/active for a company. */
export class UnmappedAccountRoleError extends Error {
  constructor(companyId: string, role: AccountRoleType) {
    super(`No active account mapped for role '${role}' in company ${companyId}`);
  }
}

/**
 * Resolves system-account roles (cash clearing, FX gain/loss) to accounts per company. Runs
 * off a post-commit event (no request context), so it scopes by company explicitly.
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
}
