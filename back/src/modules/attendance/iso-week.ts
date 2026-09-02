const MS_PER_DAY = 86_400_000;

/**
 * The Monday-to-Sunday range containing a date.
 *
 * The statutory overtime ceiling is weekly, so a claim has to be checked against every week it
 * touches — and "the week" has to mean the same thing at a year boundary as anywhere else. ISO
 * weeks run Monday to Sunday and belong to whichever year holds their Thursday, which is why week
 * 1 of a year routinely begins in the previous December. Computing the range from the date's own
 * weekday rather than from a week number sidesteps that numbering entirely: the boundary is a pair
 * of dates, and dates do not disagree about which year they are in.
 *
 * Parsed as UTC deliberately. The input is already a calendar date in the company's own zone, so
 * re-reading it in the server's local zone would shift it by a day for servers west of the company.
 */
export function isoWeekRange(date: string): { from: string; to: string } {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay(); // 1 = Monday ... 7 = Sunday
  const monday = new Date(day.getTime() - (weekday - 1) * MS_PER_DAY);
  const sunday = new Date(monday.getTime() + 6 * MS_PER_DAY);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/**
 * Every distinct ISO week touched by a date range, as Monday-to-Sunday spans in order.
 *
 * A claim crossing a boundary belongs to two weeks and must satisfy the ceiling in BOTH — treating
 * such a claim as one week is the off-by-one this exists to prevent.
 */
export function isoWeeksBetween(from: string, to: string): Array<{ from: string; to: string }> {
  const weeks: Array<{ from: string; to: string }> = [];
  let cursor = isoWeekRange(from);
  const last = to.slice(0, 10);
  while (cursor.from <= last) {
    weeks.push(cursor);
    const nextMonday = new Date(`${cursor.from}T00:00:00Z`).getTime() + 7 * MS_PER_DAY;
    cursor = isoWeekRange(new Date(nextMonday).toISOString().slice(0, 10));
  }
  return weeks;
}
