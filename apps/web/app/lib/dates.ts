import type { PublishedDates } from "@catalyst/schemas";

export interface FormattedDates {
  /** Text exactly as authored: the label, or ISO strings joined as written. */
  text: string;
  /** Machine-readable value for `<time dateTime>`, when a single ISO date is available. */
  dateTime?: string;
}

const RANGE_SEPARATOR = "–";

/**
 * Dates are shown as authored, never reformatted or invented:
 * the free-form label wins; otherwise `start–end`, `start`, or `until end`.
 */
export function formatDates(dates: PublishedDates | undefined): FormattedDates | null {
  if (!dates) return null;
  const { label, start, end } = dates;
  const dateTime = start ?? end;
  if (label) return { text: label, dateTime };
  if (start && end) return start === end ? { text: start, dateTime: start } : { text: `${start}${RANGE_SEPARATOR}${end}`, dateTime: start };
  if (start) return { text: start, dateTime: start };
  if (end) return { text: `until ${end}`, dateTime: end };
  return null;
}
