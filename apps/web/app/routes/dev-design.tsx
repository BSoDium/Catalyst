/**
 * DEV ONLY: `/dev/design` is the styleguide of the UI system (docs/design-system.md): every token and component, a scheme
 * toggle, sample entries of the four kinds as cards and as a panel mock, and the loading / empty / error states.
 * It exists only where `routes.ts` includes it (development, or a build made with CATALYST_DEV_ROUTES=1) and answers 404
 * anywhere else, exactly like `/dev/street`. Every sample string below is a made-up placeholder, never real content.
 *
 * Query: `?scheme=light|dark` starts in a forced scheme (default: follow the system).
 */
import { useEffect, useState, type ReactNode } from "react";
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
  Glyph,
  Grid,
  IconButton,
  KindTag,
  MetadataStrip,
  MicroLabel,
  RegMark,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  Stack,
  StatePanel,
  StatusTag,
  TagList,
  Toggle,
  type GlyphName,
} from "~/components/ui";
import { parseColor, contrastRatio, over } from "~/lib/contrast";
import { COVER_PATTERNS } from "~/lib/cover-art";
import { ENTRY_KINDS, ENTRY_KIND_LABEL, type EntryKind } from "~/lib/entry-kind";
import { entryCode, formatCoordinates, formatIndex, formatStamp, STATUSES } from "~/lib/labelling";
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

const SAMPLES: Record<Exclude<EntryKind, "place">, { index: number; title: string; summary: string; meta: { label: string; value: string }[]; status?: string }> = {
  article: {
    index: 42,
    title: "Notes on a quiet compiler",
    summary: "A sample summary written for the styleguide: two lines of reading text to check the clamp, the contrast and the rhythm of a card.",
    meta: [
      { label: "Date", value: formatStamp("2026-10-08") },
      { label: "Read", value: "6 MIN" },
    ],
    status: "published",
  },
  project: {
    index: 17,
    title: "Tessera, a tiling toy",
    summary: "A placeholder project: a small program that fills a plane with tiles and lets you break the rules one at a time.",
    meta: [
      { label: "Stack", value: "TS / SVG" },
      { label: "Year", value: "2026" },
    ],
    status: "live",
  },
  artwork: {
    index: 8,
    title: "Harbour at low tide, study 3",
    summary: "A made-up artwork entry. Ink on paper, scanned flat; the cover below is generated, not the work itself.",
    meta: [
      { label: "Medium", value: "INK / PAPER" },
      { label: "Year", value: "2025" },
    ],
    status: "published",
  },
  poem: {
    index: 23,
    title: "Nine lines for no one",
    summary: "A placeholder poem about a light that stays on in a room nobody uses, set in nine short lines.",
    meta: [
      { label: "Lines", value: "9" },
      { label: "Date", value: formatStamp("2026-03-14") },
    ],
    status: "draft",
  },
};

const SAMPLE_COORDS = formatCoordinates(12.3456, 65.4321);

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
    <section aria-labelledby={`${id}-h`} className="mt-14 scroll-mt-24">
      <SectionHeader index={index} title={title} id={`${id}-h`} meta={meta} />
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-prose text-sm text-muted-foreground">{children}</p>;
}

