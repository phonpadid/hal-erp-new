import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { Scope } from '../../common/enums';
import { StorageService } from '../../common/storage/storage.service';
import {
  PROFILE_IMAGE_MAX_SIZE_KB,
  PROFILE_IMAGE_MIME_ALLOWLIST,
} from '../../common/storage/image-upload.dto';
import { validateUpload, type UploadedFile } from '../../common/storage/upload';
import { Currency } from '../currency/currency.entities';
import { AppUser, Permission, Role, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { ReportingPermissions } from '../reporting/permissions';
import { Company, Department } from './multi-company.entities';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

/** A company row as returned by the list endpoint: plain fields plus a short-lived logo URL. */
export interface CompanyListItem {
  id: string;
  code: string;
  nameTh: string;
  nameEn?: string;
  taxId?: string;
  branchCode: string;
  baseCurrency: { code: string } | null;
  isActive: boolean;
  profileImageUrl: string | null;
}

/**
 * Company registry. `company` is the root entity (not company-scoped), so access
 * is gated by permission code only. Companies are deactivated, never deleted, so
 * referencing records stay intact.
 */
@Injectable()
export class CompanyService {
  constructor(
    private readonly em: EntityManager,
    private readonly storage: StorageService,
  ) {}

  /** Resolve a currency code to an ACTIVE currency, else reject (spec: base currency must be active). */
  private async resolveActiveCurrency(code: string): Promise<Currency> {
    const currency = await this.em.findOne(Currency, { code, isActive: true });
    if (!currency) {
      throw new BadRequestException(`Currency '${code}' is not an active currency`);
    }
    return currency;
  }

  /**
   * Create a company and, when a creator is given, bootstrap it so they can immediately
   * switch into and administer it: an ADMIN role holding every active permission, a default
   * department, and the creator's membership. Without this a freshly-created company has no
   * role/department/membership, so `switchCompany` (which needs an active UserCompanyRole)
   * rejects everyone — including the creator — leaving the company unreachable.
   *
   * All rows commit in one transaction so a company never persists half-bootstrapped.
   */
  async create(dto: CreateCompanyDto, creatorUserId?: string): Promise<Company> {
    return this.em.transactional(async (em) => {
      const baseCurrency = await em.findOne(Currency, { code: dto.baseCurrency, isActive: true });
      if (!baseCurrency) {
        throw new BadRequestException(`Currency '${dto.baseCurrency}' is not an active currency`);
      }
      const company = em.create(Company, {
        code: dto.code,
        nameTh: dto.nameTh,
        nameEn: dto.nameEn,
        taxId: dto.taxId,
        branchCode: dto.branchCode,
        baseCurrency,
        // Letterhead contact block (optional) — stamped at creation, editable later.
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        website: dto.website,
        isActive: true,
        createdAt: new Date(),
      });
      em.persist(company);

      // ADMIN role granted every active permission (authorize on codes, invariant 5).
      const adminRole = em.create(Role, { company, code: 'ADMIN', name: 'Administrator', isActive: true });
      em.persist(adminRole);
      const permissions = await em.find(Permission, { isActive: true });
      for (const permission of permissions) {
        // Group-consolidated reporting is meaningful only at GROUP scope; the rest is COMPANY-wide.
        const scope =
          permission.code === ReportingPermissions.REPORT_GROUP_VIEW ? Scope.GROUP : Scope.COMPANY;
        em.persist(em.create(RolePermission, { role: adminRole, permission, scope }));
      }

      // A default department so the membership (and later employees) have somewhere to live.
      const department = em.create(Department, { company, deptCode: 'HQ', name: 'Head Office', isActive: true });
      em.persist(department);

      // The creator's membership — the row switchCompany resolves. Skipped only in tests
      // that create companies without an authenticated user.
      if (creatorUserId) {
        em.persist(
          em.create(UserCompanyRole, {
            user: em.getReference(AppUser, creatorUserId),
            company,
            department,
            role: adminRole,
            isDefault: false,
          }),
        );
      }

      return company;
    });
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.get(id);
    if (dto.baseCurrency) {
      company.baseCurrency = await this.resolveActiveCurrency(dto.baseCurrency);
    }
    if (dto.nameTh !== undefined) company.nameTh = dto.nameTh;
    if (dto.nameEn !== undefined) company.nameEn = dto.nameEn;
    // '' clears the tax ID (column is nullable); any other value is stored as given.
    if (dto.taxId !== undefined) company.taxId = dto.taxId === '' ? undefined : dto.taxId;
    if (dto.branchCode !== undefined) company.branchCode = dto.branchCode;
    if (dto.isActive !== undefined) company.isActive = dto.isActive;
    // Letterhead contact block — '' clears the value (columns are nullable).
    if (dto.address !== undefined) company.address = dto.address === '' ? undefined : dto.address;
    if (dto.phone !== undefined) company.phone = dto.phone === '' ? undefined : dto.phone;
    if (dto.email !== undefined) company.email = dto.email === '' ? undefined : dto.email;
    if (dto.website !== undefined) company.website = dto.website === '' ? undefined : dto.website;
    await this.em.flush();
    return company;
  }

  /**
   * Default list omits deactivated companies unless includeInactive is set. Each row is
   * enriched with a short-lived `profileImageUrl` (or null) so the UI can render logos
   * without a follow-up request per company.
   */
  async list(
    q: PaginationQueryDto,
    includeInactive = false,
  ): Promise<Paginated<CompanyListItem>> {
    const where = includeInactive ? {} : { isActive: true };
    const page = await paginate(this.em, Company, where, { populate: ['baseCurrency'] }, q);
    const items = await Promise.all(
      page.items.map(async (c) => ({
        id: c.id,
        code: c.code,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        taxId: c.taxId,
        branchCode: c.branchCode,
        baseCurrency: c.baseCurrency ? { code: c.baseCurrency.code } : null,
        isActive: c.isActive,
        profileImageUrl: c.profileImagePath ? await this.storage.presignDownload(c.profileImagePath) : null,
      })),
    );
    return { ...page, items };
  }

  async get(id: string): Promise<Company> {
    const company = await this.em.findOne(Company, { id });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }

  /** Deactivate (soft) — never hard-delete (spec: Company Deactivation). */
  async deactivate(id: string): Promise<void> {
    const company = await this.get(id);
    company.isActive = false;
    await this.em.flush();
  }

  /**
   * Set the company's 1:1 profile image (logo) from an uploaded file. The bytes are validated
   * (image allow-list + size cap) and written to object storage by the backend — the browser
   * never PUTs to the bucket. Only the resulting object key is persisted. Returns a fresh
   * short-lived view URL.
   */
  async uploadProfileImage(id: string, file: UploadedFile): Promise<{ profileImageUrl: string }> {
    const company = await this.get(id); // 404s a non-existent company
    validateUpload(file, PROFILE_IMAGE_MIME_ALLOWLIST, PROFILE_IMAGE_MAX_SIZE_KB);
    const key = this.storage.buildProfileImageKey('company', id, file.originalname);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    company.profileImagePath = key;
    await this.em.flush();
    return { profileImageUrl: await this.storage.presignDownload(key) };
  }

  /** A short-lived view URL for the company's profile image, or null when none is set. */
  async profileImageUrl(id: string): Promise<{ profileImageUrl: string | null }> {
    const company = await this.get(id);
    return {
      profileImageUrl: company.profileImagePath ? await this.storage.presignDownload(company.profileImagePath) : null,
    };
  }
}
