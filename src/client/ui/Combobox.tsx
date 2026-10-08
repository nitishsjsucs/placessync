// Combobox (SPEC 14.2): ARIA 1.2 editable combobox with a listbox popup and
// aria-activedescendant. ArrowDown opens and moves, ArrowUp, Home and End move, Enter
// selects, Escape closes and a second Escape clears, Tab closes without selecting,
// and typing filters.
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import styles from "./Combobox.module.css";

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ComboboxProps {
  label: string;
  options: readonly ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  id?: string;
  /** Custom filter; the default matches the label and hint case-insensitively. */
  filter?: (option: ComboboxOption, query: string) => boolean;
}

const defaultFilter = (o: ComboboxOption, q: string) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());

export function Combobox({ label, options, value, onChange, placeholder, hint, error, required, id: idProp, filter = defaultFilter }: ComboboxProps) {
  const autoId = useId();
  const id = idProp ?? `cb-${autoId}`;
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const selected = options.find((o) => o.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const text = query ?? selected?.label ?? "";
  const visible = useMemo(() => (query ? options.filter((o) => filter(o, query)) : options), [options, query, filter]);
  const optionId = (i: number) => `${id}-opt-${i}`;

  const openAt = (index: number) => {
    setOpen(true);
    setActive(visible.length === 0 ? -1 : Math.max(0, Math.min(index, visible.length - 1)));
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (o: ComboboxOption) => {
    onChange(o.value);
    setQuery(null);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openAt(selected ? Math.max(0, visible.indexOf(selected)) : 0);
        else setActive((a) => Math.min(visible.length - 1, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openAt(visible.length - 1);
        else setActive((a) => Math.max(0, a - 1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(visible.length ? 0 : -1);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(visible.length - 1);
        }
        break;
      case "Enter":
        if (open && active >= 0 && visible[active]) {
          e.preventDefault();
          choose(visible[active] as ComboboxOption);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
          setQuery(null);
        } else if (value !== null || query) {
          e.preventDefault();
          setQuery(null);
          onChange(null);
        }
        break;
      case "Tab":
        close();
        setQuery(null);
        break;
    }
  };

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        className={styles.input}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          setQuery(null);
        }}
        onClick={() => (open ? close() : openAt(0))}
      />
      <ul id={listId} role="listbox" aria-label={label} className={styles.listbox} hidden={!open}>
        {open && visible.length === 0 ? (
          <li className={styles.empty} role="presentation">
            No matches
          </li>
        ) : null}
        {open
          ? visible.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={o.value === value}
                className={`${styles.option} ${i === active ? styles.active : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{o.label}</span>
                {o.hint ? <span className={styles.optionHint}>{o.hint}</span> : null}
              </li>
            ))
          : null}
      </ul>
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
