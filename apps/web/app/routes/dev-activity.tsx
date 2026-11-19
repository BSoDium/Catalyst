/** DEV ONLY: `/dev/activity`, the prototype of the activity picture for the software page (issue: GitHub contributions + WakaTime), on a snapshot of the real data (`lib/activity.sample.json`). */
import { data } from "react-router";
import { ActivityScene } from "~/components/activity-scene";
import sample from "~/lib/activity.sample.json";
import type { Activity } from "~/lib/activity";

const enabled = () => import.meta.env.DEV || process.env.CATALYST_DEV_ROUTES === "1";

export function loader() {
  if (!enabled()) throw data("Not found", { status: 404 });
  return null;
}

export function meta() {
  return [{ title: "Activity (dev)" }, { name: "robots", content: "noindex" }];
}

export default function DevActivity() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="type-h2 mb-4">Activity</h1>
      <ActivityScene activity={sample as Activity} className="aspect-[3.8/1] w-full" />
    </main>
  );
}
