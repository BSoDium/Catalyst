/**
 * DEV ONLY: `/dev/design` is the styleguide of the UI system (docs/design-system.md): every token and component, a scheme
 * toggle, sample entries of the four kinds as cards and as a panel mock, and the loading / empty / error states.
 * It exists only where `routes.ts` includes it (development, or a build made with CATALYST_DEV_ROUTES=1) and answers 404
 * anywhere else, exactly like `/dev/street`. Every sample string below is a made-up placeholder, never real content.
 *
 * Query: `?scheme=light|dark` starts in a forced scheme (default: follow the system).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { data, useSearchParams } from "react-router";
import {
  Button,
  Col,
  CoverArt,
  DataList,
  DataRow,
  Divider,
  EntryCard,
  ExpandToggle,
  Frame,
  Grid,
  ICONS,
  Icon,
  IconButton,
  KeyHint,
  KindTag,
  LogoMark,
  LogoWordmark,
  MetadataStrip,
  MicroLabel,
  SectionHeader,
  SegmentedControl,
  SensitiveMedia,
  Skeleton,
  Stack,
  StatePanel,
  StatusTag,
  TagList,
  Toggle,
  type IconName,
  type IconSize,
} from "~/components/ui";
import { parseColor, contrastRatio, over } from "~/lib/contrast";
import { COVER_PALETTES, COVER_PATTERNS } from "~/lib/cover-art";
import { ENTRY_KINDS, ENTRY_KIND_LABEL, type EntryKind } from "~/lib/entry-kind";
import { deltaE2000, PALETTE_NAMES, PALETTE_STEPS, rgbToHex, simulateCvd, type Cvd, type PaletteName } from "~/lib/palette";
import { formatPlaceCoordinates, formatStamp, STATUSES } from "~/lib/labelling";
import { SITE } from "~/lib/site";
import { cn } from "~/lib/utils";

const enabled = () => import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1";

export function loader() {
  if (!enabled()) throw data("Not found", { status: 404 });
  return null;
}

export function meta() {
  return [{ title: "Design system (dev)" }, { name: "robots", content: "noindex" }];
}

type Scheme = "system" | "light" | "dark";

const SAMPLES: Record<Exclude<EntryKind, "place">, { title: string; summary: string; meta: { label: string; value: string }[]; status?: string }> = {
  article: {
    title: "Notes on a quiet compiler",
    summary: "A sample summary written for the styleguide: two lines of reading text to check the clamp, the contrast and the rhythm of a card.",
    meta: [
      { label: "Date", value: formatStamp("2026-10-08") },
      { label: "Read", value: "6 min read" },
    ],
    status: "published",
  },
  project: {
    title: "Tessera, a tiling toy",
    summary: "A placeholder piece of software: a small program that fills a plane with tiles and lets you break the rules one at a time.",
    meta: [
      { label: "Stack", value: "TypeScript, SVG" },
      { label: "Year", value: "2026" },
    ],
    status: "live",
  },
  artwork: {
    title: "Harbour at low tide, study 3",
    summary: "A made-up artwork entry. Ink on paper, scanned flat; the cover below is generated, not the work itself.",
    meta: [
      { label: "Medium", value: "Ink on paper" },
      { label: "Year", value: "2025" },
    ],
    status: "published",
  },
  poem: {
    title: "Nine lines for no one",
    summary: "A placeholder poem about a light that stays on in a room nobody uses, set in nine short lines.",
    meta: [
      { label: "Lines", value: "9" },
      { label: "Date", value: formatStamp("2026-03-14") },
    ],
    status: "draft",
  },
  photograph: {
    title: "Last light over the ridges",
    summary: "A made-up photograph entry. The picture comes first, the title and the place sit under it.",
    meta: [
      { label: "Format", value: "3:2" },
      { label: "Date", value: formatStamp("2026-03-14") },
    ],
    status: "published",
  },
};

const SAMPLE_COORDS = formatPlaceCoordinates(12.35, 65.43);

/** Sets the forced scheme on <html> (so the fixed navbar follows too) and puts it back on the way out. */
function useForcedScheme(scheme: Scheme) {
  useEffect(() => {
    const root = document.documentElement;
    if (scheme === "system") root.removeAttribute("data-scheme");
    else root.setAttribute("data-scheme", scheme);
    return () => root.removeAttribute("data-scheme");
  }, [scheme]);
}

function Section({ index, title, meta, children }: { index: number; title: string; meta?: ReactNode; children: ReactNode }) {
  const id = `s${index}`;
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-16 scroll-mt-24">
      <SectionHeader title={title} id={`${id}-h`} meta={meta} />
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-prose text-sm text-muted-foreground">{children}</p>;
}

