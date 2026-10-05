import type { Route } from "./+types/artworks";
import { ContentPage } from "~/components/content-page";
import { getProjection } from "~/lib/content.server";
import { pageMeta } from "~/lib/meta";
import { listContent } from "~/lib/projection";

export async function loader() {
  return { items: listContent(await getProjection(), "artwork") };
}

export function meta(_args: Route.MetaArgs) {
  return pageMeta({ title: "Artworks", description: "Artworks from the Catalyst archive." });
}

export default function ArtworksRoute({ loaderData }: Route.ComponentProps) {
  return <ContentPage heading="Artworks" items={loaderData.items} />;
}
