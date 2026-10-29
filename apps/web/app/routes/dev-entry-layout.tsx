/**
 * DEV ONLY: `/dev/entry-layout` is a prototype of the software entry's layout (owner, 2026-10-30: "it looks like a bunch of lines of text one after another with no hierarchy").
 * Three directions on ONE made-up entry, at the panel's width and at the full-screen width, with and without a screenshot: `?v=a|b|c`, `?w=panel|full`, `?shot=0|1`,
 * `?scheme=light|dark`. Nothing here is the site's page yet: the parts are built from the system's own tokens and components so that what is judged is the layout.
 * Exists only where `routes.ts` includes it (development, or CATALYST_DEV_ROUTES=1).
 */
import { useEffect, type ReactNode } from "react";
import { Link, data, useSearchParams } from "react-router";
import { Button, CopyButton, CoverArt, Icon, TagList } from "~/components/ui";
import { cn } from "~/lib/utils";

const enabled = () => import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1";

export function loader() {
  if (!enabled()) throw data("Not found", { status: 404 });
  return null;
}

export function meta() {
  return [{ title: "Entry layout (dev)" }, { name: "robots", content: "noindex" }];
}

/** The made-up entry (the demo's "Timetable Diff"), with what a software entry has: facts, places, a repository, tags, a body. */
const E = {
  title: "Timetable Diff",
  summary: "A command-line tool that compares two public transit feeds and says, in plain language, which trains were added, retimed or quietly removed.",
  date: "November 2025",
  status: "Active",
  stack: ["TypeScript", "Node.js"],
  platforms: ["macOS", "Linux"],
  license: "Apache-2.0",
  repo: { label: "example.org/timetable-diff", href: "https://example.org/timetable-diff" },
  places: [
    { name: "Belgrade", region: "Serbia" },
    { name: "Zagreb", region: "Croatia" },
  ],
  linked: { places: 2, entries: 4 },
  tags: ["typescript", "cli", "gtfs", "rail", "tooling"],
  body: [
    "Public transit agencies publish their timetables as feeds, and each new feed silently replaces the last. Timetable Diff reads two of them and tells you, in sentences, what changed between them.",
    "It started as a way to notice when a night train between two capitals stopped running, and grew into a small library of comparisons: added trips, retimed stops, removed calendars.",
  ],
};

type Variant = "a" | "b" | "c";
const VARIANTS: { id: Variant; name: string; idea: string }[] = [
  { id: "a", name: "A. Actions first", idea: "What you can DO comes right under the summary (the repository, a live demo, copy link); the facts are one block read as a sentence of labelled lines; the place joins the running head." },
  { id: "b", name: "B. Spec sheet", idea: "The facts become a quiet sheet in their own column beside the text (under it on a narrow panel): status, stack, platforms, licence, where; the one button at its foot." },
  { id: "c", name: "C. Picture, then facts strip", idea: "The picture leads (full width), then ONE strip of four large cells (status, stack, platforms, licence) and the actions on the right; the place and date are the running head." },
];

export default function DevEntryLayout() {
  const [params, setParams] = useSearchParams();
  const v = (params.get("v") as Variant) in { a: 1, b: 1, c: 1 } ? (params.get("v") as Variant) : "a";
  const wide = params.get("w") === "full";
  const shot = params.get("shot") !== "0";
  const scheme = params.get("scheme");
  useEffect(() => {
    const root = document.documentElement;
    if (scheme === "light" || scheme === "dark") root.dataset.theme = scheme;
    return () => void delete root.dataset.theme;
  }, [scheme]);
  const set = (k: string, val: string) => setParams((p) => (p.set(k, val), p), { replace: true, preventScrollReset: true });
  const info = VARIANTS.find((x) => x.id === v)!;

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-[110rem] px-6 pt-[calc(var(--navbar-height)+1.5rem)] pb-24">
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 type-meta text-muted-foreground">
        <span>DEV · ENTRY LAYOUT PROTOTYPE</span>
        <Pick label="Direction" value={v} options={VARIANTS.map((x) => [x.id, x.id.toUpperCase()])} onPick={(x) => set("v", x)} />
        <Pick label="Width" value={wide ? "full" : "panel"} options={[["panel", "PANEL"], ["full", "FULL"]]} onPick={(x) => set("w", x)} />
        <Pick label="Picture" value={shot ? "1" : "0"} options={[["1", "WITH"], ["0", "WITHOUT"]]} onPick={(x) => set("shot", x)} />
        <Pick label="Theme" value={scheme ?? "system"} options={[["system", "SYSTEM"], ["light", "LIGHT"], ["dark", "DARK"]]} onPick={(x) => set("scheme", x)} />
      </div>
      <p className="mb-8 max-w-[70ch] text-sm text-muted-foreground">
        <strong className="text-foreground">{info.name}.</strong> {info.idea}
      </p>
      <div className={cn("mx-auto border border-dashed border-border bg-background", wide ? "max-w-[90rem] px-14 py-10" : "max-w-[34rem] px-6 py-6")}>
        <article data-surface="reading" data-layout={wide ? "full" : "panel"} className="entry">
          {v === "a" && <LayoutA wide={wide} shot={shot} />}
          {v === "b" && <LayoutB wide={wide} shot={shot} />}
          {v === "c" && <LayoutC wide={wide} shot={shot} />}
        </article>
      </div>
    </main>
  );
}

