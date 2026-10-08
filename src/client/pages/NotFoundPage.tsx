import { useNavigate } from "react-router";
import { Button } from "../ui/Button.tsx";
import { usePageTitle } from "./usePageTitle.ts";

export function NotFoundPage() {
  usePageTitle("Not found");
  const navigate = useNavigate();
  return (
    <section>
      <h1>Page not found</h1>
      <p>There is nothing at this address.</p>
      <Button onClick={() => navigate("/find")}>Go to Find a space</Button>
    </section>
  );
}
