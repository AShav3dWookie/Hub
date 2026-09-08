import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logPhotos } from "../server/src/db/schema.js";
import { eq } from "drizzle-orm";
import { getEntityWithLogs } from "../server/src/services/entityDetailService.js";
import { listGalleryPhotos } from "../server/src/services/galleryService.js";
import * as local from "../client/src/local/queries.js";
import {
  attachPhoto,
  createParityFixture,
  createParitySession,
  type ParityFixture,
} from "./helpers/fixture.js";

/**
 * Parity after an *incremental* sync, not just a bootstrap.
 *
 * `reads.test.ts` builds its replica by draining the feed from `since = 0`, so every link
 * array it holds is rebuilt from scratch and correct by construction. A real client only does
 * that once. Afterwards it asks for the rows that changed, which means a row whose link array
 * went stale without its own `row_seq` moving is simply never re-sent — invisible to a
 * bootstrap, permanent for everyone else.
 *
 * That is not hypothetical: attaching a photo did not bump its parent log, so the log kept the
 * `photoIds: []` it was first sent and photos vanished from the entity page while still showing
 * in the gallery, which reads photos directly. These tests sync, change something, and sync
 * again — the only shape that catches it.
 */
describe("server and offline client parity after an incremental sync", () => {
  let fx: ParityFixture;
  let session: ReturnType<typeof createParitySession>;

  beforeEach(() => {
    fx = createParityFixture();
    session = createParitySession(fx.db);
    session.sync(); // the client's first, full sync
  });

  afterEach(() => {
    fx.cleanup();
  });

  /** A movie log that already has photos in the fixture, plus its entity. */
  function logWithPhotos() {
    const log = session.snap.logs.find((l) => l.photoIds.length > 0);
    if (!log) throw new Error("fixture has no photo-bearing log");
    return log;
  }

  it("re-syncs a log after a photo is attached to it", () => {
    const log = session.snap.logs.find((l) => l.photoIds.length === 0);
    if (!log) throw new Error("fixture has no photo-free log");

    attachPhoto(fx.db, { logId: log.id, name: "added-later" });
    session.sync();

    const { type, ...actual } = local.getEntityDetail(session.snap, log.entityId) as never as {
      type: string;
    } & Record<string, unknown>;
    expect(type).toBe("entity");
    expect(actual).toEqual(getEntityWithLogs(fx.db, log.entityId));

    // Stated outright, so a failure reads as "the photo never arrived" rather than as a
    // deep-equality dump.
    const synced = session.snap.logs.find((l) => l.id === log.id);
    expect(synced?.photoIds).toHaveLength(1);
  });

  it("re-syncs a log after one of its photos is removed", () => {
    const log = logWithPhotos();
    const removed = log.photoIds[0];

    fx.db.delete(logPhotos).where(eq(logPhotos.id, removed)).run();
    session.sync();

    const { type, ...actual } = local.getEntityDetail(session.snap, log.entityId) as never as {
      type: string;
    } & Record<string, unknown>;
    expect(type).toBe("entity");
    expect(actual).toEqual(getEntityWithLogs(fx.db, log.entityId));

    const synced = session.snap.logs.find((l) => l.id === log.id);
    expect(synced?.photoIds).not.toContain(removed);
  });

  it("still agrees on the gallery, which reads photos directly", () => {
    // The control. This path reads snap.photos rather than a log's link array, so it stayed
    // correct throughout — which is why the bug looked like "photos work everywhere except
    // the entity page". It also proves the two tests above measure the link array and not
    // some general failure to sync.
    const log = session.snap.logs.find((l) => l.photoIds.length === 0)!;
    attachPhoto(fx.db, { logId: log.id, name: "gallery-check" });
    session.sync();

    expect(local.getGallery(session.snap, {})).toEqual(listGalleryPhotos(fx.db, {}));
  });
});
