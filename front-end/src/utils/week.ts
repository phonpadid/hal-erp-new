/**
 * Monday–Sunday of the week containing `anchor` (`weeksBack` weeks earlier), in the browser's
 * calendar. The pending summary's week presets: the client only ever sends day strings, and the
 * server is what turns a day into an instant in the company's timezone.
 */
export function weekOf(anchor: Date, weeksBack = 0): [Date, Date] {
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = (monday.getDay() + 6) % 7; // Monday = 0
  monday.setDate(monday.getDate() - dow - weeksBack * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [monday, sunday];
}

/** A local calendar day as `YYYY-MM-DD`. */
export function toDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