function Pick({ label, value, options, onPick }: { label: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <span>{label}</span>
      {options.map(([id, text]) => (
        <button key={id} type="button" onClick={() => onPick(id)} aria-pressed={value === id} className={cn("min-h-8 px-1 underline-offset-8", value === id ? "text-foreground underline" : "hover:text-foreground")}>
          {text}
        </button>
      ))}
    </span>
  );
}

/* ---------------------------------------- parts ---------------------------------------- */

const placesLine = E.places.map((p) => p.name).join(", ");

function Back() {
  return (
    <Link to="/software" className="type-meta -ml-1 mb-3 inline-flex min-h-11 w-fit items-center gap-2 px-1 text-muted-foreground no-underline hover:text-foreground hover:underline">
      <Icon name="arrow-left" size="inline" />
      <span>Back to Software</span>
    </Link>
  );
}

function Title({ children }: { children?: ReactNode }) {
  return (
    <>
      <h1 className="entry-title mt-6" style={{ ["--title-scale" as string]: 1 }}>
        {E.title}
      </h1>
      <p className="type-standfirst mt-5 max-w-[25.4em]">{E.summary}</p>
      {children}
    </>
  );
}

function Picture({ ratio = "16 / 10", className }: { ratio?: string; className?: string }) {
  // (a stand-in: the generated cover; a real screenshot goes here, `docs` issue "Software: add screenshots")
  return (
    <figure className={cn("m-0", className)}>
      <div style={{ aspectRatio: ratio }} className="overflow-hidden border border-border">
        <CoverArt seed="timetable-diff" kind="project" cols={64} rows={40} className="h-full [&>svg]:h-full [&>svg]:w-full" />
      </div>
      <figcaption className="type-meta mt-2 text-muted-foreground">The command, comparing two feeds of Serbian Railways.</figcaption>
    </figure>
  );
}

function Body() {
  return (
    <div className="entry-text mt-10 flex flex-col gap-[1.1em]">
      {E.body.map((t) => (
        <p key={t} className="m-0">
          {t}
        </p>
      ))}
    </div>
  );
}

function Actions({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button asChild variant="primary">
        <a href={E.repo.href}>
          <span>Open repository</span>
          <Icon name="arrow-up-right" size="inline" />
        </a>
      </Button>
      <Button asChild variant="secondary">
        <a href={E.repo.href}>
          <span>Live demo</span>
          <Icon name="arrow-up-right" size="inline" />
        </a>
      </Button>
      <CopyButton text="https://example.org/software/timetable-diff" icon="link">Copy link</CopyButton>
    </div>
  );
}

const Where = ({ className }: { className?: string }) => (
  <span className={className}>
    {E.places.map((p, i) => (
      <span key={p.name}>
        {i > 0 && ", "}
        <a href="#belgrade" className="entry-link">
          {p.name}
        </a>
      </span>
    ))}
    <a href="#globe" className="type-meta ml-3 whitespace-nowrap text-muted-foreground hover:text-foreground">
      on the globe <Icon name="arrow-up-right" size="inline" />
    </a>
  </span>
);

