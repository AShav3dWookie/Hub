import { QueryClient } from "@tanstack/react-query";

/**
 * Local-first: queries read the IndexedDB replica (never the network), so results never go
 * stale on their own — the sync engine refreshes the data and invalidates.
 *
 * `networkMode: "always"` for both. Reads, so they keep running when the browser reports
 * offline. And writes: every write hook is a local IndexedDB write plus an outbox entry, so it
 * needs no network either — but TanStack's default for mutations pauses them while it believes
 * the browser is offline. That only happens after an `offline` event, so it hid from every test
 * that loaded the page already offline, and showed up the moment the network dropped with the
 * app open — walking into a shop with no signal, say: every add and tick-off silently waited.
 * The one online-only write, media upload, disables itself offline rather than relying on this.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
        networkMode: "always",
        retry: false,
      },
      mutations: {
        networkMode: "always",
      },
    },
  });
}
