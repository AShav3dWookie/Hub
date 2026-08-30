import { useParams, Navigate } from "react-router-dom";
import { CATEGORIES, isLoggableCategory, type Category } from "@logger/shared";
import { PersonAddForm } from "./PersonAddForm.js";
import { LogAddForm } from "./LogAddForm.js";
import { AlbumAddForm } from "./AlbumAddForm.js";

export function AddCategory() {
  const { category } = useParams<{ category: string }>();

  if (category === "album") {
    return <AlbumAddForm />;
  }

  if (!category || !(CATEGORIES as readonly string[]).includes(category)) {
    return <Navigate to="/add" replace />;
  }

  const typedCategory = category as Category;

  if (typedCategory === "person") {
    return <PersonAddForm />;
  }

  if (isLoggableCategory(typedCategory)) {
    return <LogAddForm category={typedCategory} />;
  }

  return <Navigate to="/add" replace />;
}
