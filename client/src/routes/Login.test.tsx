import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { ProtectedRoute } from "../components/ProtectedRoute.js";
import { Login } from "./Login.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function renderLogin(route: Parameters<typeof renderWithProviders>[1] = { route: "/login" }) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<div>home</div>} />
      <Route
        path="/gallery"
        element={
          <ProtectedRoute>
            <div>gallery page</div>
          </ProtectedRoute>
        }
      />
    </Routes>,
    route,
  );
}

describe("Login", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("posts the password and navigates home on success", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ authRequired: true, authenticated: true }));

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ password: "hunter2" }) }),
    );
    expect(await screen.findByText("home")).toBeInTheDocument();
  });

  it("lands on the originally-requested guarded page without bouncing back", async () => {
    // Auth status stays "not authenticated" for the whole test — proving the guard is
    // satisfied by the login response written into the cache, not by a lucky refetch.
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/auth/login")
          ? jsonResponse({ authRequired: true, authenticated: true })
          : jsonResponse({ authRequired: true, authenticated: false }),
      ),
    );

    renderLogin({ route: { pathname: "/login", state: { from: { pathname: "/gallery" } } } });
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("gallery page")).toBeInTheDocument();
  });

  it("reports an incorrect password distinctly and stays on the page", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Invalid password" }, 401),
    );

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
  });

  it("distinguishes a server error from a wrong password", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it("distinguishes an unreachable server from a wrong password", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

    renderLogin();
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText(/can.?t reach the server/i)).toBeInTheDocument();
  });
});
