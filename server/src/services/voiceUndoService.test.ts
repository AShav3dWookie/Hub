import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { voiceCommands } from "../db/schema.js";
import type { VoiceParser } from "../lib/voiceModel.js";
import type { AppError } from "../lib/errors.js";
import { handleVoiceCommand } from "./voiceService.js";
import { VOICE_COMMAND_RETENTION_MS, undoVoiceCommand } from "./voiceUndoService.js";
import { createDeviceToken, listDeviceTokens } from "./deviceTokensService.js";
import { addListItem, deleteListItem, getList, listLists } from "./listService.js";
import { createLog, deleteLog, getLogById } from "./logService.js";
import { findEntity } from "./entityService.js";
import { VOICE_UNDO_WINDOW_MS } from "@logger/shared";

/** Monday 2 November 2026, 10:00 in London. */
const NOW = new Date("2026-11-02T10:00:00Z");
const CLOCK = { now: NOW, timeZone: "Europe/London" };
const later = (ms: number) => new Date(NOW.getTime() + ms);

const appointment = (title: string, date = "2026-11-10", time: string | null = "15:00"): VoiceParser =>
  vi.fn().mockResolvedValue({
    action: "create_log",
    input: { category: "appointment", title, date, time, autoDelete: null, rating: null, releaseYear: null, author: null, notes: null },
  });
const shopping = (...items: string[]): VoiceParser =>
  vi.fn().mockResolvedValue({ action: "add_to_list", input: { listId: null, items } });

