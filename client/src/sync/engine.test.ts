import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSync, forceSync } from "./engine.js";
import { setPolicy, ManualOnlyPolicy, CompositePolicy, OnOpenPolicy, DailyMidnightPolicy } from "./policy.js";
import { getMeta, META_SYNC_CURSOR } from "../local/db.js";

const emptyPage = {
  ok: true,
  status: 200,
  json: async () => ({
    changes: { entities: [], logs: [], photos: [], albums: [], entityNotes: [] },
    deletions: [],
    nextCursor: "3",
    hasMore: false,
    serverTime: "2026-06-15T00:00:00.000Z",
  }),
};

describe("runSync", () => {
  beforeEach(() => {
    setPolicy(new CompositePolicy([new OnOpenPolicy(), new DailyMidnightPolicy()]));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setPolicy(new CompositePolicy([new OnOpenPolicy(), new DailyMidnightPolicy()]));
  });

  it("pulls when the policy allows the reason", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSync("focus");
    expect(result).toMatchObject({ pages: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("3");
  });

  it("runs for a scheduled reason (DailyMidnight sub-policy)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(emptyPage)));
    expect(await runSync("scheduled")).toMatchObject({ pages: 1 });
  });

  it("returns null without pulling when the policy declines", async () => {
    setPolicy(new ManualOnlyPolicy());
    const fetchMock = vi.fn(() => Promise.resolve(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    expect(await runSync("focus")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null without pulling when offline (non-manual)", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi.fn(() => Promise.resolve(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    expect(await runSync("open")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manual sync always attempts, even under ManualOnly and even offline", async () => {
    setPolicy(new ManualOnlyPolicy());
    const fetchMock = vi.fn(() => Promise.resolve(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    expect(await runSync("manual")).toMatchObject({ pages: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forceSync bypasses the policy", async () => {
    setPolicy(new ManualOnlyPolicy());
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(emptyPage)));
    expect(await forceSync()).toMatchObject({ pages: 1 });
  });
});
