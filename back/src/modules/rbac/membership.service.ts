import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Company } from '../multi-company/multi-company.entities';
import { UserCompanyRole } from './rbac.entities';

export interface AccessibleCompany {
  id: string;
  code: string;
  nameTh: string;
  isDefault: boolean;
}

/**
 * Resolves the companies a user may enter from their active memberships. Closes
 * the multi-company deferral — company listing is filtered to the caller.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly em: EntityManager) {}

  async listForUser(userId: string): Promise<AccessibleCompany[]> {
    const today = new Date().toISOString().slice(0, 10);
    const em = this.em.fork();
    const memberships = await em.find(
      UserCompanyRole,
      {
        user: userId,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: today } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: today } }] },
        ],
      },
      { filters: { company: false }, populate: ['company'] },
    );

    // Distinct by company; a company is "default" if any membership marks it so.
    const byCompany = new Map<string, AccessibleCompany>();
    for (const m of memberships) {
      const c = m.company as Company;
      const existing = byCompany.get(c.id);
      if (existing) {
        existing.isDefault = existing.isDefault || m.isDefault;
      } else {
        byCompany.set(c.id, {
          id: c.id,
          code: c.code,
          nameTh: c.nameTh,
          isDefault: m.isDefault,
        });
      }
    }
    return [...byCompany.values()];
  }
}
