import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStatus } from "../api/auth.js";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuthStatus();
  const location = useLocation();

  if (isLoading) {
    return <div className="p-6 text-center text-slate-500">Loading…</div>;
  }
  if (data && data.authRequired && !data.authenticated) {
    // Remember where they were headed so Login can send them back after signing in.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
