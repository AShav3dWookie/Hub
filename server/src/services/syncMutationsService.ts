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

/** Resolve a value that may be a negative temp id to its real id from the batch map. */
function resolve(value: unknown, idMap: Map<number, number>, ctx: string): unknown {
  if (typeof value !== "number" || value >= 0) return value;
  const real = idMap.get(value);
  if (real == null) throw new BadRequestError(`Unresolved temp id ${value} (${ctx})`);
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

function versionOf(
  db: AppDb,
  table: typeof logs | typeof albums | typeof entityNotes,
  id: number,
): number | null {
  const row = db
    .select({ version: table.version })
    .from(table)
    .where(eq(table.id, id))
    .get();
  return row?.version ?? null;
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
      const pre = versionOf(db, logs, p.logId);
      if (pre == null) return { ...base, status: "skipped" };
      updateLog(db, p.logId, p);
      const post = versionOf(db, logs, p.logId);
      const conflict = env.baseVersion != null && env.baseVersion < pre;
      return { ...base, status: conflict ? "conflict" : "applied", serverVersion: post ?? undefined };
    }
    case "log.delete": {
      const p = mutationPayloadSchemas["log.delete"].parse(raw);
      try {
        if (p.deletePhotos) deletePhotosForLog(db, photosDir, p.logId);
        deleteLog(db, p.logId);
      } catch (e) {
        if (e instanceof NotFoundError) return { ...base, status: "applied" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "album.create": {
      const p = mutationPayloadSchemas["album.create"].parse(raw);
      const album = createAlbum(db, p);
      if (env.tempId != null) idMap.set(env.tempId, album.id);
      return mapResult(album.id);
    }
    case "album.update": {
      const p = mutationPayloadSchemas["album.update"].parse(raw);
      const pre = versionOf(db, albums, p.albumId);
      if (pre == null) return { ...base, status: "skipped" };
      updateAlbum(db, p.albumId, p);
      const post = versionOf(db, albums, p.albumId);
      const conflict = env.baseVersion != null && env.baseVersion < pre;
      return { ...base, status: conflict ? "conflict" : "applied", serverVersion: post ?? undefined };
    }
    case "album.delete": {
      const p = mutationPayloadSchemas["album.delete"].parse(raw);
      try {
        if (p.deletePhotos) deletePhotosForAlbum(db, photosDir, p.albumId);
        deleteAlbum(db, p.albumId);
      } catch (e) {
        if (e instanceof NotFoundError) return { ...base, status: "applied" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "album.addEvent": {
      const p = mutationPayloadSchemas["album.addEvent"].parse(raw);
      try {
        addAlbumEvent(db, p.albumId, p.logId);
      } catch (e) {
        if (e instanceof AppError) return { ...base, status: "skipped" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "album.removeEvent": {
      const p = mutationPayloadSchemas["album.removeEvent"].parse(raw);
      try {
        removeAlbumEvent(db, p.albumId, p.logId);
      } catch (e) {
        if (e instanceof AppError) return { ...base, status: "skipped" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "album.addPerson": {
      const p = mutationPayloadSchemas["album.addPerson"].parse(raw);
      try {
        addAlbumPerson(db, p.albumId, p.person);
      } catch (e) {
        if (e instanceof AppError) return { ...base, status: "skipped" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "album.removePerson": {
      const p = mutationPayloadSchemas["album.removePerson"].parse(raw);
      try {
        removeAlbumPerson(db, p.albumId, p.personId);
      } catch (e) {
        if (e instanceof AppError) return { ...base, status: "skipped" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
    case "note.create": {
      const p = mutationPayloadSchemas["note.create"].parse(raw);
      const note = createEntityNote(db, p.entityId, p);
      if (env.tempId != null) idMap.set(env.tempId, note.id);
      return mapResult(note.id);
    }
    case "note.update": {
      const p = mutationPayloadSchemas["note.update"].parse(raw);
      const pre = versionOf(db, entityNotes, p.noteId);
      if (pre == null) return { ...base, status: "skipped" };
      updateEntityNote(db, p.noteId, p);
      const post = versionOf(db, entityNotes, p.noteId);
      const conflict = env.baseVersion != null && env.baseVersion < pre;
      return { ...base, status: conflict ? "conflict" : "applied", serverVersion: post ?? undefined };
    }
    case "note.delete": {
      const p = mutationPayloadSchemas["note.delete"].parse(raw);
      try {
        deleteEntityNote(db, p.noteId);
      } catch (e) {
        if (e instanceof NotFoundError) return { ...base, status: "applied" };
        throw e;
      }
      return { ...base, status: "applied" };
    }
  }
}

function toMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Replay a batch of queued client mutations. Each envelope is applied in its own transaction,
 * in array order; a batch-local id map resolves negative temp ids from earlier `*.create`
 * results. Every `mutationId` is recorded (success or error) so a replayed batch returns the
 * stored result instead of re-applying — idempotent retry.
 */
export function applyMutations(
  db: AppDb,
  photosDir: string,
  envelopes: ParsedMutationEnvelope[],
): MutationResult[] {
  const idMap = new Map<number, number>();
  const results: MutationResult[] = [];

  for (const env of envelopes) {
    const cached = db
      .select({ resultJson: syncAppliedMutations.resultJson })
      .from(syncAppliedMutations)
      .where(eq(syncAppliedMutations.mutationId, env.mutationId))
      .get();
    if (cached) {
      const result = JSON.parse(cached.resultJson) as MutationResult;
      // Re-seed the batch id map so later envelopes can still resolve this create.
      if (result.idMap) {
        for (const [temp, real] of Object.entries(result.idMap)) idMap.set(Number(temp), real);
      }
      results.push(result);
      continue;
    }

    let result: MutationResult;
    try {
      // better-sqlite3 is single-connection: everything inside runs in this BEGIN/COMMIT,
      // whether it goes through `db` or the tx handle.
      result = db.transaction(() => {
        const r = dispatchOne(db, photosDir, env, idMap);
        db.insert(syncAppliedMutations)
          .values({ mutationId: env.mutationId, resultJson: JSON.stringify(r), createdAt: nowIso() })
          .run();
        return r;
      });
    } catch (e) {
      result = { mutationId: env.mutationId, status: "error", error: toMessage(e) };
      // Record the failure OUTSIDE a transaction so a replay won't re-run the poison envelope.
      db.insert(syncAppliedMutations)
        .values({
          mutationId: env.mutationId,
          resultJson: JSON.stringify(result),
          createdAt: nowIso(),
        })
        .onConflictDoNothing()
        .run();
    }
    results.push(result);
  }

  return results;
}
