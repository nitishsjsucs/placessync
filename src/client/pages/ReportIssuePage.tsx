// Report an issue (SPEC 14.1): title, description, optional resource and location note.
// Client validation mirrors the API (title 5 to 120, description 20 to 2000); on submit
// an error summary receives focus and links to each field.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CreateRequestBody, CreateRequestResponse, DESCRIPTION_MAX, ResourcesResponse, TITLE_MAX_LEN } from "../../shared/api.ts";
import { ApiClientError, api } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { Combobox, type ComboboxOption } from "../ui/Combobox.tsx";
import { TextField } from "../ui/TextField.tsx";
import styles from "./pages.module.css";
import { useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

const FIELD_IDS: Record<string, string> = { title: "issue-title", description: "issue-description", resourceId: "issue-resource", locationNote: "issue-location" };
const FIELD_NAMES: Record<string, string> = { title: "Title", description: "Description", resourceId: "Space", locationNote: "Location" };

export function ReportIssuePage() {
  usePageTitle("Report an issue");
  const site = useSite();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [locationNote, setLocationNote] = useState("");
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusSummary, setFocusSummary] = useState(0);

  useEffect(() => {
    api
      .get(`/api/sites/${site.siteId}/resources`, ResourcesResponse)
      .then((r) => setOptions(r.resources.map((x) => ({ value: x.id, label: x.name, hint: `Floor ${x.floor}, ${x.zone}` }))))
      .catch(() => setOptions([]));
  }, [site.siteId]);

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  async function submit() {
    setProblem(null);
    const body = { siteId: site.siteId, title, description, resourceId: resourceId ?? undefined, locationNote: locationNote.trim() || undefined };
    const parsed = CreateRequestBody.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const key = String(i.path[0] ?? "form");
        if (!next[key]) next[key] = i.message;
      }
      setErrors(next);
      setFocusSummary((n) => n + 1);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const res = await api.post("/api/requests", parsed.data, CreateRequestResponse);
      navigate(`/requests/${res.request.id}`, { state: { created: true, triage: res.triage } });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 422) {
        setErrors(err.fieldErrors());
        setFocusSummary((n) => n + 1);
      } else {
        setProblem("The request could not be submitted. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  const errorEntries = Object.entries(errors);

  return (
    <section className={styles.stack}>
      <h1>Report an issue</h1>
      <p className={styles.muted}>Tell facilities what is wrong. It is categorized automatically, then reviewed by facilities staff.</p>
      {errorEntries.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-summary-title" className={styles.errorSummary}>
          <h2 id="error-summary-title">Fix {errorEntries.length === 1 ? "this problem" : `these ${errorEntries.length} problems`}</h2>
          <ul>
            {errorEntries.map(([field, message]) => (
              <li key={field}>
                <a href={`#${FIELD_IDS[field] ?? ""}`}>
                  {FIELD_NAMES[field] ?? field}: {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField id={FIELD_IDS.title} label="Title" value={title} onChange={setTitle} required maxLength={TITLE_MAX_LEN} hint="5 to 120 characters, for example: Projector in Sequoia shows no signal." error={errors.title} />
        <TextField
          id={FIELD_IDS.description}
          label="Description"
          value={description}
          onChange={setDescription}
          required
          multiline
          maxLength={DESCRIPTION_MAX}
          hint="20 to 2,000 characters: what happened, where, and since when."
          error={errors.description}
        />
        <Combobox id={FIELD_IDS.resourceId} label="Space (optional)" options={options} value={resourceId} onChange={setResourceId} placeholder="Type a desk or room" error={errors.resourceId} />
        <TextField id={FIELD_IDS.locationNote} label="Location note (optional)" value={locationNote} onChange={setLocationNote} maxLength={200} hint="For places that are not a bookable space, such as the second floor kitchen." error={errors.locationNote} />
        {problem ? <p role="alert">{problem}</p> : null}
        <Button type="submit" loading={pending}>
          Submit request
        </Button>
      </form>
    </section>
  );
}
