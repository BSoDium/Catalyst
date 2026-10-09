import type { Route } from "./+types/home";
import { websiteJsonLd } from "~/lib/json-ld";
import { metaBase, pageMeta } from "~/lib/meta";

export function meta(args: Route.MetaArgs) {
  const base = metaBase(args);
  return pageMeta({ ...base, jsonLd: base.origin ? websiteJsonLd(base.origin) : undefined });
}

/** The landing page is the shell itself (globe + place list); nothing renders in the panel slot. */
export default function Home() {
  return null;
}
