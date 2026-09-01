import { describe, it, expect } from "vitest";
import { mintTempId, mintOutboxSeq } from "./tempId.js";
import { getMeta, META_OUTBOX_SEQ, META_TEMP_ID_SEQ } from "./db.js";

describe("temp-id / outbox-seq counters", () => {
  it("mintTempId walks -1, -2, -3 …", async () => {
    expect(await mintTempId()).toBe(-1);
    expect(await mintTempId()).toBe(-2);
    expect(await mintTempId()).toBe(-3);
    expect(await getMeta<number>(META_TEMP_ID_SEQ)).toBe(-3);
  });

  it("mintOutboxSeq walks 1, 2, 3 …", async () => {
    expect(await mintOutboxSeq()).toBe(1);
    expect(await mintOutboxSeq()).toBe(2);
    expect(await getMeta<number>(META_OUTBOX_SEQ)).toBe(2);
  });

  it("stays distinct under concurrent mints", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => mintTempId()));
    expect(new Set(ids).size).toBe(20);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => -(i + 1)).sort((a, b) => a - b),
    );
  });
});
