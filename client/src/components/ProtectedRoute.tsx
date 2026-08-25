import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStatus } from "../api/auth.js";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuthStatus();

  if (isLoading) {
    return <div className="p-6 text-center text-slate-500">Loading…</div>;
  }
  if (data && data.authRequired && !data.authenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
