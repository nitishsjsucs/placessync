import { usePageTitle } from "./usePageTitle.ts";

export function MyBookingsPage() {
  usePageTitle("My bookings");
  return (
    <section>
      <h1>My bookings</h1>
    </section>
  );
}
