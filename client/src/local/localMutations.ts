import {
  normalizeTitle,
  type CreateAlbumRequest,
  type CreateEntityNoteRequest,
  type CreateEntityRequest,
  type CreateListRequest,
  type CreateLogRequest,
  type MutationType,
  type PersonTagInput,
  type UpdateAlbumRequest,
  type UpdateEntityNoteRequest,
  type UpdateListRequest,
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
  type LocalList,
  type LocalListItem,
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
  | { type: "note.delete"; input: { noteId: number } }
  | { type: "list.create"; input: CreateListRequest }
  | { type: "list.update"; input: UpdateListRequest & { listId: number } }
  | { type: "list.delete"; input: { listId: number } }
  | { type: "listItem.create"; input: { listId: number; text: string } }
  | { type: "listItem.delete"; input: { listId: number; itemId: number } };

/**
 * A write the replica can already tell the server would refuse — a clashing list name, deleting
 * the main list. Thrown before anything is queued, so the form can show it instead of the
 * envelope dead-lettering later.
 */
export class LocalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalValidationError";
  }
}

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
  | LocalList
  | LocalListItem
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
  const lists = tx.objectStore("lists");
  const listItems = tx.objectStore("listItems");

  const liveLists = async () => (await lists.getAll()).filter((l) => !l._localDeleted);

  /** Same-kind list names must stay unique, compared the way the server compares them. */
  const assertListNameFree = async (kind: string, name: string, exceptId?: number) => {
    const norm = normalizeTitle(name);
    const clash = (await liveLists()).find(
      (l) => l.kind === kind && l.normalizedName === norm && l.id !== exceptId,
    );
    if (clash) throw new LocalValidationError("A list with that name already exists");
  };

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
    // Aborting rejects `tx.done`; the error that caused it is the one to report, so that
    // rejection is expected and must not surface as an unhandled one.
    tx.done.catch(() => {});
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
          time: input.time ?? null,
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
            time: row.time,
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
            // Absent keeps the time, as on the server.
            time: m.input.time === undefined ? (row.time ?? null) : m.input.time,
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
          ...(m.input.time === undefined ? {} : { time: m.input.time }),
        };

        const create = logId < 0 ? await pendingCreateFor(logId) : undefined;
        if (create) {
          await collapseIntoCreate(create, {
            rating: payload.rating,
            date: payload.date,
            notes: payload.notes,
            people: payload.people,
            autoDelete: payload.autoDelete,
            ...("time" in payload ? { time: payload.time } : {}),
          });
          return row ?? { id: logId };
        }
        // Fold into a prior pending log.update for the same row, else queue a new one.
        const prior = (await pending()).find(
          (r) => r.type === "log.update" && (r.payload as { logId: number }).logId === logId,
        );
        if (prior) {
          // Merged, so an earlier edit's time survives a later one that didn't send any.
          prior.payload = { ...(prior.payload as object), ...payload };
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

      case "list.create": {
        const kind = m.input.kind ?? "shopping";
        const name = m.input.name.trim();
        await assertListNameFree(kind, name);
        const id = await mintTempId();
        const row: LocalList = {
          id,
          rowSeq: 0,
          version: 0,
          kind,
          name,
          normalizedName: normalizeTitle(name),
          isDefault: false,
          latitude: null,
          longitude: null,
          radiusM: null,
          createdAt: now,
          updatedAt: now,
          _localDirty: true,
        };
        await lists.put(row);
        await enqueue({
          type: "list.create",
          tempId: id,
          payload: { kind, name },
          affects: [{ store: "lists", id }],
        });
        return row;
      }

      case "list.update": {
        const { listId, isDefault, location } = m.input;
        const name = m.input.name?.trim();
        const row = await lists.get(listId);
        if (row && name != null) await assertListNameFree(row.kind, name, listId);

        const affects: { store: SyncStore; id: number }[] = [{ store: "lists", id: listId }];
        if (row) {
          if (name != null) Object.assign(row, { name, normalizedName: normalizeTitle(name) });
          if (isDefault && !row.isDefault) {
            // Demote the old main list here too, so the replica never shows two.
            for (const other of await liveLists()) {
              if (other.kind === row.kind && other.isDefault) {
                Object.assign(other, { isDefault: false, updatedAt: now, _localDirty: true });
                await lists.put(other);
                affects.push({ store: "lists", id: other.id });
              }
            }
            row.isDefault = true;
          }
          if (location !== undefined) {
            Object.assign(row, {
              latitude: location?.latitude ?? null,
              longitude: location?.longitude ?? null,
              radiusM: location?.radiusM ?? null,
            });
          }
          Object.assign(row, { updatedAt: now, _localDirty: true });
          await lists.put(row);
        }

        // A rename of a list the server hasn't seen folds into its create. Making it main or
        // moving its location can't — a create carries neither — so those still go as an update.
        const create = listId < 0 ? await pendingCreateFor(listId) : undefined;
        if (create && name != null) await collapseIntoCreate(create, { name });
        if (create && !isDefault && location === undefined) return row ?? { id: listId };

        const payload: Record<string, unknown> = { listId };
        if (name != null && !create) payload.name = name;
        if (isDefault) payload.isDefault = true;
        if (location !== undefined) payload.location = location;
        const prior = (await pending()).find(
          (r) => r.type === "list.update" && (r.payload as { listId: number }).listId === listId,
        );
        if (prior) {
          prior.payload = { ...(prior.payload as Record<string, unknown>), ...payload };
          prior.affects = [...prior.affects, ...affects];
          await outbox.put(prior);
        } else {
          await enqueue({
            type: "list.update",
            payload,
            baseVersion: row?.version || undefined,
            affects,
          });
        }
        return row ?? { id: listId };
      }

      case "list.delete": {
        const { listId } = m.input;
        const row = await lists.get(listId);
        if (row?.isDefault) {
          throw new LocalValidationError("The main list can't be deleted — make another list main first");
        }

        // Its items go with it. Their own queued writes would only fail against a deleted list.
        const own = await listItems.index("by-list").getAll(listId);
        for (const item of own) await listItems.delete(item.id);
        const ownIds = new Set(own.map((i) => i.id));
        for (const r of await pending()) {
          if (r.type.startsWith("listItem.") && (r.payload as { listId: number }).listId === listId) {
            await outbox.delete(r.mutationId);
          } else if (r.affects.some((a) => a.store === "listItems" && ownIds.has(a.id))) {
            await outbox.delete(r.mutationId);
          }
        }

        if (listId < 0 && (await pendingCreateFor(listId))) {
          await dropEnvelopesTouching(listId);
          await lists.delete(listId);
          return { id: listId };
        }
        if (row) {
          row._localDeleted = true;
          row._localDirty = true;
          await lists.put(row);
        }
        await enqueue({
          type: "list.delete",
          payload: { listId },
          baseVersion: row?.version || undefined,
          affects: [{ store: "lists", id: listId }],
        });
        return { id: listId };
      }

      case "listItem.create": {
        const { listId } = m.input;
        const text = m.input.text.trim();
        const normalizedText = normalizeTitle(text);
        // Already on the list: nothing to write, the same as the server's dedupe.
        const existing = (await listItems.index("by-list").getAll(listId)).find(
          (i) => i.normalizedText === normalizedText && !i._localDeleted,
        );
        if (existing) return existing;

        const id = await mintTempId();
        const row: LocalListItem = {
          id,
          rowSeq: 0,
          version: 0,
          listId,
          text,
          normalizedText,
          createdAt: now,
          updatedAt: now,
          _localDirty: true,
        };
        await listItems.put(row);
        await enqueue({
          type: "listItem.create",
          tempId: id,
          payload: { listId, text },
          affects: [{ store: "listItems", id }],
        });
        return row;
      }

      case "listItem.delete": {
        const { listId, itemId } = m.input;
        if (itemId < 0 && (await pendingCreateFor(itemId))) {
          await dropEnvelopesTouching(itemId);
          await listItems.delete(itemId);
          return { id: itemId };
        }
        const row = await listItems.get(itemId);
        if (row) {
          row._localDeleted = true;
          row._localDirty = true;
          await listItems.put(row);
        }
        await enqueue({
          type: "listItem.delete",
          payload: { listId, itemId },
          affects: [{ store: "listItems", id: itemId }],
        });
        return { id: itemId };
      }
    }
  }
}
