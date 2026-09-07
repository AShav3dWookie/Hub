import { Link } from "react-router-dom";
import { ICONS } from "../lib/icons.js";

/**
 * One tile in a "what are you logging?" grid.
 *
 * Takes a link and an icon name rather than a CategoryMeta, because the Album tile is the
 * same shape but is not a category — it used to be a verbatim copy of this class string
 * inlined in Add.tsx.
 */
export function CategoryTile({ to, icon, label }: { to: string; icon: string; label: string }) {
  const Icon = ICONS[icon];
  return (
    <Link
      to={to}
      // p-3 + a 32px glyph, down from p-6 + 40px: the old tile was ~130px tall, so nine of
      // them needed five rows and a scroll on a phone. These fit in three.
      className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
    >
      {Icon ? <Icon size={32} strokeWidth={1.5} aria-hidden /> : null}
      <span className="text-sm font-medium leading-tight">{label}</span>
    </Link>
  );
}
