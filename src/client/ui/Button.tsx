// Button (SPEC 14.2): a native button. While loading it is aria-busy and disabled.
// Every size keeps a 44x44 px touch target.
import type { ComponentProps } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "sm";
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, disabled, className, type = "button", children, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], size === "sm" ? styles.sm : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
