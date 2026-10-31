import {
  Home,
  Search,
  PlusCircle,
  CalendarDays,
  Images,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export interface Tab {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

/**
 * The five destinations the bottom tab bar always shows.
 *
 * It lives here rather than in BottomNav because Layout needs the paths too — to decide
 * whether a screen gets a back arrow — and the unit suite routinely mocks BottomNav out,
 * which would take the constant with it.
 *
 * Albums is deliberately absent: it is a toggle inside Gallery, because six tabs on a 412px
 * screen gives every one of them a target too narrow to hit.
 */
export const TABS: Tab[] = [
  { to: "/", icon: Home, label: "Home", end: true },
  { to: "/search", icon: Search, label: "Search" },
  // Not `end`, so /add/movie keeps the tab lit while you're filling the form.
  { to: "/add", icon: PlusCircle, label: "Add" },
  { to: "/calendar", icon: CalendarDays, label: "Calendar" },
  { to: "/gallery", icon: Images, label: "Gallery" },
];

/**
 * The second row, revealed by swiping the bar up (or tapping its handle). Same five-column
 * grid as the first, so a sixth destination never squeezes the five above it. Not `end`, so a
 * list's own page keeps Shopping lit.
 */
export const MORE_TABS: Tab[] = [{ to: "/shopping", icon: ShoppingCart, label: "Shopping" }];

/** The paths above — a screen at one of these is a tab root, and has nothing to go back to. */
export const TAB_PATHS = [...TABS, ...MORE_TABS].map((tab) => tab.to);
