import { describe, it, expect } from "vitest";
import {
  MUTATION_TYPES,
  mutationEnvelopeSchema,
  mutationPayloadSchemas,
  syncMutationsRequestSchema,
} from "./syncValidation.js";

/**
 * The mutation envelope and the per-type payload table. This is the outer boundary of the
 * offline write path, and a wrong key here would silently accept bad data from a client, so it
 * is worth testing away from the full HTTP and dispatch path.
 */
describe("the payload schema table", () => {
  it("covers every mutation type, with no extras", () => {
    expect(Object.keys(mutationPayloadSchemas).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it("lists each type exactly once", () => {
    expect(new Set(MUTATION_TYPES).size).toBe(MUTATION_TYPES.length);
  });
});

describe("mutationEnvelopeSchema", () => {
  const valid = { mutationId: "m1", type: "log.delete", payload: { logId: 1 } };

  it("accepts a minimal envelope", () => {
    expect(mutationEnvelopeSchema.parse(valid)).toMatchObject({ mutationId: "m1" });
  });

  it("requires a non-empty mutation id", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, mutationId: "" })).toThrow();
    expect(() => mutationEnvelopeSchema.parse({ ...valid, mutationId: "   " })).toThrow();
  });

  it("rejects an over-long mutation id", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, mutationId: "x".repeat(101) })).toThrow();
  });

  it("rejects an unknown mutation type", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, type: "log.frobnicate" })).toThrow();
  });

  it("accepts a negative temp id, the marker for a row the server has not seen", () => {
    expect(mutationEnvelopeSchema.parse({ ...valid, tempId: -1 }).tempId).toBe(-1);
  });

  it("rejects a zero or positive temp id, which could collide with a real one", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, tempId: 0 })).toThrow();
    expect(() => mutationEnvelopeSchema.parse({ ...valid, tempId: 5 })).toThrow();
  });

  it("rejects a fractional temp id", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, tempId: -1.5 })).toThrow();
  });

  it("accepts a zero base version, meaning a row never yet updated", () => {
    expect(mutationEnvelopeSchema.parse({ ...valid, baseVersion: 0 }).baseVersion).toBe(0);
  });

  it("rejects a negative base version", () => {
    expect(() => mutationEnvelopeSchema.parse({ ...valid, baseVersion: -1 })).toThrow();
  });
});

describe("syncMutationsRequestSchema", () => {
  const envelope = (n: number) => ({
    mutationId: `m${n}`,
    type: "note.delete" as const,
    payload: { noteId: n },
  });

  it("accepts an empty batch", () => {
    expect(syncMutationsRequestSchema.parse({ mutations: [] }).mutations).toEqual([]);
  });

  it("accepts a full batch of 500", () => {
    const mutations = Array.from({ length: 500 }, (_, i) => envelope(i + 1));
    expect(syncMutationsRequestSchema.parse({ mutations }).mutations).toHaveLength(500);
  });

  it("rejects a batch over 500, so one request cannot be unbounded", () => {
    const mutations = Array.from({ length: 501 }, (_, i) => envelope(i + 1));
    expect(() => syncMutationsRequestSchema.parse({ mutations })).toThrow();
  });

  it("rejects a request with no mutations array at all", () => {
    expect(() => syncMutationsRequestSchema.parse({})).toThrow();
  });
});

describe("per-type payloads", () => {
  it("requires a positive id, since temp ids are resolved before this runs", () => {
    expect(() => mutationPayloadSchemas["note.delete"].parse({ noteId: -1 })).toThrow();
    expect(() => mutationPayloadSchemas["note.delete"].parse({ noteId: 0 })).toThrow();
    expect(mutationPayloadSchemas["note.delete"].parse({ noteId: 3 })).toEqual({ noteId: 3 });
  });

  it("defaults deletePhotos to false on a log delete", () => {
    expect(mutationPayloadSchemas["log.delete"].parse({ logId: 1 })).toEqual({
      logId: 1,
      deletePhotos: false,
    });
  });

  it("defaults deletePhotos to false on an album delete", () => {
    expect(mutationPayloadSchemas["album.delete"].parse({ albumId: 1 })).toEqual({
      albumId: 1,
      deletePhotos: false,
    });
  });

  it("keeps an explicit deletePhotos", () => {
    expect(mutationPayloadSchemas["log.delete"].parse({ logId: 1, deletePhotos: true })).toEqual({
      logId: 1,
      deletePhotos: true,
    });
  });

  it("requires both ids on an album/event link", () => {
    expect(() => mutationPayloadSchemas["album.addEvent"].parse({ albumId: 1 })).toThrow();
    expect(() => mutationPayloadSchemas["album.removeEvent"].parse({ logId: 1 })).toThrow();
    expect(mutationPayloadSchemas["album.addEvent"].parse({ albumId: 1, logId: 2 })).toEqual({
      albumId: 1,
      logId: 2,
    });
  });

  it("takes a person tag by id or by name when adding to an album", () => {
    expect(() =>
      mutationPayloadSchemas["album.addPerson"].parse({ albumId: 1, person: { id: 2 } }),
    ).not.toThrow();
    expect(() =>
      mutationPayloadSchemas["album.addPerson"].parse({ albumId: 1, person: { name: "Ada" } }),
    ).not.toThrow();
  });

  it("carries the note rules through to a note update", () => {
    // An important_date note still needs its tag and event date on the offline path.
    expect(() =>
      mutationPayloadSchemas["note.update"].parse({
        noteId: 1,
        category: "important_date",
        body: "",
      }),
    ).toThrow();
    expect(() =>
      mutationPayloadSchemas["note.update"].parse({
        noteId: 1,
        category: "important_date",
        body: "",
        tag: "Birthday",
        eventDate: "1990-09-03",
      }),
    ).not.toThrow();
  });
});
