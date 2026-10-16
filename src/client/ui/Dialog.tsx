// Dialog (SPEC 14.2): a custom modal so focus behaviour is testable in jsdom.
// role="dialog", aria-modal, labelled by its title; focus moves in, Tab and Shift+Tab
// are trapped, Escape closes unless the dialog is not dismissable (for example while a
// request is pending), focus returns to the opener, and the rest of the page is inert.
//
// Focus in: initialFocus when it can take focus (connected, enabled, not inert), else the
// first focusable element, else the dialog itself. It is read once, when the dialog
// opens, so a page that changes its preferred target while the dialog is open never
// moves focus away from a field being typed in.
// Escape: a document listener, so it works wherever focus is, and it ignores an Escape
// that a child already handled (an open Combobox calls preventDefault to close its
// listbox, which must not close the dialog too).
// Focus back: the opener when it is still connected and enabled, else returnFocus, else
// #main. Never body.
// Focus kept: a pressed button that starts loading is disabled, and the browser then
// moves focus to body (so does removing the focused control). While open, the dialog
// takes focus back: onto its role="alert" message when it shows one, else onto itself,
// and onto the message as soon as one appears (a failed request). A page can still move
// focus somewhere more specific in its own effects, which run after the dialog's.
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
  /** Where focus goes on close when the opener is gone or disabled (default: #main). */
  returnFocus?: RefObject<HTMLElement | null>;
  /** When false, Escape and backdrop clicks do nothing (use while a request is pending). */
  dismissable?: boolean;
  description?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert"));
}

/**
 * Puts focus back inside an open dialog when it has fallen to body, or when the dialog
 * parked it on itself and a message has appeared since. Returns whether focus is parked
 * on the dialog itself afterwards.
 */
function reclaimFocus(root: HTMLElement, parked: boolean): boolean {
  if (!root.isConnected) return false;
  const active = document.activeElement;
  const lost = active === null || active === document.body;
  if (!lost && !(parked && active === root)) return false;
  const alert = root.querySelector<HTMLElement>('[role="alert"]');
  if (alert) {
    if (!alert.hasAttribute("tabindex")) alert.tabIndex = -1;
    alert.focus();
    return false;
  }
  root.focus();
  return true;
}

/** True when el can take focus now: in the document, not disabled, not inside an inert subtree. */
export function canFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if (el.matches(":disabled")) return false;
  return el.closest("[inert]") === null;
}

export function Dialog({ open, onClose, title, children, actions, initialFocus, returnFocus, dismissable = true, description }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(dismissable);
  dismissRef.current = dismissable;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialRef = useRef(initialFocus);
  initialRef.current = initialFocus;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;
  const parked = useRef(false);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const root = ref.current;
    // Make everything outside the dialog inert while it is open.
    const container = root?.closest("[data-dialog-portal]") ?? null;
    const siblings = Array.from(document.body.children).filter((el) => el !== container && !el.hasAttribute("inert"));
    for (const el of siblings) el.setAttribute("inert", "");
    const preferred = initialRef.current?.current;
    const target = canFocus(preferred) ? preferred : ((root ? focusables(root)[0] : null) ?? root);
    target?.focus();

    const onDocumentKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (!dismissRef.current) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onDocumentKey);
    // Chrome fires focusout with no relatedTarget once a focused button is disabled; the
    // check waits a task so activeElement has settled. A window blur also has no
    // relatedTarget, but leaves activeElement in place, so nothing moves then.
    let pendingCheck: ReturnType<typeof setTimeout> | undefined;
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget || !root) return;
      clearTimeout(pendingCheck);
      pendingCheck = setTimeout(() => {
        parked.current = reclaimFocus(root, parked.current);
      }, 0);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== root) parked.current = false;
    };
    root?.addEventListener("focusout", onFocusOut);
    root?.addEventListener("focusin", onFocusIn);
    return () => {
      clearTimeout(pendingCheck);
      parked.current = false;
      root?.removeEventListener("focusout", onFocusOut);
      root?.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onDocumentKey);
      for (const el of siblings) el.removeAttribute("inert");
      const back = opener.current;
      if (canFocus(back) && back !== document.body) {
        back.focus();
        return;
      }
      const fallback = returnRef.current?.current;
      if (canFocus(fallback)) {
        fallback.focus();
        return;
      }
      document.getElementById("main")?.focus();
    };
  }, [open]);

  // After every render while open: a request that failed re-renders the dialog with its
  // message and the re-enabled button, so this is where focus comes back.
  useEffect(() => {
    if (open && ref.current) parked.current = reclaimFocus(ref.current, parked.current);
  });

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (index === -1) {
      // Focus is on something that is not in the Tab order, such as the dialog itself or
      // a rule message given tabIndex -1: move to its neighbour in document order.
      e.preventDefault();
      const after = (el: HTMLElement) => !!active && (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (e.shiftKey) (items.filter((el) => !after(el)).at(-1) ?? last).focus();
      else (items.find(after) ?? first).focus();
      return;
    }
    if (e.shiftKey && index === 0) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && index === items.length - 1) {
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
