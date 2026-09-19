import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProtectedRoute } from "../components/ProtectedRoute.js";
import { Layout } from "../components/Layout.js";
import { ToastProvider } from "../components/ToastProvider.js";
import { EditModeProvider } from "../components/EditModeProvider.js";
import { Login } from "../routes/Login.js";
import { fetchAuthStatus, useSessionExpiry } from "./auth.js";
import { SIGNED_OUT } from "./session.js";
import { pullChanges } from "../sync/pull.js";
import { api } from "./client.js";
import { setMeta, getMeta, META_AUTH_STATUS } from "../local/db.js";

vi.mock("../components/BottomNav.js", () => ({ BottomNav: () => <nav /> }));

/**
 * The regression suite for the wedged-session bug.
 *
 * A device whose session cookie went away kept rendering a signed-in app from its local
 * replica while every request failed. `ProtectedRoute` only redirects on an explicit
 * `authenticated: false`, and the read that would have produced one was itself answered from
 * the stale cached `true` — so there was no way back to the login screen, and Log out (which
 * only cleared state in `onSuccess`) did nothing, because its own request failed too.
 *
 * These drive the real hooks end to end. Nothing in `auth.js` or `session.js` is mocked, and
 * the QueryClient mirrors `main.tsx` — `staleTime: Infinity` is load-bearing, because it is
 * why the app never re-reads auth status within a session.
 */

const SIGNED_IN = { authRequired: true, authenticated: true };

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number) => ({ ok: false, status, json: async () => ({ error: "nope" }) });
const noContent = () => ({ ok: true, status: 204, json: async () => undefined });

/**
 * Route `fetch` by URL fragment. Anything unmatched fails the way a browser fails when the
 * server cannot be reached — which is the situation under test, so it is the default.
 */
