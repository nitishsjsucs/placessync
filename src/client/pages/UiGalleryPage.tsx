// The UI kit gallery (SPEC 14.1): every one of the eight components in each state, used
// by the e2e axe gate and for screenshots.
import { useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { DateGrid } from "../ui/DateGrid.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { SlotGrid, type SlotSelection } from "../ui/SlotGrid.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import { isWeekday } from "../../shared/time.ts";
import styles from "./pages.module.css";
import { usePageTitle } from "./usePageTitle.ts";

const OPTIONS = [
  { value: "res_redwood", label: "Redwood", hint: "Room, 4 seats" },
  { value: "res_sequoia", label: "Sequoia", hint: "Room, 8 seats" },
  { value: "res_cypress", label: "Cypress", hint: "Phone booth" },
];
const ROWS = [
  { id: "a", label: "Desk 2A-01", busy: [{ startMin: 540, endMin: 600 }] },
  { id: "b", label: "Desk 2A-02", busy: [{ startMin: 600, endMin: 690, mine: true }] },
  { id: "c", label: "Sequoia (8)", busy: [] },
];
type Row = { id: string; space: string; time: string };
const TABLE_ROWS: Row[] = [
  { id: "1", space: "Desk 2A-01", time: "09:00 to 11:00" },
  { id: "2", space: "Sequoia", time: "13:00 to 14:00" },
];

export function UiGalleryPage() {
  usePageTitle("UI kit gallery");
  const [text, setText] = useState("Projector flickers");
  const [bad, setBad] = useState("ab");
  const [long, setLong] = useState("The projector in Sequoia flickers and then shows no signal.");
  const [combo, setCombo] = useState<string | null>("res_sequoia");
  const [comboEmpty, setComboEmpty] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>("2026-10-14");
  const [selection, setSelection] = useState<SlotSelection | null>({ rowId: "c", startMin: 600, endMin: 660 });
  const [tab, setTab] = useState("one");
  const [dialog, setDialog] = useState(false);

  return (
    <section className={styles.stack}>
      <h1>UI kit gallery</h1>
      <p>The eight reusable components and their states.</p>

      <h2>Button</h2>
      <div className={styles.row}>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
        <Button size="sm">Small</Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
      </div>

      <h2>TextField</h2>
      <div className={styles.form}>
        <TextField label="Title" value={text} onChange={setText} hint="5 to 120 characters." maxLength={120} required />
        <TextField label="Short title" value={bad} onChange={setBad} error="Title needs at least 5 characters." required />
        <TextField label="Description" value={long} onChange={setLong} multiline maxLength={2000} hint="What happened, where, and since when." />
      </div>

      <h2>Combobox</h2>
      <div className={styles.form}>
        <Combobox label="Room" options={OPTIONS} value={combo} onChange={setCombo} hint="Type to filter." />
        <Combobox label="Room with an error" options={OPTIONS} value={comboEmpty} onChange={setComboEmpty} error="Choose a room." />
      </div>

      <h2>DateGrid</h2>
      <DateGrid label="Gallery date" value={date} onChange={setDate} today="2026-10-08" isDisabled={(d) => (isWeekday(d) ? null : "Closed on weekends")} />

      <h2>SlotGrid</h2>
      <SlotGrid label="Gallery availability" rows={ROWS} openMin={480} closeMin={780} selection={selection} onSelect={setSelection} />

      <h2>Tabs</h2>
      <Tabs
        tabs={[
          { id: "one", label: "Upcoming" },
          { id: "two", label: "Past" },
          { id: "three", label: "Cancelled" },
        ]}
        value={tab}
        onChange={setTab}
        label="Gallery tabs"
      >
        {(id) => <p>Panel for {id}.</p>}
      </Tabs>

      <h2>DataTable</h2>
      <DataTable
        caption="Gallery table"
        columns={[
          { key: "space", header: "Space", render: (r: Row) => r.space },
          { key: "time", header: "Time", render: (r: Row) => r.time },
        ]}
        rows={TABLE_ROWS}
        rowKey={(r) => r.id}
        rowActions={(r) => (
          <Button size="sm" variant="secondary">
            Details{" "}
            <span className="visually-hidden">for {r.space}</span>
          </Button>
        )}
      />
      <DataTable caption="Empty gallery table" columns={[{ key: "space", header: "Space", render: (r: Row) => r.space }]} rows={[]} rowKey={(r) => r.id} empty="Nothing to show." />

      <h2>Dialog</h2>
      <Button onClick={() => setDialog(true)}>Open dialog</Button>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Gallery dialog"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Close
            </Button>
            <Button onClick={() => setDialog(false)}>Confirm</Button>
          </>
        }
      >
        <TextField label="Note" value={text} onChange={setText} />
      </Dialog>
    </section>
  );
}
