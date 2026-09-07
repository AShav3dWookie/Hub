import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

/**
 * Whether the current screen is showing its editing controls.
 *
 * Reading is the default: an album, an entity or a person profile shows what it holds and
 * nothing that changes it. The header pencil opts into editing, and everything that mutates
 * an existing record appears only then. Creation is unaffected — the Add screens are their
 * own thing.
 *
 * This is a context because `Layout` is mounted once above the route switch and owns the
 * header, so a route cannot hand it a button. `supported` is how a route says "I have
 * something to edit"; without it the header shows no pencil at all.
 */
interface EditModeContextValue {
  editing: boolean;
  supported: boolean;
  toggle: () => void;
  /** Called by `useEditableRoute`; returns its own deregister. */
  register: () => () => void;
}

const EditModeContext = createContext<EditModeContextValue | null>(null);

export function EditModeProvider({
  children,
  initialEditing = false,
}: {
  children: ReactNode;
  /** Start in edit mode. For tests, which render a route without a header to tap. */
  initialEditing?: boolean;
}) {
  const [editing, setEditing] = useState(initialEditing);
  const [supported, setSupported] = useState(false);
  const { pathname } = useLocation();

  // Edit mode never survives a navigation. Deregistering on unmount covers most of it, but a
  // route that swaps its content without unmounting would otherwise strand you in edit mode
  // on a screen you did not turn it on for.
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setEditing(false);
  }, [pathname]);

  const toggle = useCallback(() => setEditing((on) => !on), []);

  const register = useCallback(() => {
    setSupported(true);
    return () => {
      setSupported(false);
      setEditing(false);
    };
  }, []);

  return (
    <EditModeContext.Provider value={{ editing, supported, toggle, register }}>
      {children}
    </EditModeContext.Provider>
  );
}

function useEditModeContext(): EditModeContextValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) {
    throw new Error("Edit mode hooks must be used within an EditModeProvider");
  }
  return ctx;
}

/**
 * Opt this route into edit mode — the header grows a pencil while it is mounted.
 * Returns whether edit mode is currently on.
 */
export function useEditableRoute(): boolean {
  const { editing, register } = useEditModeContext();
  useEffect(() => register(), [register]);
  return editing;
}

/** The header toggle's state. For `Layout`; everything else wants `useEditableRoute`. */
export function useEditModeToggle(): Pick<EditModeContextValue, "editing" | "supported" | "toggle"> {
  const { editing, supported, toggle } = useEditModeContext();
  return { editing, supported, toggle };
}
