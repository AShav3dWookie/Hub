import { Link } from "react-router-dom";
import { CATEGORIES, CATEGORY_META, ALBUM_ADD_ITEM } from "@logger/shared";
import { CategoryTile } from "../components/CategoryTile.js";
import { ICONS } from "../lib/icons.js";

export function Add() {
  const AlbumIcon = ICONS[ALBUM_ADD_ITEM.icon];
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">What are you logging?</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {CATEGORIES.map((category) => (
          <CategoryTile key={category} meta={CATEGORY_META[category]} />
        ))}
        <Link
          to={`/add/${ALBUM_ADD_ITEM.path}`}
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
        >
          {AlbumIcon ? <AlbumIcon size={40} strokeWidth={1.5} /> : null}
          <span className="font-medium">{ALBUM_ADD_ITEM.label}</span>
        </Link>
      </div>
    </div>
  );
}
