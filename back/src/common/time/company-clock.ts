/**
 * Which calendar day an instant fell on, in a company's own timezone.
 *
 * The whole attendance module turns on this being computed once, at capture, and stored — see
 * `AttendanceEvent.localDate`. Deriving it at read time would mean that correcting a company's
 * `timezone` silently moved every punch near a midnight boundary onto a different day, taking
 * every lateness and absence figure already reported with it.
 *
 * `en-CA` is used because its short date format is already ISO (`YYYY-MM-DD`), so the parts come
 * out in the order we want without reassembling them by hand. The runtime's own tz database does
 * the work, so DST and future tzdata corrections are handled without a dependency.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    // Constructing one of these is not cheap and a punch endpoint calls it on every request;
    // they are immutable and keyed by zone, so caching is safe for the process's lifetime.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/**
 * The `YYYY-MM-DD` calendar day `instant` falls on in `timezone`.
 *
 * At UTC+7 an instant of 23:30 UTC is 06:30 the next morning locally, and therefore belongs to
 * the next day — which is exactly the case that makes a night shift or an early start land on the
 * wrong date if this is skipped.
 */
export function localDateIn(instant: Date, timezone: string): string {
  return formatterFor(timezone).format(instant);
}

/**
 * The instant of local midnight starting `date` in `timezone` — the origin every minute offset in
 * the attendance computation is measured from.
 *
 * Derived by asking what the zone's offset is at midday on that date, rather than assuming a fixed
 * one: midday is chosen because it is never inside a DST transition, so the offset read there is
 * the day's own.
 */
export function localMidnightInstant(date: string, timezone: string): Date {
  const day = date.slice(0, 10);
  const midday = new Date(`${day}T12:00:00Z`);
  const asUtc = new Date(midday.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asLocal = new Date(midday.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMinutes = Math.round((asLocal.getTime() - asUtc.getTime()) / 60_000);
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMinutes * 60_000);
}
