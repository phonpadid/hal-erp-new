import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppUser } from '../rbac/rbac.entities';
import { Currency } from '../currency/currency.entities';
import { Vendor, VendorBankAccount, VendorBankAccountLog } from './master-data.entities';
import type {
  CreateVendorBankAccountDto,
  UpdateVendorBankAccountDto,
} from './dto/vendor-bank-account.dto';

/** The fields worth reconstructing an edit-pay-revert from. */
interface AccountSnapshot {
  bankCode: string;
  accountNo: string;
  accountName: string;
}

/** One recorded change, as the client reads it. */
export interface AccountHistoryEntry {
  id: string;
  action: string;
  actor: { id: string; username: string };
  actedAt?: Date;
  before: AccountSnapshot | null;
  after: AccountSnapshot | null;
}

/**
 * A vendor's payee bank accounts. A vendor may hold several; at most one active account is primary.
 *
 * Hangs off the group-level `Vendor`, so accounts are readable in every company of the group — a
 * GROUP-scope read under invariant 1, no wider than the vendor's own name or tax id, and never a
 * cross-company write. Writes are gated by `VENDOR_BANK_MANAGE` at the controller, separately from
 * `MASTER_MANAGE`, and every mutation is logged: the table is not append-only, so without the log
 * an attacker could point an account at themselves, wait for the run, and point it back leaving
 * nothing behind.
 */
@Injectable()
export class VendorBankAccountService {
  constructor(private readonly em: EntityManager) {}

  private snapshot(a: VendorBankAccount): AccountSnapshot {
    return { bankCode: a.bankCode, accountNo: a.accountNo, accountName: a.accountName };
  }

  /**
   * Record who changed what. Written in the same transaction as the change itself, so a mutation
   * can never commit unlogged.
   */
  private log(
    em: EntityManager,
    account: VendorBankAccount,
    action: string,
    before: AccountSnapshot | null,
    after: AccountSnapshot | null,
  ): void {
    em.create(VendorBankAccountLog, {
      vendorBankAccount: account,
      actor: em.getReference(AppUser, RequestContext.userId()!),
      action,
      beforeJson: before ? JSON.stringify(before) : undefined,
      afterJson: after ? JSON.stringify(after) : undefined,
      actedAt: new Date(),
    });
  }

  /** Demote whatever else is primary for this vendor, so at most one ever is. */
  private async demoteOtherPrimaries(
    em: EntityManager,
    vendorId: string,
    keepId?: string,
  ): Promise<void> {
    const others = await em.find(VendorBankAccount, { vendor: vendorId, isPrimary: true });
    for (const other of others) {
      if (other.id === keepId) continue;
      other.isPrimary = false;
      other.updatedAt = new Date();
    }
  }

  /** A currency by its ISO code (the table's own primary key), or reject. */
  private async requireCurrency(em: EntityManager, code: string): Promise<Currency> {
    const currency = await em.findOne(Currency, { code: code.toUpperCase() });
    if (!currency) throw new NotFoundException(`Currency '${code}' not found`);
    return currency;
  }

  private async requireVendor(em: EntityManager, vendorId: string): Promise<Vendor> {
    const vendor = await em.findOne(Vendor, { id: vendorId });
    if (!vendor) throw new NotFoundException(`Vendor ${vendorId} not found`);
    return vendor;
  }

  /** An account of this vendor, or reject. */
  private async requireAccount(em: EntityManager, id: string): Promise<VendorBankAccount> {
    const account = await em.findOne(VendorBankAccount, { id }, { populate: ['vendor'] });
    if (!account) throw new NotFoundException(`Vendor bank account ${id} not found`);
    return account;
  }

  /**
   * A vendor's accounts. Inactive ones are included — a document or an exported batch that names
   * one must stay legible — so callers choosing a payee filter to `isActive` themselves.
   */
  async list(vendorId: string): Promise<VendorBankAccount[]> {
    await this.requireVendor(this.em, vendorId);
    // `currency` is deliberately NOT populated: its primary key IS the ISO code, so the relation
    // serializes as the code the write DTO already takes. Populating it emitted the whole Currency
    // entity, which the client then rendered as raw JSON.
    return this.em.find(
      VendorBankAccount,
      { vendor: vendorId },
      { orderBy: { isPrimary: 'DESC', accountNo: 'ASC' } },
    );
  }

