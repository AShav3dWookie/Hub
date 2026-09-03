import {
  normalizeTitle,
  type CreateAlbumRequest,
  type CreateEntityNoteRequest,
  type CreateEntityRequest,
  type CreateLogRequest,
  type MutationType,
  type PersonTagInput,
  type UpdateAlbumRequest,
  type UpdateEntityNoteRequest,
  type UpdateLogRequest,
} from "@logger/shared";
import {
  getDB,
  META_OUTBOX_SEQ,
  META_TEMP_ID_SEQ,
  WRITE_TX_STORES,
  type LocalAlbum,
  type LocalEntity,
  type LocalEntityNote,
  type LocalLog,
  type OutboxRecord,
  type SyncStore,
} from "./db.js";

/**
 * Turn a user action into a local-first write: mutate the IndexedDB replica optimistically
 * (temp negative ids for anything the server hasn't seen) and queue the matching envelope(s)
 * in the outbox for the next sync push. Everything happens in one `readwrite` transaction over
 * every store a write can touch, so a crash mid-write can't leave the replica and the queue
 * out of step.
 *
 * The server's `POST /api/sync/mutations` dispatcher only ever gets ids (real or negative
 * temp) — never names or inline `{category,title}`. So a `{name}` person tag and an inline new
 * entity on a log are **decomposed** here into their own `entity.create` envelope (queued with
 * a lower `seq`) and referenced by temp id.
 */

export type LocalMutation =
  | { type: "entity.create"; input: CreateEntityRequest }
  | { type: "log.create"; input: CreateLogRequest }
  | { type: "log.update"; input: UpdateLogRequest & { logId: number } }
  | { type: "log.delete"; input: { logId: number; deletePhotos: boolean } }
  | { type: "album.create"; input: CreateAlbumRequest }
  | { type: "album.update"; input: UpdateAlbumRequest & { albumId: number } }
  | { type: "album.delete"; input: { albumId: number; deletePhotos: boolean } }
  | { type: "album.addEvent"; input: { albumId: number; logId: number } }
  | { type: "album.removeEvent"; input: { albumId: number; logId: number } }
  | { type: "album.addPerson"; input: { albumId: number; person: PersonTagInput } }
  | { type: "album.removePerson"; input: { albumId: number; personId: number } }
  | { type: "note.create"; input: CreateEntityNoteRequest & { entityId: number } }
  | { type: "note.update"; input: UpdateEntityNoteRequest & { noteId: number } }
  | { type: "note.delete"; input: { noteId: number } };

/**
 * What `applyLocalMutation` hands back: the optimistic local row for a create/update (so a
 * caller can read `.id` / `.entityId` and navigate), or just `{ id }` for a delete / link op /
 * a no-op against a row that isn't in the replica.
 */
export type LocalMutationResult =
  | LocalEntity
  | LocalLog
  | LocalAlbum
  | LocalEntityNote
  | { id: number };

function newMutationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const isCreate = (t: MutationType) => t.endsWith(".create");

