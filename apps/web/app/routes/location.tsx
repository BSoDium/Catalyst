import { useRef } from "react";
import { data, isRouteErrorResponse, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/location";
import type { loader as shellLoader } from "./shell";
import { PlaceDetail, PlaceNotFound } from "~/components/place-detail";
import { getProjection } from "~/lib/content.server";
import { pageMeta } from "~/lib/meta";
import { getPlaceDetail } from "~/lib/projection";

export async function loader({ params }: Route.LoaderArgs) {
  const place = getPlaceDetail(await getProjection(), params.slug);
  if (!place) throw data({ message: "Place not found" }, { status: 404 });
  return { place };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const place = loaderData?.place;
  if (!place) return pageMeta({ title: "Place not found", description: "There is no place at this address." });
  const fallback = place.region ? `${place.name}, ${place.region}` : place.name;
  return pageMeta({ title: place.name, description: place.summary ?? fallback });
}

export default function LocationRoute({ loaderData }: Route.ComponentProps) {
  // While the panel plays its exit animation the router has already dropped this
  // route's data; keep the last value so the panel does not empty out mid-slide.
  const last = useRef(loaderData);
  if (loaderData) last.current = loaderData;
  return <PlaceDetail place={last.current.place} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const shell = useRouteLoaderData<typeof shellLoader>("routes/shell");
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  if (notFound) return <PlaceNotFound places={shell?.places ?? []} />;
  throw error;
}
