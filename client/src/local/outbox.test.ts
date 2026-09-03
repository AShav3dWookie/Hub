import { describe, it, expect } from "vitest";
import { getDB, type OutboxRecord } from "./db.js";
import {
  countPending,
  deadLetters,
  discardDeadLetters,
  listOutbox,
  markAttempt,
  markDeadLetter,
  pendingOutbox,
  removeOutbox,
  rewriteOutboxIds,
} from "./outbox.js";

function rec(over: Partial<OutboxRecord> & Pick<OutboxRecord, "mutationId" | "seq">): OutboxRecord {
  return {
    type: "log.create",
    payload: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    attempts: 0,
    status: "pending",
    affects: [],
    ...over,
  };
}

async function seed(...records: OutboxRecord[]) {
  const db = await getDB();
  const tx = db.transaction("outbox", "readwrite");
  for (const r of records) await tx.store.put(r);
  await tx.done;
}

describe("outbox", () => {
  it("lists by seq regardless of insertion order", async () => {
    await seed(rec({ mutationId: "c", seq: 3 }), rec({ mutationId: "a", seq: 1 }), rec({ mutationId: "b", seq: 2 }));
    expect((await listOutbox()).map((r) => r.mutationId)).toEqual(["a", "b", "c"]);
  });

  it("separates pending from dead letters and counts pending only", async () => {
    await seed(
      rec({ mutationId: "a", seq: 1 }),
      rec({ mutationId: "b", seq: 2, status: "dead", error: "boom" }),
    );
    expect((await pendingOutbox()).map((r) => r.mutationId)).toEqual(["a"]);
    expect((await deadLetters()).map((r) => r.mutationId)).toEqual(["b"]);
    expect(await countPending()).toBe(1);
  });

  it("markAttempt / markDeadLetter / remove mutate in place", async () => {
    await seed(rec({ mutationId: "a", seq: 1 }));
    await markAttempt("a");
    await markAttempt("a");
    await markDeadLetter("a", "server said no");
    const [row] = await listOutbox();
    expect(row).toMatchObject({ attempts: 2, status: "dead", error: "server said no" });

    await removeOutbox("a");
    expect(await listOutbox()).toEqual([]);
  });

  it("discardDeadLetters drops only dead rows", async () => {
    await seed(
      rec({ mutationId: "a", seq: 1 }),
      rec({ mutationId: "b", seq: 2, status: "dead" }),
      rec({ mutationId: "c", seq: 3, status: "dead" }),
    );
    expect(await discardDeadLetters()).toBe(2);
    expect((await listOutbox()).map((r) => r.mutationId)).toEqual(["a"]);
  });

  it("rewriteOutboxIds remaps temp ids in payload / tempId / affects, pending only", async () => {
    await seed(
      rec({
        mutationId: "a",
        seq: 1,
        tempId: -1,
        payload: { category: "movie", title: "Heat" },
        affects: [{ store: "entities", id: -1 }],
      }),
      rec({
        mutationId: "b",
        seq: 2,
        type: "log.create",
        tempId: -2,
        payload: { entityId: -1, people: [{ id: -3 }], date: "2024-01-01" },
        affects: [{ store: "logs", id: -2 }],
      }),
      rec({ mutationId: "d", seq: 3, status: "dead", tempId: -2, payload: { entityId: -1 } }),
    );

    await rewriteOutboxIds(new Map([[-1, 10], [-2, 20], [-3, 30]]));

    const rows = await listOutbox();
    expect(rows[0]).toMatchObject({ tempId: 10, affects: [{ store: "entities", id: 10 }] });
    expect(rows[1].payload).toEqual({ entityId: 10, people: [{ id: 30 }], date: "2024-01-01" });
    expect(rows[1]).toMatchObject({ tempId: 20 });
    // dead letter untouched
    expect(rows[2].payload).toEqual({ entityId: -1 });
  });
});
