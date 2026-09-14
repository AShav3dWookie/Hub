import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Settings } from "./Settings.js";

vi.mock("../api/localHooks.js");
import {
  useOnlineStatus,
  useSyncStatus,
  useForceSync,
  useOutbox,
  useDiscardDeadLetters,
  usePeriodicSyncStatus,
  useThumbnailCacheStats,
  useClearThumbnailCache,
} from "../api/localHooks.js";

vi.mock("../api/auth.js");
import { useAuthStatus, useChangePassword } from "../api/auth.js";
import { ApiError } from "../api/client.js";

vi.mock("../api/notifications.js");
import {
  requestNotificationPermission,
  useDisablePush,
  useEnablePush,
  usePushStatus,
  useRefreshPushStatus,
  useSendTestPush,
} from "../api/notifications.js";
import type { PushStatus } from "../sw/push.js";

const forceSyncMutate = vi.fn();
const clearMutate = vi.fn();
const discardMutate = vi.fn();
const changePasswordMutate = vi.fn();
const enablePushMutate = vi.fn();
const disablePushMutate = vi.fn();
const testPushMutate = vi.fn();
const refreshPushStatus = vi.fn();

function withPushStatus(status: PushStatus) {
  vi.mocked(usePushStatus).mockReturnValue({ data: status } as ReturnType<typeof usePushStatus>);
}

const notifications = () => screen.getByRole("heading", { name: "Notifications" }).parentElement!;

/** Turn the password section on; it only renders when the server requires a login. */
function withAuthRequired() {
  vi.mocked(useAuthStatus).mockReturnValue({
    data: { authRequired: true, authenticated: true },
  } as ReturnType<typeof useAuthStatus>);
}

