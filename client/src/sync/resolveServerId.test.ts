import { describe, it, expect, vi, beforeEach } from "vitest";

const pushOutbox = vi.hoisted(() => vi.fn());
const resolvedRealId = vi.hoisted(() => vi.fn());

vi.mock("./push.js", () => ({ pushOutbox }));
vi.mock("./reconcile.js", () => ({ resolvedRealId }));

import { resolveServerId } from "./resolveServerId.js";

beforeEach(() => {
  pushOutbox.mockReset().mockResolvedValue({ pushed: 0, dead: 0 });
  resolvedRealId.mockReset().mockReturnValue(undefined);
});

describe("resolveServerId", () => {
  it("returns a real id straight back, without touching the outbox", async () => {
    await expect(resolveServerId(42)).resolves.toBe(42);
    expect(pushOutbox).not.toHaveBeenCalled();
  });

  it("uses an already-known resolution without pushing again", async () => {
    resolvedRealId.mockReturnValue(900);
    await expect(resolveServerId(-1)).resolves.toBe(900);
    expect(pushOutbox).not.toHaveBeenCalled();
  });

  it("flushes the outbox when the temp id is not yet resolved", async () => {
    resolvedRealId.mockReturnValueOnce(undefined).mockReturnValueOnce(900);
    await expect(resolveServerId(-1)).resolves.toBe(900);
    expect(pushOutbox).toHaveBeenCalledTimes(1);
  });

  it("throws when the push still leaves the id unresolved", async () => {
    resolvedRealId.mockReturnValue(undefined);
    await expect(resolveServerId(-1)).rejects.toThrow(/has not reached the server/);
  });

  it("does not push more than once per call", async () => {
    resolvedRealId.mockReturnValue(undefined);
    await expect(resolveServerId(-1)).rejects.toThrow();
    expect(pushOutbox).toHaveBeenCalledTimes(1);
  });

  it("does not accept zero as a server id, since autoincrement ids start at one", async () => {
    resolvedRealId.mockReturnValue(undefined);
    await expect(resolveServerId(0)).rejects.toThrow(/has not reached the server/);
  });
});
