import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { runSync, nextScheduledSyncAt } = vi.hoisted(() => ({
  runSync: vi.fn(),
  nextScheduledSyncAt: vi.fn(),
}));
vi.mock("./engine.js", () => ({ runSync, nextScheduledSyncAt }));

import { useSync } from "./useSync.js";

function Harness() {
  useSync();
  return <div>ok</div>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useSync", () => {
  beforeEach(() => {
    runSync.mockResolvedValue({ pages: 1, rows: 0, cursor: "1" });
    nextScheduledSyncAt.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("syncs on mount with reason 'open'", async () => {
    mount();
    await waitFor(() => expect(runSync).toHaveBeenCalledWith("open"));
  });

  it("syncs on refocus and on reconnect", async () => {
    mount();
    await waitFor(() => expect(runSync).toHaveBeenCalledWith("open"));
    runSync.mockClear();

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(runSync).toHaveBeenCalledWith("focus"));

    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(runSync).toHaveBeenCalledWith("online"));
  });

  it("arms a timer for the next scheduled sync and fires it", async () => {
    vi.useFakeTimers();
    nextScheduledSyncAt.mockResolvedValue(Date.now() + 60_000);

    mount();
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledWith("open"));
    runSync.mockClear();
    nextScheduledSyncAt.mockResolvedValue(null); // don't re-arm indefinitely

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(runSync).toHaveBeenCalledWith("scheduled");
  });

  it("stops listening after unmount", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(runSync).toHaveBeenCalledWith("open"));
    unmount();
    runSync.mockClear();

    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 10));
    expect(runSync).not.toHaveBeenCalled();
  });
});
