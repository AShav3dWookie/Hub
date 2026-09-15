import { useState } from "react";
import {
  DANGER_BUTTON_CLASS,
  FIELD_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_HEADING,
} from "../components/ui.js";
import { AlertTriangle, Bell, BellOff, RefreshCw, Send, Trash2, Wifi, WifiOff } from "lucide-react";
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
import { useAuthStatus, useChangePassword } from "../api/auth.js";
import {
  requestNotificationPermission,
  useDisablePush,
  useEnablePush,
  usePushStatus,
  useRefreshPushStatus,
  useSendTestPush,
} from "../api/notifications.js";
import { useToast } from "../components/ToastProvider.js";
import { ApiError } from "../api/client.js";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

const BACKGROUND_SYNC_LABEL: Record<string, string> = {
  active: "On — daily",
  denied: "Off — allow background sync for this site",
  unsupported: "Not available on this device",
  error: "Unavailable",
};

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

function relativeTime(ms: number | null): string {
  if (ms == null) return "never";
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} day${Math.round(hrs / 24) === 1 ? "" : "s"} ago`;
}

function clockTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className={SECTION_HEADING}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Stacked on a phone, side-by-side once there is room. As a two-column row at 388px the
 * long values here -- "When opened, and daily at 03:00", a sync error sentence -- squeezed
 * the label to a word per line.
 */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">{label}</span>
      <span className="text-sm text-slate-900 dark:text-white sm:text-right">{value}</span>
    </div>
  );
}

const SYNC_ERROR_LABEL: Record<string, string> = {
  auth: "Sign-in expired — reopen the app to sign in",
  network: "Couldn't reach the server",
  unknown: "Sync failed",
};

const PUSH_STATUS_LABEL: Record<string, string> = {
  on: "On",
  off: "Off",
  denied: "Blocked",
  "needs-install": "Needs the installed app",
  insecure: "Needs a secure connection",
  unsupported: "Not available on this browser",
};

const PUSH_STATUS_HINT: Record<string, string> = {
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.",
  "needs-install":
    "On iPhone and iPad, notifications only work from the installed app. Tap Share → Add to Home Screen, then open it from there.",
  insecure:
    "Browsers only allow notifications over https. Open the app from its https address rather than a local IP.",
  unsupported: "This browser doesn't support push notifications.",
};

/**
 * Reminders for upcoming dates, per device. The server does the scheduling; this turns the
 * device's subscription on and off. Online-only, like the password change.
 */
function NotificationsSection({ online }: { online: boolean }) {
  const { data: status } = usePushStatus();
  const enable = useEnablePush();
  const disable = useDisablePush();
  const sendTest = useSendTestPush();
  const refreshStatus = useRefreshPushStatus();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setError(null);
    // First, before any other await — Safari only prompts inside the tap's user gesture.
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      await refreshStatus();
      return;
    }
    try {
      await enable.mutateAsync();
      showToast("Notifications on");
    } catch {
      setError("Couldn't turn notifications on. Check your connection and try again.");
    }
  }

  async function handleDisable() {
    setError(null);
    try {
      await disable.mutateAsync();
      showToast("Notifications off");
    } catch {
      setError("Couldn't reach the server — notifications are off on this device, but try again to tidy up.");
    }
  }

  async function handleTest() {
    setError(null);
    try {
      await sendTest.mutateAsync();
      showToast("Test notification sent");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Can't reach the server. Check your connection and try again.",
      );
      // An expired subscription is dropped by the failed test; show the Turn on button again.
      await refreshStatus();
    }
  }

  const busy = enable.isPending || disable.isPending;
  const hint = status ? PUSH_STATUS_HINT[status] : undefined;

  return (
    <Section title="Notifications">
      <Row label="This device" value={status ? (PUSH_STATUS_LABEL[status] ?? "Unknown") : "…"} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Reminders at 9pm the day before and 9am on the day, and a week&apos;s notice of birthdays.
      </p>
      {hint && <p className="text-sm text-amber-600 dark:text-amber-400">{hint}</p>}

      {status === "off" && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy || !online}
          className={`flex items-center justify-center gap-2 text-sm font-medium ${PRIMARY_BUTTON_CLASS}`}
        >
          <Bell size={16} aria-hidden />
          {enable.isPending ? "Turning on…" : "Turn on notifications"}
        </button>
      )}

      {status === "on" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleTest}
            disabled={sendTest.isPending || !online}
            className={`flex flex-1 items-center justify-center gap-2 font-medium disabled:opacity-50 ${SECONDARY_BUTTON_CLASS}`}
          >
            <Send size={16} aria-hidden />
            {sendTest.isPending ? "Sending…" : "Send test notification"}
          </button>
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy || !online}
            className={`flex flex-1 items-center justify-center gap-2 font-medium disabled:opacity-50 ${SECONDARY_BUTTON_CLASS}`}
          >
            <BellOff size={16} aria-hidden />
            {disable.isPending ? "Turning off…" : "Turn off"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!online && (status === "on" || status === "off") && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Reconnect to change notification settings.
        </p>
      )}
    </Section>
  );
}

/**
 * Change the login password. Only rendered when the server actually requires one, so a LAN
 * deployment with auth off never sees it. Online-only: there is no sensible way to queue this.
 */
function PasswordSection({ online }: { online: boolean }) {
  const changePassword = useChangePassword();
  const { showToast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!current || !next || !confirm) return "Fill in all three fields.";
    if (next.length < MIN_PASSWORD_LENGTH) {
      return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (next.length > MAX_PASSWORD_LENGTH) {
      return `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    if (next !== confirm) return "New passwords don't match.";
    if (next === current) return "Choose a password different from your current one.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
      showToast("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? "Current password is incorrect."
            : "Something went wrong. Please try again.",
        );
      } else {
        setError("Can't reach the server. Check your connection and try again.");
      }
    }
  }

  return (
    <Section title="Password">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-300">Current password</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-300">New password</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-300">Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={FIELD_CLASS}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={changePassword.isPending || !online}
          className={PRIMARY_BUTTON_CLASS}
        >
          {changePassword.isPending ? "Changing…" : "Change password"}
        </button>
        {!online && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Reconnect to change your password.
          </p>
        )}
      </form>
    </Section>
  );
}

