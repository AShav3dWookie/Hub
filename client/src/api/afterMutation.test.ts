import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refreshAfterMutation } from "./afterMutation.js";
import { runSync } from "../sync/engine.js";

vi.mock("../sync/engine.js", () => ({ runSync: vi.fn() }));

const runSyncMock = vi.mocked(runSync);

describe("refreshAfterMutation", () => {
  function spyOnInvalidate(client: QueryClient) {
    return vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  }

  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof spyOnInvalidate>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidate = spyOnInvalidate(queryClient);
    runSyncMock.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("kicks a sync attributed to the mutation", async () => {
    runSyncMock.mockResolvedValue(null);
    await refreshAfterMutation(queryClient);
    expect(runSyncMock).toHaveBeenCalledWith("mutation");
  });

  it("invalidates every query once the sync succeeds", async () => {
    runSyncMock.mockResolvedValue(null);
    await refreshAfterMutation(queryClient);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("still invalidates when the sync fails, because the replica is the source of truth", async () => {
    runSyncMock.mockRejectedValue(new Error("offline"));
    await refreshAfterMutation(queryClient);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not reject when the sync fails, so a write is never reported as failed", async () => {
    runSyncMock.mockRejectedValue(new Error("offline"));
    await expect(refreshAfterMutation(queryClient)).resolves.toBeUndefined();
  });

  it("invalidates after the sync, not before, so the refetch sees the pulled rows", async () => {
    const order: string[] = [];
    runSyncMock.mockImplementation(async () => {
      order.push("sync");
      return null;
    });
    invalidate.mockImplementation(async () => {
      order.push("invalidate");
    });

    await refreshAfterMutation(queryClient);
    expect(order).toEqual(["sync", "invalidate"]);
  });
});