/** A labelled specimen: a plain caption over the thing (a styleguide has to say what it shows). */
function Spec({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <p className="m-0 text-sm text-muted-foreground">{caption}</p>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ colour */

const SWATCHES: { token: string; role: string }[] = [
  { token: "--background", role: "Page" },
  { token: "--surface", role: "Panel plate" },
  { token: "--accent", role: "Hover, sunken" },
  { token: "--foreground", role: "Text, ink" },
  { token: "--muted-foreground", role: "Secondary text" },
  { token: "--subtle-foreground", role: "Credits line" },
  { token: "--border", role: "Hairline" },
  { token: "--border-strong", role: "Control line" },
  { token: "--line-faint", role: "Grid, texture" },
  { token: "--signal", role: "The one accent: large text, marks, fills" },
  { token: "--signal-text", role: "The accent as text under 24 px" },
  { token: "--signal-foreground", role: "Text on a signal fill" },
  { token: "--signal-wash", role: "Active plate" },
  { token: "--signal-hover", role: "Primary fill, hovered" },
  { token: "--signal-active", role: "Primary fill, pressed" },
  { token: "--ring", role: "Focus ring" },
  { token: "--kind-article", role: "Article hue" },
  { token: "--kind-project", role: "Software hue" },
  { token: "--kind-artwork", role: "Artwork hue" },
  { token: "--kind-poem", role: "Poem hue" },
  { token: "--kind-photograph", role: "Photograph hue" },
];

const PAIRS: { fg: string; bg: string; need: number; use: string }[] = [
  { fg: "--foreground", bg: "--background", need: 7, use: "Body text" },
  { fg: "--foreground", bg: "--surface", need: 7, use: "Text on a frame" },
  { fg: "--muted-foreground", bg: "--background", need: 4.5, use: "Secondary text" },
  { fg: "--muted-foreground", bg: "--surface", need: 4.5, use: "Secondary text on a frame" },
  { fg: "--muted-foreground", bg: "--accent", need: 4.5, use: "Secondary text on hover" },
  { fg: "--subtle-foreground", bg: "--surface", need: 4.5, use: "Credits on a frame" },
  { fg: "--signal-text", bg: "--background", need: 4.5, use: "Accent text, any size" },
  { fg: "--signal-text", bg: "--surface", need: 4.5, use: "Accent text on a frame" },
  { fg: "--signal-text", bg: "--accent", need: 4.5, use: "Accent text on hover" },
  { fg: "--signal", bg: "--background", need: 3, use: "Accent, large display text and marks" },
  { fg: "--signal", bg: "--surface", need: 3, use: "Accent mark on a frame" },
  { fg: "--signal-foreground", bg: "--signal", need: 4.5, use: "Text on a signal fill" },
  { fg: "--primary-foreground", bg: "--signal-hover", need: 4.5, use: "Primary label, hovered" },
  { fg: "--primary-foreground", bg: "--signal-active", need: 4.5, use: "Primary label, pressed" },
  { fg: "--ring", bg: "--background", need: 3, use: "Focus ring" },
  { fg: "--ring", bg: "--accent", need: 3, use: "Focus ring on hover" },
  { fg: "--signal-hover", bg: "--background", need: 3, use: "Hovered fill against the page" },
  { fg: "--border-strong", bg: "--background", need: 3, use: "Control outline" },
];

/** Reads the live computed values from a probe element, so the table always shows what the browser resolved. */
function useResolved(scheme: Scheme) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const names = new Set([...SWATCHES.map((s) => s.token), ...PAIRS.flatMap((p) => [p.fg, p.bg])]);
    const next: Record<string, string> = {};
    for (const name of names) {
      probe.style.color = `var(${name})`;
      next[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    setValues(next);
  }, [scheme]);
  return values;
}

function Colour({ scheme }: { scheme: Scheme }) {
  const values = useResolved(scheme);
  const ratio = (fg: string, bg: string) => {
    const f = parseColor(values[fg] ?? "");
    const b = parseColor(values[bg] ?? "");
    if (!f || !b) return null;
    return contrastRatio(f, over(b, [128, 128, 128, 1]));
  };
  return (
    <Stack gap={6}>
      <Note>
        One grey family (the map's near-black and near-white, no warm cast anywhere: the entries and the lists are on the page's own colour) and one accent, BSoD
        blue. The accent is the call to action (the primary button's fill, hovered a step deeper, pressed another), the link in running text, the focus ring,
        the selection and the current mark of a navigation or a filter; as large display text, a mark (a tick, an underline, a cover's mark) or a fill it is
        `signal`, as text under 24 px its text variant (deeper in the light scheme, lighter in the dark one). The faint kind hues only tint the generated covers. Values below are the browser's resolved ones for the current scheme.
      </Note>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
        {SWATCHES.map((s) => (
          <li key={s.token} className="flex min-w-0 flex-col gap-1">
            <div className="h-12 border border-border-strong" style={{ background: `var(${s.token})` }} />
            <span className="mt-1 truncate text-sm font-medium">{s.token.slice(2)}</span>
            <span className="truncate text-sm text-muted-foreground">{s.role}</span>
            <span className="ds-meta truncate">{values[s.token] ?? " "}</span>
          </li>
        ))}
      </ul>
      <Frame padding="md">
        <DataList>
          {PAIRS.map((p) => {
            const r = ratio(p.fg, p.bg);
            const ok = r !== null && r >= p.need;
            return (
              <DataRow key={`${p.fg}${p.bg}`} label={`${p.use} (${p.fg.slice(2)} on ${p.bg.slice(2)})`} mono>
                {r === null ? "--" : `${r.toFixed(2)}:1 (needs ${p.need}:1), ${ok ? "pass" : "fail"}`}
              </DataRow>
            );
          })}
        </DataList>
      </Frame>
    </Stack>
  );
}

/* ---------------------------------------------------------------- palettes */

const PALETTE_LABEL: Record<PaletteName, string> = { blue: "BSoD Blue", green: "Rainforest Green", ocre: "Desert Ocre", violet: "Violet Purple" };
const PALETTE_USE: Record<PaletteName, string> = {
  blue: "The accent: interactive and primary, the default",
  green: "Nature, travel, the outdoors",
  ocre: "Land, deserts, warm highlights",
  violet: "Poetry, the personal, Toulouse",
};
const CVD_KINDS: Cvd[] = ["protanopia", "deuteranopia", "tritanopia"];

/** One scheme's palettes: the ten steps of each hue with the contrast of their on-colour, the roles, read from the browser's resolved values. */
function PalettePanel({ scheme }: { scheme: "light" | "dark" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const probe = document.createElement("span");
    probe.style.display = "none";
    host.appendChild(probe);
    const names = ["--background", "--surface", "--accent", "--foreground", "--muted-foreground", "--palette-white", "--palette-black"];
    for (const n of PALETTE_NAMES) {
      for (const step of PALETTE_STEPS) names.push(`--palette-${n}-${step}`);
      names.push(`--palette-${n}`, `--palette-${n}-on`, `--palette-${n}-text`, `--palette-${n}-tint`);
    }
    const next: Record<string, string> = {};
    for (const name of names) {
      probe.style.color = `var(${name})`;
      next[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    setV(next);
  }, [scheme]);
  const ratio = (fg: string, bg: string) => {
    const f = parseColor(v[fg] ?? "");
    const b = parseColor(v[bg] ?? "");
    return f && b ? contrastRatio(f, b) : null;
  };
  const fmt = (r: number | null) => (r === null ? "--" : r.toFixed(1));
  return (
    <div ref={ref} data-scheme={scheme} className="min-w-0 border border-border-strong bg-background p-4 text-foreground">
      <Stack gap={6}>
        <p className="m-0 text-base font-medium">Scheme: {scheme}</p>
        {PALETTE_NAMES.map((n) => (
          <div key={n} className="flex flex-col gap-2">
            <p className="m-0 text-sm font-medium">
              {PALETTE_LABEL[n]} <span className="font-normal text-muted-foreground">/ {PALETTE_USE[n]}</span>
            </p>
            <ul className="m-0 grid list-none grid-cols-5 gap-1 p-0 sm:grid-cols-10">
              {PALETTE_STEPS.map((step) => {
                const on = step <= 500 ? "--palette-black" : "--palette-white";
                return (
                  <li key={step} className="flex min-w-0 flex-col">
                    <div className="flex h-14 flex-col justify-between p-1 text-xs" style={{ background: `var(--palette-${n}-${step})`, color: `var(${on})` }}>
                      <span className="font-medium">{step}</span>
                      <span>{fmt(ratio(on, `--palette-${n}-${step}`))}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="ds-meta m-0 break-words">{PALETTE_STEPS.map((s) => v[`--palette-${n}-${s}`] ? rgbToHex(parseColor(v[`--palette-${n}-${s}`]!)!.slice(0, 3)) : "").join(" ")}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex min-h-11 items-center justify-between px-3 text-sm font-medium" style={{ background: `var(--palette-${n})`, color: `var(--palette-${n}-on)` }}>
                <span>Fill, on-colour</span>
                <span>{fmt(ratio(`--palette-${n}-on`, `--palette-${n}`))}:1</span>
              </div>
              <div className="flex min-h-11 items-center justify-between border border-border bg-surface px-3 text-sm font-medium" style={{ color: `var(--palette-${n}-text)` }}>
                <span>Text tone</span>
                <span>{fmt(ratio(`--palette-${n}-text`, "--surface"))}:1</span>
              </div>
              <div className="flex min-h-11 items-center justify-between px-3 text-sm" style={{ background: `var(--palette-${n}-tint)` }}>
                <span>Tint, ink</span>
                <span style={{ color: `var(--palette-${n}-text)` }}>
                  text {fmt(ratio(`--palette-${n}-text`, `--palette-${n}-tint`))}:1
                </span>
              </div>
            </div>
          </div>
        ))}
      </Stack>
    </div>
  );
}

/** The four 600 fills as a person with each deficiency sees them, with the least CIEDE2000 distance between any two. */
function CvdTable() {
  const [fills, setFills] = useState<string[] | null>(null);
  useEffect(() => {
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const hex = PALETTE_NAMES.map((n) => {
      probe.style.color = `var(--palette-${n}-600)`;
      const c = parseColor(getComputedStyle(probe).color);
      return c ? rgbToHex(c.slice(0, 3)) : "#000000";
    });
    probe.remove();
    setFills(hex);
  }, []);
  if (!fills) return null;
  const rows: { label: string; colours: string[] }[] = [{ label: "Normal vision", colours: fills }, ...CVD_KINDS.map((k) => ({ label: k, colours: fills.map((f) => simulateCvd(f, k)) }))];
  return (
    <Frame padding="md">
      <div className="flex flex-col gap-4">
        {rows.map(({ label, colours }) => {
          const pairs = colours.flatMap((a, i) => colours.slice(i + 1).map((b, j) => ({ a: PALETTE_NAMES[i]!, b: PALETTE_NAMES[i + 1 + j]!, d: deltaE2000(a, b) })));
          const least = pairs.reduce((m, p) => (p.d < m.d ? p : m));
          return (
            <div key={label} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="w-40 text-sm text-muted-foreground">{label}</span>
              <span className="flex gap-1" aria-hidden="true">
                {colours.map((c, i) => (
                  <span key={PALETTE_NAMES[i]} className="block size-8" style={{ background: c }} />
                ))}
              </span>
              <span className="ds-meta">
                least distance {least.d.toFixed(1)} ({least.a} / {least.b}); {pairs.map((p) => `${p.a[0]}${p.b[0]} ${p.d.toFixed(0)}`).join(", ")}
              </span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Palettes() {
  return (
    <Stack gap={8}>
      <Note>
        Four palettes on one lightness ladder: any hue can stand where another does. Blue is the interface's accent and the default; green, ocre and violet are for graphics (covers, marks, charts, tags), used
        sparingly in the interface. Each swatch shows its step and the contrast of its on-colour (the near-black up to 500, white from 600): 4.5:1 or more everywhere. The 600 is the fill (white text on it, 3:1 as a graphic); the
        text tone is 700 in light and 500 in dark; a tint is a solid mix of the 600 into the page colour. Never as text on text; never the only carrier of meaning.
      </Note>
      <div className="grid gap-6 xl:grid-cols-2">
        <PalettePanel scheme="light" />
        <PalettePanel scheme="dark" />
      </div>
      <Spec caption="Colour-vision deficiency: the four 600 fills as seen with protanopia, deuteranopia and tritanopia (Machado 2009, full severity), CIEDE2000 distance of each pair (first letters of the hue names). Under 10 is a pair that must carry a second cue.">
        <CvdTable />
      </Spec>
      <Spec caption="Cover marks: the seed picks one of the four (same grid, same marks, only the colour differs)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COVER_PALETTES.map((palette) => (
            <div key={palette} className="flex flex-col gap-1">
              <div className="overflow-hidden outline outline-1 -outline-offset-1 outline-border">
                <CoverArt seed="palettes-sample" pattern="lattice" palette={palette} cols={24} rows={14} />
              </div>
              <span className="ds-meta">{palette}</span>
            </div>
          ))}
        </div>
      </Spec>
    </Stack>
  );
}

/* ------------------------------------------------------------------- icons */

const ICON_SIZES: { size: IconSize; value: string; where: string }[] = [
  { size: "inline", value: "1.1em", where: "beside running text or a label: it takes that text's size" },
  { size: "control", value: "1.25rem", where: "inside a control, or at the head of a row" },
  { size: "large", value: "1.5rem", where: "alone, with no text to follow" },
];

/** The icon library's set under the names the interface uses, the three sizes next to the text each is for, and the shortcut hint. */
function Icons() {
  return (
    <Stack gap={8}>
      <Spec caption="The set (lucide-react, one library: nothing is drawn by hand). Stroke 1.75 in the library's 24-unit grid, square ends and joins.">
        <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <li key={name} className="flex min-h-11 items-center gap-3">
              <Icon name={name} size="control" />
              <code className="ds-meta">{name}</code>
            </li>
          ))}
        </ul>
      </Spec>
      <Spec caption="The three sizes, each beside the text it is for">
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {ICON_SIZES.map(({ size, value, where }) => (
            <li key={size} className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="ds-meta w-40">
                {size} {value}
              </span>
              <span className="inline-flex items-center gap-2 text-base">
                <Icon name="search" size={size} />
                Search places and entries
              </span>
              <span className="font-display text-3xl font-light">
                Software <Icon name="arrow-right" size={size} />
              </span>
              <span className="text-sm text-muted-foreground">{where}</span>
            </li>
          ))}
        </ul>
      </Spec>
      <Spec caption="The shortcut hint (the command key on a Mac, Ctrl elsewhere): plain muted text, never a box">
        <div className="flex flex-wrap items-center gap-6 text-muted-foreground">
          <KeyHint />
        </div>
      </Spec>
      <Spec caption="The header's search trigger: icon, word and hint in the header's mono capitals; the icon and the command key are one size (inline, 1.1 em of 12 px)">
        <div className="flex flex-wrap items-center gap-6 text-muted-foreground">
          <span className="nav-link nav-search inline-flex min-h-11 items-center">
            <Icon name="search" size="inline" />
            <span>Search</span>
            <KeyHint />
          </span>
        </div>
      </Spec>
    </Stack>
  );
}

/* -------------------------------------------------------------------- type */

/**
 * The type specimen (docs/design-system.md, "Type"): every role, set in the page's colours. Drawn once per scheme, so the thin / heavy pair,
 * the accent sizes and the reading text can be compared in light and dark side by side. All text is made up.
 */
function TypeSpecimen() {
  return (
    <Stack gap={8}>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Display XL / the name, 200 against 800</p>
        <p className="type-display-xl">
          <span className="type-thin">{SITE.givenName}</span> {SITE.familyName}
        </p>
      </div>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Display LG / an entry's headline</p>
        <h3 className="type-display-lg">
          Notes on a <span className="type-thin">quiet</span> compiler
        </h3>
        <p className="type-standfirst mt-4 max-w-[34ch]">
          A made-up standfirst under the headline, in the reading face at a thin weight and in italic, to even lines.
        </p>
      </div>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Display MD / a card's title, a section</p>
        <p className="type-display-md">Harbour at low tide, study 3</p>
      </div>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Meta / metadata only</p>
        <p className="type-meta m-0 text-muted-foreground">Placeholder Bay &middot; 2026.03.14 &middot; 6 min read</p>
        <p className="type-meta m-0 mt-1 text-muted-foreground">0123456789 &middot; 12.35&deg; N, 65.43&deg; E</p>
      </div>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Reading / drop cap, link, pull quote, rule (a column of 66 characters)</p>
        <div className="ds-prose flex flex-col gap-5">
          <p className="drop-cap m-0">
            Every sentence on this page is a placeholder. The quick brown fox jumps over the lazy dog, in 1984 and again in 2026, at a size and a
            leading chosen for long reading, with a measure that lets the eye return to the next line without searching.
          </p>
          <p className="m-0">
            A second paragraph carries a <a href="#s2" className="type-link">link in running text</a>, its underline in the accent, and some
            figures: 12.5 km, 7 p.m., 0123456789.
          </p>
          <h4 className="m-0 text-2xl">A third-level heading, light</h4>
          <blockquote className="type-pullquote m-0">A pull quote is the reading face in a light italic, between two hairlines.</blockquote>
          <hr className="type-rule" />
          <p className="m-0">After the rule the text resumes, and a <em>word in italic</em> is the real italic, not a slanted roman.</p>
        </div>
      </div>
      <div>
        <p className="type-meta m-0 mb-3 text-muted-foreground">Accent / the one blue, by size</p>
        <div className="flex flex-col gap-3">
          <p className="type-display-lg m-0 text-signal">Display text in the accent</p>
          <p className="m-0 text-2xl font-extrabold text-signal">24 px bold, large text (accent)</p>
          <p className="m-0 text-xl font-bold text-signal-text">20 px bold, under 24 px: the text variant</p>
          <p className="m-0 text-base text-signal-text">16 px in the text variant (AA on the page and the surface)</p>
          <p className="type-meta m-0 text-signal-text">12 px meta in the text variant</p>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-block h-1 w-16 bg-signal" />
            <span className="ds-status" data-tone="signal-solid">New</span>
            <span className="type-link text-base">Underline in the accent</span>
          </div>
        </div>
      </div>
    </Stack>
  );
}

function Type() {
  return (
    <Stack gap={8}>
      <Note>
        Three self-hosted families (OFL, Latin subset, <code>public/fonts/</code>) and the system stack behind them: Bricolage Grotesque for display (a very
        heavy weight against a very thin one), Newsreader for reading, JetBrains Mono for page metadata. The map's labels and credits stay the system mono.
        Each role is a class (<code>.type-display-xl</code>, <code>.type-reading</code>, <code>.type-meta</code> ...) or the utilities
        <code> font-display text-display-xl</code>.
      </Note>
      <div className="grid gap-6 lg:grid-cols-2">
        {(["light", "dark"] as const).map((scheme) => (
          <div key={scheme} data-scheme={scheme} className="min-w-0 border border-border-strong bg-background p-6 text-foreground">
            <p className="ds-meta m-0 mb-6">Scheme: {scheme}</p>
            <TypeSpecimen />
          </div>
        ))}
      </div>
      <Grid>
        <Col span={12} spanMd={7}>
          <Frame>
            <Stack gap={3}>
              <p className="m-0 text-sm text-muted-foreground">System sans (the interface until a component takes a role)</p>
              <p className="m-0 text-4xl leading-[3.25rem] font-semibold tracking-tight">Display 48 / 52</p>
              <p className="m-0 text-3xl font-semibold tracking-tight">Page title 36 / 40</p>
              <p className="m-0 text-2xl font-semibold tracking-tight">Panel title 28 / 34</p>
              <p className="m-0 text-xl font-semibold tracking-tight">Card title 22 / 30</p>
              <p className="m-0 text-lg text-muted-foreground">Summary 18 / 28, muted</p>
              <p className="m-0 text-base">Body 16 / 26. The quick brown fox jumps over the lazy dog, 0123456789.</p>
              <p className="m-0 text-sm text-muted-foreground">Secondary 14 / 22: metadata sentences, captions, tags.</p>
            </Stack>
          </Frame>
        </Col>
        <Col span={12} spanMd={5}>
          <Frame>
            <Stack gap={3}>
              <p className="m-0 text-sm text-muted-foreground">System mono: dates, coordinates, codes, the map's text</p>
              <p className="ds-meta m-0">{formatStamp("2026-10-08")}</p>
              <p className="ds-meta m-0">{SAMPLE_COORDS}</p>
              <p className="m-0 font-mono text-sm tabular-nums">const slashed0 = 0O; // tabular 1111</p>
              <p className="m-0 text-sm text-muted-foreground">A short code in capitals is the exception:</p>
              <MicroLabel>ERR / 500</MicroLabel>
            </Stack>
          </Frame>
        </Col>
      </Grid>
      <DataList>
        <DataRow label="display-xl" mono>
          clamp(3.5rem, 11vw, 10rem) / 0.88 / -0.045em / 800
        </DataRow>
        <DataRow label="display-lg" mono>
          clamp(2.25rem, 1.35rem + 3.7vw, 4.5rem) / 0.98 / -0.035em / 800
        </DataRow>
        <DataRow label="display-md" mono>
          clamp(1.625rem, 1.2rem + 1.4vw, 2.25rem) / 1.06 / -0.025em / 700
        </DataRow>
        <DataRow label="standfirst" mono>
          clamp(1.5rem, 1.25rem + 0.9vw, 1.9rem) / 1.3 / italic 300
        </DataRow>
        <DataRow label="reading" mono>
          clamp(1.125rem, 1.07rem + 0.25vw, 1.25rem) / 1.65 / 400, 28.5 em measure
        </DataRow>
        <DataRow label="meta" mono>
          0.75rem / 1rem / 0.1em / 500, uppercase
        </DataRow>
      </DataList>
    </Stack>
  );
}

/* -------------------------------------------------------- lines and layout */

function Lines() {
  return (
    <Stack gap={8}>
      <Grid>
        {(["plain", "active", "inverted"] as const).map((variant) => (
          <Col key={variant} span={12} spanMd={4}>
            <Frame variant={variant} className="h-32">
              <p className="m-0 text-base font-medium">Frame, {variant}</p>
              <p className="mt-2 mb-0 text-sm text-muted-foreground">
                {variant === "plain" ? "A hairline on the surface: for the few things that are a box." : variant === "active" ? "Strong line and a faint wash: the selected thing." : "The opposite scheme, for a call-out."}
              </p>
            </Frame>
          </Col>
        ))}
      </Grid>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="Divider: one hairline">
            <Divider />
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="Texture, for a placeholder or an empty frame only">
            <div className="ds-grid-bg flex h-16 items-center border border-border p-3 text-sm text-muted-foreground">16 px grid, 7 % ink</div>
          </Spec>
        </Col>
      </Grid>
      <Spec caption="4 px spacing scale (1 to 10 steps) and the 12-column panel grid">
        <div className="flex items-end gap-4">
          {[1, 2, 3, 4, 6, 8, 10].map((n) => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div className="bg-foreground" style={{ width: n * 4, height: n * 4 }} />
              <span className="ds-meta">{n * 4}</span>
            </div>
          ))}
        </div>
        <Grid className="mt-2">
          {Array.from({ length: 12 }, (_, i) => (
            <Col key={i} span={1} className="ds-hatch flex h-8 items-center justify-center border border-border">
              <span className="ds-meta bg-background">{i + 1}</span>
            </Col>
          ))}
        </Grid>
      </Spec>
    </Stack>
  );
}

/* -------------------------------------------------------------- components */

function Controls() {
  const [pressed, setPressed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<"all" | EntryKind>("all");
  return (
    <Stack gap={8}>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="Button / primary, secondary, ghost, link">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="secondary" size="sm">
                Small
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button variant="secondary" disabled>
                Disabled
              </Button>
            </div>
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="IconButton, Toggle, ExpandToggle">
            <div className="flex flex-wrap items-center gap-3">
              {(["close", "expand", "arrow-right", "arrow-up-right"] as IconName[]).map((icon) => (
                <IconButton key={icon} icon={icon} label={icon.replace("-", " ")} />
              ))}
              <IconButton icon="close" label="Close ghost" variant="ghost" />
              <IconButton icon="close" label="Close primary" variant="primary" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Toggle pressed={pressed} onPressedChange={setPressed}>
                Pinned
              </Toggle>
              <ExpandToggle expanded={expanded} onExpandedChange={setExpanded} />
              <ExpandToggle expanded={expanded} onExpandedChange={setExpanded} showLabel />
            </div>
          </Spec>
        </Col>
      </Grid>
      <Spec caption="SegmentedControl (kind filter)">
        <SegmentedControl<"all" | EntryKind>
          label="Kind filter"
          value={filter}
          onValueChange={setFilter}
          options={[{ value: "all", label: "All" }, ...ENTRY_KINDS.map((k) => ({ value: k, label: ENTRY_KIND_LABEL[k] }))]}
        />
      </Spec>
    </Stack>
  );
}

function Tags() {
  return (
    <Stack gap={8}>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="KindTag: said only where kinds are mixed (search, related)">
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {ENTRY_KINDS.map((k) => (
                <KindTag key={k} kind={k} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {ENTRY_KINDS.map((k) => (
                <KindTag key={k} kind={k} iconOnly solid />
              ))}
            </div>
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="StatusTag: one plain word, shown only when it tells something">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {STATUSES.map((s) => (
                <StatusTag key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <StatusTag status="featured" tone="solid" />
              <StatusTag status="new" tone="signal-solid" />
            </div>
          </Spec>
        </Col>
      </Grid>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="DataList: key and value, no rules">
            <DataList>
              <DataRow label="Place">Placeholder Bay</DataRow>
              <DataRow label="Coordinates" mono>
                {SAMPLE_COORDS}
              </DataRow>
              <DataRow label="Visited" mono>
                {formatStamp("2025-05-02")}
              </DataRow>
              <DataRow label="Entries">4</DataRow>
            </DataList>
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="MetadataStrip (two plain lines) and TagList (muted text, links where they go somewhere)">
            <MetadataStrip
              items={[
                { label: "Date", value: <span className="ds-meta">{formatStamp("2026-10-08")}</span> },
                { label: "Place", value: "Placeholder Bay" },
              ]}
            />
            <TagList label="Sample tags" tags={[{ label: "compilers", href: "#s5" }, { label: "notes", href: "#s5" }, { label: "typography", href: "#s5" }]} />
            <TagList label="Sample tags, not links" tags={[{ label: "compilers" }, { label: "notes" }]} />
          </Spec>
        </Col>
      </Grid>
    </Stack>
  );
}

function Covers() {
  return (
    <Stack gap={6}>
      <Note>
        Deterministic from a seed string (same seed, same art, on the server and in the browser), four tonal levels of the ink, tinted by the kind, one or two signal marks.
        Five patterns; the seed picks one.
      </Note>
      <Grid>
        {COVER_PATTERNS.map((pattern, i) => (
          <Col key={pattern} span={6} spanMd={4}>
            <Spec caption={`Pattern: ${pattern}`}>
              <div className="overflow-hidden outline outline-1 -outline-offset-1 outline-border">
                <CoverArt seed={`styleguide-${i}`} pattern={pattern} kind={ENTRY_KINDS[i % ENTRY_KINDS.length]} />
              </div>
            </Spec>
          </Col>
        ))}
        <Col span={6} spanMd={4}>
          <Spec caption="Seeds a, b, c (square 12 x 12)">
            <div className="flex gap-2">
              {["a", "b", "c"].map((seed) => (
                <div key={seed} className="flex-1 overflow-hidden outline outline-1 -outline-offset-1 outline-border">
                  <CoverArt seed={seed} cols={12} rows={12} />
                </div>
              ))}
            </div>
          </Spec>
        </Col>
      </Grid>
    </Stack>
  );
}

/** A made-up picture: one of the demo fixture's generated plates (the styleguide is dev-only; the files are in `public/media/demo/`). */
const SAMPLE_PICTURE = "/media/demo/cover-figure-study.svg";

function SensitiveSample() {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="max-w-xl">
      <SensitiveMedia revealed={revealed} onRevealedChange={setRevealed}>
        <img src={SAMPLE_PICTURE} alt="Sample picture: nested rectangles" className="block aspect-[1.91/1] w-full object-cover" />
      </SensitiveMedia>
    </div>
  );
}

function Cards() {
  const kinds = ["article", "project", "artwork", "poem", "photograph"] as const;
  return (
    <Stack gap={8}>
      <Note>
        No box: the cover, the spacing and the title do the work. One link per card (the title), stretched over the whole card; the pointer underlines the title and the
        keyboard focus draws a ring around the card. The kind is not repeated on a list of one kind.
      </Note>
      <Grid>
        {kinds.map((kind) => {
          const s = SAMPLES[kind];
          return (
            <Col key={kind} span={12} spanMd={6} className="lg:[grid-column:span_3]">
              <EntryCard
                kind={kind}
                title={s.title}
                summary={s.summary}
                href="#s7"
                meta={s.meta.map((m) => ({ label: m.label, value: m.value }))}
                tags={["sample", "placeholder", "styleguide"]}
                className="h-full"
              />
            </Col>
          );
        })}
      </Grid>
      <Spec caption="In a mixed list (related entries, search) the card says its kind">
        <div className="max-w-sm">
          <EntryCard kind="poem" showKind title={SAMPLES.poem.title} summary={SAMPLES.poem.summary} href="#s7" meta={SAMPLES.poem.meta} />
        </div>
      </Spec>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="Mature content in a card: blurred and labelled, no control (the entry's own page has it)">
            <div className="max-w-sm">
              <EntryCard
                kind="artwork"
                sensitive
                image={{ src: SAMPLE_PICTURE, alt: "Sample picture: nested rectangles" }}
                title={SAMPLES.artwork.title}
                summary={SAMPLES.artwork.summary}
                href="#s7"
                meta={SAMPLES.artwork.meta}
              />
            </div>
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="On the entry's own page: the same blur with the control that shows and hides its images (this state is not stored)">
            <SensitiveSample />
          </Spec>
        </Col>
      </Grid>
    </Stack>
  );
}

/* -------------------------------------------------------------- panel mock */

/**
 * The shape of a panel / full-screen entry view, assembled from the system's parts (the real views are built on these).
 * `expanded` re-flows the same content into the 12-column grid: reading column and an aside.
 */
function PanelMock({ kind = "article", expanded: forced, className }: { kind?: Exclude<EntryKind, "place">; expanded?: boolean; className?: string }) {
  const [own, setOwn] = useState(false);
  const expanded = forced ?? own;
  const s = SAMPLES[kind];
  const related = [
    { kind: "project" as const, title: "Tessera, a tiling toy" },
    { kind: "poem" as const, title: "Nine lines for no one" },
  ];
  const reading = (
    <Stack gap={6}>
      <div className="overflow-hidden outline outline-1 -outline-offset-1 outline-border">
        <CoverArt seed={s.title} kind={kind} cols={48} rows={20} />
      </div>
      <Stack gap={4}>
        <h3 className="m-0 mt-2 text-2xl font-semibold tracking-tight">A section heading</h3>
        <p className="m-0 max-w-[60ch] text-lg">
          This is placeholder body copy for the panel mock. It exists to show the line length, the leading and the colour of reading text, nothing more.
        </p>
        <p className="m-0 max-w-[60ch] text-lg">
          A second paragraph checks the rhythm between blocks: eighteen pixels of type on a twenty-eight pixel line, a twenty-four pixel gap, and a measure that stays
          comfortable when the panel is half the screen.
        </p>
      </Stack>
    </Stack>
  );
  const aside = (
    <Stack gap={8}>
      <section aria-labelledby={`${kind}-places`}>
        <SectionHeader title="Places" id={`${kind}-places`} as="h3" />
        <ul className="m-0 mt-2 list-none p-0">
          <li>
            <a href="#s8" className="flex min-h-11 items-baseline gap-3 py-2 text-base no-underline hover:underline">
              <span>Placeholder Bay</span>
              <span className="text-sm text-muted-foreground">Sample country</span>
            </a>
          </li>
        </ul>
      </section>
      <section aria-labelledby={`${kind}-related`}>
        <SectionHeader title="Related" id={`${kind}-related`} as="h3" />
        <ul className="m-0 mt-2 list-none p-0">
          {related.map((r) => (
            <li key={r.title}>
              <a href="#s8" className="flex min-h-11 flex-col justify-center py-2 no-underline hover:underline">
                <span className="text-sm text-muted-foreground">{ENTRY_KIND_LABEL[r.kind]}</span>
                <span className="text-base">{r.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Stack>
  );
  return (
    <article aria-label={`${ENTRY_KIND_LABEL[kind]} view, sample`} className={cn("flex min-w-0 flex-col border border-border bg-surface", className)}>
      <header className="flex items-center justify-end gap-1 p-2">
        {forced === undefined && <ExpandToggle expanded={expanded} onExpandedChange={setOwn} size="sm" />}
        <IconButton icon="close" label="Close" size="sm" variant="ghost" />
      </header>
      <div className="flex flex-col gap-8 px-4 pb-8 md:px-6">
        <div className="flex flex-col gap-2">
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>{ENTRY_KIND_LABEL[kind]}</span>
            <span aria-hidden="true">&middot;</span>
            <span className="ds-meta">{formatStamp("2026-10-08")}</span>
            {s.status && s.status !== "published" && (
              <>
                <span aria-hidden="true">&middot;</span>
                <StatusTag status={s.status} />
              </>
            )}
          </p>
          <h2 className={cn("m-0 font-semibold tracking-tight", expanded ? "text-3xl md:text-4xl md:leading-[3.25rem]" : "text-2xl")}>{s.title}</h2>
          <p className="m-0 max-w-[60ch] text-lg text-muted-foreground">{s.summary}</p>
          <TagList label="Sample tags" tags={[{ label: "sample", href: "#s8" }, { label: "placeholder", href: "#s8" }]} />
        </div>
        {expanded ? (
          <Grid>
            <Col span={12} spanMd={8}>
              {reading}
            </Col>
            <Col span={12} spanMd={4}>
              {aside}
            </Col>
          </Grid>
        ) : (
          <>
            {reading}
            {aside}
          </>
        )}
      </div>
    </article>
  );
}

function PanelSection() {
  return (
    <Stack gap={6}>
      <Note>
        The same content in the 440 px side panel and, with the toggle, re-flowed into the full-screen 12-column layout. Use the toggle in the header or the footer.
      </Note>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <PanelMock kind="article" expanded={false} />
        <PanelMock kind="project" expanded />
      </div>
      <Spec caption="Interactive: the toggle switches this one between panel and full screen">
        <PanelMock kind="poem" />
      </Spec>
    </Stack>
  );
}

function SchemePair() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["light", "dark"] as const).map((scheme) => (
        <div key={scheme} data-scheme={scheme} className="border border-border-strong bg-background p-4 text-foreground">
          <Stack gap={4}>
            <p className="m-0 text-base font-medium">Scheme: {scheme}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm">
                Primary
              </Button>
              <Button variant="secondary" size="sm">
                Secondary
              </Button>
              <Toggle pressed onPressedChange={() => undefined} size="sm">
                Pressed
              </Toggle>
              <StatusTag status="live" />
            </div>
            <EntryCard kind="artwork" title={SAMPLES.artwork.title} summary={SAMPLES.artwork.summary} meta={SAMPLES.artwork.meta} />
            <Frame variant="active" padding="sm">
              <p className="m-0 text-sm font-medium text-signal-text">Active frame</p>
              <p className="mt-1 mb-0 text-sm">Selected thing: strong line and a faint wash.</p>
            </Frame>
            <Frame variant="inverted" padding="sm">
              <p className="m-0 text-sm font-medium">Inverted frame</p>
              <p className="mt-1 mb-0 text-sm">The call-out: the opposite scheme for its subtree.</p>
              <Button variant="secondary" size="sm" className="mt-3">
                Action
              </Button>
            </Frame>
          </Stack>
        </div>
      ))}
    </div>
  );
}

function States() {
  return (
    <Grid>
      <Col span={12} spanMd={4}>
        <Spec caption="Loading: the skeleton of the content's shape">
          <StatePanel state="loading" />
        </Spec>
      </Col>
      <Col span={12} spanMd={4}>
        <Spec caption="Empty: one muted line">
          <StatePanel state="empty" title="Nothing here yet." />
        </Spec>
      </Col>
      <Col span={12} spanMd={4}>
        <Spec caption="Error">
          <StatePanel
            state="error"
            code="ERR / 500"
            title="This entry did not load"
            description="The page could not be built, and that is on my side. Try again in a moment."
            action={
              <Button variant="primary" size="sm">
                Try again
              </Button>
            }
          />
        </Spec>
      </Col>
      <Col span={12}>
        <Spec caption="Skeleton blocks">
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </Spec>
      </Col>
    </Grid>
  );
}

function Motion() {
  return (
    <DataList>
      <DataRow label="--duration-fast" mono>
        120 ms: hover and focus colour
      </DataRow>
      <DataRow label="--duration-base" mono>
        220 ms: state change, slide-over
      </DataRow>
      <DataRow label="--duration-slow" mono>
        360 ms: panel slide, globe re-centre
      </DataRow>
      <DataRow label="--ease-standard" mono>
        0.2, 0, 0, 1
      </DataRow>
      <DataRow label="--duration-scan" mono>
        1600 ms: ambient, off when reduced
      </DataRow>
    </DataList>
  );
}

function Brand() {
  return (
    <Stack gap={6}>
      <Note>
        The mark: a square (the bounding box) and a disc (the globe) overlapping, the overlap knocked out, on a 16 px grid, one bit per cell. It
        takes the text colour, so it follows the scheme; whole multiples of 16 px keep every pixel crisp. The wordmark is the same shapes beside
        the site's name in semibold type. Neither is in the header (the header carries the name as text); the favicon, the home-screen icons and
        the LogoMark component are all drawn from the same data (scripts/brand/mark.mjs).
      </Note>
      <div className="flex flex-wrap items-end gap-8">
        {[16, 32, 64, 128].map((size) => (
          <Spec key={size} caption={`${size} px`}>
            <LogoMark size={size} />
          </Spec>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-8">
        <Spec caption="Wordmark, 16 px mark">
          <LogoWordmark size={16} />
        </Spec>
        <Spec caption="Wordmark, 32 px mark">
          <LogoWordmark size={32} />
        </Spec>
        <Spec caption="Wordmark, 64 px mark">
          <LogoWordmark size={64} />
        </Spec>
      </div>
      <Spec caption="On the inverted frame">
        <Frame variant="inverted" padding="sm" className="w-fit">
          <LogoWordmark size={32} />
        </Frame>
      </Spec>
    </Stack>
  );
}

/* ------------------------------------------------------------ entry pages */

/**
 * The entry pages' grammar (docs/design-system.md, "Entry pages") at the width of a column, in both reading surfaces: the running head over one hairline, the
 * kicker, a headline whose clause after a comma is thin, the standfirst, the dateline, the marginalia, the body with its drop cap and
 * pull quote, a figure with its caption; then a poem. Made-up text. The surface is the page's reading surface (the page's own colours), bound
 * for the element by `data-reading-surface`; the sizes follow the width of the block (`cqi`), as they do on the page.
 */
function EntrySpecimen({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <div data-scheme={scheme} data-reading-surface data-layout="full" data-kind="article" className="entry min-w-0 border border-border bg-background p-6 text-foreground">
      <p className="ds-meta m-0 mb-6">Surface: the page ({scheme})</p>
      <p className="type-meta entry-running m-0 flex justify-between text-muted-foreground">
        <span>Article &middot; Placeholder Bay</span>
        <span>6 min read</span>
      </p>
      <h3 className="entry-title mt-8">
        Notes on a quiet compiler<span className="entry-title-tail">, written on a slow train</span>
      </h3>
      <p className="type-standfirst mt-6 max-w-[25.4em]">One made-up sentence that says what the piece is, set thin and italic against the heavy headline.</p>
      <div className="entry-dateline mt-8 flex flex-wrap gap-x-8">
        <span>2026.03.14</span>
        <span>
          Placeholder Bay <Icon name="arrow-up-right" size="inline" /> open on the globe
        </span>
      </div>
      <div className="entry-margin mt-8">
        <div>
          <p className="type-meta m-0 text-foreground">Where</p>
          <p className="m-0">Placeholder Bay, Sample country</p>
        </div>
        <dl className="m-0">
          <div>
            <dt className="type-meta text-foreground">Written</dt>
            <dd>March 2026</dd>
          </div>
          <div>
            <dt className="type-meta text-foreground">Linked</dt>
            <dd>1 place, 2 entries</dd>
          </div>
        </dl>
      </div>
      <div className="entry-text mt-8">
        <div className="ds-prose flex flex-col gap-[1.1em]">
          <p className="drop-cap m-0">
            Every sentence here is a placeholder, set to show the measure and the rhythm of a reading column under a heavy headline, with a drop cap
            that is the first letter of the text and nothing else. A second sentence follows to give the cap three lines of company.
          </p>
          <h4 className="m-0">A section heading, in the light end of the display face</h4>
          <figure className="type-pullquote my-[0.4em]">
            <blockquote className="m-0">
              <p className="m-0">A pull quote is larger and thinner than anything else on the page.</p>
            </blockquote>
          </figure>
          <p className="m-0">
            A <a href="#s13" className="type-link">link in running text</a> is an underline in the accent, not a button.
          </p>
        </div>
      </div>
      <figure className="entry-figure m-0 mt-8">
        <div className="aspect-video bg-accent" />
        <figcaption className="ds-caption mt-2.5">
          <span className="text-foreground">Fig. 1 </span>A made-up caption, in mono, under a rule of the ink.
        </figcaption>
      </figure>
    </div>
  );
}

/** The night board's poem: the title in thin italic, the lines in a light weight at the size of a page of verse, one block per line. */
function PoemSpecimen({ scheme }: { scheme: "light" | "dark" }) {
  return (
    <div data-scheme={scheme} data-reading-surface data-layout="full" data-kind="poem" className="entry min-w-0 border border-border bg-background p-6 text-foreground">
      <p className="type-meta m-0 mb-6 text-muted-foreground">Poem</p>
      <h3 className="entry-title" data-poem="">
        Low tide
      </h3>
      <div className="ds-prose mt-8">
        <div data-slot="verse" className="flex flex-col gap-[1.4em]">
          <p className="m-0 flex flex-col">
            <span className="block">A first line, short, set thin</span>
            <span className="block">and given the room a poem needs.</span>
          </p>
          <p className="m-0 flex flex-col">
            <span className="block">A second stanza, breathing apart,</span>
            <span className="block">where the page is mostly dark.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function EntryPages() {
  return (
    <Stack gap={8}>
      <Note>
        The article and poem boards of the owner's canvas, as the entry pages build them: Newsreader 700 for the headline (its clause after a comma, a colon or
        a dash at 300), thin italic for the standfirst and the pull quote, mono for the kicker, the dateline, the marginalia and the captions, a drop cap in the
        ink, ink rules, and a poem set as its own page: a thin italic title over lines at 300. On the page's own colours, near-white in the light scheme and near-black in the dark one.
      </Note>
      <div className="grid gap-6 lg:grid-cols-2">
        {(["light", "dark"] as const).map((scheme) => (
          <div key={scheme} className="flex min-w-0 flex-col gap-6">
            <EntrySpecimen scheme={scheme} />
            <PoemSpecimen scheme={scheme} />
          </div>
        ))}
      </div>
    </Stack>
  );
}

export default function DevDesign() {
  const [params] = useSearchParams();
  const initial = params.get("scheme");
  const [scheme, setScheme] = useState<Scheme>(initial === "light" || initial === "dark" ? initial : "system");
  useForcedScheme(scheme);

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-6 pt-[calc(var(--navbar-height)+3rem)] pb-24">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-muted-foreground">Development only</p>
          <SegmentedControl<Scheme>
            label="Colour scheme"
            value={scheme}
            onValueChange={setScheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
        <h1 className="m-0 text-4xl leading-[3.25rem] font-semibold tracking-tight">UI system</h1>
        <p className="m-0 max-w-[60ch] text-lg text-muted-foreground">
          A quiet archive: few boxes, no decorative numbering, a label only where it adds information, generative covers, and one accent for state. Sample text on
          this page is made up.
        </p>
      </header>

      <Section index={1} title="Colour">
        <Colour scheme={scheme} />
      </Section>
      <Section index={2} title="Type">
        <Type />
      </Section>
      <Section index={3} title="Lines and layout">
        <Lines />
      </Section>
      <Section index={4} title="Controls">
        <Controls />
      </Section>
      <Section index={5} title="Labels and data">
        <Tags />
      </Section>
      <Section index={6} title="Cover art">
        <Covers />
      </Section>
      <Section index={7} title="Entry cards">
        <Cards />
      </Section>
      <Section index={8} title="Panel and full screen">
        <PanelSection />
      </Section>
      <Section index={9} title="States">
        <States />
      </Section>
      <Section index={10} title="Both schemes">
        <SchemePair />
      </Section>
      <Section index={11} title="Motion">
        <Motion />
      </Section>
      <Section index={12} title="Brand">
        <Brand />
      </Section>
      <Section index={13} title="Entry pages">
        <EntryPages />
      </Section>
      <Section index={14} title="Icons">
        <Icons />
      </Section>
      <Section index={15} title="Palettes">
        <Palettes />
      </Section>
    </main>
  );
}
