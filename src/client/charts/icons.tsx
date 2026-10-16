// Small inline icons for the charts and status lines. Every one is decorative
// (aria-hidden): the words next to it carry the meaning, so color and shape never do alone.
const common = { width: "1em", height: "1em", viewBox: "0 0 16 16", "aria-hidden": true, focusable: false } as const;

export function WarningIcon() {
  return (
    <svg {...common} fill="currentColor">
      <path d="M8 1.2a1 1 0 0 1 .87.5l6.6 11.8A1 1 0 0 1 14.6 15H1.4a1 1 0 0 1-.87-1.5l6.6-11.8A1 1 0 0 1 8 1.2Zm0 4.1a.9.9 0 0 0-.9.9v3.6a.9.9 0 0 0 1.8 0V6.2a.9.9 0 0 0-.9-.9Zm0 6.3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function WrenchIcon() {
  return (
    <svg {...common} fill="currentColor">
      <path d="M14.6 3.9a.5.5 0 0 0-.83-.2L11.6 5.9l-1.6-.4-.4-1.6 2.2-2.2a.5.5 0 0 0-.2-.83 4.2 4.2 0 0 0-5.2 5.3L1.6 11a1.7 1.7 0 0 0 2.4 2.4l4.8-4.8a4.2 4.2 0 0 0 5.8-4.7Z" />
    </svg>
  );
}
