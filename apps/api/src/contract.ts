/**
 * The public response contract of the Catalyst API (v1).
 *
 * This file is TYPES ONLY and is safe to import from the web app:
 *
 *   import type { PlaceDetailResponse } from "@catalyst/api/contract";
 *
 * It must never gain runtime exports, so that importing it cannot pull the
 * server (or the content) into a client bundle.
 *
 * The shapes below are independent of how content is stored upstream
 * (v1: files; later: database-backed editing). Changing them is a breaking
 * change and requires a new /vN prefix.
 */
import type {
  ContentKind,
  GroupKind,
  PlaceSummary,
  PublishedGroup,
  PublishedBodyBlock,
  PublishedContentItem,
  PublishedContentSummary,
  PublishedCover,
  PublishedMetaEntry,
  PublishedPlace,
  PublishedProjection,
  PublishedRoute,
} from "@catalyst/schemas";

export type {
  ContentKind,
  GroupKind,
  PlaceSummary,
  PublishedBodyBlock,
  PublishedContentItem,
  PublishedContentSummary,
  PublishedCover,
  PublishedGroup,
  PublishedMetaEntry,
  PublishedPlace,
  PublishedProjection,
  PublishedRoute,
};

export type ApiContentMode = "published" | "demo";

export interface ContentCounts {
  places: number;
  groups: number;
  routes: number;
  projects: number;
  articles: number;
  artworks: number;
  poems: number;
}

/** Error envelope used by every non-2xx JSON response. */
export interface ApiError {
  error: {
    /** Stable machine-readable code. */
    code: "not_found" | "method_not_allowed" | "content_unavailable" | "internal_error";
    /** Human-readable, not stable. */
    message: string;
  };
}

/** GET /health, 200 */
export interface HealthResponse {
  ok: true;
  schemaVersion: PublishedProjection["schemaVersion"];
  content: ApiContentMode;
  counts: ContentCounts;
}

/** GET /health, 503 (the content failed validation at startup). */
export interface HealthUnavailableResponse {
  ok: false;
  error: ApiError["error"];
}

/** GET /v1/projection */
export type ProjectionResponse = PublishedProjection;

/** GET /v1/places (sorted by slug) */
export type PlacesResponse = PlaceSummary[];

/** GET /v1/groups (sorted by slug): the automatic place hierarchy, flat; `parent` links it into a tree. */
export type GroupsResponse = PublishedGroup[];

/** A group of a place's chain with its display name resolved. */
export interface ResolvedGroupRef {
  slug: string;
  name: string;
  kind: GroupKind;
}

/** A related content item with its display title resolved. */
export interface ResolvedRelatedItem {
  kind: ContentKind;
  slug: string;
  title: string;
}

/** GET /v1/places/:slug */
export type PlaceDetailResponse = Omit<PublishedPlace, "related"> & {
  related: ResolvedRelatedItem[];
  /** The place's groups from the innermost (the place's own `group`) to the root; empty when it has none. */
  groupChain: ResolvedGroupRef[];
};

/** GET /v1/routes (authored order) */
export type RoutesResponse = PublishedRoute[];

/**
 * GET /v1/projects, /v1/articles, /v1/artworks, /v1/poems (authored order): SUMMARIES, an entry without its `body`.
 * The complete entries are in GET /v1/projection and in the detail endpoints.
 */
export type ContentItemsResponse = PublishedContentSummary[];

/** A place of an entry with its display name resolved. */
export interface ResolvedPlaceRef {
  slug: string;
  name: string;
}

/**
 * GET /v1/projects/:slug, /v1/articles/:slug, /v1/artworks/:slug, /v1/poems/:slug: the complete entry (`body` included)
 * with its kind and its places resolved, in the order of `placeSlugs`, so a detail view needs no second request.
 */
export type ContentDetailResponse = PublishedContentItem & {
  kind: ContentKind;
  places: ResolvedPlaceRef[];
};
