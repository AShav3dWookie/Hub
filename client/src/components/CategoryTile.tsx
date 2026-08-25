import { Link } from "react-router-dom";
import type { CategoryMeta } from "@logger/shared";
import { ICONS } from "../lib/icons.js";

export function CategoryTile({ meta }: { meta: CategoryMeta }) {
  const Icon = ICONS[meta.icon];
  return (
    <Link
      to={`/add/${meta.category}`}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
    >
      {Icon ? <Icon size={40} strokeWidth={1.5} /> : null}
      <span className="font-medium">{meta.label}</span>
    </Link>
  );
}