/** One labelled line of a facts block: a small label over (or beside) its value. */
function Fact({ label, children, row }: { label: string; children: ReactNode; row?: boolean }) {
  return (
    <div className={cn("min-w-0", row ? "grid grid-cols-[7.5rem_1fr] items-baseline gap-x-4 py-2.5" : "flex flex-col gap-1")}>
      <dt className="type-meta text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const Related = () => (
  <p className="type-meta mt-12 border-t border-border-strong pt-4 text-muted-foreground">
    Linked to <a className="entry-link" href="#places">{E.linked.places} places</a> and <a className="entry-link" href="#entries">{E.linked.entries} entries</a>
  </p>
);

/* ---------------------------------------- A: actions first ---------------------------------------- */

function LayoutA({ wide, shot }: { wide: boolean; shot: boolean }) {
  const glance = (
    <aside className="min-w-0" aria-label="At a glance">
      <h2 className="type-meta m-0 mb-1 border-b border-border-strong pb-2 text-foreground">AT A GLANCE</h2>
      <dl className="m-0 divide-y divide-border">
        <Fact label="Stack" row>
          <TagList label="Stack" tags={E.stack.map((label) => ({ label }))} className="text-[0.9375rem]" />
        </Fact>
        <Fact label="Platforms" row>{E.platforms.join(", ")}</Fact>
        <Fact label="Licence" row>{E.license}</Fact>
        <Fact label="Made in" row>
          <Where />
        </Fact>
      </dl>
      <TagList label="Tags" tags={E.tags.map((label) => ({ label, href: `/software?tag=${label}` }))} className="mt-5 font-meta text-xs" />
    </aside>
  );
  return (
    <div className={cn(wide && "grid grid-cols-[minmax(0,1fr)_minmax(0,26rem)] gap-x-20")}>
      <div className="min-w-0">
        <Back />
        <p className="type-meta m-0 flex flex-wrap items-baseline justify-between gap-x-6 border-b border-border-strong pb-3 text-muted-foreground">
          <span>
            SOFTWARE · {placesLine.toUpperCase()} · {E.date.toUpperCase()}
          </span>
          <span className="uppercase text-foreground">{E.status}</span>
        </p>
        <Title />
        <Actions className="mt-7" />
        {!wide && <div className="mt-9">{glance}</div>}
        {shot && <Picture className="mt-9" />}
        <Body />
        <Related />
      </div>
      {wide && <div className="pt-[5.75rem]">{glance}</div>}
    </div>
  );
}

/* ---------------------------------------- B: spec sheet ---------------------------------------- */

function LayoutB({ wide, shot }: { wide: boolean; shot: boolean }) {
  const sheet = (
    <aside aria-label="Project" className={cn("min-w-0 border border-border-strong p-5", wide && "sticky top-[calc(var(--navbar-height)+1rem)]")}>
      <div className="flex items-baseline justify-between">
        <h2 className="type-meta m-0 text-foreground">PROJECT</h2>
        <span className="type-meta uppercase text-foreground">
          <span aria-hidden="true" className="mr-2 inline-block size-2 bg-signal align-middle" />
          {E.status}
        </span>
      </div>
      <dl className="m-0 mt-3 divide-y divide-border">
        <Fact label="Stack" row>{E.stack.join(", ")}</Fact>
        <Fact label="Platforms" row>{E.platforms.join(", ")}</Fact>
        <Fact label="Licence" row>{E.license}</Fact>
        <Fact label="Written" row>{E.date}</Fact>
        <Fact label="Made in" row>
          <Where />
        </Fact>
      </dl>
      <Button asChild variant="primary" className="mt-4 w-full">
        <a href={E.repo.href}>
          <span className="truncate">Open {E.repo.label}</span>
          <Icon name="arrow-up-right" size="inline" />
        </a>
      </Button>
      <div className="mt-3 flex items-center justify-between">
        <TagList label="Tags" tags={E.tags.slice(0, 3).map((label) => ({ label }))} className="font-meta text-xs" />
        <CopyButton text="https://example.org/software/timetable-diff" icon="link">Copy link</CopyButton>
      </div>
    </aside>
  );
  return (
    <div className={cn(wide ? "grid grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-x-20" : "flex flex-col")}>
      <div className="min-w-0">
        <Back />
        <p className="type-meta m-0 border-b border-border-strong pb-3 text-muted-foreground">SOFTWARE</p>
        <Title />
        {!wide && <div className="mt-8">{sheet}</div>}
        {shot && <Picture className="mt-9" />}
        <Body />
        <Related />
      </div>
      {wide && <div className="pt-[5.75rem]">{sheet}</div>}
    </div>
  );
}

/* ---------------------------------------- C: picture, then facts strip ---------------------------------------- */

function LayoutC({ wide, shot }: { wide: boolean; shot: boolean }) {
  return (
    <div>
      <Back />
      <p className="type-meta m-0 flex flex-wrap items-baseline justify-between gap-x-6 text-muted-foreground">
        <span>
          SOFTWARE · {placesLine.toUpperCase()} · {E.date.toUpperCase()}
        </span>
      </p>
      {shot && <Picture ratio={wide ? "21 / 9" : "16 / 10"} className="mt-4" />}
      <Title />
      <div className={cn("mt-8 grid gap-y-5 border-y border-border-strong py-5", wide ? "grid-cols-[repeat(4,minmax(0,1fr))_auto] items-end gap-x-10" : "grid-cols-2 gap-x-6")}>
        <Cell label="Status">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-2 bg-signal" />
            {E.status}
          </span>
        </Cell>
        <Cell label="Stack">{E.stack.join(", ")}</Cell>
        <Cell label="Platforms">{E.platforms.join(", ")}</Cell>
        <Cell label="Licence">{E.license}</Cell>
        <Button asChild variant="primary" className={cn(!wide && "col-span-2")}>
          <a href={E.repo.href}>
            <span>Open repository</span>
            <Icon name="arrow-up-right" size="inline" />
          </a>
        </Button>
      </div>
      <p className="type-meta mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-muted-foreground">
        <span>
          Made in <Where />
        </span>
        <CopyButton text="https://example.org/software/timetable-diff" icon="link">Copy link</CopyButton>
      </p>
      <div className={cn(wide && "max-w-[44rem]")}>
        <Body />
        <TagList label="Tags" tags={E.tags.map((label) => ({ label, href: `/software?tag=${label}` }))} className="mt-8 font-meta text-xs" />
        <Related />
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="type-meta mb-1 text-muted-foreground">{label}</div>
      <div className="text-[1.0625rem] leading-snug">{children}</div>
    </div>
  );
}