export function Settings() {
  const online = useOnlineStatus();
  const { data: sync } = useSyncStatus();
  const { data: pbs } = usePeriodicSyncStatus();
  const forceSync = useForceSync();
  const { data: outbox } = useOutbox();
  const discardDead = useDiscardDeadLetters();
  const { data: cache } = useThumbnailCacheStats();
  const clearThumbs = useClearThumbnailCache();
  const { data: authStatus } = useAuthStatus();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const pending = outbox?.pending ?? 0;
  const dead = outbox?.dead ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
          online
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        }`}
      >
        {online ? <Wifi size={16} /> : <WifiOff size={16} />}
        {online ? "Online" : "Offline — showing your saved data"}
      </div>

      <Section title="Sync">
        <Row label="Last sync" value={relativeTime(sync?.lastSyncAt ?? null)} />
        <Row label="Schedule" value={`When opened, and daily at ${clockTime(sync?.nextScheduledAt ?? null)}`} />
        <Row
          label="Background sync"
          value={pbs ? (BACKGROUND_SYNC_LABEL[pbs] ?? "Unknown") : "…"}
        />
        {sync?.lastError && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {SYNC_ERROR_LABEL[sync.lastError] ?? SYNC_ERROR_LABEL.unknown}
          </p>
        )}
        <button
          type="button"
          onClick={() => forceSync.mutate()}
          disabled={forceSync.isPending}
          className="mt-1 flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          <RefreshCw size={16} className={forceSync.isPending ? "animate-spin" : undefined} />
          {forceSync.isPending ? "Syncing…" : "Sync now"}
        </button>
        {forceSync.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">Sync failed — try again when online.</p>
        )}
      </Section>

      {(pending > 0 || dead.length > 0) && (
        <Section title="Pending changes">
          {pending > 0 && (
            <Row
              label="Waiting to sync"
              value={`${pending} change${pending === 1 ? "" : "s"}`}
            />
          )}
          {pending > 0 && (
            <button
              type="button"
              onClick={() => forceSync.mutate()}
              disabled={forceSync.isPending || !online}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
            >
              <RefreshCw size={16} className={forceSync.isPending ? "animate-spin" : undefined} />
              Retry now
            </button>
          )}

          {dead.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
              <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
                <AlertTriangle size={16} />
                {dead.length} change{dead.length === 1 ? "" : "s"} couldn&apos;t sync
              </p>
              <p className="text-xs text-red-600 dark:text-red-400">
                The server rejected {dead.length === 1 ? "it" : "them"}. Discarding drops the queued
                change; your data reverts to the server&apos;s copy on the next sync.
              </p>
              {confirmingDiscard ? (
                <div className="flex items-center gap-3">
                  <span className="text-red-700 dark:text-red-300">Discard {dead.length}?</span>
                  <button
                    type="button"
                    onClick={() => {
                      discardDead.mutate();
                      setConfirmingDiscard(false);
                    }}
                    className={DANGER_BUTTON_CLASS}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDiscard(false)}
                    className="min-h-[44px] rounded-md border border-red-300 px-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(true)}
                  className="self-start rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:text-red-300"
                >
                  Discard
                </button>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Storage">
        <Row
          label="Cached thumbnails"
          value={cache ? `${cache.count} · ${bytes(cache.bytes)}` : "…"}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Thumbnails are kept for offline browsing. Full-size photos download when you open them and
          need a connection.
        </p>
        <button
          type="button"
          onClick={() => clearThumbs.mutate()}
          disabled={clearThumbs.isPending || (cache?.count ?? 0) === 0}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          <Trash2 size={16} />
          Clear thumbnails
        </button>
      </Section>

      <NotificationsSection online={online} />

      {authStatus?.authRequired && <PasswordSection online={online} />}

      <Section title="App">
        <Row label="Version" value={APP_VERSION} />
      </Section>
    </div>
  );
}
