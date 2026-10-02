import { createBrowserRouter, Outlet, RouteObject } from "react-router-dom";
import AnalyticsBanner from "@/components/AnalyticsBanner";
import Copyright from "@/components/Copyright";
import OutdatedVersionNotice from "@/components/OutdatedVersionNotice";
import NavigationBar from "@/navigation/NavigationBar";
import NoMatch from "@/pages/NoMatch";

/**
 * The architecture of the application routes.
 */
export const architecture: RouteObject[] = [
  {
    element: (
      <>
        <OutdatedVersionNotice />
        <AnalyticsBanner />
        <Copyright />
        <NavigationBar>
          <Outlet />
        </NavigationBar>
      </>
    ),
    children: [
      {
        async lazy() {
          const { default: Landing } = await import("@/pages/Landing");
          return { Component: Landing };
        },
        index: true,
      },
      {
        async lazy() {
          const { default: Resume } = await import("@/pages/Resume");
          return { Component: Resume };
        },
        path: "resume",
      },
      {
        async lazy() {
          const { default: Projects } = await import(
            "@/components/projects/Projects"
          );
          return { Component: Projects };
        },
        path: "projects",
      },
    ],
  },
  {
    element: <NoMatch />,
    path: "*",
  },
];

/**
 * The router of the application.
 */
const router = createBrowserRouter(architecture);

export default router;
