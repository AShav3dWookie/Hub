import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useSyncBootstrap } from "./useSyncBootstrap.js";
import { getDB, getMeta, META_SYNC_CURSOR } from "../local/db.js";
import { makeEntity, resetFixtureCounters } from "../test/seedLocalDb.js";

function page(body: { changes?: Record<string, unknown[]>; nextCursor?: string; hasMore?: boolean }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      changes: { entities: [], logs: [], photos: [], albums: [], entityNotes: [], ...body.changes },
      deletions: [],
      nextCursor: body.nextCursor ?? "0",
      hasMore: body.hasMore ?? false,
      serverTime: "2026-06-15T00:00:00.000Z",
    }),
  };
}

function Harness() {
  useSyncBootstrap();
  const { data } = useQuery({
    queryKey: ["entities-count"],
    queryFn: async () => (await getDB()).count("entities"),
    staleTime: Infinity,
  });
  return <div>count:{data ?? "?"}</div>;
}

describe("useSyncBootstrap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pulls on mount, populates the replica, and refetches queries", async () => {
    resetFixtureCounters();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string) =>
        Promise.resolve(page({ changes: { entities: [makeEntity({ title: "Heat" })] }, nextCursor: "1" })),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByText } = render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(getByText("count:1")).toBeInTheDocument());
    expect(await getMeta<string>(META_SYNC_CURSOR)).toBe("1");
  });

  it("swallows a pull failure (recorded in meta, not thrown)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(async () => expect(await getMeta("lastSyncError")).toBe("network"));
  });
});
