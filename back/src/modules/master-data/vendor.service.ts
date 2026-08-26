import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { paginate, type Paginated, type PaginationQueryDto, withSearch, SearchablePaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ScopeService } from '../rbac/scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { Vendor, VendorBankAccount, VendorCompany } from './master-data.entities';
import { MasterDataPermissions } from './permissions';
import type { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

/**
 * Group-wide vendor registry + per-company enablement. The `vendor` table is
 * group-wide (permission-gated only); `vendor_company` is company-scoped — a vendor
 * is usable in a company only once enabled there (master-data: Per-Company Enablement).
 */
@Injectable()
export class VendorService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly scope: ScopeService,
  ) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ---- Group registry --------------------------------------------------------

  async create(dto: CreateVendorDto): Promise<Vendor> {
    const vendor = this.em.create(Vendor, {
      vendorCode: dto.vendorCode,
      name: dto.name,
      taxId: dto.taxId,
      address: dto.address,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      paymentTermDays: dto.paymentTermDays ?? 30,
      isActive: true,
    });
    await this.em.persistAndFlush(vendor);
    return vendor;
  }

  async update(id: string, dto: UpdateVendorDto): Promise<Vendor> {
    const vendor = await this.get(id);
    if (dto.name !== undefined) vendor.name = dto.name;
    if (dto.taxId !== undefined) vendor.taxId = dto.taxId;
    if (dto.address !== undefined) vendor.address = dto.address;
    if (dto.contactName !== undefined) vendor.contactName = dto.contactName;
    if (dto.contactPhone !== undefined) vendor.contactPhone = dto.contactPhone;
    if (dto.paymentTermDays !== undefined) vendor.paymentTermDays = dto.paymentTermDays;
    if (dto.isActive !== undefined) vendor.isActive = dto.isActive;
    await this.em.flush();
    return vendor;
  }

  /**
   * The group vendor registry, one page at a time.
   *
   * Each row is annotated with whether the vendor has any ACTIVE bank account. A vendor without one
   * cannot have a `requires_payee` document (a disbursement) submitted against it at all, and the
   * registry is where someone goes looking for the reason — so the answer belongs on the row rather
   * than behind a click.
   *
   * Counted here, in one query for the whole page, rather than left to the client to ask per row:
   * a 20-row page would otherwise cost 20 extra round trips to render one badge. `hasBankAccount`
   * is advisory and not persisted (`persist: false` on the entity, so no flush writes it) — but it
   * IS declared there, because the serializer drops anything it does not know about.
   */
  async list(q: SearchablePaginationQueryDto, includeInactive = false): Promise<Paginated<Vendor>> {
    const where = includeInactive ? {} : { isActive: true };
    const page = await paginate(this.em, Vendor, withSearch<Vendor>(where, q.search, ['vendorCode', 'name']), {}, q);
    if (page.items.length === 0) return page;

    const accounts = await this.em.find(
      VendorBankAccount,
      { vendor: { $in: page.items.map((v) => v.id) }, isActive: true },
      { fields: ['vendor'] },
    );
    const withAccount = new Set(accounts.map((a) => a.vendor.id));
    for (const vendor of page.items) vendor.hasBankAccount = withAccount.has(vendor.id);
    return page;
  }

  async get(id: string): Promise<Vendor> {
    const vendor = await this.em.findOne(Vendor, { id });
    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  async deactivate(id: string): Promise<void> {
    const vendor = await this.get(id);
    vendor.isActive = false;
    await this.em.flush();
  }

  // ---- Per-company enablement (company-scoped) -------------------------------

  /**
   * Enable a group vendor for the active company (upsert + activate, stamp approved). An
   * optional `paymentTermDays` overrides the group vendor's terms for this company; passing
   * `null`/undefined leaves the override untouched on re-enable.
   */
  async enableForCompany(vendorId: string, paymentTermDays?: number): Promise<VendorCompany> {
    const companyId = RequestContext.companyId()!;
    await this.get(vendorId); // vendor must exist group-wide
    const em = this.companyScope.forActiveCompany(companyId);

    let vc = await em.findOne(VendorCompany, { vendor: vendorId });
    if (vc) {
      vc.isActive = true;
      if (!vc.approvedDate) vc.approvedDate = this.today();
      if (paymentTermDays !== undefined) vc.paymentTermDays = paymentTermDays;
    } else {
      vc = em.create(VendorCompany, {
        vendor: em.getReference(Vendor, vendorId),
        company: em.getReference(Company, companyId),
        isActive: true,
        approvedDate: this.today(),
        paymentTermDays,
      });
    }
    await em.flush();
    return vc;
  }

  /** Disable a vendor for the active company (soft — keeps the approval stamp). */
  async disableForCompany(vendorId: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const vc = await em.findOne(VendorCompany, { vendor: vendorId });
    if (!vc) throw new NotFoundException(`Vendor ${vendorId} is not enabled for this company`);
    vc.isActive = false;
    await em.flush();
  }

  /**
   * Vendors enabled for the active company, flattened to the vendor master — the shape both
   * consumers expect (the document vendor picker keys on id/name; the master-data enabled
   * toggle keys on the vendor id). GROUP scope → read-only across companies, deduped by vendor
   * since the same vendor may be enabled in several companies.
   */
  async listEnabled(): Promise<Vendor[]> {
    const code = MasterDataPermissions.MASTER_VIEW;
    const isGroup = this.scope.isGroup(code);
    const rows = isGroup
      ? await this.companyScope
          .forGroupRead()
          .find(VendorCompany, { isActive: true }, { filters: { company: false }, populate: ['vendor'] })
      : await this.companyScope
          .forActiveCompany()
          .find(VendorCompany, { isActive: true }, { populate: ['vendor'] });
    const byId = new Map<string, Vendor>();
    for (const vc of rows) {
      // Overlay the per-company effective payment terms (override ?? group) onto the returned
      // vendor for the active-company read — an advisory value, not persisted (no flush). The
      // group read spans companies, so its per-company override is ambiguous: keep the group value.
      if (!isGroup && vc.paymentTermDays != null) vc.vendor.paymentTermDays = vc.paymentTermDays;
      byId.set(vc.vendor.id, vc.vendor);
    }
    return [...byId.values()];
  }

  /**
   * Guard for document-engine: the vendor must be active group-wide AND enabled
   * (active) for the company. Rejects otherwise.
   */
  async assertVendorEnabled(vendorId: string, companyId?: string): Promise<void> {
    const vendor = await this.em.findOne(Vendor, { id: vendorId, isActive: true });
    if (!vendor) {
      throw new BadRequestException(`Vendor ${vendorId} is inactive or unknown`);
    }
    const em = this.companyScope.forActiveCompany(companyId);
    const vc = await em.findOne(VendorCompany, { vendor: vendorId, isActive: true });
    if (!vc) {
      throw new BadRequestException(`Vendor ${vendorId} is not enabled for this company`);
    }
  }
}
