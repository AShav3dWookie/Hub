import { NavLink } from "react-router-dom";

/**
 * The Photos / Albums switch shared by both screens.
 *
 * Albums lost its slot when the bottom bar became a five-tab bar — six targets across
 * 412px leaves each too narrow to hit — so it lives here instead, beside the gallery it
 * belongs with. Both remain real routes, so existing links and deep links keep working.
 */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors ${
    isActive
      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
  }`;

export function GalleryTabs() {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      <NavLink to="/gallery" className={tabClass}>
        Photos
      </NavLink>
      <NavLink to="/albums" className={tabClass}>
        Albums
      </NavLink>
    </div>
  );
}