async function fillPasswordForm(current: string, next: string, confirm: string) {
  await userEvent.type(screen.getByLabelText("Current password"), current);
  await userEvent.type(screen.getByLabelText("New password"), next);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: /change password/i }));
}

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
  vi.mocked(useOutbox).mockReturnValue({
    data: { pending: 0, dead: [] },
  } as unknown as ReturnType<typeof useOutbox>);
  vi.mocked(useDiscardDeadLetters).mockReturnValue({
    mutate: discardMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDiscardDeadLetters>);
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
  vi.mocked(useAuthStatus).mockReturnValue({
    data: { authRequired: false, authenticated: true },
  } as ReturnType<typeof useAuthStatus>);
  changePasswordMutate.mockResolvedValue(undefined);
  vi.mocked(useChangePassword).mockReturnValue({
    mutateAsync: changePasswordMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useChangePassword>);
  forceSyncMutate.mockClear();
  clearMutate.mockClear();
  discardMutate.mockClear();
  changePasswordMutate.mockClear();

  withPushStatus("off");
  for (const mock of [enablePushMutate, disablePushMutate, testPushMutate, refreshPushStatus]) {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  }
  vi.mocked(requestNotificationPermission).mockResolvedValue("granted");
  vi.mocked(useEnablePush).mockReturnValue({
    mutateAsync: enablePushMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useEnablePush>);
  vi.mocked(useDisablePush).mockReturnValue({
    mutateAsync: disablePushMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDisablePush>);
  vi.mocked(useSendTestPush).mockReturnValue({
    mutateAsync: testPushMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useSendTestPush>);
  vi.mocked(useRefreshPushStatus).mockReturnValue(refreshPushStatus);
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

  it("hides the Pending changes section when the outbox is empty", () => {
    renderWithProviders(<Settings />);
    expect(screen.queryByText("Pending changes")).not.toBeInTheDocument();
  });

  it("shows the pending count and a Retry now button", async () => {
    vi.mocked(useOutbox).mockReturnValue({
      data: { pending: 3, dead: [] },
    } as unknown as ReturnType<typeof useOutbox>);
    renderWithProviders(<Settings />);

    expect(screen.getByText("Pending changes")).toBeInTheDocument();
    expect(screen.getByText("3 changes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry now/i }));
    expect(forceSyncMutate).toHaveBeenCalledOnce();
  });

  it("confirms before discarding dead-lettered changes", async () => {
    vi.mocked(useOutbox).mockReturnValue({
      data: {
        pending: 0,
        dead: [{ mutationId: "x", type: "log.update", seq: 1, status: "dead" }],
      },
    } as unknown as ReturnType<typeof useOutbox>);
    renderWithProviders(<Settings />);

    expect(screen.getByText(/1 change couldn't sync/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discardMutate).not.toHaveBeenCalled(); // confirmation first
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(discardMutate).toHaveBeenCalledOnce();
  });

  it("hides the password form when the server needs no login", () => {
    renderWithProviders(<Settings />);
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });

  it("changes the password and confirms it", async () => {
    withAuthRequired();
    renderWithProviders(<Settings />);

    await fillPasswordForm("old-password", "brand-new-one", "brand-new-one");

    expect(changePasswordMutate).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "brand-new-one",
    });
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("will not submit when the new password is mistyped", async () => {
    withAuthRequired();
    renderWithProviders(<Settings />);

    await fillPasswordForm("old-password", "brand-new-one", "brand-new-two");

    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/i);
    expect(changePasswordMutate).not.toHaveBeenCalled();
  });

  it("will not submit a new password that is too short", async () => {
    withAuthRequired();
    renderWithProviders(<Settings />);

    await fillPasswordForm("old-password", "short", "short");

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8/i);
    expect(changePasswordMutate).not.toHaveBeenCalled();
  });

  it("reports a wrong current password", async () => {
    withAuthRequired();
    changePasswordMutate.mockRejectedValueOnce(new ApiError(401, "Current password is incorrect"));
    renderWithProviders(<Settings />);

    await fillPasswordForm("wrong-password", "brand-new-one", "brand-new-one");

    expect(await screen.findByRole("alert")).toHaveTextContent(/current password is incorrect/i);
    expect(screen.queryByText("Password changed")).not.toBeInTheDocument();
  });

  it("distinguishes a server error from a wrong password", async () => {
    withAuthRequired();
    changePasswordMutate.mockRejectedValueOnce(new ApiError(500, "Internal server error"));
    renderWithProviders(<Settings />);

    await fillPasswordForm("old-password", "brand-new-one", "brand-new-one");

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
  });

  it("distinguishes an unreachable server from a wrong password", async () => {
    withAuthRequired();
    changePasswordMutate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWithProviders(<Settings />);

    await fillPasswordForm("old-password", "brand-new-one", "brand-new-one");

    expect(await screen.findByRole("alert")).toHaveTextContent(/can.?t reach the server/i);
  });

  it("cannot change the password while offline", () => {
    withAuthRequired();
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    renderWithProviders(<Settings />);

    expect(screen.getByRole("button", { name: /change password/i })).toBeDisabled();
    expect(screen.getByText(/reconnect to change your password/i)).toBeInTheDocument();
  });

  describe("notifications", () => {
    it("explains when reminders arrive", () => {
      renderWithProviders(<Settings />);
      expect(within(notifications()).getByText(/9pm the day before and 9am on the day/)).toBeInTheDocument();
    });

    it("asks for permission, then turns notifications on", async () => {
      renderWithProviders(<Settings />);

      await userEvent.click(screen.getByRole("button", { name: /turn on notifications/i }));

      expect(requestNotificationPermission).toHaveBeenCalledOnce();
      expect(enablePushMutate).toHaveBeenCalledOnce();
      expect(await screen.findByText("Notifications on")).toBeInTheDocument();
    });

    it("doesn't subscribe when permission is refused, and re-reads the status", async () => {
      vi.mocked(requestNotificationPermission).mockResolvedValue("denied");
      renderWithProviders(<Settings />);

      await userEvent.click(screen.getByRole("button", { name: /turn on notifications/i }));

      expect(enablePushMutate).not.toHaveBeenCalled();
      expect(refreshPushStatus).toHaveBeenCalledOnce();
    });

    it("reports a failure to turn notifications on", async () => {
      enablePushMutate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      renderWithProviders(<Settings />);

      await userEvent.click(screen.getByRole("button", { name: /turn on notifications/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't turn notifications on/i);
    });

    it("sends a test notification and turns notifications off once they're on", async () => {
      withPushStatus("on");
      renderWithProviders(<Settings />);

      expect(within(notifications()).getByText("On")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /send test notification/i }));
      expect(testPushMutate).toHaveBeenCalledOnce();
      expect(await screen.findByText("Test notification sent")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /turn off/i }));
      expect(disablePushMutate).toHaveBeenCalledOnce();
    });

    it("shows the server's reason when a test notification fails", async () => {
      withPushStatus("on");
      testPushMutate.mockRejectedValueOnce(
        new ApiError(404, "This device's subscription has expired — turn notifications on again"),
      );
      renderWithProviders(<Settings />);

      await userEvent.click(screen.getByRole("button", { name: /send test notification/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/turn notifications on again/);
    });

    it.each<[PushStatus, RegExp]>([
      ["needs-install", /Add to Home Screen/],
      ["denied", /blocked for this site/],
      ["insecure", /only allow notifications over https/],
      ["unsupported", /doesn't support push notifications/],
    ])("explains what to do when the status is %s, with no button to press", (status, hint) => {
      withPushStatus(status);
      renderWithProviders(<Settings />);

      expect(within(notifications()).getByText(hint)).toBeInTheDocument();
      expect(within(notifications()).queryByRole("button")).not.toBeInTheDocument();
    });

    it("cannot be turned on while offline", () => {
      vi.mocked(useOnlineStatus).mockReturnValue(false);
      renderWithProviders(<Settings />);

      expect(screen.getByRole("button", { name: /turn on notifications/i })).toBeDisabled();
      expect(screen.getByText(/reconnect to change notification settings/i)).toBeInTheDocument();
    });
  });
});
