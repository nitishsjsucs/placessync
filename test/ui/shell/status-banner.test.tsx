import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Link, Outlet, createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import { StatusBanner, StatusBannerProvider, useStatusBanner } from "../../../src/client/shell/StatusBanner.tsx";
import { Button } from "../../../src/client/ui/Button.tsx";
import { Dialog } from "../../../src/client/ui/Dialog.tsx";
import { expectNoAxeViolations } from "../axe.ts";

function Layout() {
  return (
    <StatusBannerProvider>
      <main id="main" tabIndex={-1}>
        <StatusBanner />
        <Outlet />
      </main>
    </StatusBannerProvider>
  );
}

// A page whose trigger is disabled once the action succeeds, like Book on Find a space.
function BookPage() {
  const banner = useStatusBanner();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <h1>Book</h1>
      <Button disabled={done} onClick={() => setOpen(true)}>
        Book it
      </Button>
      <Link to="/other">Elsewhere</Link>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Confirm"
        actions={
          <Button
            onClick={() => {
              setDone(true);
              setOpen(false);
              banner.show({ text: "Booked Desk 2A-01.", link: { to: "/bookings", label: "See My bookings" }, focus: true });
            }}
          >
            Confirm booking
          </Button>
        }
      >
        <p>Desk 2A-01</p>
      </Dialog>
    </>
  );
}

function renderBanner() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Layout />,
        children: [
          { path: "book", element: <BookPage /> },
          { path: "other", element: <h1>Other</h1> },
          { path: "bookings", element: <h1>My bookings</h1> },
        ],
      },
    ],
    { initialEntries: ["/book"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function book() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Book it" }));
  await user.click(screen.getByRole("button", { name: "Confirm booking" }));
  return user;
}

describe("StatusBanner", () => {
  it("shows the result with its link and takes focus after a closing Dialog whose opener is disabled", async () => {
    renderBanner();
    await book();
    const banner = screen.getByTestId("status-banner");
    expect(banner.textContent).toContain("Booked Desk 2A-01.");
    expect(screen.getByRole("link", { name: "See My bookings" }).getAttribute("href")).toBe("/bookings");
    expect(document.activeElement).toBe(banner);
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.getAttribute("aria-live")).toBeNull();
    await expectNoAxeViolations(banner);
  });

  it("Dismiss hides it and puts focus on main", async () => {
    renderBanner();
    const user = await book();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("status-banner")).toBeNull();
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("clears when the pathname changes and does not come back on return", async () => {
    const router = renderBanner();
    const user = await book();
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(await screen.findByRole("heading", { name: "Other" })).toBeTruthy();
    expect(screen.queryByTestId("status-banner")).toBeNull();
    await router.navigate("/book");
    expect(await screen.findByRole("heading", { name: "Book" })).toBeTruthy();
    expect(screen.queryByTestId("status-banner")).toBeNull();
  });

  it("following its link clears it on the next page", async () => {
    const router = renderBanner();
    const user = await book();
    await user.click(screen.getByRole("link", { name: "See My bookings" }));
    expect(await screen.findByRole("heading", { name: "My bookings" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/bookings");
    expect(screen.queryByTestId("status-banner")).toBeNull();
  });
});
