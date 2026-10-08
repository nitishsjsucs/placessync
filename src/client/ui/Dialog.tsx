// Dialog (SPEC 14.2): a custom modal so focus behaviour is testable in jsdom.
// role="dialog", aria-modal, labelled by its title; focus moves in, Tab and Shift+Tab
// are trapped, Escape closes unless the dialog is not dismissable (for example while a
// request is pending), focus returns to the opener, and the rest of the page is inert.
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  /** When false, Escape and backdrop clicks do nothing (use while a request is pending). */
  dismissable?: boolean;
  description?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert"));
}

export function Dialog({ open, onClose, title, children, actions, initialFocus, dismissable = true, description }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(dismissable);
  dismissRef.current = dismissable;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const root = ref.current;
    // Make everything outside the dialog inert while it is open.
    const container = root?.closest("[data-dialog-portal]") ?? null;
    const siblings = Array.from(document.body.children).filter((el) => el !== container && !el.hasAttribute("inert"));
    for (const el of siblings) el.setAttribute("inert", "");
    const target = initialFocus?.current ?? (root ? focusables(root)[0] : null) ?? root;
    target?.focus();
    return () => {
      for (const el of siblings) el.removeAttribute("inert");
      const back = opener.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (dismissRef.current) onCloseRef.current();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div data-dialog-portal="">
      <div
        className={styles.backdrop}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && dismissRef.current) onCloseRef.current();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={styles.dialog}
          onKeyDown={onKeyDown}
        >
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description ? <p id={descId}>{description}</p> : null}
          <div className={styles.body}>{children}</div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
