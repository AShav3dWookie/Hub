/**
 * The Tailwind class strings the app repeats, named once.
 *
 * The field styling alone appeared 33 times across 10 files and the button shapes another 23,
 * so changing how a control looks meant editing every copy and hoping none were missed.
 *
 * These are plain constants rather than wrapper components on purpose: a caller that needs
 * something slightly different appends to the string, instead of the constant growing a prop
 * for every variation. `min-h-[44px]` on the buttons is the comfortable tap-target size.
 */

/** Text, number, date and select fields, and textareas. */
export const FIELD_CLASS =
  "rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

/** A raised panel: result cards, the filter bar, the inline editors. */
export const CARD_CLASS =
  "rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";

/** The main submit button on a form. */
export const PRIMARY_BUTTON_CLASS =
  "min-h-[44px] rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600";

/** The compact primary, used inside inline editors rather than at the foot of a form. */
export const PRIMARY_BUTTON_SM_CLASS =
  "min-h-[44px] rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white dark:bg-slate-700";

/** The outlined cancel button beside a compact primary. */
export const SECONDARY_BUTTON_CLASS =
  "min-h-[44px] rounded-md border border-slate-300 px-4 py-1.5 text-sm dark:border-slate-600 dark:text-slate-200";

/** The outlined button in a confirmation row, where the buttons sit tighter. */
export const SECONDARY_BUTTON_SM_CLASS =
  "min-h-[44px] rounded-md border border-slate-300 px-3 text-sm dark:border-slate-600 dark:text-slate-200";

/** The destructive confirm, always paired with a cancel. */
export const DANGER_BUTTON_CLASS =
  "min-h-[44px] rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700";