export async function applyLocalMutation(m: LocalMutation): Promise<LocalMutationResult> {
  const db = await getDB();
  const tx = db.transaction(WRITE_TX_STORES, "readwrite");
  const meta = tx.objectStore("meta");
  const outbox = tx.objectStore("outbox");
  const now = new Date().toISOString();

  // ---- counters (read-modify-write inside this same tx) ----
  const bump = async (key: string, delta: number): Promise<number> => {
    const current = ((await meta.get(key))?.value as number | undefined) ?? 0;
    const next = current + delta;
    await meta.put({ key, value: next });
    return next;
  };
  const mintTempId = () => bump(META_TEMP_ID_SEQ, -1);
  const mintSeq = () => bump(META_OUTBOX_SEQ, 1);

  // ---- outbox helpers ----
  const enqueue = async (env: {
    type: MutationType;
    payload: unknown;
    tempId?: number;
    baseVersion?: number;
    affects?: { store: SyncStore; id: number }[];
  }): Promise<void> => {
    const rec: OutboxRecord = {
      mutationId: newMutationId(),
      type: env.type,
      tempId: env.tempId,
      payload: env.payload,
      baseVersion: env.baseVersion,
      seq: await mintSeq(),
      createdAt: now,
      attempts: 0,
      status: "pending",
      affects: env.affects ?? [],
    };
    await outbox.put(rec);
  };

  const pending = () => outbox.getAll().then((all) => all.filter((r) => r.status === "pending"));

  /** A pending `*.create` whose row is `id`, if the row is still un-synced. */
  const pendingCreateFor = async (id: number): Promise<OutboxRecord | undefined> =>
    (await pending()).find((r) => r.tempId === id && isCreate(r.type));

  /** Merge `patch` into a pending create's payload (edit-before-sync collapse). */
  const collapseIntoCreate = async (create: OutboxRecord, patch: Record<string, unknown>) => {
    create.payload = { ...(create.payload as Record<string, unknown>), ...patch };
    await outbox.put(create);
  };

  /** Drop every pending envelope that references row `id` (temp create + its children). */
  const dropEnvelopesTouching = async (id: number) => {
    for (const r of await pending()) {
      if (r.tempId === id || r.affects.some((a) => a.id === id)) {
        await outbox.delete(r.mutationId);
      }
    }
  };

  // ---- replica helpers ----
  const entities = tx.objectStore("entities");
  const logs = tx.objectStore("logs");
  const albums = tx.objectStore("albums");
  const notes = tx.objectStore("entityNotes");

  const findLocalEntity = async (
    category: string,
    title: string,
  ): Promise<LocalEntity | undefined> => {
    const norm = normalizeTitle(title);
    const rows = await entities.index("by-category").getAll(category);
    return rows.find((e) => e.normalizedTitle === norm && !e._localDeleted);
  };

  /** Resolve or mint an entity id for `category`/`title`, queuing an `entity.create` if new. */
  const resolveNewEntity = async (
    category: CreateEntityRequest["category"],
    title: string,
    fields: { releaseYear?: number | null; author?: string | null } = {},
  ): Promise<number> => {
    const existing = await findLocalEntity(category, title);
    if (existing) return existing.id;
    const id = await mintTempId();
    const row: LocalEntity = {
      id,
      rowSeq: 0,
      version: 0,
      category,
      title,
      normalizedTitle: normalizeTitle(title),
      releaseYear: fields.releaseYear ?? null,
      author: fields.author ?? null,
      createdAt: now,
      _localDirty: true,
    };
    await entities.put(row);
    await enqueue({
      type: "entity.create",
      tempId: id,
      payload: {
        category,
        title,
        releaseYear: fields.releaseYear ?? null,
        author: fields.author ?? null,
      },
      affects: [{ store: "entities", id }],
    });
    return id;
  };

  /** `{id}` tags pass through; `{name}` tags become a person `entity.create` + a temp id. */
  const resolvePeople = async (tags: PersonTagInput[]): Promise<number[]> => {
    const ids: number[] = [];
    for (const tag of tags) {
      if (tag.id != null) ids.push(tag.id);
      else if (tag.name && tag.name.trim()) ids.push(await resolveNewEntity("person", tag.name.trim()));
    }
    return ids;
  };

  // ---------------------------------------------------------------------------

  try {
    const result = await dispatch();
    await tx.done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* transaction already settled */
    }
    throw e;
  }

  async function dispatch(): Promise<LocalMutationResult> {
    switch (m.type) {
      case "entity.create": {
        const { category, title, releaseYear, author } = m.input;
        const id = await resolveNewEntity(category, title, { releaseYear, author });
        return { id };
      }

      case "log.create": {
        const input = m.input;
        const entityId =
          input.entityId != null
            ? input.entityId
            : await resolveNewEntity(
                (input.category ?? "movie") as CreateEntityRequest["category"],
                input.title ?? "",
                { releaseYear: input.releaseYear, author: input.author },
              );
        const peopleIds = await resolvePeople(input.people ?? []);
        const id = await mintTempId();
        const row: LocalLog = {
          id,
          rowSeq: 0,
          version: 0,
          entityId,
          rating: input.rating ?? null,
          date: input.date,
          notes: input.notes ?? null,
          autoDelete: input.autoDelete ?? false,
          createdAt: now,
          updatedAt: now,
          peopleIds,
          photoIds: [],
          albumIds: [],
          _localDirty: true,
        };
        await logs.put(row);
        await enqueue({
          type: "log.create",
          tempId: id,
          payload: {
            entityId,
            rating: row.rating,
            date: row.date,
            notes: row.notes,
            people: peopleIds.map((pid) => ({ id: pid })),
            autoDelete: row.autoDelete,
          },
          affects: [{ store: "logs", id }],
        });
        return row;
      }

      case "log.update": {
        const { logId } = m.input;
        const row = await logs.get(logId);
        const peopleIds = await resolvePeople(m.input.people ?? []);
        if (row) {
          Object.assign(row, {
            rating: m.input.rating ?? null,
            date: m.input.date,
            notes: m.input.notes ?? null,
            autoDelete: m.input.autoDelete ?? false,
            peopleIds,
            updatedAt: now,
            _localDirty: true,
          });
          await logs.put(row);
        }

        const payload = {
          logId,
          rating: m.input.rating ?? null,
          date: m.input.date,
          notes: m.input.notes ?? null,
          people: peopleIds.map((pid) => ({ id: pid })),
          autoDelete: m.input.autoDelete ?? false,
        };

        const create = logId < 0 ? await pendingCreateFor(logId) : undefined;
        if (create) {
          await collapseIntoCreate(create, {
            rating: payload.rating,
            date: payload.date,
            notes: payload.notes,
            people: payload.people,
            autoDelete: payload.autoDelete,
          });
          return row ?? { id: logId };
        }
        // Fold into a prior pending log.update for the same row, else queue a new one.
        const prior = (await pending()).find(
          (r) => r.type === "log.update" && (r.payload as { logId: number }).logId === logId,
        );
        if (prior) {
          prior.payload = payload;
          await outbox.put(prior);
        } else {
          await enqueue({
            type: "log.update",
            payload,
            baseVersion: row?.version || undefined,
            affects: [{ store: "logs", id: logId }],
          });
        }
        return row ?? { id: logId };
      }

      case "log.delete": {
        const { logId, deletePhotos } = m.input;
        // Un-strand any album that linked this log.
        for (const album of await albums.getAll()) {
          if (album.eventLogIds.includes(logId)) {
            album.eventLogIds = album.eventLogIds.filter((x) => x !== logId);
            await albums.put(album);
          }
        }
        if (logId < 0 && (await pendingCreateFor(logId))) {
          await dropEnvelopesTouching(logId);
          await logs.delete(logId);
          return { id: logId };
        }
        const row = await logs.get(logId);
        if (row) {
          row._localDeleted = true;
          row._localDirty = true;
          await logs.put(row);
        }
        await enqueue({
          type: "log.delete",
          payload: { logId, deletePhotos },
          baseVersion: row?.version || undefined,
          affects: [{ store: "logs", id: logId }],
        });
        return { id: logId };
      }

      case "album.create": {
        const input = m.input;
        const personIds = await resolvePeople(input.people ?? []);
        const eventLogIds = [...(input.eventLogIds ?? [])];
        const id = await mintTempId();
        const row: LocalAlbum = {
          id,
          rowSeq: 0,
          version: 0,
          title: input.title,
          notes: input.notes ?? null,
          dateStart: input.dateStart ?? null,
          dateEnd: input.dateEnd ?? null,
          createdAt: now,
          updatedAt: now,
          eventLogIds,
          personIds,
          _localDirty: true,
        };
        await albums.put(row);
        for (const logId of eventLogIds) {
          const log = await logs.get(logId);
          if (log && !log.albumIds.includes(id)) {
            log.albumIds = [...log.albumIds, id];
            log._localDirty = true;
            await logs.put(log);
          }
        }
        await enqueue({
          type: "album.create",
          tempId: id,
          payload: {
            title: row.title,
            notes: row.notes,
            dateStart: row.dateStart,
            dateEnd: row.dateEnd,
            people: personIds.map((pid) => ({ id: pid })),
            eventLogIds,
          },
          affects: [{ store: "albums", id }, ...eventLogIds.map((lid) => ({ store: "logs" as const, id: lid }))],
        });
        return row;
      }

      case "album.update": {
        const { albumId } = m.input;
        const row = await albums.get(albumId);
        if (row) {
          Object.assign(row, {
            title: m.input.title,
            notes: m.input.notes ?? null,
            dateStart: m.input.dateStart ?? null,
            dateEnd: m.input.dateEnd ?? null,
            updatedAt: now,
            _localDirty: true,
          });
          await albums.put(row);
        }

        const payload = {
          albumId,
          title: m.input.title,
          notes: m.input.notes ?? null,
          dateStart: m.input.dateStart ?? null,
          dateEnd: m.input.dateEnd ?? null,
        };
        const create = albumId < 0 ? await pendingCreateFor(albumId) : undefined;
        if (create) {
          await collapseIntoCreate(create, {
            title: payload.title,
            notes: payload.notes,
            dateStart: payload.dateStart,
            dateEnd: payload.dateEnd,
          });
          return row ?? { id: albumId };
        }
        const prior = (await pending()).find(
          (r) => r.type === "album.update" && (r.payload as { albumId: number }).albumId === albumId,
        );
        if (prior) {
          prior.payload = payload;
          await outbox.put(prior);
        } else {
          await enqueue({
            type: "album.update",
            payload,
            baseVersion: row?.version || undefined,
            affects: [{ store: "albums", id: albumId }],
          });
        }
        return row ?? { id: albumId };
      }

      case "album.delete": {
        const { albumId, deletePhotos } = m.input;
        for (const log of await logs.getAll()) {
          if (log.albumIds.includes(albumId)) {
            log.albumIds = log.albumIds.filter((x) => x !== albumId);
            await logs.put(log);
          }
        }
        if (albumId < 0 && (await pendingCreateFor(albumId))) {
          await dropEnvelopesTouching(albumId);
          await albums.delete(albumId);
          return { id: albumId };
        }
        const row = await albums.get(albumId);
        if (row) {
          row._localDeleted = true;
          row._localDirty = true;
          await albums.put(row);
        }
        await enqueue({
          type: "album.delete",
          payload: { albumId, deletePhotos },
          baseVersion: row?.version || undefined,
          affects: [{ store: "albums", id: albumId }],
        });
        return { id: albumId };
      }

      case "album.addEvent": {
        const { albumId, logId } = m.input;
        const album = await albums.get(albumId);
        if (album && !album.eventLogIds.includes(logId)) {
          album.eventLogIds = [...album.eventLogIds, logId];
          album._localDirty = true;
          await albums.put(album);
        }
        const log = await logs.get(logId);
        if (log && !log.albumIds.includes(albumId)) {
          log.albumIds = [...log.albumIds, albumId];
          log._localDirty = true;
          await logs.put(log);
        }
        const create = albumId < 0 ? await pendingCreateFor(albumId) : undefined;
        if (create) {
          const payload = create.payload as { eventLogIds: number[] };
          if (!payload.eventLogIds.includes(logId)) payload.eventLogIds = [...payload.eventLogIds, logId];
          create.affects = [...create.affects, { store: "logs", id: logId }];
          await outbox.put(create);
          return { id: albumId };
        }
        await enqueue({
          type: "album.addEvent",
          payload: { albumId, logId },
          affects: [{ store: "albums", id: albumId }, { store: "logs", id: logId }],
        });
        return { id: albumId };
      }

      case "album.removeEvent": {
        const { albumId, logId } = m.input;
        const album = await albums.get(albumId);
        if (album) {
          album.eventLogIds = album.eventLogIds.filter((x) => x !== logId);
          album._localDirty = true;
          await albums.put(album);
        }
        const log = await logs.get(logId);
        if (log) {
          log.albumIds = log.albumIds.filter((x) => x !== albumId);
          log._localDirty = true;
          await logs.put(log);
        }
        // Annihilate a still-pending addEvent for the same pair.
        const add = (await pending()).find(
          (r) =>
            r.type === "album.addEvent" &&
            (r.payload as { albumId: number; logId: number }).albumId === albumId &&
            (r.payload as { albumId: number; logId: number }).logId === logId,
        );
        if (add) {
          await outbox.delete(add.mutationId);
          return { id: albumId };
        }
        const create = albumId < 0 ? await pendingCreateFor(albumId) : undefined;
        if (create) {
          const payload = create.payload as { eventLogIds: number[] };
          payload.eventLogIds = payload.eventLogIds.filter((x) => x !== logId);
          await outbox.put(create);
          return { id: albumId };
        }
        await enqueue({
          type: "album.removeEvent",
          payload: { albumId, logId },
          affects: [{ store: "albums", id: albumId }, { store: "logs", id: logId }],
        });
        return { id: albumId };
      }

      case "album.addPerson": {
        const { albumId } = m.input;
        const [personId] = await resolvePeople([m.input.person]);
        if (personId == null) return { id: albumId };
        const album = await albums.get(albumId);
        if (album && !album.personIds.includes(personId)) {
          album.personIds = [...album.personIds, personId];
          album._localDirty = true;
          await albums.put(album);
        }
        const create = albumId < 0 ? await pendingCreateFor(albumId) : undefined;
        if (create) {
          const payload = create.payload as { people: { id: number }[] };
          if (!payload.people.some((p) => p.id === personId)) payload.people = [...payload.people, { id: personId }];
          await outbox.put(create);
          return { id: albumId };
        }
        await enqueue({
          type: "album.addPerson",
          payload: { albumId, person: { id: personId } },
          affects: [{ store: "albums", id: albumId }],
        });
        return { id: albumId };
      }

      case "album.removePerson": {
        const { albumId, personId } = m.input;
        const album = await albums.get(albumId);
        if (album) {
          album.personIds = album.personIds.filter((x) => x !== personId);
          album._localDirty = true;
          await albums.put(album);
        }
        const add = (await pending()).find(
          (r) =>
            r.type === "album.addPerson" &&
            (r.payload as { albumId: number; person: { id: number } }).albumId === albumId &&
            (r.payload as { albumId: number; person: { id: number } }).person.id === personId,
        );
        if (add) {
          await outbox.delete(add.mutationId);
          return { id: albumId };
        }
        const create = albumId < 0 ? await pendingCreateFor(albumId) : undefined;
        if (create) {
          const payload = create.payload as { people: { id: number }[] };
          payload.people = payload.people.filter((p) => p.id !== personId);
          await outbox.put(create);
          return { id: albumId };
        }
        await enqueue({
          type: "album.removePerson",
          payload: { albumId, personId },
          affects: [{ store: "albums", id: albumId }],
        });
        return { id: albumId };
      }

      case "note.create": {
        const { entityId, category, body, tag, eventDate } = m.input;
        const id = await mintTempId();
        const row: LocalEntityNote = {
          id,
          rowSeq: 0,
          version: 0,
          entityId,
          category: category ?? "general",
          body: body ?? "",
          tag: tag ?? null,
          eventDate: eventDate ?? null,
          createdAt: now,
          updatedAt: now,
          _localDirty: true,
        };
        await notes.put(row);
        const payload: Record<string, unknown> = {
          entityId,
          category: row.category,
          body: row.body,
        };
        if (row.tag) payload.tag = row.tag;
        if (row.eventDate) payload.eventDate = row.eventDate;
        await enqueue({
          type: "note.create",
          tempId: id,
          payload,
          affects: [{ store: "entityNotes", id }],
        });
        return row;
      }

      case "note.update": {
        const { noteId } = m.input;
        const row = await notes.get(noteId);
        const nextCategory = m.input.category ?? row?.category ?? "general";
        const nextBody = m.input.body ?? "";
        const nextTag = m.input.tag ?? null;
        const nextEventDate = m.input.eventDate ?? null;
        if (row) {
          Object.assign(row, {
            category: nextCategory,
            body: nextBody,
            tag: nextTag,
            eventDate: nextEventDate,
            updatedAt: now,
            _localDirty: true,
          });
          await notes.put(row);
        }

        const payload: Record<string, unknown> = { noteId, category: nextCategory, body: nextBody };
        if (nextTag) payload.tag = nextTag;
        if (nextEventDate) payload.eventDate = nextEventDate;

        const create = noteId < 0 ? await pendingCreateFor(noteId) : undefined;
        if (create) {
          await collapseIntoCreate(create, {
            category: nextCategory,
            body: nextBody,
            tag: nextTag ?? undefined,
            eventDate: nextEventDate ?? undefined,
          });
          return row ?? { id: noteId };
        }
        const prior = (await pending()).find(
          (r) => r.type === "note.update" && (r.payload as { noteId: number }).noteId === noteId,
        );
        if (prior) {
          prior.payload = payload;
          await outbox.put(prior);
        } else {
          await enqueue({
            type: "note.update",
            payload,
            baseVersion: row?.version || undefined,
            affects: [{ store: "entityNotes", id: noteId }],
          });
        }
        return row ?? { id: noteId };
      }

      case "note.delete": {
        const { noteId } = m.input;
        if (noteId < 0 && (await pendingCreateFor(noteId))) {
          await dropEnvelopesTouching(noteId);
          await notes.delete(noteId);
          return { id: noteId };
        }
        const row = await notes.get(noteId);
        if (row) {
          row._localDeleted = true;
          row._localDirty = true;
          await notes.put(row);
        }
        await enqueue({
          type: "note.delete",
          payload: { noteId },
          baseVersion: row?.version || undefined,
          affects: [{ store: "entityNotes", id: noteId }],
        });
        return { id: noteId };
      }
    }
  }
}
