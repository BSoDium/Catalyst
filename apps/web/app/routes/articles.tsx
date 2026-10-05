import type { Route } from "./+types/articles";
import { ContentPage } from "~/components/content-page";
import { getProjection } from "~/lib/content.server";
import { pageMeta } from "~/lib/meta";
import { listContent } from "~/lib/projection";

export async function loader() {
  return { items: listContent(await getProjection(), "article") };
}

export function meta(_args: Route.MetaArgs) {
  return pageMeta({ title: "Articles", description: "Articles from the Catalyst archive." });
}

export default function ArticlesRoute({ loaderData }: Route.ComponentProps) {
  return <ContentPage heading="Articles" items={loaderData.items} />;
}
