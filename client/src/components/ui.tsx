import type { ReactNode } from "react";

/**
 * The handful of Tailwind class strings the app repeats everywhere, named once.
 *
 * The field styling alone appeared 33 times across 10 files, so any change to how an input
 * looks meant editing all of them and hoping none were missed. These are deliberately plain
 * class constants plus thin wrappers rather than a component library: callers that need
 * something slightly different append to the string instead of adding a prop.
 */

/** Text, number, date and select fields. */
export const FIELD_CLASS =
  "rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

/** A raised panel: result cards, the filter bar, the inline editors. */
export const CARD_CLASS =
  "rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";

/** The dark confirm/submit button. 44px min height keeps it a comfortable tap target. */
export const PRIMARY_BUTTON_CLASS =
  "min-h-[44px] rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600";

/** The outlined cancel/secondary button. */
export const SECONDARY_BUTTON_CLASS =
  "min-h-[44px] rounded-md border border-slate-300 px-4 py-1.5 text-sm dark:border-slate-600 dark:text-slate-200";

/** The small label above a field or section. */
export const FIELD_LABEL_CLASS = "text-sm font-medium";

/** Join a base class with an optional caller extension. */
function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

/** A labelled field wrapper. Pass the control as children. */
export function Field({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(CARD_CLASS, className)}>{children}</div>;
}