  /**
   * An account's recorded changes, newest first.
   *
   * The log rows have existed since the accounts did; without this read they were written and never
   * seen, which makes the log a deterrent only in theory — an edit-pay-revert would be legible only
   * to someone querying the database directly, long after the money moved.
   *
   * Parsed here rather than handed over as raw JSON strings: the server knows the shape, so making
   * every client re-parse it invites two readers that disagree.
   */
  async history(id: string): Promise<AccountHistoryEntry[]> {
    await this.requireAccount(this.em, id);
    const rows = await this.em.find(
      VendorBankAccountLog,
      { vendorBankAccount: id },
      { populate: ['actor'], orderBy: { actedAt: 'DESC' } },
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: { id: r.actor.id, username: r.actor.username },
      actedAt: r.actedAt,
      before: r.beforeJson ? (JSON.parse(r.beforeJson) as AccountSnapshot) : null,
      after: r.afterJson ? (JSON.parse(r.afterJson) as AccountSnapshot) : null,
    }));
  }

  /**
   * Add an account. The first account of a vendor becomes primary automatically — a vendor with
   * accounts but no primary would make every payee default to nothing.
   */
  async create(vendorId: string, dto: CreateVendorBankAccountDto): Promise<VendorBankAccount> {
    return this.em.transactional(async (tem) => {
      const vendor = await this.requireVendor(tem, vendorId);

      const existing = await tem.count(VendorBankAccount, { vendor: vendorId });
      const isPrimary = dto.isPrimary ?? existing === 0;
      if (isPrimary) await this.demoteOtherPrimaries(tem, vendorId);

      const account = tem.create(VendorBankAccount, {
        vendor,
        bankCode: dto.bankCode,
        accountNo: dto.accountNo,
        accountName: dto.accountName,
        currency: dto.currency ? await this.requireCurrency(tem, dto.currency) : undefined,
        isPrimary,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      this.log(tem, account, 'CREATE', null, this.snapshot(account));

      try {
        await tem.flush();
      } catch (e) {
        // Lost the unique race with a concurrent add — still a 409, not an opaque 500.
        if (e instanceof UniqueConstraintViolationException) {
          throw new ConflictException(
            `Vendor already has account ${dto.accountNo} at bank ${dto.bankCode}`,
          );
        }
        throw e;
      }
      return account;
    });
  }

  /** Edit an account's bank details. The vendor it belongs to is immutable. */
  async update(id: string, dto: UpdateVendorBankAccountDto): Promise<VendorBankAccount> {
    return this.em.transactional(async (tem) => {
      const account = await this.requireAccount(tem, id);
      const before = this.snapshot(account);

      if (dto.bankCode !== undefined) account.bankCode = dto.bankCode;
      if (dto.accountNo !== undefined) account.accountNo = dto.accountNo;
      if (dto.accountName !== undefined) account.accountName = dto.accountName;
      if (dto.currency !== undefined) {
        account.currency = dto.currency ? await this.requireCurrency(tem, dto.currency) : undefined;
      }
      account.updatedAt = new Date();
      this.log(tem, account, 'UPDATE', before, this.snapshot(account));

      try {
        await tem.flush();
      } catch (e) {
        if (e instanceof UniqueConstraintViolationException) {
          throw new ConflictException(
            `Vendor already has account ${account.accountNo} at bank ${account.bankCode}`,
          );
        }
        throw e;
      }
      return account;
    });
  }

  /**
   * Make this account the vendor's primary, demoting the previous one in the same transaction so
   * two accounts are never both primary, even momentarily.
   */
  async setPrimary(id: string): Promise<VendorBankAccount> {
    return this.em.transactional(async (tem) => {
      const account = await this.requireAccount(tem, id);
      if (!account.isActive) {
        throw new ConflictException('An inactive account cannot be made primary');
      }
      await this.demoteOtherPrimaries(tem, account.vendor.id, account.id);
      account.isPrimary = true;
      account.updatedAt = new Date();
      this.log(tem, account, 'SET_PRIMARY', null, this.snapshot(account));
      await tem.flush();
      return account;
    });
  }

  /**
   * Retire an account. Documents that already reference it are untouched — the account stays
   * readable so their payee is still legible; it just cannot be chosen again.
   */
  async deactivate(id: string): Promise<VendorBankAccount> {
    return this.em.transactional(async (tem) => {
      const account = await this.requireAccount(tem, id);
      account.isActive = false;
      // A retired account must not stay primary, or it would keep being the default payee.
      account.isPrimary = false;
      account.updatedAt = new Date();
      this.log(tem, account, 'DEACTIVATE', this.snapshot(account), null);
      await tem.flush();
      return account;
    });
  }
}
