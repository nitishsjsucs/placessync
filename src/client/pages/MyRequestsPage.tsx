import { usePageTitle } from "./usePageTitle.ts";

export function MyRequestsPage() {
  usePageTitle("My requests");
  return (
    <section>
      <h1>My requests</h1>
    </section>
  );
}
