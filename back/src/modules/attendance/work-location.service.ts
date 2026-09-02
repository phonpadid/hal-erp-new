import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ControlPolicy } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Company } from '../multi-company/multi-company.entities';
import { WorkLocation } from './attendance.entities';
import type { CreateWorkLocationDto, UpdateWorkLocationDto } from './dto/work-location.dto';

/**
 * Per-company geofence master. Nothing enforces these yet — the capture slice does — but the
 * policy is declared here so that slice has configured targets on the day it lands.
 *
 * Coordinates stay decimal strings end to end. A geofence decision is a comparison of distances,
 * exactly the kind of arithmetic that should not inherit binary floating-point rounding, and it
 * matches the project rule that no value of consequence rides on a JS number.
 */
@Injectable()
export class WorkLocationService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async create(dto: CreateWorkLocationDto): Promise<WorkLocation> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const dup = await em.findOne(WorkLocation, { code: dto.code });
    if (dup) throw new BadRequestException(`Work location '${dto.code}' already exists`);

    assertCoordinates(dto.latitude, dto.longitude);
    const location = em.create(WorkLocation, {
      company: em.getReference(Company, companyId),
      code: dto.code,
      name: dto.name,
      latitude: dto.latitude,
      longitude: dto.longitude,
      radiusMeters: dto.radiusMeters,
      controlPolicy: dto.controlPolicy ?? ControlPolicy.SOFT_WARNING,
      isActive: dto.isActive ?? true,
    });
    await em.persistAndFlush(location);
    return location;
  }

  async update(id: string, dto: UpdateWorkLocationDto): Promise<WorkLocation> {
    const em = this.companyScope.forActiveCompany();
    const location = await this.getScoped(em, id);
    const latitude = dto.latitude ?? location.latitude;
    const longitude = dto.longitude ?? location.longitude;
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      assertCoordinates(latitude, longitude);
      location.latitude = latitude;
      location.longitude = longitude;
    }
    if (dto.name !== undefined) location.name = dto.name;
    if (dto.radiusMeters !== undefined) location.radiusMeters = dto.radiusMeters;
    if (dto.controlPolicy !== undefined) location.controlPolicy = dto.controlPolicy;
    if (dto.isActive !== undefined) location.isActive = dto.isActive;
    await em.flush();
    return location;
  }

  list(q: PaginationQueryDto = {}, includeInactive = false): Promise<Paginated<WorkLocation>> {
    const em = this.companyScope.forActiveCompany();
    const where = includeInactive ? {} : { isActive: true };
    return paginate(em, WorkLocation, where, { orderBy: { code: 'ASC' } }, q);
  }

  get(id: string): Promise<WorkLocation> {
    return this.getScoped(this.companyScope.forActiveCompany(), id);
  }

  /** Soft-delete, so a location referenced by past capture stays resolvable. */
  async deactivate(id: string): Promise<void> {
    const em = this.companyScope.forActiveCompany();
    const location = await this.getScoped(em, id);
    location.isActive = false;
    await em.flush();
  }

  private async getScoped(em: EntityManager, id: string): Promise<WorkLocation> {
    const location = await em.findOne(WorkLocation, { id });
    if (!location) throw new NotFoundException(`Work location ${id} not found`);
    return location;
  }
}

/**
 * Range-check coordinates without going through a float. `Number` here is a bounds test on a
 * validated decimal string, not the stored value — what persists is the string itself.
 */
function assertCoordinates(latitude: string, longitude: string): void {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new BadRequestException('latitude must be between -90 and 90');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new BadRequestException('longitude must be between -180 and 180');
  }
}
