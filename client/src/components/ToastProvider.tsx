import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface ToastOptions {
  /** Makes the whole toast a button that runs this, then dismisses it. */
  onTap?: () => void;
  /** Stay up until tapped or replaced, instead of dismissing after three seconds. */
  persist?: boolean;
}

interface ToastState {
  id: number;
  message: string;
  onTap?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const PILL_CLASS =
  "rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-700";

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = Date.now();
    setToast({ id, message, onTap: options.onTap });
    if (options.persist) return;
    setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, 3000);
  }, []);

  const tap = (onTap: () => void) => {
    setToast(null);
    onTap();
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--nav-handle-h)+env(safe-area-inset-bottom)+0.5rem)] z-50 flex justify-center px-4"
        >
          {toast.onTap ? (
            <button
              type="button"
              onClick={() => tap(toast.onTap!)}
              className={`${PILL_CLASS} min-h-11 underline-offset-2 hover:underline`}
            >
              {toast.message}
            </button>
          ) : (
            <div className={PILL_CLASS}>{toast.message}</div>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
