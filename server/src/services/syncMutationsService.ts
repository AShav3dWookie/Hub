import { eq } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { albums, entityNotes, logs, syncAppliedMutations } from "../db/schema.js";
import { AppError, BadRequestError, NotFoundError } from "../lib/errors.js";
import { mutationPayloadSchemas, type ParsedMutationEnvelope } from "../lib/syncValidation.js";
import { findOrCreateEntity } from "./entityService.js";
import { createLog, updateLog, deleteLog } from "./logService.js";
import {
  createAlbum,
  updateAlbum,
  deleteAlbum,
  addAlbumEvent,
  removeAlbumEvent,
  addAlbumPerson,
  removeAlbumPerson,
} from "./albumService.js";
import { createEntityNote, updateEntityNote, deleteEntityNote } from "./entityNotesService.js";
import { deletePhotosForAlbum, deletePhotosForLog } from "./logPhotosService.js";
import type { MutationResult, MutationType } from "@logger/shared";

type MutationEnvelope = ParsedMutationEnvelope;

const nowIso = () => new Date().toISOString();

/**
 * A negative temp id that isn't in the batch id map *yet*. The dispatcher may just be seeing
 * this envelope before the `*.create` that produces the id — `applyMutations` defers it and
 * retries after the rest of the batch, so envelope order doesn't have to be perfect.
 */
class UnresolvedTempIdError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "UnresolvedTempIdError";
  }
}

/** Resolve a value that may be a negative temp id to its real id from the batch map. */
function resolve(value: unknown, idMap: Map<number, number>, ctx: string): unknown {
  if (typeof value !== "number" || value >= 0) return value;
  const real = idMap.get(value);
  if (real == null) throw new UnresolvedTempIdError(`Unresolved temp id ${value} (${ctx})`);
  return real;
}

function resolvePeople(people: unknown, idMap: Map<number, number>): unknown {
  if (!Array.isArray(people)) return people;
  return people.map((tag) =>
    tag && typeof tag === "object" && "id" in tag
      ? { ...tag, id: resolve((tag as { id: unknown }).id, idMap, "person tag") }
      : tag,
  );
}

/**
 * Deep-clone `payload` and replace every negative temp id in the id-bearing fields for this
 * mutation type with its real id from `idMap`. A surviving negative (dependency not created
 * earlier in the batch) throws.
 */
function rewriteNegIds(
  type: MutationType,
  payload: unknown,
  idMap: Map<number, number>,
): Record<string, unknown> {
  const p = JSON.parse(JSON.stringify(payload ?? {})) as Record<string, unknown>;
  switch (type) {
    case "log.create":
      if (p.entityId != null) p.entityId = resolve(p.entityId, idMap, "log.create.entityId");
      p.people = resolvePeople(p.people, idMap);
      break;
    case "log.update":
      p.logId = resolve(p.logId, idMap, "log.update.logId");
      p.people = resolvePeople(p.people, idMap);
      break;
    case "log.delete":
      p.logId = resolve(p.logId, idMap, "log.delete.logId");
      break;
    case "album.create":
      p.eventLogIds = Array.isArray(p.eventLogIds)
        ? p.eventLogIds.map((v) => resolve(v, idMap, "album.create.eventLogIds"))
        : p.eventLogIds;
      p.people = resolvePeople(p.people, idMap);
      break;
    case "album.update":
      p.albumId = resolve(p.albumId, idMap, "album.update.albumId");
      break;
    case "album.delete":
      p.albumId = resolve(p.albumId, idMap, "album.delete.albumId");
      break;
    case "album.addEvent":
    case "album.removeEvent":
      p.albumId = resolve(p.albumId, idMap, `${type}.albumId`);
      p.logId = resolve(p.logId, idMap, `${type}.logId`);
      break;
    case "album.addPerson":
      p.albumId = resolve(p.albumId, idMap, "album.addPerson.albumId");
      if (p.person && typeof p.person === "object" && "id" in p.person) {
        p.person = { ...p.person, id: resolve((p.person as { id: unknown }).id, idMap, "album.addPerson.person") };
      }
      break;
    case "album.removePerson":
      p.albumId = resolve(p.albumId, idMap, "album.removePerson.albumId");
      p.personId = resolve(p.personId, idMap, "album.removePerson.personId");
      break;
    case "note.create":
      p.entityId = resolve(p.entityId, idMap, "note.create.entityId");
      break;
    case "note.update":
    case "note.delete":
      p.noteId = resolve(p.noteId, idMap, `${type}.noteId`);
      break;
    case "entity.create":
      break;
  }
  return p;
}

type VersionedTable = typeof logs | typeof albums | typeof entityNotes;

