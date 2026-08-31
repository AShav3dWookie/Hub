import { useOnlineStatus } from "../api/localHooks.js";

/**
 * Shown above a form's submit button while offline. In the read-only lite tier, writes still
 * need a connection — this is the seam the offline write-queue replaces later.
 */
export function OfflineNotice({ verb = "Saving" }: { verb?: string }) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300"
    >
      You’re offline. {verb} needs a connection — reconnect to continue.
    </div>
  );
}
