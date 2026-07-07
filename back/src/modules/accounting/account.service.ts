import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { Account } from './accounting.entities';
import type { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

/**
 * Per-company chart of accounts. Every read/write is company-scoped (invariant 1) via the
 * CompanyScoped `company` filter. This slice manages the master + a resolver other
 * capabilities call; it does not post to any ledger.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateAccountDto): Promise<Account> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    const dup = await em.findOne(Account, { code: dto.code });
    if (dup) throw new BadRequestException(`Account code '${dto.code}' already exists`);

    const parent = dto.parentId
      ? await this.requireValidParent(em, dto.parentId, dto.accountType)
      : undefined;

    const account = em.create(Account, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      accountType: dto.accountType,
      parent,
      isPostable: dto.isPostable ?? true,
      isActive: dto.isActive ?? true,
    });
    await em.persistAndFlush(account);
    return account;
  }

  async update(id: string, dto: UpdateAccountDto): Promise<Account> {
    const em = this.companyScope.forActiveCompany();
    const account = await this.getScoped(em, id);

    const nextType = dto.accountType ?? account.accountType;
    if (dto.name !== undefined) account.name = dto.name;
    if (dto.accountType !== undefined) account.accountType = dto.accountType;
    if (dto.isPostable !== undefined) account.isPostable = dto.isPostable;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;

    if (dto.parentId !== undefined) {
      account.parent = dto.parentId
        ? await this.requireValidParent(em, dto.parentId, nextType, account.id)
        : undefined;
    } else if (dto.accountType !== undefined && account.parent) {
      // Type changed but parent kept: re-validate the (unchanged) parent against the new type.
      await this.requireValidParent(em, account.parent.id, nextType, account.id);
    }

    await em.flush();
    return account;
  }

  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<Account>> {
    const em = this.companyScope.forActiveCompany();
    const where = includeInactive ? {} : { isActive: true };
    return paginate(em, Account, where, { populate: ['parent'], orderBy: { code: 'ASC' } }, q);
  }

  async get(id: string): Promise<Account> {
    return this.getScoped(this.companyScope.forActiveCompany(), id);
  }

  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const account = await this.getScoped(em, id);
    account.isActive = false;
    await em.flush();
  }

  /** Active, postable accounts for the budget-form GL picker (active company only). */
  async listSelectable(): Promise<Array<{ id: string; code: string; name: string }>> {
    const em = this.companyScope.forActiveCompany();
    const rows = await em.find(
      Account,
      { isActive: true, isPostable: true },
      { fields: ['id', 'code', 'name'], orderBy: { code: 'ASC' } },
    );
    return rows.map((a) => ({ id: a.id, code: a.code, name: a.name }));
  }

  /**
   * Shared resolver (invariant: GL codes must reference a real account). Returns the
   * active, postable account for `code` in the given company, or throws a 400 naming the
   * code when it is missing / inactive / non-postable / in another company.
   */
  async resolvePostable(code: string, companyId = RequestContext.companyId()): Promise<Account> {
    const em = this.companyScope.forActiveCompany(companyId);
    const account = await em.findOne(Account, { code });
    if (!account) throw new BadRequestException(`Unknown GL account '${code}'`);
    if (!account.isActive) throw new BadRequestException(`GL account '${code}' is inactive`);
    if (!account.isPostable) throw new BadRequestException(`GL account '${code}' is not postable`);
    return account;
  }

  // --- internals -------------------------------------------------------------

  private async getScoped(em: EntityManager, id: string): Promise<Account> {
    const account = await em.findOne(Account, { id }, { populate: ['parent'] });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  /**
   * A parent MUST be in the same company (enforced by the company filter on the fork),
   * share the child's account_type, and not create a cycle.
   */
  private async requireValidParent(
    em: EntityManager,
    parentId: string,
    childType: string,
    selfId?: string,
  ): Promise<Account> {
    if (selfId && parentId === selfId) {
      throw new BadRequestException('An account cannot be its own parent');
    }
    const parent = await em.findOne(Account, { id: parentId });
    if (!parent) throw new BadRequestException(`Parent account ${parentId} not found in this company`);
    if (parent.accountType !== childType) {
      throw new BadRequestException('Parent account must have the same account type');
    }
    // Walk up the ancestry; reaching selfId means the move would create a cycle.
    if (selfId) {
      let cursor: Account | undefined = parent;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor.id === selfId) throw new BadRequestException('Account hierarchy cannot contain a cycle');
        if (seen.has(cursor.id)) break;
        seen.add(cursor.id);
        cursor = cursor.parent ? await em.findOne(Account, { id: cursor.parent.id }) ?? undefined : undefined;
      }
    }
    return parent;
  }
}
