// Tabs (SPEC 14.2): tablist, tab and tabpanel with automatic activation, arrow keys
// that wrap, and Home and End. Every tab controls a rendered panel (hidden when inactive).
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Renders the active panel's content. */
  children: (activeId: string) => ReactNode;
}

export function Tabs({ tabs, value, onChange, label, children }: TabsProps) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  const index = Math.max(0, tabs.findIndex((t) => t.id === value));

  const select = (i: number) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    if (!t) return;
    onChange(t.id);
    refs.current[(i + tabs.length) % tabs.length]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => select(index + 1),
      ArrowLeft: () => select(index - 1),
      Home: () => select(0),
      End: () => select(tabs.length - 1),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.tablist}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={tabId(t.id)}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={t.id === value}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === value ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={panelId(t.id)} role="tabpanel" aria-labelledby={tabId(t.id)} hidden={t.id !== value} tabIndex={0}>
          {t.id === value ? children(t.id) : null}
        </div>
      ))}
    </div>
  );
}