/** A labelled specimen: a micro caption over the thing. */
function Spec({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <MicroLabel>{caption}</MicroLabel>
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
  { token: "--signal", role: "The one accent" },
  { token: "--signal-wash", role: "Active plate" },
  { token: "--kind-article", role: "Article hue" },
  { token: "--kind-project", role: "Project hue" },
  { token: "--kind-artwork", role: "Artwork hue" },
  { token: "--kind-poem", role: "Poem hue" },
];

const PAIRS: { fg: string; bg: string; need: number; use: string }[] = [
  { fg: "--foreground", bg: "--background", need: 7, use: "Body text" },
  { fg: "--foreground", bg: "--surface", need: 7, use: "Text on a frame" },
  { fg: "--muted-foreground", bg: "--background", need: 4.5, use: "Secondary text" },
  { fg: "--muted-foreground", bg: "--surface", need: 4.5, use: "Micro-labels on a frame" },
  { fg: "--muted-foreground", bg: "--accent", need: 4.5, use: "Micro-labels on hover" },
  { fg: "--subtle-foreground", bg: "--surface", need: 4.5, use: "Credits on a frame" },
  { fg: "--signal", bg: "--surface", need: 4.5, use: "Signal text" },
  { fg: "--signal-foreground", bg: "--signal", need: 4.5, use: "Text on a signal fill" },
  { fg: "--border-strong", bg: "--background", need: 2.8, use: "Control outline" },
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
        One grey family (the map's near-black and near-white), one accent, and a faint hue per kind that only ever repeats what a glyph and a word already say.
        Values below are the browser's resolved ones for the current scheme.
      </Note>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-5">
        {SWATCHES.map((s) => (
          <li key={s.token} className="flex min-w-0 flex-col gap-2">
            <div className="h-12 border border-border-strong" style={{ background: `var(${s.token})` }} />
            <MicroLabel tone="strong" className="truncate">
              {s.token.slice(2)}
            </MicroLabel>
            <MicroLabel className="truncate normal-case">{s.role}</MicroLabel>
            <MicroLabel className="truncate normal-case">{values[s.token] ?? " "}</MicroLabel>
          </li>
        ))}
      </ul>
      <Frame padding="sm">
        <DataList>
          {PAIRS.map((p) => {
            const r = ratio(p.fg, p.bg);
            const ok = r !== null && r >= p.need;
            return (
              <DataRow key={`${p.fg}${p.bg}`} label={`${p.use} (${p.fg.slice(2)} on ${p.bg.slice(2)})`} mono>
                {r === null ? "--" : `${r.toFixed(2)}:1 / ${p.need}:1 ${ok ? "PASS" : "FAIL"}`}
              </DataRow>
            );
          })}
        </DataList>
      </Frame>
    </Stack>
  );
}

/* -------------------------------------------------------------------- type */

function Type() {
  return (
    <Stack gap={8}>
      <Grid>
        <Col span={12} spanMd={7}>
          <Frame>
            <Stack gap={3}>
              <MicroLabel>Sans, reading and titles (system grotesk stack)</MicroLabel>
              <p className="m-0 text-4xl leading-[3.25rem] font-semibold tracking-tight">Display 48 / 52</p>
              <p className="m-0 text-3xl font-semibold tracking-tight">Heading 36 / 40</p>
              <p className="m-0 text-2xl font-semibold tracking-tight">Panel title 28 / 34</p>
              <p className="m-0 text-xl font-semibold tracking-tight">Card title 22 / 30</p>
              <p className="m-0 text-lg text-muted-foreground">Summary 18 / 28, muted</p>
              <p className="m-0 text-base">Body 16 / 26. The quick brown fox jumps over the lazy dog, 0123456789.</p>
              <p className="m-0 text-sm text-muted-foreground">Secondary 14 / 22. Lists, captions, metadata sentences.</p>
            </Stack>
          </Frame>
        </Col>
        <Col span={12} spanMd={5}>
          <Frame>
            <Stack gap={3}>
              <MicroLabel>Mono, labels and data (system mono stack)</MicroLabel>
              <MicroLabel tone="strong">{entryCode("article", 42)}</MicroLabel>
              <MicroLabel>{SAMPLE_COORDS}</MicroLabel>
              <MicroLabel>
                {formatStamp("2026-10-08")} / 14:32Z
              </MicroLabel>
              <MicroLabel tone="signal">Signal / live</MicroLabel>
              <StatusTag status="published" />
              <p className="m-0 font-mono text-sm tabular-nums">const slashed0 = 0O; // tabular 1111</p>
              <p className="m-0 font-mono text-xs">12 / 18 mono, buttons and values</p>
              <p className="ds-micro m-0">11 / 16 micro, uppercase, 0.12em</p>
            </Stack>
          </Frame>
        </Col>
      </Grid>
      <Note>
        No web font is loaded: the system stacks give crisp, native-feeling grotesk and mono at zero bytes. Changing a face is one token (`--font-sans`, `--font-mono`).
      </Note>
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
              <MicroLabel tone="strong">Frame / {variant}</MicroLabel>
              <p className="mt-2 mb-0 text-sm text-muted-foreground">Hairline 1 px, corner brackets 10 px, no radius, no shadow.</p>
            </Frame>
          </Col>
        ))}
      </Grid>
      <Grid>
        <Col span={12} spanMd={6}>
          <Spec caption="Divider / hairline, ticks, labelled">
            <Divider />
            <Divider ticks />
            <Divider label="Section" ticks />
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="Registration marks and textures (decorative)">
            <div className="ds-grid-bg relative flex h-24 items-center justify-between border border-border p-2">
              <RegMark className="text-muted-foreground" />
              <MicroLabel>grid 16 px</MicroLabel>
              <RegMark className="text-muted-foreground" />
            </div>
            <div className="ds-hatch flex h-8 items-center border border-border px-2">
              <MicroLabel>hatch</MicroLabel>
            </div>
          </Spec>
        </Col>
      </Grid>
      <Spec caption="4 px spacing scale (1 to 10 steps) and the 12-column panel grid">
        <div className="flex items-end gap-3">
          {[1, 2, 3, 4, 6, 8, 10].map((n) => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div className="bg-foreground" style={{ width: n * 4, height: n * 4 }} />
              <MicroLabel>{n * 4}</MicroLabel>
            </div>
          ))}
        </div>
        <Grid className="mt-2">
          {Array.from({ length: 12 }, (_, i) => (
            <Col key={i} span={1} className="ds-hatch flex h-8 items-center justify-center border border-border">
              <MicroLabel>{formatIndex(i + 1, 2)}</MicroLabel>
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
              {(["close", "expand", "arrow-right", "arrow-up-right"] as GlyphName[]).map((icon) => (
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
          <Spec caption="KindTag / five kinds, solid, icon only">
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
          <Spec caption="StatusTag / default tones, solid variants">
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
          <Spec caption="DataList / KEY ........ value">
            <Frame padding="sm">
              <DataList>
                <DataRow label="Place">Placeholder Bay</DataRow>
                <DataRow label="Coordinates" mono>
                  {SAMPLE_COORDS}
                </DataRow>
                <DataRow label="Visited" mono>
                  {formatStamp("2025-05-02")}
                </DataRow>
                <DataRow label="Entries" mono>
                  {formatIndex(4)}
                </DataRow>
              </DataList>
            </Frame>
          </Spec>
        </Col>
        <Col span={12} spanMd={6}>
          <Spec caption="MetadataStrip, TagList">
            <MetadataStrip
              items={[
                { label: "Date", value: formatStamp("2026-10-08") },
                { label: "Place", value: "PLACEHOLDER BAY" },
                { label: "Status", value: "PUBLISHED" },
              ]}
            />
            <TagList label="Sample tags" tags={[{ label: "compilers" }, { label: "notes" }, { label: "linked tag", href: "#s5" }]} />
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
            <Spec caption={`pattern / ${pattern}`}>
              <Frame padding="none">
                <CoverArt seed={`styleguide-${i}`} pattern={pattern} kind={ENTRY_KINDS[i % ENTRY_KINDS.length]} />
              </Frame>
            </Spec>
          </Col>
        ))}
        <Col span={6} spanMd={4}>
          <Spec caption="seed / a, b, c (square 12 x 12)">
            <div className="flex gap-2">
              {["a", "b", "c"].map((seed) => (
                <Frame key={seed} padding="none" className="flex-1">
                  <CoverArt seed={seed} cols={12} rows={12} />
                </Frame>
              ))}
            </div>
          </Spec>
        </Col>
      </Grid>
    </Stack>
  );
}

function Cards() {
  const kinds = ["article", "project", "artwork", "poem"] as const;
  return (
    <Stack gap={6}>
      <Note>One link per card (the title), stretched over the whole card. Hover and keyboard focus turn the brackets to the signal colour.</Note>
      <Grid>
        {kinds.map((kind) => {
          const s = SAMPLES[kind];
          return (
            <Col key={kind} span={12} spanMd={6} className="lg:[grid-column:span_3]">
              <EntryCard kind={kind} index={s.index} title={s.title} summary={s.summary} href="#s6" meta={s.meta} status={s.status} className="h-full" />
            </Col>
          );
        })}
      </Grid>
      <Spec caption="Place card (no link)">
        <div className="max-w-sm">
          <EntryCard kind="place" index={3} title="Placeholder Bay" summary="A made-up place. Cards for places carry their coordinates." meta={[{ label: "Coords", value: SAMPLE_COORDS }]} />
        </div>
      </Spec>
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
    { kind: "project" as const, title: "Tessera, a tiling toy", n: 17 },
    { kind: "poem" as const, title: "Nine lines for no one", n: 23 },
    { kind: "place" as const, title: "Placeholder Bay", n: 3 },
  ];
  const reading = (
    <Stack gap={6}>
      <p className="m-0 text-lg text-muted-foreground">{s.summary}</p>
      <CoverArt seed={s.title} kind={kind} cols={48} rows={20} />
      <section aria-labelledby={`${kind}-body`}>
        <SectionHeader index={1} title="Body" id={`${kind}-body`} as="h3" meta="3 PARAGRAPHS" />
        <Stack gap={4} className="mt-4">
          <p className="m-0">
            This is placeholder body copy for the panel mock. It exists to show the line length, the leading and the colour of reading text inside a frame, nothing more.
          </p>
          <p className="m-0">
            A second paragraph checks the rhythm between blocks: sixteen pixels of type on a twenty-six pixel line, a twenty-four pixel gap, and a measure that stays comfortable
            when the panel is half the screen.
          </p>
          <p className="m-0 text-muted-foreground">A last, muted line stands in for a caption or a note.</p>
        </Stack>
      </section>
    </Stack>
  );
  const aside = (
    <Stack gap={6}>
      <section aria-labelledby={`${kind}-related`}>
        <SectionHeader index={2} title="Related" id={`${kind}-related`} as="h3" meta={formatIndex(related.length, 2)} />
        <ul className="m-0 mt-2 list-none p-0">
          {related.map((r) => (
            <li key={r.title} className="border-b border-border last:border-b-0">
              <a href="#s7" className="group flex min-h-11 items-center gap-3 py-2 text-sm hover:bg-accent">
                <KindTag kind={r.kind} iconOnly />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <MicroLabel>{formatIndex(r.n)}</MicroLabel>
                <Glyph name="arrow-right" size={12} />
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby={`${kind}-data`}>
        <SectionHeader index={3} title="Data" id={`${kind}-data`} as="h3" />
        <DataList className="mt-3">
          <DataRow label="Place">Placeholder Bay</DataRow>
          <DataRow label="Coords" mono>
            {SAMPLE_COORDS}
          </DataRow>
          <DataRow label="Seed" mono>
            {kind}-{formatIndex(s.index)}
          </DataRow>
        </DataList>
      </section>
    </Stack>
  );
  return (
    <Frame as="article" aria-label={`${ENTRY_KIND_LABEL[kind]} view, sample`} padding="none" className={cn("flex min-w-0 flex-col", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-3">
          <KindTag kind={kind} />
          <MicroLabel className="truncate">№ {formatIndex(s.index)}</MicroLabel>
        </div>
        <div className="flex items-center gap-2">
          {forced === undefined && <ExpandToggle expanded={expanded} onExpandedChange={setOwn} size="sm" />}
          <IconButton icon="close" label="Close" size="sm" />
        </div>
      </header>
      <div className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusTag status={s.status ?? "published"} />
            <MicroLabel>{SAMPLE_COORDS}</MicroLabel>
          </div>
          <h2 className={cn("m-0 font-semibold tracking-tight", expanded ? "text-3xl md:text-4xl md:leading-[3.25rem]" : "text-2xl")}>{s.title}</h2>
          <MetadataStrip items={[...s.meta, { label: "Place", value: "PLACEHOLDER BAY" }]} />
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
      <footer className="mt-auto">
        <Divider ticks />
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <MicroLabel>
            {formatStamp("2026-10-08")} / END
          </MicroLabel>
          <div className="flex items-center gap-2">
            {forced === undefined && <ExpandToggle expanded={expanded} onExpandedChange={setOwn} showLabel size="sm" />}
            <Button variant="primary" size="sm">
              Next entry
            </Button>
          </div>
        </div>
      </footer>
    </Frame>
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
            <MicroLabel tone="strong">Scheme / {scheme}</MicroLabel>
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
            <EntryCard kind="artwork" index={SAMPLES.artwork.index} title={SAMPLES.artwork.title} summary={SAMPLES.artwork.summary} meta={SAMPLES.artwork.meta} status="published" />
            <Frame variant="active" padding="sm">
              <MicroLabel tone="signal">Active frame</MicroLabel>
              <p className="mt-1 mb-0 text-sm">Selected thing: strong line, signal brackets, faint wash.</p>
            </Frame>
            <Frame variant="inverted" padding="sm">
              <MicroLabel>Inverted frame</MicroLabel>
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
        <Spec caption="Loading">
          <StatePanel state="loading" code="LOADING / 0042" />
        </Spec>
      </Col>
      <Col span={12} spanMd={4}>
        <Spec caption="Empty">
          <StatePanel
            state="empty"
            title="Nothing here yet"
            description="No entries are linked to this place. New ones show up as they are published."
            action={
              <Button variant="secondary" size="sm">
                Back to the globe
              </Button>
            }
          />
        </Spec>
      </Col>
      <Col span={12} spanMd={4}>
        <Spec caption="Error">
          <StatePanel
            state="error"
            code="ERR / 500"
            title="This entry did not load"
            description="Something went wrong on our side. Try again in a moment."
            action={<Button variant="primary" size="sm">Try again</Button>}
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
    <Frame padding="sm">
      <DataList>
        <DataRow label="--duration-fast (hover, focus colour)" mono>
          120 MS
        </DataRow>
        <DataRow label="--duration-base (state change, slide-over)" mono>
          220 MS
        </DataRow>
        <DataRow label="--duration-slow (panel slide, globe re-centre)" mono>
          360 MS
        </DataRow>
        <DataRow label="--ease-standard" mono>
          0.2, 0, 0, 1
        </DataRow>
        <DataRow label="--duration-scan (ambient, off when reduced)" mono>
          1600 MS
        </DataRow>
      </DataList>
    </Frame>
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
          <MicroLabel tone="signal">Dev only / design system</MicroLabel>
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
        <h1 className="m-0 text-4xl leading-[3.25rem] font-semibold tracking-tight">Catalyst UI system</h1>
        <p className="m-0 max-w-prose text-lg text-muted-foreground">
          Square, labelled, quiet. Hairlines with corner brackets, micro-labels in mono, generative covers, one signal colour. Sample text on this page is made up.
        </p>
        <Divider ticks />
      </header>

      <Section index={1} title="Colour" meta="2 SCHEMES">
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
      <Section index={10} title="Both schemes" meta="FORCED PER BLOCK">
        <SchemePair />
      </Section>
      <Section index={11} title="Motion">
        <Motion />
      </Section>
    </main>
  );
}
