/**
 * How a photograph was taken (#385): the six facts the export may carry for it, as `meta` entries with fixed labels (the contract is unchanged: label max 40, value max 200, at most 10 facts). `Camera` and
 * `Lens` are the core; the four others are optional per photograph. They are shown as an exposure line under the title (`35 mm · f/2.8 · 1/250 s · ISO 200`) with the camera and the lens on a line of their own,
 * on the entry page and in the panel, never on the wall; a value that is missing is skipped (no dashes), and a photograph with none shows nothing. Pure.
 */
import type { PublishedMetaEntry } from "@catalyst/schemas";

export const EXPOSURE_LABELS = ["Camera", "Lens", "Focal length", "Aperture", "Shutter", "ISO"] as const;
export type ExposureLabel = (typeof EXPOSURE_LABELS)[number];

export interface Exposure {
  /** The camera and the lens, in that order, each only when known. */
  gear: string[];
  /** Focal length, aperture, shutter and ISO as they are said, in that order, each only when known. */
  settings: string[];
}

const LOWER = new Map(EXPOSURE_LABELS.map((l) => [l.toLowerCase(), l] as const));

/** A number said without a trailing zero: 2.80 is 2.8, 35.0 is 35. */
const tidy = (n: string): string => String(Number(n));

/** The focal length: a bare number is millimetres (`35` and `35.0 mm` say `35 mm`). */
function focal(v: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*(?:mm)?$/i.exec(v);
  return m ? `${tidy(m[1]!)} mm` : v;
}

/** The aperture: `2.8`, `f2.8`, `F/2.8` and `f/2.80` say `f/2.8`. */
function aperture(v: string): string {
  const m = /^f?\s*\/?\s*(\d+(?:\.\d+)?)$/i.exec(v);
  return m ? `f/${tidy(m[1]!)}` : v;
}

/** The shutter speed: `1/250` and `1/250s` say `1/250 s`; `0.5` and `2` are seconds; `2"` too. */
function shutter(v: string): string {
  const m = /^(\d+(?:[./]\d+)?)\s*(?:s|sec|")?$/i.exec(v);
  return m ? `${m[1]} s` : v;
}

/** The sensitivity: `200` says `ISO 200`. */
function iso(v: string): string {
  const m = /^(?:iso\s*)?(\d+)$/i.exec(v);
  return m ? `ISO ${m[1]}` : v;
}

/**
 * The exposure facts of an entry's `meta`, and the rest: the same list without them (they are not shown a second time in the facts block). `exposure` is null when the entry has none, so a photograph with none
 * shows nothing. The labels are matched without regard to case; the first of a label wins.
 */
export function splitExposure(meta: readonly PublishedMetaEntry[]): { exposure: Exposure | null; rest: PublishedMetaEntry[] } {
  const found = new Map<ExposureLabel, string>();
  const rest: PublishedMetaEntry[] = [];
  for (const m of meta) {
    const label = LOWER.get(m.label.trim().toLowerCase());
    if (!label) {
      rest.push(m);
      continue;
    }
    const value = m.value.trim();
    if (value && !found.has(label)) found.set(label, value);
  }
  const gear = [found.get("Camera"), found.get("Lens")].filter((v): v is string => !!v);
  const f = found.get("Focal length");
  const a = found.get("Aperture");
  const s = found.get("Shutter");
  const i = found.get("ISO");
  const settings = [f && focal(f), a && aperture(a), s && shutter(s), i && iso(i)].filter((v): v is string => !!v);
  return { exposure: gear.length || settings.length ? { gear, settings } : null, rest };
}

/** A setting as it is said (`6.81 mm`, `f/1.85`, `1/120 s`, `ISO 667`) in three parts: what comes before the figure, the figure, what comes after (the page draws the figure in the ink and the rest quiet). No figure: all of it is the figure. */
export function splitFigure(setting: string): { before: string; figure: string; after: string } {
  const m = /^(\D*?)(\d[\d./]*)(.*)$/.exec(setting);
  return m ? { before: m[1]!, figure: m[2]!, after: m[3]! } : { before: "", figure: setting, after: "" };
}
