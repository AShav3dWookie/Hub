import { CATEGORIES, CATEGORY_META } from "@logger/shared";
import { CategoryTile } from "../components/CategoryTile.js";

export function Add() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">What are you logging?</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {CATEGORIES.map((category) => (
          <CategoryTile key={category} meta={CATEGORY_META[category]} />
        ))}
      </div>
    </div>
  );
}
