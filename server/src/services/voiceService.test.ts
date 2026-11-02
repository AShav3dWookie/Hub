import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb } from "../testUtils/testDb.js";
import { handleVoiceCommand as handle } from "./voiceService.js";
import type { AddToListReply } from "@logger/shared";
import type { AppDb } from "../db/client.js";
import { addListItem, createList, getList, listLists } from "./listService.js";
import type { VoiceParser } from "../lib/voiceModel.js";
import { AppError } from "../lib/errors.js";

/** Monday 2 November 2026, 10:00 in London (GMT, so 10:00Z). */
const CLOCK = { now: new Date("2026-11-02T10:00:00Z"), timeZone: "Europe/London" };

/** The shopping tests below: every reply is an add_to_list one. */
const handleVoiceCommand = (db: AppDb, text: string, parser: VoiceParser | null) =>
  handle(db, text, parser, CLOCK) as Promise<AddToListReply>;

describe("handleVoiceCommand", () => {
  let ctx: ReturnType<typeof createTestDb>;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  function setup() {
    ctx = createTestDb();
    const main = listLists(ctx.db).find((l) => l.isDefault)!;
    const ms = createList(ctx.db, { name: "M&S – Bangor" });
    return { main, ms };
  }

  const itemsOn = (id: number) => getList(ctx.db, id).items.map((i) => i.text);
  const model = (answer: { listId: number | null; items: string[] }): VoiceParser =>
    vi.fn().mockResolvedValue({ action: "add_to_list", input: answer });

  it("adds what the model understood to the list it chose", async () => {
    const { ms } = setup();
    const result = await handleVoiceCommand(
      ctx.db,
      "add eggs and milk to marks and spencer",
      model({ listId: ms.id, items: ["Eggs", "Milk"] }),
    );

    expect(itemsOn(ms.id)).toEqual(["Eggs", "Milk"]);
    expect(result).toEqual({
      action: "add_to_list",
      list: { id: ms.id, name: "M&S – Bangor" },
      added: ["Eggs", "Milk"],
      alreadyOnList: [],
      parsedBy: "model",
      message: "Added Eggs and Milk to M&S – Bangor",
    });
  });

  it("gives the model the shopping lists to choose from", async () => {
    const { main, ms } = setup();
    const parser = model({ listId: null, items: ["Eggs"] });
    await handleVoiceCommand(ctx.db, "add eggs", parser);
    expect(vi.mocked(parser).mock.calls[0][1].lists.map((l) => l.id).sort()).toEqual([main.id, ms.id].sort());
  });

  it("uses the main list when the model names none", async () => {
    const { main } = setup();
    const result = await handleVoiceCommand(ctx.db, "add eggs", model({ listId: null, items: ["Eggs"] }));
    expect(result.list.id).toBe(main.id);
    expect(itemsOn(main.id)).toEqual(["Eggs"]);
  });

  it("never trusts a list id the model made up", async () => {
    const { main } = setup();
    const result = await handleVoiceCommand(ctx.db, "add eggs", model({ listId: 999, items: ["Eggs"] }));
    expect(result.list.id).toBe(main.id);
  });

  it("falls back to the rules when the model fails, and says so", async () => {
    const { main } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: VoiceParser = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await handleVoiceCommand(ctx.db, "add eggs and milk", failing);

    expect(result.parsedBy).toBe("rules");
    expect(itemsOn(main.id)).toEqual(["Eggs and milk"]);
    expect(result.message).toBe("Added Eggs and milk to Shopping (simple parser — check it)");
  });

  it.each([
    ["an action that doesn't exist", { action: "delete_everything", input: {} }],
    ["input that doesn't fit the action", { action: "add_to_list", input: { list: "Tesco", items: "eggs" } }],
  ])("falls back to the rules when the model answers with %s", async (_case, answer) => {
    const { main } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await handleVoiceCommand(ctx.db, "add eggs", vi.fn().mockResolvedValue(answer));
    expect(result.parsedBy).toBe("rules");
    expect(itemsOn(main.id)).toEqual(["Eggs"]);
  });

  it("answers that it needs the model for anything but shopping when there's no model", async () => {
    setup();
    const err = await handleVoiceCommand(ctx.db, "dentist next tuesday at 3", null).catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(/^I need the model for that/) });
    expect(listLists(ctx.db).every((l) => getList(ctx.db, l.id).items.length === 0)).toBe(true);
  });

  it("answers the same when the model fails on a command that isn't shopping", async () => {
    setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing: VoiceParser = vi.fn().mockRejectedValue(new Error("timeout"));
    const err = await handleVoiceCommand(ctx.db, "haircut on the 14th", failing).catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 422, message: expect.stringMatching(/^I need the model for that/) });
  });

  it("gives the model the local date, weekday and time where the hub is", async () => {
    setup();
    const parser = model({ listId: null, items: ["Eggs"] });
    // 23:30Z on Friday 31 July is already 00:30 on Saturday 1 August in London (BST).
    await handle(ctx.db, "add eggs", parser, { now: new Date("2026-07-31T23:30:00Z"), timeZone: "Europe/London" });
    expect(vi.mocked(parser).mock.calls[0][1]).toMatchObject({
      today: "2026-08-01",
      weekday: "Saturday",
      time: "00:30",
      timeZone: "Europe/London",
    });
  });

  it("uses the rules alone when there's no model configured", async () => {
    const { ms } = setup();
    const result = await handleVoiceCommand(ctx.db, "add bread to the m&s bangor list", null);
    expect(result).toMatchObject({ parsedBy: "rules", list: { id: ms.id }, added: ["Bread"] });
  });

  it("reports items the list already has instead of adding them twice", async () => {
    const { main } = setup();
    addListItem(ctx.db, main.id, { text: "Eggs" });
    const result = await handleVoiceCommand(
      ctx.db,
      "add eggs and milk",
      model({ listId: null, items: ["eggs", "Milk", "MILK"] }),
    );

    expect(itemsOn(main.id)).toEqual(["Eggs", "Milk"]);
    expect(result).toMatchObject({ added: ["Milk"], alreadyOnList: ["Eggs"] });
    expect(result.message).toBe("Added Milk to Shopping. Eggs is already on Shopping");
  });

  it("capitalises an all-lowercase item but leaves deliberate casing alone", async () => {
    const { main } = setup();
    await handleVoiceCommand(ctx.db, "x", model({ listId: null, items: ["  bin   bags ", "iPhone charger"] }));
    expect(itemsOn(main.id)).toEqual(["Bin bags", "iPhone charger"]);
  });

  it("is a 422 with a readable message when there's nothing to add", async () => {
    setup();
    const err = await handleVoiceCommand(ctx.db, "hello there", model({ listId: null, items: ["  "] })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 422, message: 'Didn\'t catch anything to add in "hello there"' });
  });
});
