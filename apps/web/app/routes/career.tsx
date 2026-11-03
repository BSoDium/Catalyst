import { data } from "react-router";
import type { Route } from "./+types/career";
import { CareerPage } from "~/components/career-page";
import { getProjection } from "~/lib/content.server";
import { careerMeta } from "~/lib/career-meta";
import { metaBase } from "~/lib/meta";

/**
 * `/career`: the curriculum vitae (docs/career-page.md). It exists only while the projection has a `career` (the owner's document is
 * published, or a preview or demo content carries one): without it the address is a real 404, which the root boundary draws with the
 * site's not-found page, and no link to it is rendered anywhere (`useHasCareer`, the search index).
 */
export async function loader() {
  const projection = await getProjection();
  const career = projection.career;
  if (!career) throw data({ message: "No career document" }, { status: 404 });
  // The places the document names that the site has: a location links to its page on the globe only when that page exists.
  const have = new Set(projection.places.map((p) => p.slug));
  const named = [...career.roles, ...career.education].flatMap((x) => (x.place && have.has(x.place) ? [x.place] : []));
  // The project entries a position's project names that the site has: its title links to the entry's page only when that page exists.
  const haveProject = new Set(projection.projects.map((p) => p.slug));
  const projects = [...new Set(career.roles.flatMap((r) => (r.projects ?? []).flatMap((p) => (p.entry && haveProject.has(p.entry) ? [p.entry] : []))))];
  return { career, places: [...new Set(named)], projects };
}

export function meta(args: Route.MetaArgs) {
  return careerMeta(args.loaderData?.career, metaBase(args));
}

export default function CareerRoute({ loaderData }: Route.ComponentProps) {
  return <CareerPage career={loaderData.career} places={loaderData.places} projects={loaderData.projects} />;
}