function stubFetch(routes: Array<[string, () => unknown]> = []) {
  const mock = vi.fn((input: unknown) => {
    const url = String(input);
    for (const [fragment, respond] of routes) {
      if (url.includes(fragment)) return Promise.resolve(respond());
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The production query defaults, which the shared `renderWithProviders` does not use. */
function productionQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, networkMode: "always", retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Mirrors App.tsx: the session-expiry listener wrapping a guarded route and the real login
 * screen. The real `Login` matters for the round trip — it is what navigates back to where the
 * user was once the password is accepted.
 */
function Harness({ children }: { children: ReactNode }) {
  useSessionExpiry();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<ProtectedRoute>{children}</ProtectedRoute>} />
    </Routes>
  );
}

/** The login screen's own submit button — not Layout's "Log out". */
const loginButton = () => screen.findByRole("button", { name: /^log in$/i });

function renderApp(children: ReactNode = <div>my logs</div>, client = productionQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <EditModeProvider>
            <Harness>{children}</Harness>
          </EditModeProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The state a wedged device is in: last known "signed in", and a server it cannot reach. */
async function seedWedgedDevice() {
  await setMeta(META_AUTH_STATUS, SIGNED_IN);
}

afterEach(() => vi.unstubAllGlobals());

describe("recovering a lost session", () => {
  it("keeps the app usable when the server is merely unreachable", async () => {
    // The offline-first promise: a failed status check is not a sign-out. This is what the
    // cached fallback exists for, and the fix must not cost it.
    await seedWedgedDevice();
    stubFetch();

    renderApp();

    expect(await screen.findByText("my logs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^log in$/i })).not.toBeInTheDocument();
  });

  it("sends a wedged device to the login screen when a sync pull 401s", async () => {
    await seedWedgedDevice();
    stubFetch([["/api/sync/changes", () => errJson(401)]]);

    renderApp();
    // It starts wedged: rendering as signed in, off a status check that reached no one.
    expect(await screen.findByText("my logs")).toBeInTheDocument();

    await expect(pullChanges()).rejects.toMatchObject({ kind: "auth" });

    expect(await loginButton()).toBeInTheDocument();
    expect(screen.queryByText("my logs")).not.toBeInTheDocument();
  });

  it("does not sign the user out when the sync pull merely fails", async () => {
    await seedWedgedDevice();
    stubFetch();

    renderApp();
    expect(await screen.findByText("my logs")).toBeInTheDocument();

    await expect(pullChanges()).rejects.toMatchObject({ kind: "network" });

    // Give a redirect the chance to happen before asserting that it did not.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("my logs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^log in$/i })).not.toBeInTheDocument();
    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_IN);
  });

  it("remembers the sign-out across a reload, with the server still unreachable", async () => {
    // The event only reaches the running app. What makes the recovery stick is the IndexedDB
    // write — otherwise the next launch reads the stale "signed in" again and re-wedges.
    await seedWedgedDevice();
    stubFetch([["/api/sync/changes", () => errJson(401)]]);
    await expect(pullChanges()).rejects.toMatchObject({ kind: "auth" });

    // A fresh launch: nothing in memory, and the status check still cannot reach the server.
    stubFetch();
    expect(await fetchAuthStatus()).toEqual(SIGNED_OUT);

    renderApp();
    expect(await loginButton()).toBeInTheDocument();
  });

  it("lets the user back in once they log in again", async () => {
    await seedWedgedDevice();
    stubFetch([["/api/sync/changes", () => errJson(401)]]);
    await expect(pullChanges()).rejects.toMatchObject({ kind: "auth" });

    // The server is reachable again and the password is accepted.
    stubFetch([["/api/auth/login", () => okJson(SIGNED_IN)]]);
    renderApp();
    expect(await loginButton()).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/password/i), "hunter2");
    await userEvent.click(await loginButton());

    expect(await screen.findByText("my logs")).toBeInTheDocument();
    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_IN);
  });
});

describe("a 401 from anywhere, not just sync", () => {
  it("signs the user out when an ordinary read 401s", async () => {
    // Sync is not the only thing that talks to the server. A gallery page, a photo upload or a
    // notifications call hitting a dead session has to recover the same way, or the app stays
    // wedged until the next pull happens to run.
    await seedWedgedDevice();
    stubFetch([["/api/gallery", () => errJson(401)]]);

    renderApp();
    expect(await screen.findByText("my logs")).toBeInTheDocument();

    await expect(api.get("/gallery")).rejects.toMatchObject({ status: 401 });

    expect(await loginButton()).toBeInTheDocument();
  });

  it("signs the user out when an upload 401s", async () => {
    await seedWedgedDevice();
    stubFetch([["/api/logs/1/photos", () => errJson(401)]]);

    renderApp();
    await screen.findByText("my logs");

    await expect(api.postForm("/logs/1/photos", new FormData())).rejects.toMatchObject({
      status: 401,
    });

    expect(await loginButton()).toBeInTheDocument();
  });

  it("does not sign the user out when a password change is rejected", async () => {
    // `/auth/password` 401s on a wrong *current* password. That session is perfectly good —
    // signing them out for a typo would be both wrong and baffling.
    await seedWedgedDevice();
    stubFetch([["/api/auth/password", () => errJson(401)]]);

    renderApp();
    expect(await screen.findByText("my logs")).toBeInTheDocument();

    await expect(
      api.post("/auth/password", { currentPassword: "wrong", newPassword: "whatever" }),
    ).rejects.toMatchObject({ status: 401 });

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("my logs")).toBeInTheDocument();
    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_IN);
  });

  it("does not sign the user out when a login is rejected", async () => {
    stubFetch([["/api/auth/login", () => errJson(401)]]);
    await setMeta(META_AUTH_STATUS, SIGNED_IN);

    await expect(api.post("/auth/login", { password: "wrong" })).rejects.toMatchObject({
      status: 401,
    });

    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_IN);
  });

  it("does not sign the user out on any other error status", async () => {
    await seedWedgedDevice();
    stubFetch([["/api/gallery", () => errJson(500)]]);

    await expect(api.get("/gallery")).rejects.toMatchObject({ status: 500 });

    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_IN);
  });
});

describe("Log out with an unreachable server", () => {
  it("gets the user to the login screen anyway", async () => {
    // The button used to clear state only in `onSuccess`, so it did nothing at all here —
    // which is exactly when someone reaches for it.
    await seedWedgedDevice();
    stubFetch();

    renderApp(<Layout>my logs</Layout>);
    expect(await screen.findByText("my logs")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /log out/i }));

    expect(await loginButton()).toBeInTheDocument();
    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_OUT);
  });

  it("still tells the server when it can, so the cookie is actually dropped", async () => {
    await seedWedgedDevice();
    const fetchMock = stubFetch([["/api/auth/logout", noContent]]);

    renderApp(<Layout>my logs</Layout>);
    await screen.findByText("my logs");
    await userEvent.click(await screen.findByRole("button", { name: /log out/i }));

    await loginButton();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/logout"))).toBe(
        true,
      ),
    );
  });
});
