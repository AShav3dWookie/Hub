import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAuthStatus } from "./auth.js";
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
