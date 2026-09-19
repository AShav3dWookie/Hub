import { describe, it, expect, vi } from "vitest";
import { bestEffort, markSignedOut, SIGNED_OUT, SESSION_EXPIRED_EVENT } from "./session.js";
import { getMeta, setMeta, META_AUTH_STATUS } from "../local/db.js";

describe("bestEffort", () => {
  it("resolves as soon as the promise settles", async () => {
    await expect(bestEffort(Promise.resolve("done"), 10_000)).resolves.toBeUndefined();
  });

  it("resolves rather than rejecting when the promise fails", async () => {
    await expect(bestEffort(Promise.reject(new Error("offline")), 10_000)).resolves.toBeUndefined();
  });

  it("gives up on a request that never settles", async () => {
    // The reason Log out was unresponsive: a hung request left the mutation pending forever,
    // so nothing downstream of it ever ran.
    await expect(bestEffort(new Promise(() => {}), 5)).resolves.toBeUndefined();
  });
});

describe("markSignedOut", () => {
  it("persists the signed-out status so a reload still knows", async () => {
    await setMeta(META_AUTH_STATUS, { authRequired: true, authenticated: true });
    await markSignedOut();
    expect(await getMeta(META_AUTH_STATUS)).toEqual(SIGNED_OUT);
  });

  it("announces the expiry to the running app", async () => {
    const heard = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, heard);
    await markSignedOut();
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, heard);
  });
});
