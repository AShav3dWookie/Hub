import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function renderGuarded() {
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
      <Route path="/login" element={<div>login page</div>} />
    </Routes>,
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
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });
});
