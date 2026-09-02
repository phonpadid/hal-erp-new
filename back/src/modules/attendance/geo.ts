const EARTH_RADIUS_METRES = 6_371_008.8; // IUGG mean radius

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres between two points, by the haversine formula.
 *
 * Coordinates arrive as the decimal strings they are stored as and are converted to numbers only
 * inside this function; nothing that persists ever becomes a float. A spherical earth is used
 * deliberately: at the scale of a geofence radius the error against an ellipsoidal model is well
 * under a metre, far inside the GPS error the policy exists to tolerate, and it avoids pulling in
 * a dependency to be wrong by less than the measurement noise.
 *
 * Returns a rounded whole number of metres, matching the `int` the column stores.
 */
export function distanceMetres(
  latitude1: string,
  longitude1: string,
  latitude2: string,
  longitude2: string,
): number {
  const lat1 = toRadians(Number(latitude1));
  const lat2 = toRadians(Number(latitude2));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(longitude2) - Number(longitude1));

  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a))));
}
