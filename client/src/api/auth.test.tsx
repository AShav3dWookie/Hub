import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fetchAuthStatus, useLogin, useChangePassword } from "./auth.js";
import { getMeta, setMeta, META_AUTH_STATUS } from "../local/db.js";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("fetchAuthStatus offline fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns and caches a successful check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok({ authRequired: true, authenticated: true }))),
    );
    expect(await fetchAuthStatus()).toEqual({ authRequired: true, authenticated: true });
    expect(await getMeta(META_AUTH_STATUS)).toEqual({ authRequired: true, authenticated: true });
  });

  it("falls back to the cached value when the network fails", async () => {
    await setMeta(META_AUTH_STATUS, { authRequired: true, authenticated: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    expect(await fetchAuthStatus()).toEqual({ authRequired: true, authenticated: false });
  });

  it("rethrows when the network fails and nothing is cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(fetchAuthStatus()).rejects.toBeInstanceOf(TypeError);
  });
});

describe("useLogin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes the login response straight into the auth-status cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok({ authRequired: true, authenticated: true }))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["auth-status"], { authRequired: true, authenticated: false });

    const { result } = renderHook(() => useLogin(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await result.current.mutateAsync("hunter2");

    await waitFor(() =>
      expect(client.getQueryData(["auth-status"])).toEqual({
        authRequired: true,
        authenticated: true,
      }),
    );
    expect(await getMeta(META_AUTH_STATUS)).toEqual({ authRequired: true, authenticated: true });
  });
});

describe("useChangePassword", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the current and new password to the server", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    const { result } = renderHook(() => useChangePassword(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await result.current.mutateAsync({ currentPassword: "old-one", newPassword: "brand-new-one" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "old-one", newPassword: "brand-new-one" }),
      }),
    );
  });
});
