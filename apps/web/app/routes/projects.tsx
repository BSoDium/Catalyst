import type { Route } from "./+types/projects";
import { ContentPage } from "~/components/content-page";
import { getProjection } from "~/lib/content.server";
import { pageMeta } from "~/lib/meta";
import { listContent } from "~/lib/projection";

export async function loader() {
  return { items: listContent(await getProjection(), "project") };
}

export function meta(_args: Route.MetaArgs) {
  return pageMeta({ title: "Projects", description: "Projects from the Catalyst archive." });
}

export default function ProjectsRoute({ loaderData }: Route.ComponentProps) {
  return <ContentPage heading="Projects" items={loaderData.items} />;
}
