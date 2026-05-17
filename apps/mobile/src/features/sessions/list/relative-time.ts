/**
 * sessions/list slice helper. Pure, dependency-free relative-time formatter for
 * `Session.updatedAt` / `createdAt` (epoch **milliseconds** per the vendored
 * protocol). Native-iOS phrasing: "Just now", "5m ago", "3h ago", "Yesterday",
 * weekday within the last week, then a short calendar date.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Compact relative label suitable for a list trailing slot.
 * @param epochMs timestamp in milliseconds
 * @param now reference time (injectable for tests; defaults to Date.now())
 */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(epochMs)) return '';
  const diff = now - epochMs;

  // Clock skew / future timestamps: treat as just now rather than "-3m".
  if (diff < 0) return 'Just now';
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;

  const d = new Date(epochMs);
  if (diff < 2 * DAY) return 'Yesterday';
  if (diff < 7 * DAY) return WEEKDAYS[d.getDay()];

  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return sameYear ? base : `${base}, ${d.getFullYear()}`;
}

/** Longer accessibility phrasing ("Updated 5m ago"). */
export function describeUpdated(epochMs: number, now: number = Date.now()): string {
  const rel = formatRelative(epochMs, now);
  return rel ? `Updated ${rel.toLowerCase()}` : 'Update time unknown';
}
