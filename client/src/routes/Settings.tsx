import { RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import {
  useOnlineStatus,
  useSyncStatus,
  useForceSync,
  usePeriodicSyncStatus,
  useThumbnailCacheStats,
  useClearThumbnailCache,
} from "../api/localHooks.js";

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
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="text-right text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

const SYNC_ERROR_LABEL: Record<string, string> = {
  auth: "Sign-in expired — reopen the app to sign in",
  network: "Couldn't reach the server",
  unknown: "Sync failed",
};

export function Settings() {
  const online = useOnlineStatus();
  const { data: sync } = useSyncStatus();
  const { data: pbs } = usePeriodicSyncStatus();
  const forceSync = useForceSync();
  const { data: cache } = useThumbnailCacheStats();
  const clearThumbs = useClearThumbnailCache();

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

      <Section title="App">
        <Row label="Version" value={APP_VERSION} />
      </Section>
    </div>
  );
}
