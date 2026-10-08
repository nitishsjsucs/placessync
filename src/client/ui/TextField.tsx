// TextField (SPEC 14.2): label association, hint and error linked through
// aria-describedby, aria-invalid, an optional character counter that is announced
// politely when the text reaches 80% and 100% of maxLength, and a multiline variant.
import { type ChangeEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import styles from "./TextField.module.css";

interface BaseProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  rows?: number;
  id?: string;
  name?: string;
  type?: "text" | "email" | "search" | "number";
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  inputMode?: "text" | "numeric";
  inputRef?: Ref<HTMLInputElement & HTMLTextAreaElement>;
  onBlur?: () => void;
}

export type TextFieldProps = BaseProps;

function thresholdOf(length: number, max: number): 0 | 80 | 100 {
  if (length >= max) return 100;
  if (length >= Math.ceil(max * 0.8)) return 80;
  return 0;
}

export function TextField(props: TextFieldProps) {
  const { label, value, onChange, hint, error, required, maxLength, multiline, rows = 5, name, type = "text", placeholder, autoComplete, disabled, inputMode, inputRef, onBlur } = props;
  const autoId = useId();
  const id = props.id ?? `tf-${autoId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy = [hint ? hintId : null, error ? errorId : null, maxLength ? counterId : null].filter(Boolean).join(" ") || undefined;

  // Announce only when the length crosses into the 80% or 100% band, not on every key.
  const [announcement, setAnnouncement] = useState("");
  const lastBand = useRef<0 | 80 | 100>(maxLength ? thresholdOf(value.length, maxLength) : 0);
  useEffect(() => {
    if (!maxLength) return;
    const band = thresholdOf(value.length, maxLength);
    if (band !== lastBand.current) {
      lastBand.current = band;
      if (band === 80) setAnnouncement(`${maxLength - value.length} characters left`);
      else if (band === 100) setAnnouncement(`Character limit of ${maxLength} reached`);
      else setAnnouncement("");
    }
  }, [value.length, maxLength]);

  const common = {
    id,
    name,
    value,
    required,
    disabled,
    placeholder,
    autoComplete,
    maxLength,
    className: styles.input,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onBlur,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {multiline ? <textarea {...common} rows={rows} ref={inputRef} /> : <input {...common} type={type} inputMode={inputMode} ref={inputRef} />}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
      {maxLength ? (
        <span id={counterId} className={`${styles.counter} ${value.length >= maxLength ? styles.counterOver : ""}`}>
          {value.length} / {maxLength}
        </span>
      ) : null}
      {maxLength ? (
        <span className="visually-hidden" aria-live="polite" data-testid={`${id}-announce`}>
          {announcement}
        </span>
      ) : null}
    </div>
  );
}
