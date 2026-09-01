import { z } from "zod";
import {
  personTagSchema,
  createEntitySchema,
  createLogSchema,
  updateLogSchema,
  createAlbumSchema,
  updateAlbumSchema,
  createEntityNoteSchema,
  updateEntityNoteSchema,
} from "./validation.js";

/**
 * `POST /api/sync/mutations` — structural validation of the envelope. Per-mutation payloads
 * are parsed inside `syncMutationsService` with the schemas below, AFTER negative temp ids
 * have been resolved to real positive ids (so these can require positive ids).
 */

export const MUTATION_TYPES = [
  "entity.create",
  "log.create",
  "log.update",
  "log.delete",
  "album.create",
  "album.update",
  "album.delete",
  "album.addEvent",
  "album.removeEvent",
  "album.addPerson",
  "album.removePerson",
  "note.create",
  "note.update",
  "note.delete",
] as const;

export const mutationTypeSchema = z.enum(MUTATION_TYPES);

export const mutationEnvelopeSchema = z.object({
  mutationId: z.string().trim().min(1).max(100),
  type: mutationTypeSchema,
  tempId: z.number().int().negative().optional(),
  payload: z.unknown(),
  baseVersion: z.number().int().nonnegative().optional(),
});

export const syncMutationsRequestSchema = z.object({
  mutations: z.array(mutationEnvelopeSchema).max(500),
});

export type ParsedMutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;

// ---- per-type payload schemas (post temp-id resolution → ids are positive) ----

const posId = z.number().int().positive();

export const mutationPayloadSchemas = {
  "entity.create": createEntitySchema,
  "log.create": createLogSchema,
  "log.update": z.intersection(z.object({ logId: posId }), updateLogSchema),
  "log.delete": z.object({ logId: posId, deletePhotos: z.boolean().optional().default(false) }),
  "album.create": createAlbumSchema,
  "album.update": z.intersection(z.object({ albumId: posId }), updateAlbumSchema),
  "album.delete": z.object({ albumId: posId, deletePhotos: z.boolean().optional().default(false) }),
  "album.addEvent": z.object({ albumId: posId, logId: posId }),
  "album.removeEvent": z.object({ albumId: posId, logId: posId }),
  "album.addPerson": z.object({ albumId: posId, person: personTagSchema }),
  "album.removePerson": z.object({ albumId: posId, personId: posId }),
  "note.create": z.intersection(z.object({ entityId: posId }), createEntityNoteSchema),
  "note.update": z.intersection(z.object({ noteId: posId }), updateEntityNoteSchema),
  "note.delete": z.object({ noteId: posId }),
} satisfies Record<(typeof MUTATION_TYPES)[number], z.ZodType>;
