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

/**
 * Text, number, date and select fields, and textareas.
 *
 * Deliberately carries no width: callers append `w-full`, `flex-1` or `w-40`, and Tailwind
 * emits `w-full` *after* the numeric widths in its own ordering, so putting it here would
 * silently beat every `w-40 ${FIELD_CLASS}` call site.
 */
export const FIELD_CLASS =
  "min-h-[44px] rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

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

/** A square icon-only control: month chevrons, a close button, the header actions. */
export const ICON_BUTTON_CLASS =
  "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";

/** The header edit toggle while edit mode is on — the filled counterpart to ICON_BUTTON_CLASS. */
export const ICON_BUTTON_ACTIVE_CLASS =
  "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-600 dark:text-white dark:hover:bg-slate-500";

/** A selectable pill in a filter row or a category chooser. Pair with one of the two halves below. */
export const CHIP_CLASS =
  "flex min-h-[44px] items-center justify-center rounded-md border px-3 text-sm font-medium";

export const CHIP_ON_CLASS =
  "border-slate-900 bg-slate-900 text-white dark:border-slate-500 dark:bg-slate-600";

/** A secondary filter that is off — person and album sit apart from the log categories. */
export const CHIP_MUTED_CLASS =
  "border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500 dark:hover:bg-slate-800";

export const CHIP_OFF_CLASS =
  "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

/** The small-caps label above a list. Was duplicated verbatim in SearchResults and AlbumSections. */
export const SECTION_HEADING =
  "text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";

/** A tappable list row that fills the width. Was ROW_LINK, local to SearchResults. */
export const ROW_LINK = `flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800 ${CARD_CLASS}`;

/**
 * The remove control inside a person/event pill.
 *
 * 36px rather than the 44px floor the rest of the app keeps: a 44px circle does not fit
 * inside a text pill, and this un-tags rather than destroying anything — re-tagging is one
 * tap. The pill around it is sized to match.
 */
export const REMOVE_BUTTON_CLASS =
  "flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-full hover:bg-slate-300 dark:hover:bg-slate-600";

/**
 * The quiet Edit / Delete pair at the foot of a card.
 *
 * These were 44px tall already but rendered as bare text links, so on a phone there was
 * nothing to show where the target began or ended. An outline costs little and makes the
 * hit area visible.
 */
export const CARD_ACTION_CLASS =
  "flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

export const CARD_ACTION_DANGER_CLASS =
  "flex min-h-[44px] items-center justify-center rounded-md border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";
