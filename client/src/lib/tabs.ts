import { Home, Search, PlusCircle, CalendarDays, Images, type LucideIcon } from "lucide-react";

/**
 * The five destinations the bottom tab bar owns.
 *
 * It lives here rather than in BottomNav because Layout needs the paths too — to decide
 * whether a screen gets a back arrow — and the unit suite routinely mocks BottomNav out,
 * which would take the constant with it.
 *
 * Albums is deliberately absent: it is a toggle inside Gallery, because six tabs on a 412px
 * screen gives every one of them a target too narrow to hit.
 */
export const TABS: { to: string; icon: LucideIcon; label: string; end?: boolean }[] = [
  { to: "/", icon: Home, label: "Home", end: true },
  { to: "/search", icon: Search, label: "Search" },
  // Not `end`, so /add/movie keeps the tab lit while you're filling the form.
  { to: "/add", icon: PlusCircle, label: "Add" },
  { to: "/calendar", icon: CalendarDays, label: "Calendar" },
  { to: "/gallery", icon: Images, label: "Gallery" },
];

/** The paths above — a screen at one of these is a tab root, and has nothing to go back to. */
export const TAB_PATHS = TABS.map((tab) => tab.to);
