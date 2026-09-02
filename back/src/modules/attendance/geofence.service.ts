import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ControlPolicy, GeofenceStatus } from '../../common/enums';
import { WorkLocation } from './attendance.entities';
import { distanceMetres } from './geo';

/** What measuring a punch against the company's geofences produced. */
export interface GeofenceVerdict {
  workLocation?: WorkLocation;
  distanceMeters?: number;
  status: GeofenceStatus;
}

/**
 * Decides whether a punch was taken where work happens.
 *
 * Judged against the NEAREST active location rather than one the client nominates: a client that
 * chose its own reference could always pick the most permissive fence, and which site you are at
 * is a fact about your coordinates rather than a claim you get to make.
 *
 * `UNKNOWN` is a first-class outcome. A phone indoors may never get a fix, and a company that has
 * configured no locations has expressed no opinion about where work happens — refusing a punch in
 * either case would punish someone for their building. What the system guarantees is that the
 * absence of a fix is recorded as such, so a pattern of it is visible.
 */
@Injectable()
export class GeofenceService {
  /**
   * `locations` are supplied by the caller (already company-scoped and filtered to active) so the
   * bulk path can read them once for a whole crew rather than per employee.
   */
  evaluate(
    latitude: string | undefined,
    longitude: string | undefined,
    locations: WorkLocation[],
  ): GeofenceVerdict {
    if (latitude === undefined || longitude === undefined || locations.length === 0) {
      return { status: GeofenceStatus.UNKNOWN };
    }

    let nearest = locations[0];
    let nearestDistance = distanceMetres(latitude, longitude, nearest.latitude, nearest.longitude);
    for (const location of locations.slice(1)) {
      const distance = distanceMetres(latitude, longitude, location.latitude, location.longitude);
      if (distance < nearestDistance) {
        nearest = location;
        nearestDistance = distance;
      }
    }

    if (nearestDistance <= nearest.radiusMeters) {
      return {
        workLocation: nearest,
        distanceMeters: nearestDistance,
        status: GeofenceStatus.INSIDE,
      };
    }

    if (nearest.controlPolicy === ControlPolicy.HARD_STOP) {
      // Tell them how far off they are: "outside the geofence" is unactionable, a distance is not.
      throw new BadRequestException(
        `Outside '${nearest.name}': ${nearestDistance} m away, limit ${nearest.radiusMeters} m`,
      );
    }

    return {
      workLocation: nearest,
      distanceMeters: nearestDistance,
      status: GeofenceStatus.OUTSIDE,
    };
  }

  /** The active locations of the current company — the set `evaluate` measures against. */
  activeLocations(em: EntityManager): Promise<WorkLocation[]> {
    return em.find(WorkLocation, { isActive: true });
  }
}
