/**
 * DEV ONLY: `/dev/trip-cards` is a gallery of the trip cards (#510), a storybook for the subject cutout: every trip of the content with its own photograph, and every photograph
 * (and route picture) on a trip of your choice, at several widths, each card resizable by its corner (the cards are resizable in the app too), with the cutout on or off, light or
 * dark. A card says what Vision found in its picture (the share the subject covers) and whether the poster uses it. It exists only where `routes.ts` includes it (development,
 * or CATALYST_DEV_ROUTES=1) and answers 404 anywhere else.
 *
 * Query: `?scheme=light|dark`, `?cutout=off`, `?w=320,480,720` (the widths), `?occlude=0.35` (the share of the word the subject hides; default: each picture's own), `?trip=<route id>` (the trip the photographs are shown on).
 */
import { useEffect, useMemo } from "react";
import { data, useLoaderData, useSearchParams } from "react-router";
import { TripCard } from "~/components/trip-card";
import { TripPhotoFilters, TripPoster } from "~/components/trip-map";
import { getProjection } from "~/lib/content.server";
import { CUTOUT_MAX, CUTOUT_MIN, cutoutOf, rawCutoutOf } from "~/lib/cutout";
import { tripsOf, type Trip, type TripPhoto } from "~/lib/journeys";

const enabled = () => import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1";

interface PictureItem {
  id: string;
  label: string;
  photo: TripPhoto;
}

export async function loader() {
  if (!enabled()) throw data("Not found", { status: 404 });
  const projection = await getProjection();
  const trips: Array<{ trip: Trip; here: string }> = [];
  for (const route of projection.routes) {
    const here = route.stops[0];
    const trip = here === undefined ? undefined : tripsOf(projection, here).find((t) => t.id === route.id);
    if (trip && here !== undefined) trips.push({ trip, here });
  }
  const pictures: PictureItem[] = [
    ...projection.photographs.filter((p) => p.cover).map((p) => ({ id: p.slug, label: p.slug, photo: { src: p.cover!.src, width: p.cover!.width, ...(p.cover!.small ? { small: p.cover!.small } : {}) } })),
    ...projection.routes.flatMap((r) => (r.image ? [{ id: `${r.id}-image`, label: `${r.id} (route picture)`, photo: { src: r.image.src, width: r.image.width, ...(r.image.small ? { small: r.image.small } : {}) } }] : [])),
  ];
  return { trips, pictures };
}

export function meta() {
  return [{ title: "Trip cards (dev)" }, { name: "robots", content: "noindex" }];
}

const WIDTHS = [320, 480, 720];

function useForcedScheme(scheme: string | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (scheme === "light" || scheme === "dark") root.setAttribute("data-scheme", scheme);
    else root.removeAttribute("data-scheme");
    return () => root.removeAttribute("data-scheme");
  }, [scheme]);
}

/** A box the reader can resize by its corner: the card inside takes the width it is given, as in a resizable panel. */
function Resizable({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div className="max-w-full shrink-0 resize-x overflow-hidden border border-dashed border-border" style={{ width, minWidth: 200 }}>
      {children}
    </div>
  );
}

const CHECKER = "repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%) 50% / 14px 14px";

