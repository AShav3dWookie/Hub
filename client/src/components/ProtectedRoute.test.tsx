import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route, useLocation } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function LoginStub() {
  const location = useLocation();
  return <div>login page: {JSON.stringify(location.state)}</div>;
}

function renderGuarded(route: Parameters<typeof renderWithProviders>[1] = { route: "/" }) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div>secret content</div>
          </ProtectedRoute>
        }
      />
      <Route
        path="/gallery"
        element={
          <ProtectedRoute>
            <div>secret content</div>
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginStub />} />
    </Routes>,
    route,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows a loading state while auth status is pending", () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    renderGuarded();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders children when auth is not required", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ authRequired: false, authenticated: false }),
    );
    renderGuarded();
    expect(await screen.findByText("secret content")).toBeInTheDocument();
  });

  it("renders children when authenticated", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ authRequired: true, authenticated: true }),
    );
    renderGuarded();
    expect(await screen.findByText("secret content")).toBeInTheDocument();
  });

  it("redirects to /login when auth is required and not authenticated", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderGuarded();
    expect(await screen.findByText(/login page/)).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("carries the attempted location to /login so it can redirect back", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ authRequired: true, authenticated: false }),
    );
    renderGuarded({ route: "/gallery" });
    expect(await screen.findByText(/"pathname":"\/gallery"/)).toBeInTheDocument();
  });
});
