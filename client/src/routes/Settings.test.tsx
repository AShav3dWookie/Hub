import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Settings } from "./Settings.js";

vi.mock("../api/localHooks.js");
import {
  useOnlineStatus,
  useSyncStatus,
  useForceSync,
  usePeriodicSyncStatus,
  useThumbnailCacheStats,
  useClearThumbnailCache,
} from "../api/localHooks.js";

const forceSyncMutate = vi.fn();
const clearMutate = vi.fn();

beforeEach(() => {
  vi.mocked(useOnlineStatus).mockReturnValue(true);
  vi.mocked(useSyncStatus).mockReturnValue({
    data: { lastSyncAt: Date.now() - 3 * 60_000, lastError: null, nextScheduledAt: null },
  } as ReturnType<typeof useSyncStatus>);
  vi.mocked(useForceSync).mockReturnValue({
    mutate: forceSyncMutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useForceSync>);
  vi.mocked(usePeriodicSyncStatus).mockReturnValue({
    data: "unsupported",
  } as ReturnType<typeof usePeriodicSyncStatus>);
  vi.mocked(useThumbnailCacheStats).mockReturnValue({
    data: { count: 12, bytes: 512_000 },
  } as ReturnType<typeof useThumbnailCacheStats>);
  vi.mocked(useClearThumbnailCache).mockReturnValue({
    mutate: clearMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useClearThumbnailCache>);
  forceSyncMutate.mockClear();
  clearMutate.mockClear();
});

describe("Settings", () => {
  it("shows sync status and triggers a manual sync", async () => {
    renderWithProviders(<Settings />);

    expect(screen.getByText("3 min ago")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(forceSyncMutate).toHaveBeenCalledOnce();
  });

  it("shows the thumbnail cache size and clears it", async () => {
    renderWithProviders(<Settings />);

    expect(screen.getByText(/12 · 500 KB/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear thumbnails/i }));
    expect(clearMutate).toHaveBeenCalledOnce();
  });

  it("shows the background-sync status", () => {
    vi.mocked(usePeriodicSyncStatus).mockReturnValue({
      data: "active",
    } as ReturnType<typeof usePeriodicSyncStatus>);
    renderWithProviders(<Settings />);
    expect(screen.getByText("On — daily")).toBeInTheDocument();
  });

  it("surfaces a sync error", () => {
    vi.mocked(useSyncStatus).mockReturnValue({
      data: { lastSyncAt: null, lastError: "auth", nextScheduledAt: null },
    } as ReturnType<typeof useSyncStatus>);
    renderWithProviders(<Settings />);
    expect(screen.getByText(/sign-in expired/i)).toBeInTheDocument();
  });

  it("reflects offline state", () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    renderWithProviders(<Settings />);
    expect(screen.getByText(/offline — showing your saved data/i)).toBeInTheDocument();
  });

  it("disables Clear thumbnails when the cache is empty", () => {
    vi.mocked(useThumbnailCacheStats).mockReturnValue({
      data: { count: 0, bytes: 0 },
    } as ReturnType<typeof useThumbnailCacheStats>);
    renderWithProviders(<Settings />);
    expect(screen.getByRole("button", { name: /clear thumbnails/i })).toBeDisabled();
  });
});