export default function DevTripCards() {
  const { trips, pictures } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const scheme = params.get("scheme");
  useForcedScheme(scheme);
  const cutout = params.get("cutout") !== "off";
  const widths = useMemo(() => {
    const given = (params.get("w") ?? "").split(",").map(Number).filter((n) => n >= 200 && n <= 1200);
    return given.length ? given : WIDTHS;
  }, [params]);
  const tripId = params.get("trip") ?? trips[0]?.trip.id;
  const onTrip = trips.find((t) => t.trip.id === tripId) ?? trips[0];
  const occlude = params.get("occlude") === null ? undefined : Number(params.get("occlude"));
  const set = (key: string, value: string | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  const withSubject = pictures.filter((p) => cutoutOf(p.photo.src)).length;
  const none = pictures.filter((p) => !rawCutoutOf(p.photo.src)).length;

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-10 p-6 pt-20 text-foreground">
      <TripPhotoFilters />
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-2xl font-semibold">Trip cards: subject in front of the word</h1>
        <p className="m-0 max-w-3xl text-sm text-muted-foreground">
          {pictures.length} pictures: {withSubject} have a subject the poster uses (it covers {Math.round(CUTOUT_MIN * 100)}% to {Math.round(CUTOUT_MAX * 100)}% of the picture), {pictures.length - withSubject - none} have a matte that is a speck or the whole picture,
          {" "}{none} none at all. Drag the corner of a card to resize it.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={cutout} onChange={(e) => set("cutout", e.target.checked ? null : "off")} /> Cutout in front of the word
          </label>
          <label className="flex items-center gap-2">
            Word hidden
            <input type="range" min={0} max={0.8} step={0.05} value={occlude ?? 0.35} onChange={(e) => set("occlude", e.target.value)} />
            {occlude === undefined ? "per picture" : `${Math.round(occlude * 100)}%`}
            {occlude !== undefined && <button type="button" onClick={() => set("occlude", null)} className="border border-border px-2 py-0.5">reset</button>}
          </label>
          <label className="flex items-center gap-2">
            Scheme
            <select value={scheme ?? "system"} onChange={(e) => set("scheme", e.target.value === "system" ? null : e.target.value)} className="border border-border bg-background px-2 py-1">
              <option value="system">system</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <span className="flex items-center gap-2">
            Widths
            {[240, 320, 400, 480, 600, 720, 960].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={widths.includes(n)}
                onClick={() => set("w", (widths.includes(n) ? widths.filter((x) => x !== n) : [...widths, n].sort((a, b) => a - b)).join(",") || null)}
                className="border border-border px-2 py-1 aria-pressed:bg-foreground aria-pressed:text-background"
              >
                {n}
              </button>
            ))}
          </span>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="m-0 text-lg font-semibold">The trips, each with its own picture</h2>
        {trips.map(({ trip, here }) => {
          const raw = trip.photo ? rawCutoutOf(trip.photo.src) : undefined;
          return (
            <div key={trip.id} className="flex flex-col gap-2">
              <p className="m-0 font-mono text-xs text-muted-foreground">
                {trip.id} · {trip.word} · {trip.photo ? (raw ? `subject ${Math.round(raw.coverage * 100)}%${cutoutOf(trip.photo.src) ? "" : " (not used)"}` : "no subject found") : "no picture"}
              </p>
              <div className="flex flex-wrap items-start gap-4">
                {widths.map((w) => (
                  <Resizable key={w} width={w}>
                    <TripCard trip={trip} here={here} cutout={cutout} occlude={occlude} />
                  </Resizable>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="m-0 text-lg font-semibold">Every picture, on</h2>
          <select value={onTrip?.trip.id} onChange={(e) => set("trip", e.target.value)} className="border border-border bg-background px-2 py-1 text-sm">
            {trips.map(({ trip }) => (
              <option key={trip.id} value={trip.id}>
                {trip.id} · {trip.word}
              </option>
            ))}
          </select>
        </div>
        {onTrip && (
          <div className="flex flex-wrap items-start gap-6">
            {pictures.map((pic) => {
              const raw = rawCutoutOf(pic.photo.src);
              const used = cutoutOf(pic.photo.src);
              const trip: Trip = { ...onTrip.trip, photo: pic.photo };
              return (
                <figure key={pic.id} className="m-0 flex flex-col gap-1.5">
                  <figcaption className="font-mono text-xs text-muted-foreground">
                    {pic.label} · {raw ? `subject ${Math.round(raw.coverage * 100)}%${used ? "" : " (not used)"}` : "no subject found"}
                  </figcaption>
                  <div className="flex items-start gap-3">
                    {widths.map((w) => (
                      <Resizable key={w} width={w}>
                        <div className="relative isolate">
                          <TripPoster trip={trip} here={onTrip.here} cutout={cutout} occlude={occlude} />
                        </div>
                      </Resizable>
                    ))}
                    <div className="h-24 w-20 shrink-0 border border-border" style={{ background: CHECKER }}>
                      {raw && <img src={raw.src} alt="" className="size-full object-contain" />}
                    </div>
                  </div>
                </figure>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
