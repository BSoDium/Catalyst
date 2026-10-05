import type { Route } from "./+types/home";
import { pageMeta } from "~/lib/meta";

export function meta(_args: Route.MetaArgs) {
  return pageMeta();
}

/** The landing page is the shell itself (globe + place list); nothing renders in the panel slot. */
export default function Home() {
  return null;
}
