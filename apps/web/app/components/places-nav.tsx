import { Link } from "react-router";
import type { PlaceSummary, PublishedGroup } from "@catalyst/schemas";
import { buildPlaceTree, placePath, type PlaceTreeNode } from "~/lib/projection";

export const PLACES_NAV_ID = "places-nav";

interface PlacesNavProps {
  places: PlaceSummary[];
  /** The automatic hierarchy: the list nests the places under their groups (headings, not links). Empty = the flat list. */
  groups?: PublishedGroup[];
  currentSlug: string | null;
  onFocusSlug(slug: string | null): void;
  /** Called when a link is activated, so focus can return to it when the panel closes. */
  onOpen(): void;
}

/**
 * The dependable, keyboard- and screen-reader path to every place (the globe is a pointer enhancement).
 * Always in the DOM, visually hidden like a skip link (`.places-nav` in app.css) and revealed as a compact floating
 * list while a link inside it has focus; it hides again when focus leaves. Hover or focus highlights the
 * place on the globe. With groups the list mirrors the globe's hierarchy: a group is a heading (not focusable, so the
 * tab order and the focus-reveal are those of the flat list) above a nested list of its subgroups and places.
 */
export function PlacesNav({ places, groups = [], currentSlug, onFocusSlug, onOpen }: PlacesNavProps) {
  if (places.length === 0) return null;
  const tree = buildPlaceTree(places, groups);
  return (
    <nav id={PLACES_NAV_ID} aria-label="Places" className="places-nav">
      <p aria-hidden="true" className="label px-4 pt-3 pb-1">
        Places
      </p>
      <PlaceList nodes={tree} depth={0} currentSlug={currentSlug} onFocusSlug={onFocusSlug} onOpen={onOpen} className="pb-2" />
    </nav>
  );
}

interface ListProps extends Pick<PlacesNavProps, "currentSlug" | "onFocusSlug" | "onOpen"> {
  nodes: PlaceTreeNode[];
  depth: number;
  className?: string;
  labelledBy?: string;
}

function PlaceList({ nodes, depth, currentSlug, onFocusSlug, onOpen, className, labelledBy }: ListProps) {
  return (
    <ul className={className} aria-labelledby={labelledBy}>
      {nodes.map((node) =>
        node.kind === "place" ? (
          <li key={node.place.slug}>
            <Link
              to={placePath(node.place.slug)}
              prefetch="intent"
              data-place-link={node.place.slug}
              aria-current={node.place.slug === currentSlug ? "page" : undefined}
              onClick={onOpen}
              onMouseEnter={() => onFocusSlug(node.place.slug)}
              onMouseLeave={() => onFocusSlug(null)}
              onFocus={() => onFocusSlug(node.place.slug)}
              onBlur={() => onFocusSlug(null)}
              style={depth > 0 ? { paddingLeft: `${1 + depth * 0.75}rem` } : undefined}
              className="flex min-h-11 items-baseline -outline-offset-2 justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
            >
              <span>{node.place.name}</span>
              {node.place.region && <span className="label truncate">{node.place.region}</span>}
            </Link>
          </li>
        ) : (
          <li key={node.group.slug} data-place-group={node.group.slug}>
            <p
              id={`${PLACES_NAV_ID}-group-${node.group.slug}`}
              className="label pt-3 pb-1"
              style={{ paddingLeft: `${1 + depth * 0.75}rem`, paddingRight: "1rem" }}
            >
              {node.group.name}
            </p>
            <PlaceList
              nodes={node.children}
              depth={depth + 1}
              currentSlug={currentSlug}
              onFocusSlug={onFocusSlug}
              onOpen={onOpen}
              labelledBy={`${PLACES_NAV_ID}-group-${node.group.slug}`}
            />
          </li>
        ),
      )}
    </ul>
  );
}
