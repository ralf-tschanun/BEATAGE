/**
 * Device-local datetime helpers for <input type="datetime-local">.
 * Wall-clock values must be converted to absolute ISO before sending to Postgres
 * timestamptz (which otherwise treats bare timestamps as UTC on Supabase).
 */

/** Convert datetime-local value (admin device local time) to UTC ISO for timestamptz. */
export function datetimeLocalToIso(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Without a zone, browsers parse this as local wall time.
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

/** Convert stored ISO / timestamptz back to datetime-local in device local time. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
