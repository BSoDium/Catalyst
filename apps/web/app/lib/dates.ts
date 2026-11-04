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

/**
 * An entry's partial ISO date in the stamp style of the annotation language: `2024-04-02` -> `2024.04.02`, `2024-04` -> `2024.04`,
 * `2024` -> `2024`. Only the separator changes: nothing is padded, completed or invented. Anything that is not a partial ISO date gives null.
 */
export function formatEntryDate(date: string | undefined): FormattedDates | null {
  if (!date || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date)) return null;
  return { text: date.replaceAll("-", "."), dateTime: date };
}

/** A run of a date's text, `strong` for the part that is the point of it. */
export interface DatePart {
  text: string;
  strong: boolean;
}

/**
 * The two ends of a range of partial ISO dates (`2024-09`, `2025-06`) cut so that what CHANGED between them is marked: the years when the years differ, else the months, else the days
 * (the first component that differs, in both ends); the rest is quiet. Null when an end is not a partial ISO date or the ends are the same.
 */
export function changedParts(start: string, end: string): { from: DatePart[]; to: DatePart[] } | null {
  const iso = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
  if (!iso.test(start) || !iso.test(end) || start === end) return null;
  const a = start.split("-");
  const b = end.split("-");
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first++;
  const cut = (parts: string[]): DatePart[] =>
    parts.flatMap((text, i) => [...(i > 0 ? [{ text: "-", strong: false }] : []), { text, strong: i === first }]);
  return { from: cut(a), to: cut(b) };
}
