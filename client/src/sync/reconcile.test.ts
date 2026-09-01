import { describe, it, expect, beforeEach } from "vitest";
import { reconcileIds } from "./reconcile.js";
import { getDB, type OutboxRecord } from "../local/db.js";
import { listOutbox } from "../local/outbox.js";
import {
  makeAlbum,
  makeEntity,
  makeLog,
  makeNote,
  resetFixtureCounters,
} from "../test/seedLocalDb.js";

async function put(store: "entities" | "logs" | "albums" | "entityNotes", row: object) {
  await (await getDB()).put(store, row as never);
}
const all = async <T>(store: "entities" | "logs" | "albums" | "entityNotes") =>
  (await (await getDB()).getAll(store)) as T[];

describe("reconcileIds", () => {
  beforeEach(() => resetFixtureCounters());

  it("re-keys a temp row and rewrites the foreign keys that point at it", async () => {
    await put("entities", { ...makeEntity({ id: -1, title: "Heat" }), _localDirty: true });
    await put("logs", { ...makeLog({ id: -2, entityId: -1 }), _localDirty: true });
    await put("entityNotes", { ...makeNote({ id: -3, entityId: -1 }), _localDirty: true });

    await reconcileIds(new Map([[-1, 100], [-2, 200], [-3, 300]]));

    expect((await all<{ id: number }>("entities")).map((e) => e.id)).toEqual([100]);
    expect(await all<{ id: number; entityId: number }>("logs")).toEqual([
      expect.objectContaining({ id: 200, entityId: 100 }),
    ]);
    expect((await all<{ entityId: number }>("entityNotes"))[0].entityId).toBe(100);
  });

  it("drops the temp row when the server deduped it onto an existing one", async () => {
    await put("entities", makeEntity({ id: 50, category: "eating_out", title: "Chipotle" }));
    await put("entities", {
      ...makeEntity({ id: -1, category: "eating_out", title: "Chipotle" }),
      _localDirty: true,
    });
    await put("logs", { ...makeLog({ id: -2, entityId: -1 }), _localDirty: true });

    await reconcileIds(new Map([[-1, 50], [-2, 99]]));

    expect((await all<{ id: number }>("entities")).map((e) => e.id).sort((a, b) => a - b)).toEqual([50]);
    expect((await all<{ entityId: number }>("logs"))[0].entityId).toBe(50);
  });

  it("converges two temp people that map to the same real id", async () => {
    await put("logs", { ...makeLog({ id: -9, entityId: 1, peopleIds: [-1, -2] }), _localDirty: true });
    await reconcileIds(new Map([[-1, 7], [-2, 7], [-9, 90]]));
    expect((await all<{ peopleIds: number[] }>("logs"))[0].peopleIds).toEqual([7]);
  });

  it("rewrites still-pending outbox envelopes but not dead letters", async () => {
    const db = await getDB();
    const rec = (over: Partial<OutboxRecord> & Pick<OutboxRecord, "mutationId" | "seq">): OutboxRecord => ({
      type: "log.create",
      payload: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      attempts: 0,
      status: "pending",
      affects: [],
      ...over,
    });
    const tx = db.transaction("outbox", "readwrite");
    await tx.store.put(
      rec({
        mutationId: "p",
        seq: 2,
        payload: { entityId: -1, people: [{ id: -2 }] },
        affects: [{ store: "logs", id: -5 }],
      }),
    );
    await tx.store.put(rec({ mutationId: "d", seq: 1, status: "dead", payload: { entityId: -1 } }));
    await tx.done;

    await reconcileIds(new Map([[-1, 10], [-2, 20], [-5, 55]]));

    const rows = await listOutbox();
    expect(rows.find((r) => r.mutationId === "p")).toMatchObject({
      payload: { entityId: 10, people: [{ id: 20 }] },
      affects: [{ store: "logs", id: 55 }],
    });
    expect(rows.find((r) => r.mutationId === "d")?.payload).toEqual({ entityId: -1 });
  });

  it("also rewrites album link arrays", async () => {
    await put("albums", { ...makeAlbum({ id: -1, eventLogIds: [-2], personIds: [-3] }), _localDirty: true });
    await reconcileIds(new Map([[-1, 1], [-2, 2], [-3, 3]]));
    expect(await all<{ eventLogIds: number[]; personIds: number[] }>("albums")).toEqual([
      expect.objectContaining({ eventLogIds: [2], personIds: [3] }),
    ]);
  });
});
