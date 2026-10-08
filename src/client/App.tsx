// Router and role guards (SPEC 14.1).
import { type ReactNode, useMemo } from "react";
import { Navigate, type RouteObject, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AdminDashboardPage } from "./pages/AdminDashboardPage.tsx";
import { DevLoginPage } from "./pages/DevLoginPage.tsx";
import { FindSpacePage } from "./pages/FindSpacePage.tsx";
import { MyBookingsPage } from "./pages/MyBookingsPage.tsx";
import { MyRequestsPage } from "./pages/MyRequestsPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { ReportIssuePage } from "./pages/ReportIssuePage.tsx";
import { RequestDetailPage } from "./pages/RequestDetailPage.tsx";
import { ResourcePage } from "./pages/ResourcePage.tsx";
import { StaffDashboardPage } from "./pages/StaffDashboardPage.tsx";
import { UiGalleryPage } from "./pages/UiGalleryPage.tsx";
import { RequireRole, RequireSession } from "./session/RequireRole.tsx";
import { SessionProvider } from "./session/SessionProvider.tsx";
import { AnnouncerProvider } from "./shell/Announcer.tsx";
import { AppShell } from "./shell/AppShell.tsx";

export const appRoutes: RouteObject[] = [
  { path: "/login", element: <DevLoginPage /> },
  {
    path: "/",
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Navigate to="/find" replace /> },
      { path: "find", element: <FindSpacePage /> },
      { path: "resources/:id", element: <ResourcePage /> },
      { path: "bookings", element: <MyBookingsPage /> },
      { path: "requests/new", element: <ReportIssuePage /> },
      { path: "requests", element: <MyRequestsPage /> },
      { path: "requests/:id", element: <RequestDetailPage /> },
      {
        path: "staff",
        element: (
          <RequireRole roles={["facilities_staff", "facilities_admin"]}>
            <StaffDashboardPage />
          </RequireRole>
        ),
      },
      {
        path: "admin",
        element: (
          <RequireRole roles={["facilities_admin"]}>
            <AdminDashboardPage />
          </RequireRole>
        ),
      },
      { path: "ui", element: <UiGalleryPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AnnouncerProvider>{children}</AnnouncerProvider>
    </SessionProvider>
  );
}

export function App() {
  const router = useMemo(() => createBrowserRouter(appRoutes), []);
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
