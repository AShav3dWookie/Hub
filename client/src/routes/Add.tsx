import { CATEGORIES, CATEGORY_META, ALBUM_ADD_ITEM } from "@logger/shared";
import { CategoryTile } from "../components/CategoryTile.js";

export function Add() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">What are you logging?</h1>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {CATEGORIES.map((category) => (
          <CategoryTile
            key={category}
            to={`/add/${category}`}
            icon={CATEGORY_META[category].icon}
            label={CATEGORY_META[category].label}
          />
        ))}
        <CategoryTile
          to={`/add/${ALBUM_ADD_ITEM.path}`}
          icon={ALBUM_ADD_ITEM.icon}
          label={ALBUM_ADD_ITEM.label}
        />
      </div>
    </div>
  );
}
