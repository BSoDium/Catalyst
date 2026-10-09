import { useRef } from "react";
import { useLocation, useRouteLoaderData } from "react-router";
import { EntryView } from "~/components/entry/entry-view";
import { useLast } from "~/hooks/use-last";
import { parsePanelPath, parseView, resolveBackTarget, type EntryView as EntryViewMode } from "~/lib/entries";
import type { EntryLoaderData } from "~/lib/entries";
import type { loader as shellLoader } from "~/routes/shell";

type Frozen = { layout: EntryViewMode; backTo: ReturnType<typeof resolveBackTarget> };

/**
 * The element of an entry route inside the shell's detail panel: the loaded entry, in the container the URL selects
 * (`?view=full`), with a way back to the place the visitor came from. While the panel plays its exit animation the router has
 * already left the route (no loader data, no query): what was shown (the entry, the layout, the way back) stays as it was.
 */
export function EntryRoute({ data }: { data: EntryLoaderData | undefined }) {
  const shown = useLast(data);
  const location = useLocation();
  const shell = useRouteLoaderData<typeof shellLoader>("routes/shell");
  const frozen = useRef<Frozen>({ layout: "panel", backTo: null });
  if (!shown) return null;
  const route = parsePanelPath(location.pathname);
  if (route?.type === "entry" && route.kind === shown.entry.kind && route.slug === shown.entry.slug) {
    frozen.current = { layout: parseView(location.search), backTo: resolveBackTarget(location.state, shell?.places ?? []) };
  }
  return <EntryView entry={shown.entry} layout={frozen.current.layout} backTo={frozen.current.backTo} />;
}