/** A dispatch outcome before the mutation id is attached. */
type Outcome = Omit<MutationResult, "mutationId">;

function versionOf(db: AppDb, table: VersionedTable, id: number): number | null {
  const row = db
    .select({ version: table.version })
    .from(table)
    .where(eq(table.id, id))
    .get();
  return row?.version ?? null;
}

/**
 * The outbox replays, so a delete can arrive for a row that is already gone — a retry after a
 * response was lost, or two devices deleting the same thing. That is the delete succeeding, not
 * failing, so a missing row reports "applied" and the envelope leaves the queue.
 */
function runOrTreatMissingAsDone(run: () => void): Outcome {
  try {
    run();
  } catch (e) {
    if (e instanceof NotFoundError) return { status: "applied" };
    throw e;
  }
  return { status: "applied" };
}

/**
 * Link and unlink operations against a row that has since been deleted, or an edge that already
 * exists, are reported as "skipped": nothing was written, but nothing is wrong either, and the
 * client should stop retrying.
 */
function runOrSkip(run: () => void): Outcome {
  try {
    run();
  } catch (e) {
    if (e instanceof AppError) return { status: "skipped" };
    throw e;
  }
  return { status: "applied" };
}

/**
 * An update against a versioned row. A row that has vanished is skipped. Otherwise the write
 * goes through regardless, and the result is flagged "conflict" when the client edited an older
 * version than the one on the server — last write wins, but the client is told it raced.
 */
function applyVersionedUpdate(
  db: AppDb,
  table: VersionedTable,
  id: number,
  baseVersion: number | undefined,
  apply: () => void,
): Outcome {
  const pre = versionOf(db, table, id);
  if (pre == null) return { status: "skipped" };
  apply();
  const post = versionOf(db, table, id);
  return {
    status: baseVersion != null && baseVersion < pre ? "conflict" : "applied",
    serverVersion: post ?? undefined,
  };
}

/** Apply one already-id-resolved envelope. May throw — the caller turns that into `status:"error"`. */
function dispatchOne(
  db: AppDb,
  photosDir: string,
  env: MutationEnvelope,
  idMap: Map<number, number>,
): MutationResult {
  const raw = rewriteNegIds(env.type, env.payload, idMap);
  const base = { mutationId: env.mutationId } as const;
  const mapResult = (realId: number): MutationResult =>
    env.tempId != null
      ? { ...base, status: "applied", idMap: { [env.tempId]: realId } }
      : { ...base, status: "applied" };

  switch (env.type) {
    case "entity.create": {
      const p = mutationPayloadSchemas["entity.create"].parse(raw);
      const e = findOrCreateEntity(db, p.category, p.title, {
        releaseYear: p.releaseYear ?? null,
        author: p.author ?? null,
      });
      if (env.tempId != null) idMap.set(env.tempId, e.id);
      return { ...mapResult(e.id), serverVersion: e.version };
    }
    case "log.create": {
      const p = mutationPayloadSchemas["log.create"].parse(raw);
      const log = createLog(db, p);
      if (env.tempId != null) idMap.set(env.tempId, log.id);
      return mapResult(log.id);
    }
    case "log.update": {
      const p = mutationPayloadSchemas["log.update"].parse(raw);
      return {
        ...base,
        ...applyVersionedUpdate(db, logs, p.logId, env.baseVersion, () => updateLog(db, p.logId, p)),
      };
    }
    case "log.delete": {
      const p = mutationPayloadSchemas["log.delete"].parse(raw);
      return {
        ...base,
        ...runOrTreatMissingAsDone(() => {
          if (p.deletePhotos) deletePhotosForLog(db, photosDir, p.logId);
          deleteLog(db, p.logId);
        }),
      };
    }
    case "album.create": {
      const p = mutationPayloadSchemas["album.create"].parse(raw);
      const album = createAlbum(db, p);
      if (env.tempId != null) idMap.set(env.tempId, album.id);
      return mapResult(album.id);
    }
    case "album.update": {
      const p = mutationPayloadSchemas["album.update"].parse(raw);
      return {
        ...base,
        ...applyVersionedUpdate(db, albums, p.albumId, env.baseVersion, () =>
          updateAlbum(db, p.albumId, p),
        ),
      };
    }
    case "album.delete": {
      const p = mutationPayloadSchemas["album.delete"].parse(raw);
      return {
        ...base,
        ...runOrTreatMissingAsDone(() => {
          if (p.deletePhotos) deletePhotosForAlbum(db, photosDir, p.albumId);
          deleteAlbum(db, p.albumId);
        }),
      };
    }
    case "album.addEvent": {
      const p = mutationPayloadSchemas["album.addEvent"].parse(raw);
      return { ...base, ...runOrSkip(() => addAlbumEvent(db, p.albumId, p.logId)) };
    }
    case "album.removeEvent": {
      const p = mutationPayloadSchemas["album.removeEvent"].parse(raw);
      return { ...base, ...runOrSkip(() => removeAlbumEvent(db, p.albumId, p.logId)) };
    }
    case "album.addPerson": {
      const p = mutationPayloadSchemas["album.addPerson"].parse(raw);
      return { ...base, ...runOrSkip(() => addAlbumPerson(db, p.albumId, p.person)) };
    }
    case "album.removePerson": {
      const p = mutationPayloadSchemas["album.removePerson"].parse(raw);
      return { ...base, ...runOrSkip(() => removeAlbumPerson(db, p.albumId, p.personId)) };
    }
    case "note.create": {
      const p = mutationPayloadSchemas["note.create"].parse(raw);
      const note = createEntityNote(db, p.entityId, p);
      if (env.tempId != null) idMap.set(env.tempId, note.id);
      return mapResult(note.id);
    }
    case "note.update": {
      const p = mutationPayloadSchemas["note.update"].parse(raw);
      return {
        ...base,
        ...applyVersionedUpdate(db, entityNotes, p.noteId, env.baseVersion, () =>
          updateEntityNote(db, p.noteId, p),
        ),
      };
    }
    case "note.delete": {
      const p = mutationPayloadSchemas["note.delete"].parse(raw);
      return { ...base, ...runOrTreatMissingAsDone(() => deleteEntityNote(db, p.noteId)) };
    }
  }
}

function toMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Replay a batch of queued client mutations. Each envelope is applied in its own transaction;
 * a batch-local id map resolves negative temp ids from `*.create` results. Envelopes whose
 * temp-id dependency hasn't been created yet are **deferred and retried** after the rest of
 * the batch (so a create that gains a dependency out of order still lands), until a pass makes
 * no progress. Every `mutationId` is recorded (success or error) so a replayed batch returns
 * the stored result instead of re-applying — idempotent retry. Results come back in input
 * order regardless of the deferral shuffle.
 */
export function applyMutations(
  db: AppDb,
  photosDir: string,
  envelopes: ParsedMutationEnvelope[],
): MutationResult[] {
  const idMap = new Map<number, number>();
  const done = new Map<string, MutationResult>();

  const record = (mutationId: string, result: MutationResult) => {
    db.insert(syncAppliedMutations)
      .values({ mutationId, resultJson: JSON.stringify(result), createdAt: nowIso() })
      .onConflictDoNothing()
      .run();
    done.set(mutationId, result);
  };

  /** Apply one envelope now. `"defer"` = its temp-id dependency isn't in the batch map yet. */
  const runOne = (env: ParsedMutationEnvelope): MutationResult | "defer" => {
    const cached = db
      .select({ resultJson: syncAppliedMutations.resultJson })
      .from(syncAppliedMutations)
      .where(eq(syncAppliedMutations.mutationId, env.mutationId))
      .get();
    if (cached) {
      const result = JSON.parse(cached.resultJson) as MutationResult;
      if (result.idMap) {
        for (const [temp, real] of Object.entries(result.idMap)) idMap.set(Number(temp), real);
      }
      return result;
    }

    try {
      // better-sqlite3 is single-connection: everything inside runs in this BEGIN/COMMIT.
      return db.transaction(() => {
        const r = dispatchOne(db, photosDir, env, idMap);
        db.insert(syncAppliedMutations)
          .values({ mutationId: env.mutationId, resultJson: JSON.stringify(r), createdAt: nowIso() })
          .run();
        return r;
      });
    } catch (e) {
      if (e instanceof UnresolvedTempIdError) return "defer";
      // A real failure — record it OUTSIDE a transaction so a replay won't re-run the poison.
      return { mutationId: env.mutationId, status: "error", error: toMessage(e) } satisfies MutationResult;
    }
  };

  let queue = [...envelopes];
  while (queue.length > 0) {
    const deferred: ParsedMutationEnvelope[] = [];
    let progressed = false;
    for (const env of queue) {
      const r = runOne(env);
      if (r === "defer") {
        deferred.push(env);
        continue;
      }
      // dispatchOne already stored a success inside its txn; errors are stored here.
      if (r.status === "error") record(env.mutationId, r);
      else done.set(env.mutationId, r);
      progressed = true;
    }
    if (deferred.length === 0) break;
    if (!progressed) {
      for (const env of deferred) {
        record(env.mutationId, {
          mutationId: env.mutationId,
          status: "error",
          error: "Unresolved temp id — its create is missing from the batch",
        });
      }
      break;
    }
    queue = deferred;
  }

  return envelopes.map((e) => done.get(e.mutationId)!);
}
