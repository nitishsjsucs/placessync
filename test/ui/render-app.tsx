import { render } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Providers, appRoutes } from "../../src/client/App.tsx";

/** Renders the whole app at a path with a memory router (fetch must be faked first). */
export function renderAt(path: string) {
  return renderAtEntries([path]);
}

/** Like renderAt, with earlier history entries; the last entry is the current one. */
export function renderAtEntries(entries: string[]) {
  const router = createMemoryRouter(appRoutes, { initialEntries: entries, initialIndex: entries.length - 1 });
  const utils = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}