describe("undoing a voice command", () => {
  let ctx: ReturnType<typeof createTestDb>;
  afterEach(() => ctx?.cleanup());

  function setup() {
    ctx = createTestDb();
    createDeviceToken(ctx.db, "Pixel 6");
    createDeviceToken(ctx.db, "Tablet");
    const [pixel, tablet] = listDeviceTokens(ctx.db).map((d) => d.id).sort((a, b) => a - b);
    const main = listLists(ctx.db).find((l) => l.isDefault)!;
    return { pixel, tablet, main };
  }
  const say = (text: string, parser: VoiceParser, deviceId: number | null) =>
    handleVoiceCommand(ctx.db, text, parser, CLOCK, deviceId);
  const itemsOn = (listId: number) => getList(ctx.db, listId).items.map((i) => i.text);
  const refusal = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected a refusal");
  };

  it("removes the appointment, and the entry it made", async () => {
    const { pixel } = setup();
    const reply = await say("dentist next tuesday at 3", appointment("Dentist"), pixel);
    if (reply.action !== "create_log") throw new Error("expected create_log");
    expect(reply.commandId).toEqual(expect.any(Number));

    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(60_000));

    expect(() => getLogById(ctx.db, reply.log.id)).toThrow();
    expect(findEntity(ctx.db, "appointment", "Dentist")).toBeUndefined();
  });

  it("leaves an entry that was already there, and its other appointments", async () => {
    const { pixel } = setup();
    const earlier = createLog(ctx.db, { category: "appointment", title: "Dentist", rating: null, date: "2026-10-01", notes: null, people: [] });
    const reply = await say("dentist next tuesday at 3", appointment("Dentist"), pixel);
    if (reply.action !== "create_log") throw new Error("expected create_log");

    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(60_000));

    expect(() => getLogById(ctx.db, reply.log.id)).toThrow();
    expect(getLogById(ctx.db, earlier.id).entityId).toBe(earlier.entityId);
  });

  it("keeps an entry it made that has since been used for something else", async () => {
    const { pixel } = setup();
    const reply = await say("dentist next tuesday at 3", appointment("Dentist"), pixel);
    if (reply.action !== "create_log") throw new Error("expected create_log");
    const other = createLog(ctx.db, { entityId: reply.log.entityId, rating: null, date: "2026-12-01", notes: null, people: [] });

    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(60_000));

    expect(getLogById(ctx.db, other.id).entityId).toBe(reply.log.entityId);
  });

  it("removes only the items the command added, not ones already on the list", async () => {
    const { pixel, main } = setup();
    addListItem(ctx.db, main.id, { text: "Eggs" });
    const reply = await say("add eggs and milk and bread", shopping("Eggs", "Milk", "Bread"), pixel);

    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(60_000));
    expect(itemsOn(main.id)).toEqual(["Eggs"]);
  });

  it("has nothing to undo when the command saved nothing", async () => {
    const { pixel, main } = setup();
    addListItem(ctx.db, main.id, { text: "Eggs" });
    expect((await say("add eggs", shopping("Eggs"), pixel)).commandId).toBeNull();
  });

  it("won't undo another device's command, and says it doesn't exist", async () => {
    const { pixel, tablet, main } = setup();
    const reply = await say("add milk", shopping("Milk"), pixel);

    expect(refusal(() => undoVoiceCommand(ctx.db, reply.commandId!, tablet, later(1000)))).toMatchObject({ statusCode: 404 });
    // A signed-in browser can't undo a device's command either.
    expect(refusal(() => undoVoiceCommand(ctx.db, reply.commandId!, null, later(1000)))).toMatchObject({ statusCode: 404 });
    expect(itemsOn(main.id)).toEqual(["Milk"]);
  });

  it("lets a signed-in browser undo its own", async () => {
    const { main } = setup();
    const reply = await say("add milk", shopping("Milk"), null);
    undoVoiceCommand(ctx.db, reply.commandId!, null, later(1000));
    expect(itemsOn(main.id)).toEqual([]);
  });

  it(`refuses once ${VOICE_UNDO_WINDOW_MS / 60_000} minutes have passed, by the hub's clock`, async () => {
    const { pixel, main } = setup();
    const reply = await say("add milk", shopping("Milk"), pixel);

    const err = refusal(() => undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(VOICE_UNDO_WINDOW_MS + 1)));
    expect(err).toMatchObject({ statusCode: 410, message: expect.stringMatching(/^Too late to undo/) });
    expect(itemsOn(main.id)).toEqual(["Milk"]);

    // Right at the edge still counts.
    const again = await say("add bread", shopping("Bread"), pixel);
    undoVoiceCommand(ctx.db, again.commandId!, pixel, later(VOICE_UNDO_WINDOW_MS));
    expect(itemsOn(main.id)).toEqual(["Milk"]);
  });

  it("is harmless to repeat, even after something new was added", async () => {
    const { pixel, main } = setup();
    const reply = await say("add milk", shopping("Milk"), pixel);
    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(1000));
    addListItem(ctx.db, main.id, { text: "Milk" });

    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(2000));
    // Even after the window: it was already undone.
    undoVoiceCommand(ctx.db, reply.commandId!, pixel, later(VOICE_UNDO_WINDOW_MS * 2));
    expect(itemsOn(main.id)).toEqual(["Milk"]);
  });

  it("copes with what it made having been removed meanwhile", async () => {
    const { pixel, main } = setup();
    const shop = await say("add milk and eggs", shopping("Milk", "Eggs"), pixel);
    deleteListItem(ctx.db, main.id, getList(ctx.db, main.id).items[0].id);
    const diary = await say("dentist", appointment("Dentist"), pixel);
    if (diary.action !== "create_log") throw new Error("expected create_log");
    deleteLog(ctx.db, diary.log.id);

    undoVoiceCommand(ctx.db, shop.commandId!, pixel, later(1000));
    undoVoiceCommand(ctx.db, diary.commandId!, pixel, later(1000));
    expect(itemsOn(main.id)).toEqual([]);
    expect(findEntity(ctx.db, "appointment", "Dentist")).toBeUndefined();
  });

  it("forgets commands after a day", async () => {
    const { pixel } = setup();
    await say("add milk", shopping("Milk"), pixel);
    await handleVoiceCommand(ctx.db, "add eggs", shopping("Eggs"), { ...CLOCK, now: later(VOICE_COMMAND_RETENTION_MS + 1) }, pixel);
    expect(ctx.db.select().from(voiceCommands).all().map((c) => c.created)).toEqual([
      [expect.objectContaining({ kind: "listItem" })],
    ]);
  });
});
